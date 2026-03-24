#!/usr/bin/env python3
"""
FastAPI backend for YouTube Comment Insights
"""

import os
import re
import json
import random
from datetime import datetime
from typing import List, Dict, Optional
from urllib.parse import urlparse, parse_qs
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import stripe
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from io import BytesIO

# Import from local module (same directory)
from fetch_comments import get_youtube_service, get_video_comments, get_video_details
from fetch_maps_reviews import get_place_reviews, extract_place_id_from_url
from together import Together

# Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = FastAPI(title="YouTube Comment Insights API")

# Usage tracking
USAGE_FILE = Path(__file__).parent / "usage_data.json"
SUBSCRIPTIONS_FILE = Path(__file__).parent / "subscriptions_data.json"

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

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    video_url: str
    user_email: Optional[str] = None


class AnalyzeMapsRequest(BaseModel):
    maps_url: str
    user_email: Optional[str] = None


class UsageResponse(BaseModel):
    email: str
    used: int
    remaining: int  # -1 means unlimited
    limit: int
    is_unlimited: bool
    tier: str


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
    comments: List[Comment]


class Review(BaseModel):
    author: str
    text: str
    rating: int
    published_at: str
    sentiment: Optional[str] = None


class AnalyzeMapsResponse(BaseModel):
    place_id: str
    place_name: str
    place_address: str
    place_rating: float
    total_reviews: int
    summary: str
    sentiment: Dict[str, int]
    action_items: List[ActionItem]
    reviews: List[Review]


class PDFRequest(BaseModel):
    video_id: str
    video_title: str
    total_comments: int
    summary: str
    sentiment: Dict[str, int]
    action_items: List[ActionItem]


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


def heuristic_sentiment_maps(reviews: List[Dict], total: int) -> Dict[str, int]:
    """Use star ratings when LLM JSON fails (4–5 positive, 3 neutral, 1–2 negative)."""
    if total <= 0:
        return {"positive": 0, "neutral": 0, "negative": 0}
    pos, neg, neutral = 0, 0, 0
    for r in reviews:
        rating = int(r.get("rating") or 0)
        if rating >= 4:
            pos += 1
        elif rating <= 2:
            neg += 1
        else:
            neutral += 1
    s = pos + neg + neutral
    if s == 0:
        return {"positive": total, "neutral": 0, "negative": 0}
    scale = total / s
    rp = max(0, round(pos * scale))
    rn = max(0, round(neg * scale))
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
        v = obj.get(key)
        if isinstance(v, list) and v:
            return v
    return None


def _parse_action_items_from_response(response_text: str) -> List[ActionItem]:
    arr = extract_json_array_from_llm(response_text)
    if not arr:
        obj = extract_json_object_from_llm(response_text)
        if isinstance(obj, dict):
            arr = _action_array_from_object(obj)
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
    return out


def get_ai_summary(comments: List[Dict], video_title: str = "", video_description: str = "") -> str:
    """Get AI summary of comments."""
    api_key = os.getenv('TOGETHER_API_KEY')
    if not api_key:
        raise ValueError("TOGETHER_API_KEY not set")
    
    client = Together(api_key=api_key)
    
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
        model="moonshotai/Kimi-K2.5",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=8000
    )
    
    msg = response.choices[0].message
    content = msg.content or getattr(msg, "reasoning_content", None) or ""
    print(f"[DEBUG summary] finish={response.choices[0].finish_reason}, content length={len(content)}, first 200 chars: {content[:200]!r}")
    if not content.strip():
        content = "Summary could not be generated. Please try again."
    return content


def get_sentiment_analysis(comments: List[Dict], video_title: str = "", video_description: str = "") -> Dict[str, int]:
    """Get sentiment breakdown of comments."""
    api_key = os.getenv('TOGETHER_API_KEY')
    if not api_key:
        raise ValueError("TOGETHER_API_KEY not set")
    
    client = Together(api_key=api_key)
    
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
        model="moonshotai/Kimi-K2.5",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=8000
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
    api_key = os.getenv('TOGETHER_API_KEY')
    if not api_key:
        raise ValueError("TOGETHER_API_KEY not set")
    
    client = Together(api_key=api_key)
    
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
    
    prompt = f"""Based on these YouTube comments, provide 3-5 specific, actionable recommendations for the creator to improve their next video.

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

{video_context}Comments:
{comments_text}"""
    
    response = client.chat.completions.create(
        model="moonshotai/Kimi-K2.5",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=8000
    )
    
    response_text = _extract_llm_text(response)
    print(f"[DEBUG yt actions] finish={response.choices[0].finish_reason}, response: {response_text[:300]!r}")
    items = _parse_action_items_from_response(response_text)
    if items:
        return items
    return [
        ActionItem(
            title="Review audience feedback in the comment browser",
            description="Structured recommendations could not be parsed from the model response. Scroll through filtered comments below to spot recurring themes.",
            impact="Medium",
        )
    ]


