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
from fastapi.responses import Response
from pydantic import BaseModel
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from io import BytesIO

# Import from local module (same directory)
from fetch_comments import get_youtube_service, get_video_comments, get_video_details
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
ANALYSIS_LIMIT = 8
UNLIMITED_USERS = ["rohitkota4@gmail.com"]
CUSTOM_LIMITS = {"rkdscnd@gmail.com": 100}  # Custom limits for specific users


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
    
    # Check for custom limits
    user_limit = CUSTOM_LIMITS.get(email, ANALYSIS_LIMIT)
    
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
    video_title: str
    total_comments: int
    summary: str
    sentiment: Dict[str, int]
    action_items: List[ActionItem]
    comments: List[Comment]


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
        model="meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2000
    )
    
    return response.choices[0].message.content


def get_sentiment_analysis(comments: List[Dict], video_title: str = "", video_description: str = "") -> Dict[str, int]:
    """Get sentiment breakdown of comments."""
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

Return ONLY a JSON object with this format:
{{
  "positive": <number>,
  "neutral": <number>,
  "negative": <number>
}}

{video_context}Comments:
{comments_text}"""
    
    response = client.chat.completions.create(
        model="meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500
    )
    
    response_text = response.choices[0].message.content.strip()
    
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

{video_context}Comments:
{comments_text}"""
    
    response = client.chat.completions.create(
        model="meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1500
    )
    
    response_text = response.choices[0].message.content.strip()
    
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
    is_unlimited = email in UNLIMITED_USERS
    used = get_user_usage(email)
    
    # Get the user's limit (custom or default)
    user_limit = CUSTOM_LIMITS.get(email, ANALYSIS_LIMIT)
    remaining = -1 if is_unlimited else max(0, user_limit - used)
    
    return UsageResponse(
        email=email,
        used=used,
        remaining=remaining,
        limit=user_limit,
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
            user_limit = CUSTOM_LIMITS.get(request.user_email, ANALYSIS_LIMIT)
            raise HTTPException(
                status_code=429, 
                detail=f"You've reached your limit of {user_limit} analyses. Contact support for more access."
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
        if request.user_email and request.user_email not in UNLIMITED_USERS:
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

