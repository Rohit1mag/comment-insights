#!/usr/bin/env python3
"""
FastAPI backend for Disstill
"""

import os
import re
import json
import random
import secrets
import asyncio
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional, Tuple
from urllib.parse import urlparse, parse_qs
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
import stripe
from io import BytesIO

# Import from local module (same directory)
import db
import channel_insights
from channel_insights import (
    ChannelInsightsError,
    ChannelNotFoundError,
    YouTubeQuotaError,
)
from fetch_comments import get_youtube_service, get_video_comments, get_video_details
from clerk_auth import ClerkAuthError, clerk_configured, email_from_session_token
from together import Together

# Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Vercel forwards the full public path (/api/python/...) to this service, while
# local dev strips it in the Next rewrite. root_path makes both match the routes below.
ROOT_PATH = "/api/python" if os.getenv("VERCEL") else ""

app = FastAPI(title="Disstill API", root_path=ROOT_PATH)


@app.on_event("startup")
async def startup_event():
    print(f"Disstill API started (model={LLM_MODEL})")
    if not clerk_configured():
        # Fails closed rather than trusting client input, so say so loudly:
        # every signed-in route 401s until an issuer can be resolved.
        print(
            "WARNING: Clerk is not configured. Set CLERK_ISSUER (or "
            "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) and CLERK_SECRET_KEY. "
            "Signed-in routes will return 401; the guest trial still works."
        )

LLM_MODEL = "google/gemma-4-31B-it"
# Together SDK default timeout is ~60s; large comment prompts need longer
LLM_TIMEOUT_SECS = 300.0
# Comments sent to the LLM (top engaged + random sample)
LLM_SAMPLE_SIZE = 200
ACTIONS_MARKER = "---ACTIONS---"
# Gemma-4 thinking can burn the entire max_tokens budget with zero visible content.
INSIGHTS_MAX_TOKENS = 2000


def get_together_client() -> Together:
    """Create a Together client with a production-safe timeout."""
    api_key = os.getenv("TOGETHER_API_KEY")
    if not api_key:
        raise ValueError("TOGETHER_API_KEY not set")
    return Together(api_key=api_key, timeout=LLM_TIMEOUT_SECS, max_retries=2)


def _insights_completion_kwargs(**extra):
    """Shared chat.completions kwargs for summary+actions (thinking disabled)."""
    kwargs = {
        "model": LLM_MODEL,
        "max_tokens": INSIGHTS_MAX_TOKENS,
        # Prevent Gemma-4 from consuming the token budget on hidden thought tokens.
        "chat_template_kwargs": {"enable_thinking": False},
    }
    kwargs.update(extra)
    return kwargs


def _stream_delta_text(chunk) -> str:
    """Extract visible text from a streaming chunk (skips empty-choice heartbeats)."""
    try:
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            return ""
        delta = getattr(choices[0], "delta", None)
        if not delta:
            return ""
        text = getattr(delta, "content", None) or ""
        if text:
            return text
        # Some reasoning models stream the answer via reasoning_content
        return getattr(delta, "reasoning_content", None) or ""
    except (AttributeError, IndexError, TypeError):
        return ""


# Usage tracking — /tmp on Vercel (writable); local files for dev
_DATA_DIR = Path("/tmp/disstill") if os.getenv("VERCEL") else Path(__file__).parent
_DATA_DIR.mkdir(parents=True, exist_ok=True)
USAGE_FILE = _DATA_DIR / "usage_data.json"
SUBSCRIPTIONS_FILE = _DATA_DIR / "subscriptions_data.json"
GUEST_USAGE_FILE = _DATA_DIR / "guest_usage.json"

# Guest trial: 1 free analysis per guest cookie; IP soft-cap for spray abuse
GUEST_COOKIE_NAME = "disstill_guest_id"
GUEST_ANALYSIS_LIMIT = 1
GUEST_IP_LIMIT_24H = 3
GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365  # 1 year

# Uncached channel profiles per account per day. Each one spends ~600 of the
# key's 10,000 daily YouTube units, so this is a shared-resource guard, not a
# billing tier — see _enforce_profile_throttle.
CHANNEL_PROFILE_RUNS_PER_DAY = 5
CHANNEL_LLM_TIMEOUT_SECS = 60.0

# Stripe configuration
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
STRIPE_PRICE_ID = os.getenv("STRIPE_PRICE_ID")  # Pro tier price ID from Stripe dashboard

# Tier definitions
TIER_LIMITS = {
    "FREE": 5,
    "PRO": 15,
    "PREMIUM": 1000,
    "UNLIMITED": -1  # -1 means unlimited
}

# User tier assignments (email -> tier name)
USER_TIERS = {
    "rohitkota4@gmail.com": "UNLIMITED",
    "rkdscnd@gmail.com": "PREMIUM",
    # Add Pro users here as they subscribe
    # "user@example.com": "PRO",
}

# Default tier for new users
DEFAULT_TIER = "FREE"


def get_current_month() -> str:
    """Get current month in YYYY-MM format."""
    return datetime.now().strftime("%Y-%m")


def load_usage_data() -> Dict:
    """Load usage data from file."""
    if USAGE_FILE.exists():
        try:
            with open(USAGE_FILE, "r") as f:
                data = json.load(f)
                # Migrate old format (simple int) to new format (dict with used and last_reset_month)
                migrated = {}
                for email, value in data.items():
                    if isinstance(value, int):
                        # Old format: just a number
                        migrated[email] = {
                            "used": value,
                            "last_reset_month": get_current_month()
                        }
                    else:
                        # New format: already a dict
                        migrated[email] = value
                return migrated
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def save_usage_data(data: Dict) -> None:
    """Save usage data to file."""
    with open(USAGE_FILE, "w") as f:
        json.dump(data, f, indent=2)


def get_user_usage(email: str) -> int:
    """Get the number of analyses used by a user, resetting if it's a new month."""
    data = load_usage_data()
    current_month = get_current_month()
    
    if email not in data:
        return 0
    
    user_data = data[email]
    
    # Check if we need to reset (new month)
    if isinstance(user_data, dict):
        last_reset_month = user_data.get("last_reset_month", current_month)
        if last_reset_month != current_month:
            # New month - reset usage
            data[email] = {
                "used": 0,
                "last_reset_month": current_month
            }
            save_usage_data(data)
            return 0
        return user_data.get("used", 0)
    else:
        # Legacy format - migrate it
        data[email] = {
            "used": user_data if isinstance(user_data, int) else 0,
            "last_reset_month": current_month
        }
        save_usage_data(data)
        return data[email]["used"]


def increment_user_usage(email: str) -> int:
    """Increment usage count and return new count."""
    data = load_usage_data()
    current_month = get_current_month()
    
    if email not in data:
        data[email] = {
            "used": 1,
            "last_reset_month": current_month
        }
    else:
        user_data = data[email]
        if isinstance(user_data, dict):
            # Check if we need to reset (new month)
            last_reset_month = user_data.get("last_reset_month", current_month)
            if last_reset_month != current_month:
                # New month - reset and start at 1
                data[email] = {
                    "used": 1,
                    "last_reset_month": current_month
                }
            else:
                # Same month - increment
                data[email]["used"] = user_data.get("used", 0) + 1
        else:
            # Legacy format - migrate it
            data[email] = {
                "used": (user_data if isinstance(user_data, int) else 0) + 1,
                "last_reset_month": current_month
            }
    
    save_usage_data(data)
    return data[email]["used"]