def get_maps_ai_summary(reviews: List[Dict], place_name: str = "", place_address: str = "") -> str:
    """Get AI summary of Google Maps reviews."""
    api_key = os.getenv('TOGETHER_API_KEY')
    if not api_key:
        raise ValueError("TOGETHER_API_KEY not set")
    
    client = Together(api_key=api_key)
    
    # Smart sampling for production
    if len(reviews) > 500:
        top_reviews = sorted(reviews, key=lambda x: x.get('rating', 0), reverse=True)[:300]
        remaining = [r for r in reviews if r not in top_reviews]
        random_sample = random.sample(remaining, min(200, len(remaining))) if remaining else []
        sampled_reviews = top_reviews + random_sample
    else:
        sampled_reviews = reviews
    
    reviews_text = "\n\n".join([
        f"Review {i+1} (Rating: {r.get('rating', 0)}/5):\n{r['text']}"
        for i, r in enumerate(sampled_reviews)
    ])
    
    # Build context about the place
    place_context = ""
    if place_name:
        place_context += f"Business Name: {place_name}\n\n"
    if place_address:
        place_context += f"Location: {place_address}\n\n"
    
    prompt = f"""Analyze these Google Maps reviews and provide a representative summary for the business owner. Follow this exact format and style:

**Overall Sentiment:**
[Write one paragraph that accurately and concisely summarizes the overall sentiment of the reviews. Be specific about what customers are saying and feeling.]

**Feedback Summary:**
[Write one paragraph summarizing the feedback (both positive and negative) that customers have for the business. Capture the positives and negatives in proportions representative of the reviews. Focus on actionable insights.]

Style guidelines:
- Use clear, professional language
- Be specific and concrete (mention what customers actually said)
- Maintain a balanced, objective tone
- Keep paragraphs concise but informative
- Use present tense when describing customer sentiments

{place_context}Reviews:
{reviews_text}"""
    
    response = client.chat.completions.create(
        model="moonshotai/Kimi-K2.5",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=8000
    )
    
    msg = response.choices[0].message
    content = msg.content or getattr(msg, "reasoning_content", None) or ""
    print(f"[DEBUG maps summary] finish={response.choices[0].finish_reason}, content length={len(content)}, first 200 chars: {content[:200]!r}")
    if not content.strip():
        content = "Summary could not be generated. Please try again."
    return content


def get_maps_sentiment_analysis(reviews: List[Dict], place_name: str = "") -> Dict[str, int]:
    """Get sentiment breakdown of Google Maps reviews."""
    api_key = os.getenv('TOGETHER_API_KEY')
    if not api_key:
        raise ValueError("TOGETHER_API_KEY not set")
    
    client = Together(api_key=api_key)
    
    total_reviews = len(reviews)
    
    # Smart sampling
    if len(reviews) > 500:
        top_reviews = sorted(reviews, key=lambda x: x.get('rating', 0), reverse=True)[:300]
        remaining = [r for r in reviews if r not in top_reviews]
        random_sample = random.sample(remaining, min(200, len(remaining))) if remaining else []
        sampled_reviews = top_reviews + random_sample
    else:
        sampled_reviews = reviews
    
    reviews_text = "\n\n".join([
        f"Review {i+1} (Rating: {r.get('rating', 0)}/5): {r['text']}"
        for i, r in enumerate(sampled_reviews)
    ])
    
    place_context = f"Business Name: {place_name}\n\n" if place_name else ""
    
    prompt = f"""Analyze the sentiment of these Google Maps reviews and categorize each as "positive", "neutral", or "negative".

Return ONLY a single JSON object (no markdown fences, no explanation) with this exact shape:
{{
  "positive": <number>,
  "neutral": <number>,
  "negative": <number>
}}
The three numbers must sum to the number of reviews analyzed and represent counts of each sentiment.

{place_context}Reviews:
{reviews_text}"""
    
    response = client.chat.completions.create(
        model="moonshotai/Kimi-K2.5",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=8000
    )
    
    response_text = _extract_llm_text(response)
    print(f"[DEBUG maps sentiment] finish={response.choices[0].finish_reason}, response: {response_text[:300]!r}")
    obj = extract_json_object_from_llm(response_text)
    if obj:
        parsed = _parse_sentiment_counts_from_dict(obj, total_reviews)
        if parsed is not None:
            h = heuristic_sentiment_maps(reviews, total_reviews)
            if _looks_like_equal_thirds_split(parsed, total_reviews) and not _looks_like_equal_thirds_split(
                h, total_reviews
            ):
                return h
            return parsed
    return heuristic_sentiment_maps(reviews, total_reviews)


