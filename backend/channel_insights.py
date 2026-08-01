#!/usr/bin/env python3
"""
YouTube channel profiling for the Video Ideas feature.

Resolves a free-form channel input (URL, @handle, legacy name, raw id, or a
video URL) to a canonical channel, pulls that channel's best-performing videos,
and discovers competitor channels by keyword search.

Quota: the default YouTube Data API allowance is 10,000 units/day and
search.list costs 100 units per call. One full profile computation costs
roughly 600 units (see PROFILE_QUOTA_ESTIMATE), so callers must cache results
and throttle per user.

The LLM is injected as a callable so this module stays free of Together/FastAPI
imports and can be reused by later steps of the feature.
"""

import math
import re
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from googleapiclient.errors import HttpError

# A "profile" is deliberately expensive, so every knob that multiplies quota is
# a constant here rather than a magic number at the call site.
TOP_VIDEOS_COUNT = 20
# Uploads scanned when channel search comes up short (see fetch_top_videos).
UPLOADS_SCAN_LIMIT = 150
MAX_DISCOVERY_QUERIES = 5
DISCOVERY_RESULTS_PER_QUERY = 25
MAX_CANDIDATES_TO_HYDRATE = 50
COMPETITOR_COUNT = 3
COMPETITOR_TOP_VIDEOS = 10
IDEA_COUNT = 3
PROFILE_TTL_DAYS = 7

# resolve (1) + top videos search (100) + uploads top-up (<=3) +
# videos.list (<=4) + 5 discovery searches (500) + candidate stats (3) +
# candidate hydrate (1)
PROFILE_QUOTA_ESTIMATE = 612

# 3 competitors × (search.list 100 + videos.list 1) ≈ 303 when search is full.
IDEAS_QUOTA_ESTIMATE = 303

# Ranking weights — see rank_competitors() for what each component means.
# They sum to 1.0 so a score is always 0-100 and comparable across channels.
RANK_WEIGHT_RELEVANCE = 0.45
RANK_WEIGHT_SIZE = 0.30
RANK_WEIGHT_EXPOSURE = 0.15
RANK_WEIGHT_ACTIVITY = 0.10

# log10 ceilings: 100M subscribers and 1B matched views both saturate at 1.0.
SIZE_LOG_CEILING = 8.0
EXPOSURE_LOG_CEILING = 9.0
ACTIVITY_WINDOW_DAYS = 365

_CHANNEL_ID_RE = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
_HANDLE_RE = re.compile(r"^@?[A-Za-z0-9._-]{3,30}$")
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_ISO_DURATION_RE = re.compile(
    r"^P(?:(?P<days>\d+)D)?T?(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?$"
)
_YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}


class ChannelInsightsError(Exception):
    """Base error with a message that is safe to show a user."""


class ChannelNotFoundError(ChannelInsightsError):
    """The input could not be resolved to a YouTube channel."""


class YouTubeQuotaError(ChannelInsightsError):
    """The API key is out of daily quota (or rate limited)."""


class YouTubeApiError(ChannelInsightsError):
    """Any other YouTube API failure; raw Google errors never reach the client."""


def _execute(request):
    """Run a googleapiclient request, translating HttpError into our own errors.

    Google's error bodies contain the API key and internal reason codes, so the
    message is replaced rather than forwarded.
    """
    try:
        return request.execute()
    except HttpError as exc:
        reason = ""
        try:
            errors = exc.error_details or []
            if errors:
                reason = errors[0].get("reason", "")
        except (AttributeError, IndexError, TypeError):
            reason = ""
        status = getattr(getattr(exc, "resp", None), "status", None)
        if (
            reason in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded")
            or status == 403
        ):
            raise YouTubeQuotaError(
                "YouTube's daily data quota is used up. Please try again tomorrow."
            )
        print(f"YouTube API error: status={status} reason={reason or 'unknown'}")
        raise YouTubeApiError("YouTube is not responding right now. Please try again.")
    except Exception as exc:
        print(f"YouTube request failed: {type(exc).__name__}")
        raise YouTubeApiError("YouTube is not responding right now. Please try again.")


