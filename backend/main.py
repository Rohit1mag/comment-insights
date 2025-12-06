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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import from local module (same directory)
from fetch_comments import get_youtube_service, get_video_comments
from anthropic import Anthropic

# Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = FastAPI(title="YouTube Comment Insights API")

# Usage tracking
USAGE_FILE = Path(__file__).parent / "usage_data.json"
ANALYSIS_LIMIT = 5
UNLIMITED_USERS = ["rohitkota4@gmail.com"]


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


def check_usage_limit(email: Optional[str]) -> tuple[bool, int]:
    """
    Check if user can perform analysis.
    Returns (can_analyze, remaining_analyses).
    """
    if not email:
        return False, 0
    
    if email in UNLIMITED_USERS:
        return True, -1  # -1 indicates unlimited
    
    current_usage = get_user_usage(email)
    remaining = max(0, ANALYSIS_LIMIT - current_usage)
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


class UsageResponse(BaseModel):
    email: str
    used: int
    remaining: int  # -1 means unlimited
    limit: int
    is_unlimited: bool


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
    total_comments: int
    summary: str
    sentiment: Dict[str, int]
    action_items: List[ActionItem]
    comments: List[Comment]


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


def get_ai_summary(comments: List[Dict]) -> str:
    """Get AI summary of comments."""
    api_key = os.getenv('CLAUDE_API_KEY')
    if not api_key:
        raise ValueError("CLAUDE_API_KEY not set")
    
    client = Anthropic(api_key=api_key)
    
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
    
    prompt = f"""Analyze these YouTube comments and provide a representative summary in one paragraph for the creator. Be accurate and concise about the overall sentiment. 

In another paragraph, give a summary of the feedback (both good and bad) that commenters have for the creator only if present. The feedback should effectively capture the positives and negatives in a proportion that is representative of the comments.

If no meaningful feedback is present, say so.

Comments:
{comments_text}"""
    
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}]
    )
    
    return message.content[0].text


def get_sentiment_analysis(comments: List[Dict]) -> Dict[str, int]:
    """Get sentiment breakdown of comments."""
    api_key = os.getenv('CLAUDE_API_KEY')
    if not api_key:
        raise ValueError("CLAUDE_API_KEY not set")
    
    client = Anthropic(api_key=api_key)
    
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
    
    prompt = f"""Analyze the sentiment of these YouTube comments and categorize each as "positive", "neutral", or "negative".

Return ONLY a JSON object with this format:
{{
  "positive": <number>,
  "neutral": <number>,
  "negative": <number>
}}

Comments:
{comments_text}"""
    
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )
    
    response_text = message.content[0].text.strip()
    
    # Extract JSON
    import json
    json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', response_text)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass
    
    # Fallback
    return {"positive": 0, "neutral": 0, "negative": 0}


def get_action_items(comments: List[Dict]) -> List[ActionItem]:
    """Get actionable recommendations from comments."""
    api_key = os.getenv('CLAUDE_API_KEY')
    if not api_key:
        raise ValueError("CLAUDE_API_KEY not set")
    
    client = Anthropic(api_key=api_key)
    
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
    
    prompt = f"""Based on these YouTube comments, provide 3-5 specific, actionable recommendations for the creator to improve their next video.

Return ONLY a JSON array with this format:
[
  {{
    "title": "Short action title",
    "description": "Brief explanation of why and how",
    "impact": "High|Medium|Low"
  }}
]

Focus on:
- Concrete, specific actions (not vague advice)
- Things mentioned by multiple commenters
- Balance positive reinforcement with areas to improve
- Prioritize by impact (what will make the biggest difference)
- Things the creator can improve from the next video, because its useless giving them recommendation for a video already posted

Comments:
{comments_text}"""
    
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}]
    )
    
    response_text = message.content[0].text.strip()
    
    # Extract JSON array
    import json
    json_match = re.search(r'\[[\s\S]*\]', response_text)
    if json_match:
        try:
            action_data = json.loads(json_match.group())
            return [ActionItem(**item) for item in action_data]
        except (json.JSONDecodeError, ValueError):
            pass
    
    # Fallback
    return []


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


@app.get("/")
async def root():
    return {"message": "YouTube Comment Insights API", "status": "running"}


@app.get("/usage/{email}")
async def get_usage(email: str) -> UsageResponse:
    """Get usage statistics for a user."""
    is_unlimited = email in UNLIMITED_USERS
    used = get_user_usage(email)
    remaining = -1 if is_unlimited else max(0, ANALYSIS_LIMIT - used)
    
    return UsageResponse(
        email=email,
        used=used,
        remaining=remaining,
        limit=ANALYSIS_LIMIT,
        is_unlimited=is_unlimited
    )


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
            raise HTTPException(
                status_code=429, 
                detail=f"You've reached your limit of {ANALYSIS_LIMIT} free analyses. Contact support for more access."
            )
        
        # Extract video ID
        video_id = extract_video_id(request.video_url)
        
        # Fetch comments - production limit for quota management
        # 1000 comments gives good coverage while managing API costs
        youtube = get_youtube_service()
        comments = get_video_comments(youtube, video_id, max_results=1000, verbose=False)
        
        if not comments:
            raise HTTPException(status_code=404, detail="No comments found for this video")
        
        # Get AI analysis (parallel would be better, but keeping it simple)
        summary = get_ai_summary(comments)
        sentiment = get_sentiment_analysis(comments)
        action_items = get_action_items(comments)
        
        # Assign sentiments to comments
        comments_with_sentiment = assign_sentiments_to_comments(comments, sentiment)
        
        # Increment usage count after successful analysis
        if request.user_email and request.user_email not in UNLIMITED_USERS:
            increment_user_usage(request.user_email)
        
        return AnalyzeResponse(
            video_id=video_id,
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