def get_maps_action_items(reviews: List[Dict], place_name: str = "") -> List[ActionItem]:
    """Get actionable recommendations from Google Maps reviews."""
    api_key = os.getenv('TOGETHER_API_KEY')
    if not api_key:
        raise ValueError("TOGETHER_API_KEY not set")
    
    client = Together(api_key=api_key)
    
    # Smart sampling
    if len(reviews) > 500:
        top_reviews = sorted(reviews, key=lambda x: x.get('rating', 0), reverse=True)[:300]
        remaining = [r for r in reviews if r not in top_reviews]
        random_sample = random.sample(remaining, min(200, len(remaining))) if remaining else []
        sampled_reviews = top_reviews + random_sample
    else:
        sampled_reviews = reviews
    
    reviews_text = "\n\n".join([
        f"Review {i+1} (Rating: {r.get('rating', 0)}/5):\n{r['text']}"
        for i, r in enumerate(sampled_reviews)
    ])
    
    place_context = f"Business Name: {place_name}\n\n" if place_name else ""
    
    prompt = f"""Based on these Google Maps reviews, provide 3-5 specific, actionable recommendations for the business owner to improve their business.

Return ONLY a JSON array (no markdown fences, no explanation). Each item must have "title", "description", and "impact" where impact is exactly one of: High, Medium, Low.

Focus on:
- Concrete, specific actions (not vague advice)
- Things mentioned by multiple customers
- Balance positive reinforcement with areas to improve
- Prioritize by impact (what will make the biggest difference)
- Actionable improvements the business can make going forward

{place_context}Reviews:
{reviews_text}"""
    
    response = client.chat.completions.create(
        model="moonshotai/Kimi-K2.5",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=8000
    )
    
    response_text = _extract_llm_text(response)
    print(f"[DEBUG maps actions] finish={response.choices[0].finish_reason}, response: {response_text[:300]!r}")
    items = _parse_action_items_from_response(response_text)
    if items:
        return items
    return [
        ActionItem(
            title="Review customer feedback in the review browser",
            description="Structured recommendations could not be parsed from the model response. Use the reviews below to identify recurring themes.",
            impact="Medium",
        )
    ]


def assign_sentiments_to_reviews(reviews: List[Dict], sentiment_counts: Dict[str, int]) -> List[Review]:
    """Assign sentiment labels to individual reviews based on overall distribution."""
    total = len(reviews)
    if total == 0:
        return []
    
    positive_count = sentiment_counts.get('positive', 0)
    neutral_count = sentiment_counts.get('neutral', 0)
    negative_count = sentiment_counts.get('negative', 0)
    
    # Sort reviews by rating (highest first)
    sorted_reviews = sorted(reviews, key=lambda x: x.get('rating', 0), reverse=True)
    
    result = []
    for i, review in enumerate(sorted_reviews):
        ratio = i / max(total, 1)
        
        if ratio < positive_count / max(total, 1):
            sentiment = "positive"
        elif ratio < (positive_count + neutral_count) / max(total, 1):
            sentiment = "neutral"
        else:
            sentiment = "negative"
        
        result.append(Review(
            author=review['author'],
            text=review['text'],
            rating=review.get('rating', 0),
            published_at=review['published_at'],
            sentiment=sentiment
        ))
    
    return result


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
    story.append(Paragraph("YouTube Comment Analysis Report", title_style))
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
        "<i>Report generated by YouTube Comment Insights</i>",
        ParagraphStyle('Footer', parent=styles['Normal'], fontSize=9, textColor=colors.grey, alignment=TA_CENTER)
    ))
    
    # Build PDF
    doc.build(story)
    buffer.seek(0)
    return buffer


@app.get("/")
async def root():
    return {"message": "YouTube Comment Insights API", "status": "running"}


@app.get("/usage/{email}")
async def get_usage(email: str) -> UsageResponse:
    """Get usage statistics for a user."""
    # Get user's tier
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


@app.get("/tier/{email}")
async def get_user_tier(email: str):
    """Get tier information for a user."""
    tier = USER_TIERS.get(email, DEFAULT_TIER)
    limit = TIER_LIMITS[tier]
    return {
        "tier": tier,
        "limit": limit if limit != -1 else "unlimited",
        "price": "$0" if tier == "FREE" else "$4.99" if tier == "PRO" else "Custom"
    }


class CheckoutRequest(BaseModel):
    email: str
    success_url: str
    cancel_url: str