def load_subscriptions_data() -> Dict:
    """Load subscription data from file."""
    if SUBSCRIPTIONS_FILE.exists():
        try:
            with open(SUBSCRIPTIONS_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def save_subscriptions_data(data: Dict) -> None:
    """Save subscription data to file."""
    with open(SUBSCRIPTIONS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def update_user_tier(email: str, tier: str) -> None:
    """Update user's tier in USER_TIERS."""
    USER_TIERS[email] = tier


def check_usage_limit(email: Optional[str]) -> tuple[bool, int]:
    """
    Check if user can perform analysis.
    Returns (can_analyze, remaining_analyses).
    """
    if not email:
        return False, 0
    
    # Get user's tier
    tier = USER_TIERS.get(email, DEFAULT_TIER)
    user_limit = TIER_LIMITS[tier]
    
    # Unlimited tier
    if user_limit == -1:
        return True, -1  # -1 indicates unlimited
    
    current_usage = get_user_usage(email)
    remaining = max(0, user_limit - current_usage)
    return remaining > 0, remaining


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def load_guest_usage_data() -> Dict:
    """Load guest trial + IP rate-limit data."""
    if GUEST_USAGE_FILE.exists():
        try:
            with open(GUEST_USAGE_FILE, "r") as f:
                data = json.load(f)
                if not isinstance(data, dict):
                    return {"guests": {}, "ips": {}}
                data.setdefault("guests", {})
                data.setdefault("ips", {})
                return data
        except (json.JSONDecodeError, IOError):
            return {"guests": {}, "ips": {}}
    return {"guests": {}, "ips": {}}


def save_guest_usage_data(data: Dict) -> None:
    """Persist guest trial data."""
    with open(GUEST_USAGE_FILE, "w") as f:
        json.dump(data, f, indent=2)


def get_client_ip(request: Request) -> str:
    """Best-effort client IP behind Vercel/Render proxies."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # First hop is the original client
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _cookie_secure() -> bool:
    """Secure cookies in production (HTTPS). Override with COOKIE_SECURE=true/false."""
    explicit = os.getenv("COOKIE_SECURE")
    if explicit is not None:
        return explicit.strip().lower() in ("1", "true", "yes")
    env = (
        os.getenv("ENVIRONMENT")
        or os.getenv("VERCEL_ENV")
        or os.getenv("NODE_ENV")
        or ""
    ).lower()
    return env in ("production", "prod")


def set_guest_cookie(response: Response, guest_id: str) -> None:
    response.set_cookie(
        key=GUEST_COOKIE_NAME,
        value=guest_id,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(),
        max_age=GUEST_COOKIE_MAX_AGE,
        path="/",
    )


def clear_guest_cookie(response: Response) -> None:
    response.delete_cookie(
        key=GUEST_COOKIE_NAME,
        path="/",
        samesite="lax",
        secure=_cookie_secure(),
    )


def get_or_create_guest_id(request: Request) -> Tuple[str, bool]:
    """Return (guest_id, created_new)."""
    existing = request.cookies.get(GUEST_COOKIE_NAME)
    if existing and len(existing) >= 16:
        return existing, False
    return secrets.token_urlsafe(32), True


def get_guest_record(guest_id: str) -> Dict:
    data = load_guest_usage_data()
    return data.get("guests", {}).get(guest_id, {})


def guest_remaining(guest_id: str) -> int:
    record = get_guest_record(guest_id)
    if record.get("claimed_by"):
        return 0
    used = int(record.get("used", 0) or 0)
    return max(0, GUEST_ANALYSIS_LIMIT - used)


def _prune_ip_timestamps(timestamps: List[str], window: timedelta) -> List[str]:
    cutoff = _utc_now() - window
    kept: List[str] = []
    for ts in timestamps:
        try:
            dt = datetime.fromisoformat(ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt >= cutoff:
                kept.append(ts)
        except (TypeError, ValueError):
            continue
    return kept


def check_guest_ip_limit(ip: str) -> Tuple[bool, int]:
    """Returns (allowed, remaining_ip_slots) for guest analyses in last 24h."""
    data = load_guest_usage_data()
    timestamps = _prune_ip_timestamps(
        list(data.get("ips", {}).get(ip, [])),
        timedelta(hours=24),
    )
    remaining = max(0, GUEST_IP_LIMIT_24H - len(timestamps))
    return remaining > 0, remaining


def record_guest_analysis(guest_id: str, ip: str) -> None:
    """Mark guest trial used and record IP timestamp (after successful analysis)."""
    data = load_guest_usage_data()
    guests = data.setdefault("guests", {})
    ips = data.setdefault("ips", {})

    record = guests.get(guest_id, {})
    record["used"] = int(record.get("used", 0) or 0) + 1
    record["last_used_at"] = _utc_now_iso()
    if "created_at" not in record:
        record["created_at"] = _utc_now_iso()
    guests[guest_id] = record

    pruned = _prune_ip_timestamps(list(ips.get(ip, [])), timedelta(hours=24))
    pruned.append(_utc_now_iso())
    ips[ip] = pruned

    save_guest_usage_data(data)


def ensure_guest_registered(guest_id: str) -> None:
    """Ensure guest id exists in storage (used=0) so cookie mapping is durable."""
    data = load_guest_usage_data()
    guests = data.setdefault("guests", {})
    if guest_id not in guests:
        guests[guest_id] = {
            "used": 0,
            "created_at": _utc_now_iso(),
        }
        save_guest_usage_data(data)


def claim_guest_for_email(guest_id: str, email: str) -> Dict:
    """
    Merge guest trial into account usage once.
    If guest already used their free analysis, increment account monthly usage by 1.
    Invalidates guest for further anonymous use.
    """
    data = load_guest_usage_data()
    guests = data.setdefault("guests", {})
    record = guests.get(guest_id)
    if not record:
        return {"merged": False, "reason": "no_guest", "usage_incremented": False}

    if record.get("claimed_by"):
        return {
            "merged": False,
            "reason": "already_claimed",
            "usage_incremented": False,
            "claimed_by": record.get("claimed_by"),
        }

    used = int(record.get("used", 0) or 0)
    usage_incremented = False
    if used >= 1:
        increment_user_usage(email)
        usage_incremented = True

    # Burn remaining trial even if unused, so cookie can't be reused anonymously after sign-in
    record["used"] = max(used, GUEST_ANALYSIS_LIMIT)
    record["claimed_by"] = email
    record["claimed_at"] = _utc_now_iso()
    guests[guest_id] = record
    save_guest_usage_data(data)

    return {
        "merged": True,
        "reason": "ok",
        "usage_incremented": usage_incremented,
        "guest_used": used,
    }


def get_verified_email(request: Request) -> Optional[str]:
    """
    Email from a verified Clerk session token, or None.
    A missing/invalid/expired token is not an error here — callers that allow
    anonymous access fall through to the guest path.
    """
    scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = token.strip()
    if not token:
        return None
    try:
        return email_from_session_token(token)
    except ClerkAuthError:
        return None


def require_verified_email(request: Request) -> str:
    """Email from a verified Clerk session token; 401 when there isn't one."""
    email = get_verified_email(request)
    if not email:
        raise HTTPException(status_code=401, detail="Sign in required")
    return email


def authorize_analysis(request: Request) -> Dict:
    """
    Server-side gate for analyze. Signed-in users (verified Clerk token) use
    email limits; anonymous users use guest cookie + IP rate limit.
    """
    user_email = get_verified_email(request)
    if user_email:
        # Best-effort merge if a used guest cookie is still present
        guest_id = request.cookies.get(GUEST_COOKIE_NAME)
        if guest_id:
            claim_guest_for_email(guest_id, user_email)

        can_analyze, remaining = check_usage_limit(user_email)
        if not can_analyze:
            tier = USER_TIERS.get(user_email, DEFAULT_TIER)
            user_limit = TIER_LIMITS[tier]
            raise HTTPException(
                status_code=429,
                detail=(
                    f"You've reached your {tier} tier limit of {user_limit} analyses. "
                    "Upgrade to Pro for 15 analyses/month!"
                ),
            )
        return {
            "mode": "user",
            "email": user_email,
            "guest_id": guest_id,
            "remaining": remaining,
        }

    guest_id, _created = get_or_create_guest_id(request)
    ensure_guest_registered(guest_id)
    remaining = guest_remaining(guest_id)
    if remaining <= 0:
        raise HTTPException(
            status_code=401,
            detail=(
                "You've used your free guest analysis. "
                "Sign up or sign in to continue analyzing."
            ),
        )

    ip = get_client_ip(request)
    ip_ok, ip_remaining = check_guest_ip_limit(ip)
    if not ip_ok:
        raise HTTPException(
            status_code=429,
            detail=(
                "Too many free analyses from this network. "
                "Please sign up or try again tomorrow."
            ),
        )

    return {
        "mode": "guest",
        "email": None,
        "guest_id": guest_id,
        "ip": ip,
        "remaining": remaining,
        "ip_remaining": ip_remaining,
    }


def record_analysis_usage(auth: Dict) -> None:
    """Increment the correct usage counter after a successful analysis."""
    if auth["mode"] == "user":
        email = auth["email"]
        tier = USER_TIERS.get(email, DEFAULT_TIER)
        if TIER_LIMITS[tier] != -1:
            increment_user_usage(email)
    elif auth["mode"] == "guest":
        record_guest_analysis(auth["guest_id"], auth["ip"])


def record_analysis_history(
    auth: Dict,
    video_id: str,
    video_title: Optional[str],
    video_url: Optional[str],
    total_comments: Optional[int],
    summary: Optional[str],
    sentiment: Optional[Dict[str, int]],
    action_items: Optional[List],
) -> None:
    """
    Save a completed analysis to the signed-in user's history, best effort.

    Guests have no account to attach history to, and a database problem must
    never cost a user the result they already paid a credit for.
    """
    if auth.get("mode") != "user" or not auth.get("email"):
        return
    if not video_id or not summary:
        return
    try:
        db.save_analysis(
            user_email=auth["email"],
            video_id=video_id,
            video_title=video_title,
            video_url=video_url,
            total_comments=total_comments,
            summary=summary,
            sentiment=sentiment,
            action_items=action_items or [],
        )
    except Exception as exc:
        print(f"record_analysis_history failed: {type(exc).__name__}")


# CORS: credentials require explicit origins (not *). Prefer same-origin /api/python rewrite.
_cors_origins = [
    o.strip()
    for o in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    video_url: str


class UsageResponse(BaseModel):
    email: str
    used: int
    remaining: int  # -1 means unlimited
    limit: int
    is_unlimited: bool
    tier: str


class GuestUsageResponse(BaseModel):
    guest: bool = True
    used: int
    remaining: int
    limit: int
    is_unlimited: bool = False
    tier: str = "GUEST"


class Comment(BaseModel):
    author: str
    text: str
    like_count: int
    published_at: str
    sentiment: Optional[str] = None


class ActionItem(BaseModel):
    title: str
    description: str
    impact: str  # High, Medium, Low


class AnalyzeResponse(BaseModel):
    video_id: str
    video_title: str
    total_comments: int
    summary: str
    sentiment: Dict[str, int]
    action_items: List[ActionItem]
    comments: List[Comment] = Field(default_factory=list)


class HistoryItem(BaseModel):
    id: str
    video_id: str
    video_title: Optional[str] = None
    video_url: Optional[str] = None
    total_comments: Optional[int] = None
    sentiment: Dict[str, int] = Field(default_factory=dict)
    created_at: str


class HistoryListResponse(BaseModel):
    items: List[HistoryItem] = Field(default_factory=list)
    next_cursor: Optional[str] = None


class HistoryDetailResponse(BaseModel):
    id: str
    video_id: str
    video_title: Optional[str] = None
    video_url: Optional[str] = None
    total_comments: Optional[int] = None
    summary: str = ""
    sentiment: Dict[str, int] = Field(default_factory=dict)
    action_items: List[ActionItem] = Field(default_factory=list)
    created_at: str


class PDFRequest(BaseModel):
    video_id: str
    video_title: str
    total_comments: int
    summary: str
    sentiment: Dict[str, int]
    action_items: List[ActionItem]


class ChannelResolveRequest(BaseModel):
    # No min_length: blank input falls through to the resolver so the user gets
    # the actionable "enter a channel URL" message instead of a 422 body.
    input: str = Field(default="", max_length=500)


class ChannelProfileRequest(BaseModel):
    channel_input: Optional[str] = Field(default=None, max_length=500)
    refresh: bool = False


class ChannelSummary(BaseModel):
    channel_id: str
    title: str
    handle: str = ""
    description: str = ""
    thumbnail: str = ""
    subscriber_count: Optional[int] = None  # None when the creator hides it
    video_count: int = 0
    view_count: int = 0
    published_at: str = ""
    url: str = ""


class SavedChannelResponse(BaseModel):
    channel: Optional[ChannelSummary] = None


class TopVideo(BaseModel):
    video_id: str
    title: str
    published_at: str = ""
    view_count: int = 0
    like_count: int = 0
    comment_count: int = 0
    duration_seconds: int = 0
    thumbnail: str = ""
    url: str = ""


class VibeProfile(BaseModel):
    niche: str = ""
    topics: List[str] = Field(default_factory=list)
    format: str = ""
    audience: str = ""
    tone: str = ""
    summary: str = ""
    search_queries: List[str] = Field(default_factory=list)


class CompetitorScoreComponents(BaseModel):
    relevance: float = 0.0
    size: float = 0.0
    exposure: float = 0.0
    activity: float = 0.0
    queries_matched: int = 0
    queries_total: int = 0
    matched_views: int = 0


class CompetitorChannel(BaseModel):
    channel_id: str
    title: str
    handle: str = ""
    description: str = ""
    thumbnail: str = ""
    subscriber_count: Optional[int] = None
    video_count: int = 0
    view_count: int = 0
    url: str = ""
    reason: str = ""
    score: float = 0.0
    score_components: CompetitorScoreComponents = Field(
        default_factory=CompetitorScoreComponents
    )


class ChannelProfileResponse(BaseModel):
    channel: ChannelSummary
    top_videos: List[TopVideo] = Field(default_factory=list)
    vibe: VibeProfile = Field(default_factory=VibeProfile)
    competitors: List[CompetitorChannel] = Field(default_factory=list)
    cached: bool = False
    computed_at: Optional[str] = None


class ChannelIdeasRequest(BaseModel):
    refresh: bool = False


class InspiredByVideo(BaseModel):
    channel_title: str = ""
    video_title: str = ""
    video_id: str = ""
    url: str = ""
    view_count: int = 0


class VideoIdea(BaseModel):
    title: str
    hook: str = ""
    angle: str = ""
    why_it_works: str = ""
    inspired_by: List[InspiredByVideo] = Field(default_factory=list)


class CompetitorVideoPackage(BaseModel):
    channel_id: str
    title: str = ""
    handle: str = ""
    top_videos: List[TopVideo] = Field(default_factory=list)


class ChannelIdeasResponse(BaseModel):
    ideas: List[VideoIdea] = Field(default_factory=list)
    competitor_videos: List[CompetitorVideoPackage] = Field(default_factory=list)
    cached: bool = False
    computed_at: Optional[str] = None


def extract_video_id(url: str) -> str:
    """Extract video ID from various YouTube URL formats."""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    
    # Try parsing as URL
    parsed = urlparse(url)
    if parsed.hostname and 'youtube.com' in parsed.hostname:
        params = parse_qs(parsed.query)
        if 'v' in params:
            return params['v'][0]
    
    raise ValueError("Invalid YouTube URL")


def _extract_llm_text(response) -> str:
    """Get text from LLM response, checking content, reasoning_content, and other fields."""
    choice = response.choices[0]
    msg = choice.message
    
    # Try standard content first
    text = msg.content
    if text:
        return text.strip()
    
    # Try reasoning_content (Kimi and other reasoning models)
    text = getattr(msg, "reasoning_content", None)
    if text:
        return text.strip()
    
    # Try tool_calls or function_call (some models return structured data this way)
    tool_calls = getattr(msg, "tool_calls", None)
    if tool_calls:
        for tc in tool_calls:
            fn = getattr(tc, "function", None)
            if fn and getattr(fn, "arguments", None):
                return fn.arguments.strip()
    
    # Dump all message attributes for debugging
    attrs = {k: str(v)[:200] for k, v in vars(msg).items() if v}
    print(f"[DEBUG _extract_llm_text] No content found. Message attrs: {attrs}")
    print(f"[DEBUG _extract_llm_text] Choice finish_reason: {getattr(choice, 'finish_reason', 'unknown')}")
    
    return ""


def _strip_llm_markdown_fences(text: str) -> str:
    """Extract content from ```json ... ``` if present (anywhere in the string)."""
    t = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", t, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    if t.startswith("```"):
        lines = t.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return t


def extract_json_object_from_llm(text: str) -> Optional[Dict]:
    """Parse a JSON object from LLM output (markdown fences, extra prose)."""
    if not text:
        return None
    t = _strip_llm_markdown_fences(text)
    try:
        obj = json.loads(t)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    start = t.find("{")
    end = t.rfind("}")
    if start >= 0 and end > start:
        try:
            obj = json.loads(t[start : end + 1])
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
    return None


def extract_json_array_from_llm(text: str) -> Optional[List]:
    """Parse a JSON array from LLM output."""
    if not text:
        return None
    t = _strip_llm_markdown_fences(text)
    try:
        arr = json.loads(t)
        if isinstance(arr, list):
            return arr
    except json.JSONDecodeError:
        pass
    start = t.find("[")
    end = t.rfind("]")
    if start >= 0 and end > start:
        try:
            arr = json.loads(t[start : end + 1])
            if isinstance(arr, list):
                return arr
        except json.JSONDecodeError:
            pass
    return None


def _float_val(v) -> float:
    try:
        if isinstance(v, str):
            v = v.strip().replace(",", "")
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _extract_sentiment_floats(raw: Dict) -> tuple[float, float, float]:
    """Read positive/neutral/negative as floats (handles % and proportions)."""
    lower = {str(k).lower().strip(): v for k, v in raw.items()}

    def pick(*names: str) -> float:
        for n in names:
            if n in lower:
                return _float_val(lower[n])
        return 0.0

    p = pick("positive", "pos")
    neu = pick("neutral", "neu")
    neg = pick("negative", "neg")
    if p + neu + neg == 0:
        for k, v in lower.items():
            fv = _float_val(v)
            if fv == 0:
                continue
            if "positive" in k or k in ("pos", "p"):
                p += fv
            elif "negative" in k or k in ("neg", "n"):
                neg += fv
            elif "neutral" in k or k in ("neu", "u"):
                neu += fv
    return p, neu, neg


def _parse_sentiment_counts_from_dict(raw: Dict, total_comments: int) -> Optional[Dict[str, int]]:
    """
    Normalize LLM sentiment to integer counts summing to total_comments.
    Handles raw counts, percentages (sum ~100), and proportions (sum ~1).
    Returns None if the dict cannot be interpreted (caller uses heuristic).
    """
    if total_comments <= 0:
        return {"positive": 0, "neutral": 0, "negative": 0}

    p, neu, neg = _extract_sentiment_floats(raw)
    s = p + neu + neg
    if s <= 0:
        return None

    # Proportions (e.g. 0.7, 0.2, 0.1)
    if s <= 1.01 and max(p, neu, neg) <= 1.0:
        p, neu, neg = (
            p * total_comments / s,
            neu * total_comments / s,
            neg * total_comments / s,
        )
    # Percentages (e.g. 70, 20, 10) or counts that sum to 100
    elif 90 <= s <= 110 and max(p, neu, neg) > 1.0:
        p, neu, neg = (
            p * total_comments / s,
            neu * total_comments / s,
            neg * total_comments / s,
        )
    else:
        # Raw counts: scale to total_comments
        scale = total_comments / s
        p, neu, neg = p * scale, neu * scale, neg * scale

    sentiment_counts = {
        "positive": max(0, round(p)),
        "neutral": max(0, round(neu)),
        "negative": max(0, round(neg)),
    }
    total_sentiment = sum(sentiment_counts.values())
    if total_sentiment != total_comments:
        diff = total_comments - total_sentiment
        max_key = max(sentiment_counts, key=sentiment_counts.get)
        sentiment_counts[max_key] += diff
    return sentiment_counts


def heuristic_sentiment_youtube(comments: List[Dict], total: int) -> Dict[str, int]:
    """Keyword + emoji sentiment when LLM JSON is missing or invalid."""
    if total <= 0:
        return {"positive": 0, "neutral": 0, "negative": 0}
    pos_words = re.compile(
        r"\b(love|loved|loves|loving|great|good|amazing|best|thanks|thank|awesome|excellent|"
        r"helpful|beautiful|perfect|incredible|fantastic|wonderful|brilliant|nice|cool|agree|"
        r"subscribe|subscribed|legend|goat|fire|banger|masterpiece|insane|dope|lit|iconic|"
        r"underrated|gem|blessed|proud|respect|king|queen|god|goddess|stunning|"
        r"fav|favorite|favourite|sick|vibes|vibe|talented|genius|goosebumps|chills|"
        r"wow|omg|yess+|yes|bravo|congratulations|congrats|inspiring|inspiration)\b",
        re.I,
    )
    pos_emoji = re.compile(r"[❤️😍👍💯🔥😊🥰💪🎉👏✨💖💕😭🤩😎👑🙏💗💙💜🫶🥺♥️]+")
    neg_words = re.compile(
        r"\b(hate|hated|bad|worst|terrible|awful|boring|useless|disappoint|disappointed|"
        r"trash|sucks|suck|pathetic|horrible|garbage|scam|clickbait|cringe|mid|"
        r"overrated|annoying|fake|copied|stolen|dislike|disliked|stop|ruined|ruin)\b",
        re.I,
    )
    neg_emoji = re.compile(r"[😡👎🤮💩😤😠]+")
    pos_count, neg_count, neutral_count = 0, 0, 0
    for c in comments:
        t = (c.get("text") or "")[:6000]
        pw = len(pos_words.findall(t))
        pe = len(pos_emoji.findall(t))
        nw = len(neg_words.findall(t))
        ne = len(neg_emoji.findall(t))
        p_score = pw + pe
        n_score = nw + ne
        if p_score > 0 and p_score > n_score:
            pos_count += 1
        elif n_score > 0 and n_score > p_score:
            neg_count += 1
        elif p_score > 0 and n_score > 0:
            neutral_count += 1
        else:
            # No strong signals — default to neutral
            neutral_count += 1
    s = pos_count + neg_count + neutral_count
    if s == 0:
        return {"positive": total, "neutral": 0, "negative": 0}
    scale = total / s
    rp = max(0, round(pos_count * scale))
    rn = max(0, round(neg_count * scale))
    rneu = total - rp - rn
    if rneu < 0:
        rneu = 0
    return {"positive": rp, "neutral": rneu, "negative": rn}


def _looks_like_equal_thirds_split(c: Dict[str, int], total: int) -> bool:
    """Detect ~33/33/34 style outputs (often a bad LLM default)."""
    if total < 6:
        return False
    t = total / 3
    margin = max(0.02 * total, 2)
    return all(abs(c.get(k, 0) - t) <= margin for k in ("positive", "neutral", "negative"))


def _normalize_action_dict(item: Dict) -> Dict:
    title = (
        item.get("title")
        or item.get("name")
        or item.get("headline")
        or item.get("recommendation")
        or "Recommendation"
    )
    title = str(title).strip() or "Recommendation"
    desc = (
        item.get("description")
        or item.get("detail")
        or item.get("details")
        or item.get("rationale")
        or ""
    )
    desc = str(desc).strip() or "See comments for details."
    imp = str(item.get("impact", "Medium")).strip()
    il = imp.lower()
    if "high" in il:
        imp = "High"
    elif "low" in il:
        imp = "Low"
    else:
        imp = "Medium"
    return {"title": title, "description": desc, "impact": imp}


def _action_array_from_object(obj: Dict) -> Optional[List]:
    """Many models wrap the array: {\"recommendations\": [...], \"items\": [...]}."""
    for key in (
        "recommendations",
        "items",
        "actions",
        "action_items",
        "data",
        "suggestions",
        "list",
    ):
        if key in obj and isinstance(obj.get(key), list):
            return obj[key]  # empty list is a valid "0 recommendations" answer
    return None


def _coerce_action_items(arr: Optional[List]) -> List[ActionItem]:
    if not arr:
        return []
    out: List[ActionItem] = []
    for item in arr:
        if not isinstance(item, dict):
            continue
        try:
            out.append(ActionItem(**_normalize_action_dict(item)))
        except Exception:
            continue
    return out[:3]  # Cap at 3 high-quality items


def _try_parse_action_items(response_text: str) -> Optional[List[ActionItem]]:
    """
    Parse action items from model text.
    Returns a list (possibly empty) when JSON is complete; None if not parseable yet.
    """
    if not response_text or not response_text.strip():
        return None
    arr = extract_json_array_from_llm(response_text)
    if arr is not None:
        return _coerce_action_items(arr)
    obj = extract_json_object_from_llm(response_text)
    if isinstance(obj, dict):
        wrapped = _action_array_from_object(obj)
        if wrapped is not None:
            return _coerce_action_items(wrapped)
    return None


def _parse_action_items_from_response(response_text: str) -> List[ActionItem]:
    parsed = _try_parse_action_items(response_text)
    return parsed if parsed is not None else []


def _sample_engaged(items: List[Dict], score_key: str = "like_count", n: int = LLM_SAMPLE_SIZE) -> List[Dict]:
    """Sample top-engaged items plus a random slice for coverage."""
    if len(items) <= n:
        return items
    indexed = list(enumerate(items))
    indexed.sort(key=lambda pair: pair[1].get(score_key, 0) or 0, reverse=True)
    top_n = min(150, n)
    top = indexed[:top_n]
    top_idxs = {i for i, _ in top}
    rest = [pair for pair in indexed if pair[0] not in top_idxs]
    random.shuffle(rest)
    chosen = top + rest[: max(0, n - len(top))]
    chosen.sort(key=lambda pair: pair[1].get(score_key, 0) or 0, reverse=True)
    return [c for _, c in chosen]


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _split_insights_response(text: str) -> tuple[str, List[ActionItem]]:
    """Split streamed/combined model output into summary + action items."""
    if not text:
        return "Summary could not be generated. Please try again.", []
    marker = ACTIONS_MARKER
    if marker in text:
        summary_part, actions_part = text.split(marker, 1)
        summary = summary_part.strip()
        parsed = _try_parse_action_items(actions_part.strip())
        items = parsed if parsed is not None else []
    else:
        # Fallback: try to peel a trailing JSON array off the text
        summary = text.strip()
        items = []
        start = text.rfind("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            maybe = text[start : end + 1]
            parsed = _try_parse_action_items(maybe)
            if parsed is not None:
                items = parsed
                summary = text[:start].strip()
    if not summary:
        summary = "Summary could not be generated. Please try again."
    return summary, items


def _build_youtube_insights_prompt(
    comments: List[Dict], video_title: str = "", video_description: str = ""
) -> str:
    sampled = _sample_engaged(comments, "like_count", LLM_SAMPLE_SIZE)
    comments_text = "\n\n".join(
        f"Comment {i+1} (Likes: {c.get('like_count', 0)}):\n{c.get('text', '')}"
        for i, c in enumerate(sampled)
    )
    video_context = ""
    if video_title:
        video_context += f"Video Title: {video_title}\n\n"
    if video_description:
        video_context += f"Video Description: {video_description[:1500]}\n\n"

    return f"""Analyze these YouTube comments for the creator.

Write the summary first in this exact format:

**Overall Sentiment:**
[One paragraph summarizing overall sentiment. Be specific about what commenters say.]

**Feedback Summary:**
[One paragraph on positive and negative feedback in representative proportions. If none, write "No specific feedback was provided by commenters."]

Then on its own line write exactly: {ACTIONS_MARKER}
Then a JSON array of 0-3 actionable recommendations for the creator's *next* video.
Each item must have "title", "description", and "impact" (exactly High, Medium, or Low).
If there is no meaningful actionable feedback, output an empty array: []

Rules for recommendations:
- Quality over quantity: only include items clearly supported by multiple comments
- Prefer 1–2 excellent items over padding; 0 is valid when nothing is strongly supported
- Concrete and specific, not vague advice
- Things the creator can improve going forward (not for a video already posted)
- Never invent recommendations to fill a quota

{video_context}Comments:
{comments_text}"""


def get_combined_insights(prompt: str) -> tuple[str, List[ActionItem]]:
    """Single LLM call for summary + action items (non-streaming)."""
    client = get_together_client()
    response = client.chat.completions.create(
        **_insights_completion_kwargs(
            messages=[{"role": "user", "content": prompt}],
        )
    )
    text = _extract_llm_text(response)
    print(f"[DEBUG insights] finish={response.choices[0].finish_reason}, len={len(text)}, head={text[:200]!r}")
    return _split_insights_response(text)


def _iter_insights_stream(prompt: str):
    """
    Yield ('summary_delta', str) while streaming, then ('done', summary, items).
    Holds back a marker-sized suffix so ---ACTIONS--- is never leaked to the client.
    Stops once the actions JSON after ---ACTIONS--- is fully parseable (including []).
    """
    client = get_together_client()
    stream = client.chat.completions.create(
        **_insights_completion_kwargs(
            messages=[{"role": "user", "content": prompt}],
            stream=True,
        )
    )
    buffer = ""
    emitted = 0
    marker_hit = False
    hold = len(ACTIONS_MARKER)

    for chunk in stream:
        delta = _stream_delta_text(chunk)
        if not delta:
            continue
        buffer += delta
        if marker_hit:
            # Keep reading until the actions JSON is complete (incl. empty [])
            actions_part = buffer.split(ACTIONS_MARKER, 1)[1]
            if _try_parse_action_items(actions_part.strip()) is not None:
                break
            continue
        if ACTIONS_MARKER in buffer:
            summary_part = buffer.split(ACTIONS_MARKER, 1)[0]
            new = summary_part[emitted:]
            if new:
                yield ("summary_delta", new)
            emitted = len(summary_part)
            marker_hit = True
            actions_part = buffer.split(ACTIONS_MARKER, 1)[1]
            if _try_parse_action_items(actions_part.strip()) is not None:
                break
            continue
        safe_end = max(0, len(buffer) - hold)
        if safe_end > emitted:
            yield ("summary_delta", buffer[emitted:safe_end])
            emitted = safe_end

    summary, items = _split_insights_response(buffer)
    # Emit any remaining summary that was held back (no marker case)
    if not marker_hit and len(summary) > emitted:
        tail = summary[emitted:]
        if tail:
            yield ("summary_delta", tail)
    yield ("done", summary, items)


def get_ai_summary(comments: List[Dict], video_title: str = "", video_description: str = "") -> str:
    """Get AI summary of comments."""
    client = get_together_client()
    
    sampled_comments = _sample_engaged(comments, "like_count", LLM_SAMPLE_SIZE)
    
    comments_text = "\n\n".join([
        f"Comment {i+1} (Likes: {c['like_count']}):\n{c['text']}"
        for i, c in enumerate(sampled_comments)
    ])
    
    # Build context about the video
    video_context = ""
    if video_title:
        video_context += f"Video Title: {video_title}\n\n"
    if video_description:
        video_context += f"Video Description: {video_description}\n\n"
    
    prompt = f"""Analyze these YouTube comments and provide a representative summary for the creator. Follow this exact format and style:

**Overall Sentiment:**
[Write one paragraph that accurately and concisely summarizes the overall sentiment of the comments. Be specific about what commenters are saying and feeling.]

**Feedback Summary:**
[Write one paragraph summarizing the feedback (both positive and negative) that commenters have for the creator. If feedback is present, capture the positives and negatives in proportions representative of the comments. If no meaningful feedback is present, write "No specific feedback was provided by commenters."]

Style guidelines:
- Use clear, professional language
- Be specific and concrete (mention what commenters actually said)
- Maintain a balanced, objective tone
- Keep paragraphs concise but informative
- Use present tense when describing commenter sentiments

{video_context}Comments:
{comments_text}"""
    
    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2000
    )
    
    msg = response.choices[0].message
    content = msg.content or getattr(msg, "reasoning_content", None) or ""
    print(f"[DEBUG summary] finish={response.choices[0].finish_reason}, content length={len(content)}, first 200 chars: {content[:200]!r}")
    if not content.strip():
        content = "Summary could not be generated. Please try again."
    return content


def get_sentiment_analysis(comments: List[Dict], video_title: str = "", video_description: str = "") -> Dict[str, int]:
    """Get sentiment breakdown of comments."""
    client = get_together_client()
    
    # Store total comment count before sampling
    total_comments = len(comments)
    
    # Smart sampling for production: prioritize most engaged comments
    # Use top 500 comments (300 most-liked + 200 random) for cost optimization
    if len(comments) > 500:
        # Get top 300 by likes (these are most important)
        top_comments = sorted(comments, key=lambda x: x['like_count'], reverse=True)[:300]
        # Get random 200 from the rest for representative sampling
        remaining = [c for c in comments if c not in top_comments]
        random_sample = random.sample(remaining, min(200, len(remaining))) if remaining else []
        sampled_comments = top_comments + random_sample
    else:
        sampled_comments = comments
    
    comments_text = "\n\n".join([
        f"Comment {i+1}: {c['text']}"
        for i, c in enumerate(sampled_comments)
    ])
    
    # Build context about the video
    video_context = ""
    if video_title:
        video_context += f"Video Title: {video_title}\n\n"
    if video_description:
        video_context += f"Video Description: {video_description}\n\n"
    
    prompt = f"""Analyze the sentiment of these YouTube comments and categorize each as "positive", "neutral", or "negative".

Return ONLY a single JSON object (no markdown fences, no explanation) with this exact shape:
{{
  "positive": <number>,
  "neutral": <number>,
  "negative": <number>
}}
The three numbers must sum to the number of comments analyzed and represent counts of each sentiment.

{video_context}Comments:
{comments_text}"""
    
    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500
    )
    
    response_text = _extract_llm_text(response)
    print(f"[DEBUG yt sentiment] finish={response.choices[0].finish_reason}, response: {response_text[:300]!r}")
    obj = extract_json_object_from_llm(response_text)
    if obj:
        parsed = _parse_sentiment_counts_from_dict(obj, total_comments)
        if parsed is not None:
            h = heuristic_sentiment_youtube(comments, total_comments)
            # Kimi often returns ~equal thirds; override when keyword heuristic disagrees
            if _looks_like_equal_thirds_split(parsed, total_comments) and not _looks_like_equal_thirds_split(
                h, total_comments
            ):
                return h
            return parsed
    return heuristic_sentiment_youtube(comments, total_comments)


def get_action_items(comments: List[Dict], video_title: str = "", video_description: str = "") -> List[ActionItem]:
    """Get actionable recommendations from comments."""
    client = get_together_client()
    
    # Smart sampling for production: prioritize most engaged comments
    # Use top 500 comments (300 most-liked + 200 random) for cost optimization
    if len(comments) > 500:
        # Get top 300 by likes (these are most important)
        top_comments = sorted(comments, key=lambda x: x['like_count'], reverse=True)[:300]
        # Get random 200 from the rest for representative sampling
        remaining = [c for c in comments if c not in top_comments]
        random_sample = random.sample(remaining, min(200, len(remaining))) if remaining else []
        sampled_comments = top_comments + random_sample
    else:
        sampled_comments = comments
    
    comments_text = "\n\n".join([
        f"Comment {i+1} (Likes: {c['like_count']}):\n{c['text']}"
        for i, c in enumerate(sampled_comments)
    ])
    
    # Build context about the video
    video_context = ""
    if video_title:
        video_context += f"Video Title: {video_title}\n\n"
    if video_description:
        video_context += f"Video Description: {video_description}\n\n"
    
    prompt = f"""Based on these YouTube comments, provide 0-3 specific, actionable recommendations for the creator to improve their next video.
Quality over quantity: only include items clearly supported by the comments. Prefer 1–2 high-quality items over padding; return [] if nothing is strongly supported.

Return ONLY a JSON array (no markdown fences, no explanation). Each item must have "title", "description", and "impact" where impact is exactly one of: High, Medium, Low.
Example shape:
[
  {{
    "title": "Short action title",
    "description": "Brief explanation of why and how",
    "impact": "High"
  }}
]

Focus on:
- Concrete, specific actions (not vague advice)
- Things mentioned by multiple commenters
- Balance positive reinforcement with areas to improve
- Prioritize by impact (what will make the biggest difference)
- Things the creator can improve from the next video, because its useless giving them recommendation for a video already posted
- Never invent recommendations to fill a quota

{video_context}Comments:
{comments_text}"""
    
    response = client.chat.completions.create(
        **_insights_completion_kwargs(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500,
        )
    )
    
    response_text = _extract_llm_text(response)
    print(f"[DEBUG yt actions] finish={response.choices[0].finish_reason}, response: {response_text[:300]!r}")
    return _parse_action_items_from_response(response_text)


def assign_sentiments_to_comments(comments: List[Dict], sentiment_counts: Dict[str, int]) -> List[Comment]:
    """Assign sentiment labels to individual comments based on overall distribution."""
    # Simple heuristic: distribute sentiments based on like counts and text analysis
    # For MVP, we'll use a simple approach
    
    total = len(comments)
    if total == 0:
        return []
    
    positive_count = sentiment_counts.get('positive', 0)
    neutral_count = sentiment_counts.get('neutral', 0)
    negative_count = sentiment_counts.get('negative', 0)
    
    # Sort comments by likes (most liked first)
    sorted_comments = sorted(comments, key=lambda x: x['like_count'], reverse=True)
    
    result = []
    for i, comment in enumerate(sorted_comments):
        # Simple distribution based on ratios
        ratio = i / max(total, 1)
        
        if ratio < positive_count / max(total, 1):
            sentiment = "positive"
        elif ratio < (positive_count + neutral_count) / max(total, 1):
            sentiment = "neutral"
        else:
            sentiment = "negative"
        
        result.append(Comment(
            author=comment['author'],
            text=comment['text'],
            like_count=comment['like_count'],
            published_at=comment['published_at'],
            sentiment=sentiment
        ))
    
    # Sort back by original order (or keep by likes)
    return result


def generate_pdf_report(
    video_id: str,
    video_title: str,
    total_comments: int,
    summary: str,
    sentiment: Dict[str, int],
    action_items: List[ActionItem]
) -> BytesIO:
    """Generate a PDF report from analysis results."""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    
    # Container for the 'Flowable' objects
    story = []
    
    # Define styles
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1e40af'),
        spaceAfter=30,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )
    
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=18,
        textColor=colors.HexColor('#3b82f6'),
        spaceAfter=12,
        spaceBefore=20,
        fontName='Helvetica-Bold'
    )
    
    subheading_style = ParagraphStyle(
        'CustomSubheading',
        parent=styles['Heading3'],
        fontSize=14,
        textColor=colors.HexColor('#6366f1'),
        spaceAfter=10,
        spaceBefore=15,
        fontName='Helvetica-Bold'
    )
    
    normal_style = ParagraphStyle(
        'CustomNormal',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.HexColor('#1f2937'),
        spaceAfter=12,
        alignment=TA_JUSTIFY,
        leading=14
    )
    
    # Title page
    story.append(Spacer(1, 1*inch))
    story.append(Paragraph("Disstill Analysis Report", title_style))
    story.append(Spacer(1, 0.3*inch))
    
    if video_title:
        story.append(Paragraph(f"<b>Video:</b> {video_title}", styles['Normal']))
        story.append(Spacer(1, 0.2*inch))
    
    story.append(Paragraph(f"<b>Video ID:</b> {video_id}", styles['Normal']))
    story.append(Paragraph(f"<b>Total Comments Analyzed:</b> {total_comments}", styles['Normal']))
    story.append(Paragraph(f"<b>Generated:</b> {datetime.now().strftime('%B %d, %Y at %I:%M %p')}", styles['Normal']))
    story.append(PageBreak())
    
    # Summary Section
    story.append(Paragraph("Summary", heading_style))
    
    # Parse summary to handle markdown-style formatting
    summary_paragraphs = summary.split('\n\n')
    for para in summary_paragraphs:
        para = para.strip()
        if not para:
            continue
        
        # Check if it's a heading (starts with ** and ends with **)
        heading_match = re.match(r'^\*\*(.*?):\*\*', para)
        if heading_match:
            heading_text = heading_match.group(1)
            content = para.replace(f'**{heading_text}:**', '').strip()
            story.append(Paragraph(f"<b>{heading_text}:</b>", subheading_style))
            if content:
                story.append(Paragraph(content, normal_style))
        else:
            # Remove markdown bold markers
            para_clean = para.replace('**', '')
            story.append(Paragraph(para_clean, normal_style))
    
    story.append(Spacer(1, 0.3*inch))
    
    # Sentiment Breakdown Section
    story.append(Paragraph("Sentiment Breakdown", heading_style))
    
    total_sentiment = sum(sentiment.values())
    if total_sentiment > 0:
        sentiment_data = [
            ['Sentiment', 'Count', 'Percentage'],
            ['Positive', str(sentiment.get('positive', 0)), f"{(sentiment.get('positive', 0) / total_sentiment * 100):.1f}%"],
            ['Neutral', str(sentiment.get('neutral', 0)), f"{(sentiment.get('neutral', 0) / total_sentiment * 100):.1f}%"],
            ['Negative', str(sentiment.get('negative', 0)), f"{(sentiment.get('negative', 0) / total_sentiment * 100):.1f}%"],
        ]
        
        sentiment_table = Table(sentiment_data, colWidths=[2*inch, 1.5*inch, 1.5*inch])
        sentiment_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3b82f6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 12),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.grey),
            ('FONTSIZE', (0, 1), (-1, -1), 11),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3f4f6')]),
        ]))
        story.append(sentiment_table)
    else:
        story.append(Paragraph("No sentiment data available.", normal_style))
    
    story.append(Spacer(1, 0.3*inch))
    
    # Action Items Section
    story.append(Paragraph("Recommendations", heading_style))
    
    if action_items and len(action_items) > 0:
        for idx, item in enumerate(action_items, 1):
            # Impact color mapping (using color names instead of hex codes for ReportLab)
            impact_colors = {
                'High': '#ef4444',
                'Medium': '#f59e0b',
                'Low': '#10b981'
            }
            impact_color = impact_colors.get(item.impact, '#6b7280')
            
            story.append(Spacer(1, 0.1*inch))
            story.append(Paragraph(
                f"<b>{idx}. {item.title}</b> <font color='{impact_color}'>[{item.impact} Impact]</font>",
                subheading_style
            ))
            story.append(Paragraph(item.description, normal_style))
            story.append(Spacer(1, 0.15*inch))
    else:
        story.append(Paragraph("No specific recommendations identified from the comments.", normal_style))
    
    # Footer note
    story.append(Spacer(1, 0.5*inch))
    story.append(Paragraph(
        "<i>Report generated by Disstill</i>",
        ParagraphStyle('Footer', parent=styles['Normal'], fontSize=9, textColor=colors.grey, alignment=TA_CENTER)
    ))
    
    # Build PDF
    doc.build(story)
    buffer.seek(0)
    return buffer


@app.get("/")
async def root():
    return {"message": "Disstill API", "status": "running"}


# The /{_email} variants are legacy shapes kept so clients still running an
# older bundle don't 404 mid-deploy. The address in the path is ignored — the
# account always comes from the verified token.
@app.get("/usage")
@app.get("/usage/{_email}")
async def get_usage(request: Request, _email: Optional[str] = None) -> UsageResponse:
    """Get usage statistics for the signed-in user."""
    email = require_verified_email(request)
    tier = USER_TIERS.get(email, DEFAULT_TIER)
    user_limit = TIER_LIMITS[tier]
    is_unlimited = user_limit == -1
    
    used = get_user_usage(email)
    remaining = -1 if is_unlimited else max(0, user_limit - used)
    
    return UsageResponse(
        email=email,
        used=used,
        remaining=remaining,
        limit=user_limit,
        is_unlimited=is_unlimited,
        tier=tier
    )


@app.get("/guest/usage")
async def get_guest_usage(request: Request):
    """Get guest trial status; sets guest cookie if missing."""
    guest_id, _created = get_or_create_guest_id(request)
    ensure_guest_registered(guest_id)
    record = get_guest_record(guest_id)
    used = min(GUEST_ANALYSIS_LIMIT, int(record.get("used", 0) or 0))
    if record.get("claimed_by"):
        used = GUEST_ANALYSIS_LIMIT
    remaining = max(0, GUEST_ANALYSIS_LIMIT - used)
    payload = GuestUsageResponse(
        used=used,
        remaining=remaining,
        limit=GUEST_ANALYSIS_LIMIT,
    )
    response = JSONResponse(content=payload.model_dump())
    set_guest_cookie(response, guest_id)
    return response


@app.post("/guest/claim")
async def claim_guest_usage(request: Request):
    """
    On Clerk sign-in/sign-up: merge guest trial into account usage once.
    If the guest already used their free analysis, account monthly usage += 1.
    """
    email = require_verified_email(request)

    guest_id = request.cookies.get(GUEST_COOKIE_NAME)
    if not guest_id:
        return {"merged": False, "reason": "no_guest", "usage_incremented": False}

    result = claim_guest_for_email(guest_id, email)
    response = JSONResponse(content=result)
    # Invalidate cookie so anonymous reuse isn't possible after sign-in
    clear_guest_cookie(response)
    return response


@app.get("/tier")
@app.get("/tier/{_email}")
async def get_user_tier(request: Request, _email: Optional[str] = None):
    """Get tier information for the signed-in user."""
    email = require_verified_email(request)
    tier = USER_TIERS.get(email, DEFAULT_TIER)
    limit = TIER_LIMITS[tier]
    return {
        "tier": tier,
        "limit": limit if limit != -1 else "unlimited",
        "price": "$0" if tier == "FREE" else "$4.99" if tier == "PRO" else "Custom"
    }


class CheckoutRequest(BaseModel):
    success_url: str
    cancel_url: str


@app.post("/create-checkout-session")
async def create_checkout_session(http_request: Request, body: CheckoutRequest):
    """Create a Stripe checkout session for Pro subscription."""
    email = require_verified_email(http_request)

    if not STRIPE_PRICE_ID:
        raise HTTPException(status_code=500, detail="Stripe price ID not configured")
    
    try:
        checkout_session = stripe.checkout.Session.create(
            customer_email=email,
            payment_method_types=["card"],
            line_items=[
                {
                    "price": STRIPE_PRICE_ID,
                    "quantity": 1,
                }
            ],
            mode="subscription",
            success_url=body.success_url,
            cancel_url=body.cancel_url,
            metadata={
                "user_email": email,
            },
        )
        return {"checkout_url": checkout_session.url, "session_id": checkout_session.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create checkout session: {str(e)}")


@app.post("/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")
    
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Webhook secret not configured")
    
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, STRIPE_WEBHOOK_SECRET
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    # Handle the event
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_email = session.get("metadata", {}).get("user_email")
        customer_id = session.get("customer")
        subscription_id = session.get("subscription")
        
        if user_email:
            # Update user tier to PRO
            update_user_tier(user_email, "PRO")
            
            # Save subscription data
            subscriptions = load_subscriptions_data()
            subscriptions[user_email] = {
                "customer_id": customer_id,
                "subscription_id": subscription_id,
                "tier": "PRO",
                "created_at": datetime.now().isoformat()
            }
            save_subscriptions_data(subscriptions)
    
    elif event["type"] == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        
        # Find user by customer_id and downgrade to FREE
        subscriptions = load_subscriptions_data()
        for email, sub_data in subscriptions.items():
            if sub_data.get("customer_id") == customer_id:
                update_user_tier(email, "FREE")
                # Remove subscription data
                subscriptions.pop(email, None)
                save_subscriptions_data(subscriptions)
                break
    
    elif event["type"] == "customer.subscription.updated":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        status = subscription.get("status")
        
        # Update subscription status
        subscriptions = load_subscriptions_data()
        for email, sub_data in subscriptions.items():
            if sub_data.get("customer_id") == customer_id:
                if status in ["active", "trialing"]:
                    update_user_tier(email, "PRO")
                elif status in ["canceled", "unpaid", "past_due"]:
                    update_user_tier(email, "FREE")
                break
    
    return {"status": "success"}


@app.get("/subscription-status")
@app.get("/subscription-status/{_email}")
async def get_subscription_status(request: Request, _email: Optional[str] = None):
    """Get subscription status for the signed-in user."""
    email = require_verified_email(request)
    subscriptions = load_subscriptions_data()
    subscription_data = subscriptions.get(email)
    
    if not subscription_data:
        return {
            "has_subscription": False,
            "tier": USER_TIERS.get(email, DEFAULT_TIER)
        }
    
    try:
        subscription = stripe.Subscription.retrieve(subscription_data["subscription_id"])
        return {
            "has_subscription": True,
            "tier": "PRO",
            "status": subscription.status,
            "current_period_end": subscription.current_period_end
        }
    except Exception:
        return {
            "has_subscription": False,
            "tier": USER_TIERS.get(email, DEFAULT_TIER)
        }


def _history_sentiment(raw) -> Dict[str, int]:
    """Normalize a stored sentiment blob into the three buckets the UI charts."""
    raw = raw if isinstance(raw, dict) else {}
    out: Dict[str, int] = {}
    for key in ("positive", "neutral", "negative"):
        try:
            out[key] = int(raw.get(key) or 0)
        except (TypeError, ValueError):
            out[key] = 0
    return out


def _history_item(row: Dict) -> HistoryItem:
    return HistoryItem(
        id=row["id"],
        video_id=row["video_id"],
        video_title=row.get("video_title"),
        video_url=row.get("video_url"),
        total_comments=row.get("total_comments"),
        sentiment=_history_sentiment(row.get("sentiment")),
        created_at=row["created_at"],
    )


# Declared before /history/{analysis_id} so the static path always wins.
@app.get("/history")
async def get_history(
    request: Request,
    limit: int = db.DEFAULT_LIST_LIMIT,
    before: Optional[str] = None,
) -> HistoryListResponse:
    """List the signed-in user's past analyses, newest first."""
    email = require_verified_email(request)
    limit = max(1, min(limit, db.MAX_LIST_LIMIT))

    if not db.configured():
        return HistoryListResponse()

    try:
        rows = db.list_analyses(email, limit=limit, before=before)
    except Exception as exc:
        # History is an extra, not the product — degrade to empty rather than 500.
        print(f"list_analyses failed: {type(exc).__name__}")
        return HistoryListResponse()

    items = [_history_item(row) for row in rows]
    # A short page means there is nothing left behind the cursor.
    next_cursor = items[-1].created_at if len(items) == limit else None
    return HistoryListResponse(items=items, next_cursor=next_cursor)


@app.get("/history/{analysis_id}")
async def get_history_detail(request: Request, analysis_id: str) -> HistoryDetailResponse:
    """Get one past analysis owned by the signed-in user."""
    email = require_verified_email(request)

    row = None
    if db.configured():
        try:
            row = db.get_analysis(analysis_id, email)
        except Exception as exc:
            print(f"get_analysis failed: {type(exc).__name__}")
            raise HTTPException(
                status_code=503, detail="History is temporarily unavailable"
            )

    if row is None:
        # Same answer for "no such analysis" and "not yours", so an id from
        # another account reveals nothing.
        raise HTTPException(status_code=404, detail="Analysis not found")

    return HistoryDetailResponse(
        id=row["id"],
        video_id=row["video_id"],
        video_title=row.get("video_title"),
        video_url=row.get("video_url"),
        total_comments=row.get("total_comments"),
        summary=row.get("summary") or "",
        sentiment=_history_sentiment(row.get("sentiment")),
        action_items=_coerce_action_items(row.get("action_items")),
        created_at=row["created_at"],
    )


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_video(http_request: Request, body: AnalyzeRequest):
    """Analyze a YouTube video's comments."""
    auth = authorize_analysis(http_request)
    try:
        # Extract video ID
        video_id = extract_video_id(body.video_url)
        
        # Fetch video details and comments - production limit for quota management
        youtube = get_youtube_service()
        video_details = get_video_details(youtube, video_id)
        video_title = video_details.get('title', '')
        video_description = video_details.get('description', '')
        comments = get_video_comments(youtube, video_id, max_results=200, verbose=False)
        
        if not comments:
            raise HTTPException(status_code=404, detail="No comments found for this video")
        
        # Fast heuristic pie chart + one LLM call for summary & actions
        sentiment = heuristic_sentiment_youtube(comments, len(comments))
        prompt = _build_youtube_insights_prompt(comments, video_title, video_description)
        summary, action_items = await asyncio.to_thread(get_combined_insights, prompt)
        
        record_analysis_usage(auth)
        record_analysis_history(
            auth,
            video_id=video_id,
            video_title=video_title,
            video_url=body.video_url,
            total_comments=len(comments),
            summary=summary,
            sentiment=sentiment,
            action_items=action_items,
        )
        
        result = AnalyzeResponse(
            video_id=video_id,
            video_title=video_title,
            total_comments=len(comments),
            summary=summary,
            sentiment=sentiment,
            action_items=action_items,
            comments=[],
        )
        if auth["mode"] == "guest":
            # Pydantic v2: model_dump; fall back for older
            content = result.model_dump() if hasattr(result, "model_dump") else result.dict()
            response = JSONResponse(content=content)
            set_guest_cookie(response, auth["guest_id"])
            return response
        return result
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Log the full error for debugging
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error analyzing video: {error_trace}")
        raise HTTPException(
            status_code=500, 
            detail=f"An error occurred: {str(e)}. Please check your API keys and try again."
        )


@app.post("/analyze/stream")
async def analyze_video_stream(http_request: Request, body: AnalyzeRequest):
    """Stream YouTube analysis via SSE: meta → sentiment → summary deltas → action_items → done."""
    auth = authorize_analysis(http_request)

    try:
        video_id = extract_video_id(body.video_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    async def event_gen():
        try:
            youtube = get_youtube_service()
            video_details = await asyncio.to_thread(get_video_details, youtube, video_id)
            video_title = video_details.get("title", "")
            video_description = video_details.get("description", "")
            comments = await asyncio.to_thread(
                get_video_comments, youtube, video_id, 200, False
            )
            if not comments:
                yield _sse("error", {"detail": "No comments found for this video"})
                return

            sentiment = heuristic_sentiment_youtube(comments, len(comments))
            # Emit meta+sentiment together so the pie chart paints immediately.
            # sleep(0) + SSE padding force the ASGI server to flush early chunks.
            yield _sse(
                "meta",
                {
                    "video_id": video_id,
                    "video_title": video_title,
                    "total_comments": len(comments),
                    "sentiment": sentiment,
                },
            )
            await asyncio.sleep(0)
            yield _sse("sentiment", sentiment)
            await asyncio.sleep(0)
            yield f":{ ' ' * 2048}\n\n"
            await asyncio.sleep(0)

            prompt = _build_youtube_insights_prompt(comments, video_title, video_description)
            queue: asyncio.Queue = asyncio.Queue()
            loop = asyncio.get_running_loop()

            def run_stream():
                try:
                    for item in _iter_insights_stream(prompt):
                        loop.call_soon_threadsafe(queue.put_nowait, item)
                except Exception as exc:
                    loop.call_soon_threadsafe(queue.put_nowait, ("error", str(exc)))
                finally:
                    loop.call_soon_threadsafe(queue.put_nowait, None)

            loop.run_in_executor(None, run_stream)

            # Bound outside the loop so the history save can still see them after
            # the stream drains.
            final_summary: str = ""
            final_action_items: List = []

            while True:
                item = await queue.get()
                if item is None:
                    break
                kind = item[0]
                if kind == "summary_delta":
                    yield _sse("summary_delta", {"text": item[1]})
                elif kind == "done":
                    final_summary, final_action_items = item[1], item[2]
                    yield _sse("summary", {"text": final_summary})
                    yield _sse(
                        "action_items",
                        [a.model_dump() if hasattr(a, "model_dump") else a.dict() for a in final_action_items],
                    )
                elif kind == "error":
                    yield _sse("error", {"detail": item[1]})
                    return

            record_analysis_usage(auth)
            record_analysis_history(
                auth,
                video_id=video_id,
                video_title=video_title,
                video_url=body.video_url,
                total_comments=len(comments),
                summary=final_summary,
                sentiment=sentiment,
                action_items=final_action_items,
            )
            yield _sse("done", {"ok": True})
        except Exception as e:
            import traceback
            print(f"Error streaming video analysis: {traceback.format_exc()}")
            yield _sse("error", {"detail": str(e)})

    response = StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
    if auth["mode"] == "guest":
        set_guest_cookie(response, auth["guest_id"])
    elif auth.get("guest_id"):
        # Signed-in path already claimed/merged — drop guest cookie
        clear_guest_cookie(response)
    return response


@app.post("/analyze/pdf")
async def download_pdf_report(request: PDFRequest):
    """Generate and download PDF report from analysis results."""
    try:
        # Generate PDF from provided analysis data
        pdf_buffer = generate_pdf_report(
            video_id=request.video_id,
            video_title=request.video_title,
            total_comments=request.total_comments,
            summary=request.summary,
            sentiment=request.sentiment,
            action_items=request.action_items
        )
        
        # Read PDF content
        pdf_content = pdf_buffer.read()
        
        # Return PDF as response with proper headers
        filename = f"youtube_analysis_{request.video_id}_{datetime.now().strftime('%Y%m%d')}.pdf"
        return Response(
            content=pdf_content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Content-Type": "application/pdf",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST",
                "Access-Control-Allow-Headers": "Content-Type",
            }
        )
    
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error generating PDF: {error_trace}")
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred generating PDF: {str(e)}"
        )


def _channel_llm_json(prompt: str) -> Optional[Dict]:
    """One strict-JSON LLM call for the channel profiler, or None on failure."""
    try:
        api_key = os.getenv("TOGETHER_API_KEY")
        if not api_key:
            raise ValueError("TOGETHER_API_KEY not set")
        # These prompts are a fraction of the size of a comment batch, so they
        # get a much shorter leash than LLM_TIMEOUT_SECS: a stalled connection
        # here would otherwise hold the whole profile request open for minutes.
        client = Together(
            api_key=api_key, timeout=CHANNEL_LLM_TIMEOUT_SECS, max_retries=2
        )
        response = client.chat.completions.create(
            **_insights_completion_kwargs(
                messages=[{"role": "user", "content": prompt}],
            )
        )
        return extract_json_object_from_llm(_extract_llm_text(response))
    except Exception as exc:
        print(f"channel profile LLM call failed: {type(exc).__name__}")
        return None


def _youtube_service():
    """YouTube client, or a 503 the UI can explain (missing key is our fault)."""
    try:
        return get_youtube_service()
    except ValueError:
        raise HTTPException(
            status_code=503, detail="YouTube search is not configured right now."
        )


def _channel_http_error(exc: ChannelInsightsError) -> HTTPException:
    if isinstance(exc, ChannelNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, YouTubeQuotaError):
        return HTTPException(status_code=503, detail=str(exc))
    return HTTPException(status_code=502, detail=str(exc))


def _channel_summary(data: Dict) -> ChannelSummary:
    return ChannelSummary(
        channel_id=data.get("channel_id", ""),
        title=data.get("title", ""),
        handle=data.get("handle", "") or "",
        description=data.get("description", "") or "",
        thumbnail=data.get("thumbnail", "") or "",
        subscriber_count=data.get("subscriber_count"),
        video_count=data.get("video_count", 0) or 0,
        view_count=data.get("view_count", 0) or 0,
        published_at=data.get("published_at", "") or "",
        url=data.get("url")
        or channel_insights.channel_url(data.get("channel_id", ""), data.get("handle")),
    )


def _top_videos(rows: Optional[List[Dict]]) -> List[TopVideo]:
    return [
        TopVideo(**{k: v for k, v in row.items() if k in TopVideo.model_fields})
        for row in rows or []
    ]


def _competitors(rows: Optional[List[Dict]]) -> List[CompetitorChannel]:
    items: List[CompetitorChannel] = []
    for row in rows or []:
        fields = {k: v for k, v in row.items() if k in CompetitorChannel.model_fields}
        fields["score_components"] = CompetitorScoreComponents(
            **(row.get("score_components") or {})
        )
        items.append(CompetitorChannel(**fields))
    return items


def _video_ideas(rows: Optional[List[Dict]]) -> List[VideoIdea]:
    items: List[VideoIdea] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        inspired = [
            InspiredByVideo(**{k: v for k, v in ref.items() if k in InspiredByVideo.model_fields})
            for ref in (row.get("inspired_by") or [])
            if isinstance(ref, dict)
        ]
        items.append(
            VideoIdea(
                title=str(row.get("title") or ""),
                hook=str(row.get("hook") or ""),
                angle=str(row.get("angle") or ""),
                why_it_works=str(row.get("why_it_works") or ""),
                inspired_by=inspired,
            )
        )
    return items


def _competitor_video_packages(rows: Optional[List[Dict]]) -> List[CompetitorVideoPackage]:
    packages: List[CompetitorVideoPackage] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        packages.append(
            CompetitorVideoPackage(
                channel_id=str(row.get("channel_id") or ""),
                title=str(row.get("title") or ""),
                handle=str(row.get("handle") or ""),
                top_videos=_top_videos(row.get("top_videos")),
            )
        )
    return packages


def _enforce_profile_throttle(email: str) -> None:
    """Cap uncached profile/ideas runs per account.

    A single computation costs ~600 of the 10,000 daily YouTube units, so one
    user must not be able to drain the key for everyone. Tracked in Postgres
    (not the /tmp JSON used for analyses) because /tmp is per-instance on
    Vercel and this limit protects a shared, global resource.

    UNLIMITED tier accounts (see USER_TIERS) skip the cap.
    """
    if TIER_LIMITS.get(USER_TIERS.get(email, DEFAULT_TIER), 0) == -1:
        return
    if not db.configured():
        return
    try:
        used = db.count_channel_profile_runs(email)
    except Exception as exc:
        print(f"count_channel_profile_runs failed: {type(exc).__name__}")
        return
    if used >= CHANNEL_PROFILE_RUNS_PER_DAY:
        raise HTTPException(
            status_code=429,
            detail=(
                f"You've refreshed {CHANNEL_PROFILE_RUNS_PER_DAY} channel profiles today. "
                "Try again tomorrow."
            ),
        )


def _saved_channel_summary(email: str) -> Optional[ChannelSummary]:
    """The user's linked channel, enriched from the profile cache when possible."""
    if not db.configured():
        return None
    try:
        saved = db.get_user_channel(email)
    except Exception as exc:
        print(f"get_user_channel failed: {type(exc).__name__}")
        return None
    if not saved:
        return None

    channel_id = saved.get("channel_id", "")
    try:
        cached = db.get_channel_profile(channel_id)
    except Exception as exc:
        print(f"get_channel_profile failed: {type(exc).__name__}")
        cached = None
    if cached and cached.get("channel"):
        return _channel_summary(cached["channel"])

    return _channel_summary(
        {
            "channel_id": channel_id,
            "title": saved.get("channel_title") or channel_id,
            "handle": saved.get("handle") or "",
        }
    )


@app.post("/channel/resolve")
async def resolve_user_channel(request: Request, body: ChannelResolveRequest) -> ChannelSummary:
    """Resolve a channel URL/@handle/id and link it to the signed-in account."""
    email = require_verified_email(request)
    youtube = _youtube_service()

    try:
        channel = await asyncio.to_thread(
            channel_insights.resolve_channel, youtube, body.input
        )
    except ChannelInsightsError as exc:
        raise _channel_http_error(exc)

    if db.configured():
        db.save_user_channel(
            user_email=email,
            channel_id=channel["channel_id"],
            channel_title=channel.get("title"),
            handle=channel.get("handle"),
        )

    return _channel_summary(channel)


@app.get("/channel/me")
async def get_my_channel(request: Request) -> SavedChannelResponse:
    """The signed-in user's linked channel, or null when they haven't linked one."""
    email = require_verified_email(request)
    return SavedChannelResponse(channel=_saved_channel_summary(email))


@app.post("/channel/profile")
async def get_channel_profile(
    request: Request, body: ChannelProfileRequest
) -> ChannelProfileResponse:
    """Channel vibe profile, top videos, and competitors — cached for a week.

    Falls back to the user's linked channel when channel_input is omitted.
    """
    email = require_verified_email(request)
    youtube = _youtube_service()

    channel: Optional[Dict] = None
    channel_id = ""
    if body.channel_input:
        try:
            channel = await asyncio.to_thread(
                channel_insights.resolve_channel, youtube, body.channel_input
            )
        except ChannelInsightsError as exc:
            raise _channel_http_error(exc)
        channel_id = channel["channel_id"]
    else:
        saved = None
        if db.configured():
            try:
                saved = db.get_user_channel(email)
            except Exception as exc:
                print(f"get_user_channel failed: {type(exc).__name__}")
        if not saved:
            raise HTTPException(
                status_code=400,
                detail="Add your channel first so we can profile it.",
            )
        channel_id = saved["channel_id"]

    cached = None
    if db.configured() and not body.refresh:
        try:
            cached = db.get_channel_profile(channel_id)
        except Exception as exc:
            print(f"get_channel_profile failed: {type(exc).__name__}")
            cached = None

    if cached and channel_insights.profile_is_fresh(cached.get("computed_at")):
        computed_at = cached.get("computed_at")
        return ChannelProfileResponse(
            channel=_channel_summary(cached.get("channel") or {}),
            top_videos=_top_videos(cached.get("top_videos")),
            vibe=VibeProfile(**(cached.get("profile") or {})),
            competitors=_competitors(cached.get("competitors")),
            cached=True,
            computed_at=computed_at.isoformat() if computed_at else None,
        )

    _enforce_profile_throttle(email)

    if channel is None:
        try:
            channel = await asyncio.to_thread(
                channel_insights.resolve_channel, youtube, channel_id
            )
        except ChannelInsightsError as exc:
            raise _channel_http_error(exc)

    try:
        result = await asyncio.to_thread(
            channel_insights.compute_channel_profile, youtube, channel, _channel_llm_json
        )
    except ChannelInsightsError as exc:
        raise _channel_http_error(exc)
    except Exception as exc:
        print(f"compute_channel_profile failed: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=500, detail="We couldn't build your channel profile. Please try again."
        )

    if db.configured():
        db.save_user_channel(
            user_email=email,
            channel_id=channel["channel_id"],
            channel_title=channel.get("title"),
            handle=channel.get("handle"),
        )
        db.save_channel_profile(
            channel_id=channel["channel_id"],
            channel=channel,
            top_videos=result["top_videos"],
            profile=result["vibe"],
            competitors=result["competitors"],
        )
        db.record_channel_profile_run(email, channel["channel_id"])

    return ChannelProfileResponse(
        channel=_channel_summary(channel),
        top_videos=_top_videos(result["top_videos"]),
        vibe=VibeProfile(**result["vibe"]),
        competitors=_competitors(result["competitors"]),
        cached=False,
        computed_at=_utc_now_iso(),
    )


@app.post("/channel/ideas")
async def get_channel_ideas(
    request: Request, body: ChannelIdeasRequest
) -> ChannelIdeasResponse:
    """Recommend 3 video ideas from each competitor's top 10 videos.

    Requires a fresh step-1 profile (channel + competitors) already cached for
    the signed-in user's linked channel.
    """
    email = require_verified_email(request)

    if not db.configured():
        raise HTTPException(
            status_code=503,
            detail="Ideas aren't available right now — database is not configured.",
        )

    try:
        saved = db.get_user_channel(email)
    except Exception as exc:
        print(f"get_user_channel failed: {type(exc).__name__}")
        saved = None
    if not saved:
        raise HTTPException(
            status_code=400,
            detail="Add your channel and profile it before we can recommend ideas.",
        )

    channel_id = saved["channel_id"]
    try:
        cached = db.get_channel_profile(channel_id)
    except Exception as exc:
        print(f"get_channel_profile failed: {type(exc).__name__}")
        cached = None

    if not cached or not channel_insights.profile_is_fresh(cached.get("computed_at")):
        raise HTTPException(
            status_code=400,
            detail="Profile your channel first so we know your vibe and competitors.",
        )

    if not body.refresh and channel_insights.profile_is_fresh(
        cached.get("ideas_computed_at")
    ):
        computed_at = cached.get("ideas_computed_at")
        return ChannelIdeasResponse(
            ideas=_video_ideas(cached.get("ideas")),
            competitor_videos=_competitor_video_packages(cached.get("competitor_videos")),
            cached=True,
            computed_at=computed_at.isoformat() if computed_at else None,
        )

    competitors = cached.get("competitors") or []
    if not competitors:
        raise HTTPException(
            status_code=400,
            detail="We need at least one competitor before we can recommend ideas.",
        )

    _enforce_profile_throttle(email)
    youtube = _youtube_service()

    try:
        result = await asyncio.to_thread(
            channel_insights.compute_video_ideas,
            youtube,
            cached.get("channel") or {},
            cached.get("profile") or {},
            cached.get("top_videos") or [],
            competitors,
            _channel_llm_json,
        )
    except ChannelInsightsError as exc:
        raise _channel_http_error(exc)
    except Exception as exc:
        print(f"compute_video_ideas failed: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=500,
            detail="We couldn't generate video ideas. Please try again.",
        )

    db.save_channel_ideas(
        channel_id=channel_id,
        ideas=result["ideas"],
        competitor_videos=result["competitor_videos"],
    )
    db.record_channel_profile_run(email, channel_id)

    return ChannelIdeasResponse(
        ideas=_video_ideas(result["ideas"]),
        competitor_videos=_competitor_video_packages(result["competitor_videos"]),
        cached=False,
        computed_at=_utc_now_iso(),
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