def _int_val(value) -> int:
    try:
        return int(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return 0


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _duration_seconds(iso_duration: Optional[str]) -> int:
    """Convert an ISO 8601 duration (PT12M30S) to seconds; 0 when unparseable."""
    if not iso_duration:
        return 0
    match = _ISO_DURATION_RE.match(iso_duration)
    if not match:
        return 0
    parts = {k: int(v) for k, v in match.groupdict(default="0").items()}
    return (
        parts["days"] * 86400
        + parts["hours"] * 3600
        + parts["minutes"] * 60
        + parts["seconds"]
    )


def _thumbnail_url(thumbnails: Dict) -> str:
    for size in ("high", "medium", "default"):
        url = (thumbnails or {}).get(size, {}).get("url")
        if url:
            return url
    return ""


def _chunked(items: List[str], size: int) -> List[List[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def channel_url(channel_id: str, handle: Optional[str]) -> str:
    if handle:
        return f"https://www.youtube.com/{handle}"
    return f"https://www.youtube.com/channel/{channel_id}"


def parse_channel_input(raw: str) -> List[Tuple[str, str]]:
    """Turn free-form input into ordered (strategy, value) resolution attempts.

    Strategies, cheapest and most precise first: "id" and "video" are exact
    lookups (1 unit), "handle"/"username" are exact-but-may-miss lookups
    (1 unit), and "search" is the 100-unit last resort.
    """
    text = (raw or "").strip()
    if not text:
        return []

    attempts: List[Tuple[str, str]] = []

    def add(kind: str, value: str) -> None:
        value = (value or "").strip()
        if value and (kind, value) not in attempts:
            attempts.append((kind, value))

    looks_like_url = "://" in text or "/" in text or text.lower().startswith("www.")
    if looks_like_url:
        parsed = urlparse(text if "://" in text else f"https://{text}")
        host = (parsed.netloc or "").lower()
        if host not in _YOUTUBE_HOSTS and not host.endswith(".youtube.com"):
            # Not a YouTube link: fail immediately instead of spending 100 units
            # on a search that cannot succeed.
            return []

        segments = [s for s in (parsed.path or "").split("/") if s]
        query = parse_qs(parsed.query or "")
        head = segments[0] if segments else ""

        if query.get("v"):
            add("video", query["v"][0])
        if host in ("youtu.be", "www.youtu.be") and segments:
            add("video", head)
        elif head.startswith("@"):
            add("handle", head)
            add("search", head.lstrip("@"))
        elif head.lower() == "channel" and len(segments) > 1:
            add("id", segments[1])
        elif (
            head.lower() in ("watch", "shorts", "embed", "live", "v")
            and len(segments) > 1
        ):
            add("video", segments[1])
        elif head.lower() == "user" and len(segments) > 1:
            add("username", segments[1])
            add("handle", segments[1])
            add("search", segments[1])
        elif head.lower() == "c" and len(segments) > 1:
            add("handle", segments[1])
            add("username", segments[1])
            add("search", segments[1])
        return attempts

    if _CHANNEL_ID_RE.match(text):
        # An exact id either exists or doesn't; searching for it would be 100
        # wasted units.
        return [("id", text)]
    if text.startswith("@"):
        add("handle", text)
    elif _HANDLE_RE.match(text):
        add("handle", text)
        add("username", text)
    if _VIDEO_ID_RE.match(text) and not text.startswith("@"):
        add("video", text)

    # Last resort: 100 units, and search relevance can be wrong, so it only runs
    # after every exact lookup has failed.
    add("search", text.lstrip("@"))
    return attempts


def _channel_from_item(item: Dict) -> Dict:
    snippet = item.get("snippet", {}) or {}
    stats = item.get("statistics", {}) or {}
    content = (item.get("contentDetails", {}) or {}).get("relatedPlaylists", {}) or {}
    channel_id = item.get("id", "")
    custom_url = snippet.get("customUrl") or ""
    handle = (
        custom_url
        if custom_url.startswith("@")
        else (f"@{custom_url}" if custom_url else "")
    )
    hidden = bool(stats.get("hiddenSubscriberCount"))
    return {
        "channel_id": channel_id,
        "title": snippet.get("title", ""),
        "handle": handle,
        "description": snippet.get("description", "") or "",
        "thumbnail": _thumbnail_url(snippet.get("thumbnails", {})),
        "subscriber_count": None if hidden else _int_val(stats.get("subscriberCount")),
        "video_count": _int_val(stats.get("videoCount")),
        "view_count": _int_val(stats.get("viewCount")),
        "published_at": snippet.get("publishedAt", "") or "",
        "country": snippet.get("country", "") or "",
        "uploads_playlist_id": content.get("uploads", "") or "",
        "url": channel_url(channel_id, handle),
    }


def _channels_list(youtube, **kwargs) -> List[Dict]:
    """channels.list with the parts every caller here needs. Cost: 1 unit."""
    response = _execute(
        youtube.channels().list(
            part="snippet,statistics,contentDetails", maxResults=50, **kwargs
        )
    )
    return response.get("items", []) or []


def resolve_channel(youtube, raw_input: str) -> Dict:
    """Resolve free-form input to one canonical channel.

    Raises ChannelNotFoundError with an actionable message when nothing matches.
    """
    attempts = parse_channel_input(raw_input)
    if not attempts:
        raise ChannelNotFoundError(
            "Enter a YouTube channel URL, @handle, or channel ID."
        )

    for kind, value in attempts:
        items: List[Dict] = []
        if kind == "id":
            if not _CHANNEL_ID_RE.match(value):
                continue
            items = _channels_list(youtube, id=value)
        elif kind == "video":
            # videos.list is 1 unit and gives us the owning channel exactly.
            response = _execute(youtube.videos().list(part="snippet", id=value))
            video_items = response.get("items", []) or []
            if not video_items:
                continue
            owner = (video_items[0].get("snippet", {}) or {}).get("channelId")
            if owner:
                items = _channels_list(youtube, id=owner)
        elif kind == "handle":
            handle = value if value.startswith("@") else f"@{value}"
            items = _channels_list(youtube, forHandle=handle)
        elif kind == "username":
            items = _channels_list(youtube, forUsername=value)
        elif kind == "search":
            response = _execute(
                youtube.search().list(
                    part="snippet", type="channel", q=value, maxResults=1
                )
            )
            hits = response.get("items", []) or []
            if not hits:
                continue
            found_id = (hits[0].get("snippet", {}) or {}).get("channelId") or (
                hits[0].get("id", {}) or {}
            ).get("channelId")
            if found_id:
                items = _channels_list(youtube, id=found_id)

        if items:
            return _channel_from_item(items[0])

    raise ChannelNotFoundError(
        "We couldn't find that channel. Try the full channel URL "
        "(youtube.com/@yourhandle) or paste a link to one of your videos."
    )


def _search_top_video_ids(youtube, channel_id: str, limit: int) -> List[str]:
    """All-time most-viewed video ids for a channel. Cost: 100 units."""
    response = _execute(
        youtube.search().list(
            part="id",
            channelId=channel_id,
            type="video",
            order="viewCount",
            maxResults=max(1, min(limit, 50)),
        )
    )
    return [
        (item.get("id", {}) or {}).get("videoId")
        for item in response.get("items", []) or []
        if (item.get("id", {}) or {}).get("videoId")
    ]


def _recent_upload_ids(youtube, uploads_playlist_id: str, scan_limit: int) -> List[str]:
    """Most recent upload ids from the channel's uploads playlist (1 unit/50)."""
    ids: List[str] = []
    page_token = None
    while len(ids) < scan_limit:
        response = _execute(
            youtube.playlistItems().list(
                part="contentDetails",
                playlistId=uploads_playlist_id,
                maxResults=min(50, scan_limit - len(ids)),
                pageToken=page_token,
            )
        )
        for item in response.get("items", []) or []:
            video_id = (item.get("contentDetails", {}) or {}).get("videoId")
            if video_id:
                ids.append(video_id)
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return ids


def _hydrate_videos(youtube, video_ids: List[str]) -> List[Dict]:
    """videos.list in batches of 50 (1 unit each) for stats search omits."""
    videos: List[Dict] = []
    for batch in _chunked(video_ids, 50):
        details = _execute(
            youtube.videos().list(
                part="snippet,statistics,contentDetails", id=",".join(batch)
            )
        )
        for item in details.get("items", []) or []:
            snippet = item.get("snippet", {}) or {}
            stats = item.get("statistics", {}) or {}
            videos.append(
                {
                    "video_id": item.get("id", ""),
                    "title": snippet.get("title", ""),
                    "published_at": snippet.get("publishedAt", "") or "",
                    "view_count": _int_val(stats.get("viewCount")),
                    "like_count": _int_val(stats.get("likeCount")),
                    "comment_count": _int_val(stats.get("commentCount")),
                    "duration_seconds": _duration_seconds(
                        (item.get("contentDetails", {}) or {}).get("duration")
                    ),
                    "tags": (snippet.get("tags") or [])[:10],
                    "thumbnail": _thumbnail_url(snippet.get("thumbnails", {})),
                    "url": f"https://www.youtube.com/watch?v={item.get('id', '')}",
                }
            )
    return videos


def fetch_top_videos(
    youtube,
    channel_id: str,
    limit: int = TOP_VIDEOS_COUNT,
    uploads_playlist_id: str = "",
) -> List[Dict]:
    """The channel's best-performing videos, most viewed first.

    search.list(order=viewCount) is the only way to reach all-time top
    performers, but YouTube's channel-scoped search index is lossy — it
    regularly returns a handful of results for a maxResults=20 request, even
    for huge channels. When it comes up short we top the list up from the
    uploads playlist (1 unit per 50 ids) and re-sort by actual view count.
    """
    limit = max(1, min(limit, 50))
    video_ids = _search_top_video_ids(youtube, channel_id, limit)

    if len(video_ids) < limit and uploads_playlist_id:
        seen = set(video_ids)
        for video_id in _recent_upload_ids(
            youtube, uploads_playlist_id, UPLOADS_SCAN_LIMIT
        ):
            if video_id not in seen:
                seen.add(video_id)
                video_ids.append(video_id)

    if not video_ids:
        return []

    videos = _hydrate_videos(youtube, video_ids)
    videos.sort(key=lambda v: v["view_count"], reverse=True)
    return videos[:limit]


def build_vibe_prompt(channel: Dict, top_videos: List[Dict]) -> str:
    titles = "\n".join(
        f"{i+1}. {v['title']} ({v['view_count']:,} views)"
        for i, v in enumerate(top_videos[:TOP_VIDEOS_COUNT])
    )
    tags = sorted({t for v in top_videos for t in v.get("tags", [])})[:25]
    tags_line = f"Tags used across those videos: {', '.join(tags)}\n" if tags else ""
    subs = channel.get("subscriber_count")
    subs_line = (
        f"{subs:,} subscribers" if isinstance(subs, int) else "subscriber count hidden"
    )

    return f"""You are profiling a YouTube channel so we can later recommend video ideas to its creator.

Channel: {channel.get('title', '')} ({subs_line}, {channel.get('video_count', 0)} videos)
Channel description: {(channel.get('description') or '')[:1500]}
{tags_line}
Top performing videos by views:
{titles}

Return ONLY a JSON object, no prose and no markdown fences, with exactly these keys:
{{
  "niche": "the specific niche in 3-8 words",
  "topics": ["4-6 recurring subjects, each 1-4 words"],
  "format": "how the videos are made and structured, one sentence",
  "audience": "who watches this and why, one sentence",
  "tone": "the personality and delivery style, one sentence",
  "summary": "two sentences a stranger could read to instantly get this channel",
  "search_queries": ["{MAX_DISCOVERY_QUERIES} search phrases a fan of this channel would type into YouTube"]
}}

Rules:
- search_queries must be things viewers search for, not the channel's name and not the video titles verbatim
- search_queries should be broad enough that rival channels in this niche rank for them
- Base everything on the evidence above; never invent facts about the creator"""


def build_competitor_reasons_prompt(channel: Dict, competitors: List[Dict]) -> str:
    lines = "\n".join(
        f"- {c['channel_id']}: {c['title']} — {(c.get('description') or '')[:220]}"
        for c in competitors
    )
    return f"""These YouTube channels compete with "{channel.get('title', '')}" ({channel.get('niche_hint', '')}).

{lines}

Return ONLY a JSON object mapping each channel id to a single sentence (max 18 words) explaining why it competes for the same viewers:
{{"CHANNEL_ID": "reason"}}

Be concrete about the overlap in topic, format, or audience. No markdown fences."""


def _coerce_queries(payload: Optional[Dict]) -> List[str]:
    raw = (payload or {}).get("search_queries")
    if not isinstance(raw, list):
        return []
    queries: List[str] = []
    for item in raw:
        text = str(item).strip()
        if text and text.lower() not in {q.lower() for q in queries}:
            queries.append(text)
    return queries[:MAX_DISCOVERY_QUERIES]


def coerce_vibe(payload: Optional[Dict]) -> Dict:
    """Normalize the LLM's vibe object; missing fields degrade to empty."""
    data = payload or {}

    def text(key: str) -> str:
        value = data.get(key)
        return str(value).strip() if isinstance(value, (str, int, float)) else ""

    topics_raw = data.get("topics")
    topics: List[str] = []
    if isinstance(topics_raw, list):
        topics = [str(t).strip() for t in topics_raw if str(t).strip()][:8]
    elif isinstance(topics_raw, str):
        topics = [t.strip() for t in topics_raw.split(",") if t.strip()][:8]

    return {
        "niche": text("niche"),
        "topics": topics,
        "format": text("format"),
        "audience": text("audience"),
        "tone": text("tone"),
        "summary": text("summary"),
        "search_queries": _coerce_queries(data),
    }


def discover_candidates(
    youtube, own_channel_id: str, queries: List[str]
) -> Dict[str, Dict]:
    """Tally channels that rank for the channel's own audience's searches.

    relatedToVideoId was removed from the Data API, so discovery is keyword
    driven: one search.list per query at 100 units each, hence the
    MAX_DISCOVERY_QUERIES cap.
    """
    tally: Dict[str, Dict] = {}
    video_ids: List[str] = []
    video_owner: Dict[str, str] = {}

    for query in queries[:MAX_DISCOVERY_QUERIES]:
        response = _execute(
            youtube.search().list(
                part="snippet",
                type="video",
                q=query,
                order="relevance",
                maxResults=DISCOVERY_RESULTS_PER_QUERY,
            )
        )
        seen_this_query = set()
        for item in response.get("items", []) or []:
            snippet = item.get("snippet", {}) or {}
            candidate_id = snippet.get("channelId")
            video_id = (item.get("id", {}) or {}).get("videoId")
            if not candidate_id or candidate_id == own_channel_id:
                continue
            entry = tally.setdefault(
                candidate_id,
                {
                    "channel_id": candidate_id,
                    "queries_matched": 0,
                    "matched_videos": 0,
                    "matched_views": 0,
                    "latest_published_at": None,
                },
            )
            if candidate_id not in seen_this_query:
                seen_this_query.add(candidate_id)
                entry["queries_matched"] += 1
            entry["matched_videos"] += 1
            published = _parse_iso_datetime(snippet.get("publishedAt"))
            if published and (
                entry["latest_published_at"] is None
                or published > entry["latest_published_at"]
            ):
                entry["latest_published_at"] = published
            if video_id:
                video_ids.append(video_id)
                video_owner[video_id] = candidate_id

    # Matched-video view counts are the exposure signal; search.list does not
    # return statistics, so this costs 1 extra unit per 50 videos.
    for batch in _chunked(video_ids, 50):
        response = _execute(
            youtube.videos().list(part="statistics", id=",".join(batch))
        )
        for item in response.get("items", []) or []:
            owner = video_owner.get(item.get("id", ""))
            if owner and owner in tally:
                tally[owner]["matched_views"] += _int_val(
                    (item.get("statistics", {}) or {}).get("viewCount")
                )

    return tally


def hydrate_candidates(youtube, tally: Dict[str, Dict]) -> List[Dict]:
    """Fetch snippet+statistics for the strongest candidates (1 unit per 50)."""
    ordered = sorted(
        tally.values(),
        key=lambda c: (c["queries_matched"], c["matched_views"]),
        reverse=True,
    )[:MAX_CANDIDATES_TO_HYDRATE]
    if not ordered:
        return []

    by_id = {c["channel_id"]: c for c in ordered}
    hydrated: List[Dict] = []
    for batch in _chunked(list(by_id.keys()), 50):
        for item in _channels_list(youtube, id=",".join(batch)):
            channel = _channel_from_item(item)
            signals = by_id.get(channel["channel_id"])
            if not signals:
                continue
            channel.update(
                {
                    "queries_matched": signals["queries_matched"],
                    "matched_videos": signals["matched_videos"],
                    "matched_views": signals["matched_views"],
                    "latest_published_at": signals["latest_published_at"],
                }
            )
            hydrated.append(channel)
    return hydrated


def _log_ratio(value: int, ceiling: float) -> float:
    if value <= 0:
        return 0.0
    return max(0.0, min(1.0, math.log10(value + 1) / ceiling))


def rank_competitors(
    candidates: List[Dict], query_count: int, limit: int = COMPETITOR_COUNT
) -> List[Dict]:
    """Score and return the strongest competitors, highest score first.

    score = 100 * (0.45*relevance + 0.30*size + 0.15*exposure + 0.10*activity)

      relevance — share of the viewer search queries the channel ranked for.
                  This is what makes a big channel a *competitor* and not just
                  a big channel.
      size      — log10(subscribers) / 8, so 100M subs scores 1.0. Answers the
                  "biggest" half of "biggest relevant competitor".
      exposure  — log10(views on the videos that ranked) / 9. Separates channels
                  whose matching videos actually get watched.
      activity  — 1.0 if its most recent matching upload is within a year,
                  decaying linearly to 0 over the following year. A dormant
                  channel is not competition for the next video.

    Subscriber counts can be hidden by the creator; those channels fall back to
    a total-view-derived size estimate so they are neither dropped nor treated
    as zero-subscriber.
    """
    query_count = max(1, query_count)
    now = datetime.now(timezone.utc)
    ranked: List[Dict] = []

    for candidate in candidates:
        relevance = min(1.0, candidate.get("queries_matched", 0) / query_count)

        subscribers = candidate.get("subscriber_count")
        if isinstance(subscribers, int):
            size = _log_ratio(subscribers, SIZE_LOG_CEILING)
        else:
            # Hidden subscriber count: total channel views are ~2 orders of
            # magnitude above subscribers for a typical channel.
            size = _log_ratio(candidate.get("view_count", 0) // 100, SIZE_LOG_CEILING)

        exposure = _log_ratio(candidate.get("matched_views", 0), EXPOSURE_LOG_CEILING)

        latest = candidate.get("latest_published_at")
        if isinstance(latest, datetime):
            age_days = max(0.0, (now - latest).total_seconds() / 86400)
            activity = max(0.0, min(1.0, 2.0 - age_days / ACTIVITY_WINDOW_DAYS))
        else:
            activity = 0.0

        score = 100 * (
            RANK_WEIGHT_RELEVANCE * relevance
            + RANK_WEIGHT_SIZE * size
            + RANK_WEIGHT_EXPOSURE * exposure
            + RANK_WEIGHT_ACTIVITY * activity
        )

        entry = dict(candidate)
        entry["score"] = round(score, 2)
        entry["score_components"] = {
            "relevance": round(relevance, 3),
            "size": round(size, 3),
            "exposure": round(exposure, 3),
            "activity": round(activity, 3),
            "queries_matched": candidate.get("queries_matched", 0),
            "queries_total": query_count,
            "matched_views": candidate.get("matched_views", 0),
        }
        ranked.append(entry)

    ranked.sort(key=lambda c: c["score"], reverse=True)
    return ranked[:limit]


def _fallback_reason(competitor: Dict, vibe: Dict) -> str:
    niche = vibe.get("niche") or "this niche"
    matched = competitor.get("score_components", {}).get("queries_matched", 0)
    return f"Ranks for {matched} of the searches your viewers make about {niche}."


def compute_channel_profile(
    youtube,
    channel: Dict,
    llm_json: Callable[[str], Optional[Dict]],
) -> Dict:
    """Full Step 1 payload: top videos, vibe profile, and top competitors.

    llm_json(prompt) must return the parsed JSON object the prompt asks for, or
    None. Every LLM failure degrades to a usable-but-thinner result rather than
    failing the whole request.
    """
    top_videos = fetch_top_videos(
        youtube,
        channel["channel_id"],
        uploads_playlist_id=channel.get("uploads_playlist_id", ""),
    )

    vibe = coerce_vibe(llm_json(build_vibe_prompt(channel, top_videos)))
    queries = vibe.get("search_queries") or []
    if not queries:
        # Without LLM queries there is still a usable fallback: the channel's
        # own niche/title, which keeps discovery working on a bad LLM day.
        fallback = vibe.get("niche") or channel.get("title", "")
        queries = [fallback] if fallback else []
        vibe["search_queries"] = queries

    competitors: List[Dict] = []
    if queries:
        tally = discover_candidates(youtube, channel["channel_id"], queries)
        candidates = hydrate_candidates(youtube, tally)
        competitors = rank_competitors(candidates, len(queries))

    if competitors:
        reason_channel = dict(channel)
        reason_channel["niche_hint"] = vibe.get("niche", "")
        reasons = (
            llm_json(build_competitor_reasons_prompt(reason_channel, competitors)) or {}
        )
        for competitor in competitors:
            reason = (
                reasons.get(competitor["channel_id"])
                if isinstance(reasons, dict)
                else None
            )
            competitor["reason"] = (
                str(reason).strip() if reason else _fallback_reason(competitor, vibe)
            )
            # latest_published_at is a datetime; the caller stores this as jsonb.
            latest = competitor.pop("latest_published_at", None)
            competitor["latest_matched_upload"] = (
                latest.isoformat() if isinstance(latest, datetime) else None
            )

    return {
        "top_videos": top_videos,
        "vibe": vibe,
        "competitors": competitors,
    }


def profile_is_fresh(
    computed_at: Optional[datetime], ttl_days: int = PROFILE_TTL_DAYS
) -> bool:
    if not isinstance(computed_at, datetime):
        return False
    if computed_at.tzinfo is None:
        computed_at = computed_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - computed_at < timedelta(days=ttl_days)


def fetch_competitor_top_videos(
    youtube, competitors: List[Dict], limit: int = COMPETITOR_TOP_VIDEOS
) -> List[Dict]:
    """Top videos for each competitor. Cost: ~100 units per competitor."""
    packages: List[Dict] = []
    for competitor in competitors[:COMPETITOR_COUNT]:
        channel_id = competitor.get("channel_id") or ""
        if not channel_id:
            continue
        videos = fetch_top_videos(
            youtube,
            channel_id,
            limit=limit,
            uploads_playlist_id=competitor.get("uploads_playlist_id", "") or "",
        )
        packages.append(
            {
                "channel_id": channel_id,
                "title": competitor.get("title", ""),
                "handle": competitor.get("handle", "") or "",
                "top_videos": videos,
            }
        )
    return packages


def build_ideas_prompt(
    channel: Dict,
    vibe: Dict,
    user_top_videos: List[Dict],
    competitor_packages: List[Dict],
) -> str:
    user_titles = "\n".join(
        f"{i+1}. {v['title']} ({v['view_count']:,} views)"
        for i, v in enumerate(user_top_videos[:TOP_VIDEOS_COUNT])
    ) or "(no public top videos available)"

    competitor_blocks: List[str] = []
    for package in competitor_packages:
        video_lines = []
        for i, v in enumerate(package.get("top_videos") or []):
            line = f"  {i+1}. {v['title']} ({v['view_count']:,} views)"
            if v.get("video_id"):
                line += f" [{v['video_id']}]"
            video_lines.append(line)
        lines = "\n".join(video_lines) or "  (no videos found)"
        competitor_blocks.append(
            f"Competitor: {package.get('title', '')} "
            f"({package.get('handle') or package.get('channel_id', '')})\n{lines}"
        )

    competitors_text = "\n\n".join(competitor_blocks) or "(no competitors)"
    topics = ", ".join(vibe.get("topics") or []) or "unknown"

    return f"""You recommend YouTube video ideas for a creator by studying what already worked for their closest competitors — then adapting those patterns to THIS creator's channel, not copying titles.

Creator channel: {channel.get('title', '')}
Niche: {vibe.get('niche') or 'unknown'}
Topics: {topics}
Format: {vibe.get('format') or 'unknown'}
Audience: {vibe.get('audience') or 'unknown'}
Tone: {vibe.get('tone') or 'unknown'}
Vibe summary: {vibe.get('summary') or ''}

Creator's own top videos:
{user_titles}

Competitor top videos (what is already winning in this niche):
{competitors_text}

Return ONLY a JSON object, no prose and no markdown fences:
{{
  "ideas": [
    {{
      "title": "a specific, publishable working title the creator could use",
      "hook": "the first 10-15 seconds / thumbnail promise, one sentence",
      "angle": "how to film and frame it in THIS creator's style, one sentence",
      "why_it_works": "why this concept wins for their audience, grounded in the competitor evidence, one or two sentences",
      "inspired_by": [
        {{
          "channel_title": "competitor name",
          "video_title": "exact competitor video title that inspired this",
          "video_id": "11-char id from the list above, or empty string if unsure"
        }}
      ]
    }}
  ]
}}

Rules:
- Return exactly {IDEA_COUNT} ideas
- Each idea must be clearly adapted to the creator's niche, format, audience, and tone — not a clone of a competitor title
- Prefer concepts that competitors proved with high views but that the creator has not already covered in their top videos
- inspired_by must reference real videos from the competitor list (use the video_id in brackets when present)
- Titles should be concrete and searchable, not vague ("Things I Learned…")
- No hashtags, no emoji spam, no "Part 1" without a reason"""


def coerce_ideas(payload: Optional[Dict], competitor_packages: List[Dict]) -> List[Dict]:
    """Normalize LLM ideas; drop junk and pad nothing — fewer than 3 is ok."""
    data = payload or {}
    raw = data.get("ideas") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return []

    known_videos: Dict[str, Dict] = {}
    for package in competitor_packages:
        for video in package.get("top_videos") or []:
            vid = video.get("video_id") or ""
            if vid:
                known_videos[vid] = {
                    "channel_title": package.get("title", ""),
                    "video_title": video.get("title", ""),
                    "video_id": vid,
                    "url": video.get("url")
                    or f"https://www.youtube.com/watch?v={vid}",
                    "view_count": video.get("view_count", 0),
                }

    ideas: List[Dict] = []
    for item in raw[:IDEA_COUNT]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue

        inspired_raw = item.get("inspired_by")
        inspired: List[Dict] = []
        if isinstance(inspired_raw, list):
            for ref in inspired_raw[:3]:
                if not isinstance(ref, dict):
                    continue
                video_id = str(ref.get("video_id") or "").strip()
                if video_id in known_videos:
                    inspired.append(known_videos[video_id])
                    continue
                video_title = str(ref.get("video_title") or "").strip()
                channel_title = str(ref.get("channel_title") or "").strip()
                if not video_title:
                    continue
                inspired.append(
                    {
                        "channel_title": channel_title,
                        "video_title": video_title,
                        "video_id": video_id if _VIDEO_ID_RE.match(video_id) else "",
                        "url": (
                            f"https://www.youtube.com/watch?v={video_id}"
                            if _VIDEO_ID_RE.match(video_id)
                            else ""
                        ),
                        "view_count": 0,
                    }
                )

        ideas.append(
            {
                "title": title[:160],
                "hook": str(item.get("hook") or "").strip()[:280],
                "angle": str(item.get("angle") or "").strip()[:280],
                "why_it_works": str(item.get("why_it_works") or "").strip()[:500],
                "inspired_by": inspired,
            }
        )
    return ideas


def _fallback_ideas(
    channel: Dict, vibe: Dict, competitor_packages: List[Dict]
) -> List[Dict]:
    """When the LLM fails, surface the strongest competitor patterns as prompts."""
    ideas: List[Dict] = []
    niche = vibe.get("niche") or channel.get("title") or "your niche"
    for package in competitor_packages:
        if len(ideas) >= IDEA_COUNT:
            break
        videos = package.get("top_videos") or []
        if not videos:
            continue
        top = videos[0]
        ideas.append(
            {
                "title": f"{top['title']} — your take for {niche}",
                "hook": f"Open with the same tension that made this hit for {package.get('title', 'a rival')}.",
                "angle": f"Shoot it in your own format and tone so it fits {channel.get('title', 'your channel')}.",
                "why_it_works": (
                    f"{package.get('title', 'A competitor')}'s \"{top['title']}\" "
                    f"drew {top.get('view_count', 0):,} views — the pattern is proven in your niche."
                ),
                "inspired_by": [
                    {
                        "channel_title": package.get("title", ""),
                        "video_title": top.get("title", ""),
                        "video_id": top.get("video_id", ""),
                        "url": top.get("url")
                        or f"https://www.youtube.com/watch?v={top.get('video_id', '')}",
                        "view_count": top.get("view_count", 0),
                    }
                ],
            }
        )
    return ideas


def compute_video_ideas(
    youtube,
    channel: Dict,
    vibe: Dict,
    user_top_videos: List[Dict],
    competitors: List[Dict],
    llm_json: Callable[[str], Optional[Dict]],
) -> Dict:
    """Step 2: competitor top videos → 3 tailored ideas for the user's channel."""
    if not competitors:
        return {"ideas": [], "competitor_videos": []}

    competitor_packages = fetch_competitor_top_videos(youtube, competitors)
    payload = llm_json(
        build_ideas_prompt(channel, vibe, user_top_videos, competitor_packages)
    )
    ideas = coerce_ideas(payload, competitor_packages)
    if not ideas:
        ideas = _fallback_ideas(channel, vibe, competitor_packages)

    return {
        "ideas": ideas,
        "competitor_videos": competitor_packages,
    }