@app.post("/create-checkout-session")
async def create_checkout_session(request: CheckoutRequest):
    """Create a Stripe checkout session for Pro subscription."""
    if not STRIPE_PRICE_ID:
        raise HTTPException(status_code=500, detail="Stripe price ID not configured")
    
    try:
        checkout_session = stripe.checkout.Session.create(
            customer_email=request.email,
            payment_method_types=["card"],
            line_items=[
                {
                    "price": STRIPE_PRICE_ID,
                    "quantity": 1,
                }
            ],
            mode="subscription",
            success_url=request.success_url,
            cancel_url=request.cancel_url,
            metadata={
                "user_email": request.email,
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


@app.get("/subscription-status/{email}")
async def get_subscription_status(email: str):
    """Get subscription status for a user."""
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


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_video(request: AnalyzeRequest):
    """Analyze a YouTube video's comments."""
    try:
        # Check usage limits
        if not request.user_email:
            raise HTTPException(
                status_code=401, 
                detail="Please sign in to analyze videos"
            )
        
        can_analyze, remaining = check_usage_limit(request.user_email)
        if not can_analyze:
            tier = USER_TIERS.get(request.user_email, DEFAULT_TIER)
            user_limit = TIER_LIMITS[tier]
            raise HTTPException(
                status_code=429, 
                detail=f"You've reached your {tier} tier limit of {user_limit} analyses. Upgrade to Pro for 15 analyses/month!"
            )
        
        # Extract video ID
        video_id = extract_video_id(request.video_url)
        
        # Fetch video details and comments - production limit for quota management
        # 1000 comments gives good coverage while managing API costs
        youtube = get_youtube_service()
        video_details = get_video_details(youtube, video_id)
        video_title = video_details.get('title', '')
        video_description = video_details.get('description', '')
        comments = get_video_comments(youtube, video_id, max_results=1000, verbose=False)
        
        if not comments:
            raise HTTPException(status_code=404, detail="No comments found for this video")
        
        # Get AI analysis (parallel would be better, but keeping it simple)
        # Pass video context to help LLM provide better analysis
        summary = get_ai_summary(comments, video_title, video_description)
        sentiment = get_sentiment_analysis(comments, video_title, video_description)
        action_items = get_action_items(comments, video_title, video_description)
        
        # Assign sentiments to comments
        comments_with_sentiment = assign_sentiments_to_comments(comments, sentiment)
        
        # Increment usage count after successful analysis
        if request.user_email:
            tier = USER_TIERS.get(request.user_email, DEFAULT_TIER)
            if TIER_LIMITS[tier] != -1:  # Only increment if not unlimited
                increment_user_usage(request.user_email)
        
        return AnalyzeResponse(
            video_id=video_id,
            video_title=video_title,
            total_comments=len(comments),
            summary=summary,
            sentiment=sentiment,
            action_items=action_items,
            comments=comments_with_sentiment
        )
    
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


@app.post("/analyze-maps", response_model=AnalyzeMapsResponse)
async def analyze_maps_place(request: AnalyzeMapsRequest):
    """Analyze a Google Maps place's reviews."""
    try:
        # Check usage limits
        if not request.user_email:
            raise HTTPException(
                status_code=401, 
                detail="Please sign in to analyze places"
            )
        
        can_analyze, remaining = check_usage_limit(request.user_email)
        if not can_analyze:
            tier = USER_TIERS.get(request.user_email, DEFAULT_TIER)
            user_limit = TIER_LIMITS[tier]
            raise HTTPException(
                status_code=429, 
                detail=f"You've reached your {tier} tier limit of {user_limit} analyses. Upgrade to Pro for 15 analyses/month!"
            )
        
        # Extract place ID from URL
        place_id = extract_place_id_from_url(request.maps_url)
        
        # Fetch place reviews
        reviews, place_info = get_place_reviews(place_id, max_results=1000)
        
        if not reviews:
            raise HTTPException(status_code=404, detail="No reviews found for this place")
        
        # Get AI analysis
        summary = get_maps_ai_summary(reviews, place_info['name'], place_info['address'])
        sentiment = get_maps_sentiment_analysis(reviews, place_info['name'])
        action_items = get_maps_action_items(reviews, place_info['name'])
        
        # Assign sentiments to reviews
        reviews_with_sentiment = assign_sentiments_to_reviews(reviews, sentiment)
        
        # Increment usage count after successful analysis
        if request.user_email:
            tier = USER_TIERS.get(request.user_email, DEFAULT_TIER)
            if TIER_LIMITS[tier] != -1:  # Only increment if not unlimited
                increment_user_usage(request.user_email)
        
        return AnalyzeMapsResponse(
            place_id=place_id,
            place_name=place_info['name'],
            place_address=place_info['address'],
            place_rating=place_info['rating'],
            total_reviews=len(reviews),
            summary=summary,
            sentiment=sentiment,
            action_items=action_items,
            reviews=reviews_with_sentiment
        )
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Log the full error for debugging
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error analyzing Google Maps place: {error_trace}")
        raise HTTPException(
            status_code=500, 
            detail=f"An error occurred: {str(e)}. Please check your API keys and try again."
        )


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

