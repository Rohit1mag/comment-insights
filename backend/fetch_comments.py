#!/usr/bin/env python3
"""
Script to fetch comments from a YouTube video and summarize constructive criticism.
Requires YOUTUBE_API_KEY and TOGETHER_API_KEY environment variables to be set.
Environment variables can be provided via a .env file in the project root.
"""

import os
import re
import html
from pathlib import Path

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from together import Together

try:
    # Optional: load environment variables from .env if python-dotenv is installed
    from dotenv import load_dotenv

    env_path = Path(__file__).parent / ".env"
    load_dotenv(env_path)
except ImportError:
    # If python-dotenv is not available, we rely on OS environment variables only
    pass


def clean_comment_text(text: str) -> str:
    """
    Clean HTML tags, decode entities, and extract timestamps from YouTube comment text.
    
    Handles:
    - HTML anchor tags with timestamps: <a href="...?t=249">4:09</a> -> "4:09"
    - HTML entities: &amp; -> &, &quot; -> ", &lt; -> <, &gt; -> >
    - HTML tags: <br>, <p>, etc. -> removed
    - Extra whitespace: normalized to single spaces
    
    Args:
        text: Raw comment text with HTML tags and entities
    
    Returns:
        Cleaned comment text ready for display
    """
    if not text:
        return ""
    
    # Extract timestamps from links like <a href="...?t=249">4:09</a>
    # Replace with just the timestamp text (the readable format like "4:09")
    # Pattern matches: <a href="...?t=249">4:09</a> and extracts "4:09"
    text = re.sub(r'<a[^>]*href="[^"]*[?&]t=\d+"[^>]*>([^<]+)</a>', r'\1', text)
    # Also handle any <a> tags containing timestamp-like patterns
    text = re.sub(r'<a[^>]*>([\d:]+)</a>', r'\1', text)
    
    # Remove all remaining HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    
    # Decode HTML entities (&amp; -> &, &quot; -> ", etc.)
    text = html.unescape(text)
    
    # Clean up extra whitespace
    text = re.sub(r'\s+', ' ', text)
    text = text.strip()
    
    return text


def get_youtube_service():
    """Initialize and return YouTube API service."""
    api_key = os.getenv('YOUTUBE_API_KEY')
    
    if not api_key:
        raise ValueError(
            "YOUTUBE_API_KEY environment variable is not set. "
            "Please set it using: export YOUTUBE_API_KEY='your_api_key'"
        )
    
    return build('youtube', 'v3', developerKey=api_key)


def get_video_comments(youtube, video_id, max_results=100, verbose=False):
    """
    Fetch comments from a YouTube video with pagination support.
    
    Args:
        youtube: YouTube API service object
        video_id: YouTube video ID
        max_results: Maximum number of comments to fetch (default: 100)
                     Set to None or a very large number to fetch all available comments
    
    Returns:
        List of comment dictionaries
    """
    comments = []
    next_page_token = None
    page_num = 1
    
    # If max_results is None or very large, fetch all available comments
    fetch_all = max_results is None or max_results >= 10000
    
    try:
        # Fetch comments with pagination until we have max_results or run out
        while True:
            # Check if we've reached the limit (unless fetching all)
            if max_results is not None and len(comments) >= max_results:
                break
                
            # Calculate how many more we need
            if fetch_all:
                # Fetch all comments - use max page size
                page_size = 100
            else:
                remaining = max_results - len(comments)
                # YouTube API max per request is 100
                page_size = min(remaining, 100)
            
            request_params = {
                'part': 'snippet',
                'videoId': video_id,
                'maxResults': page_size,
                'order': 'relevance'  # Can be 'time' or 'relevance'
            }
            
            # Add pagination token if we have one
            if next_page_token:
                request_params['pageToken'] = next_page_token
            
            request = youtube.commentThreads().list(**request_params)
            response = request.execute()
            
            # Debug: print page info
            items_in_page = len(response.get('items', []))
            if verbose:
                print(f"  Page {page_num}: Fetched {items_in_page} comments (Total so far: {len(comments) + items_in_page})")
            
            # Process comments from this page
            for item in response.get('items', []):
                comment = item['snippet']['topLevelComment']['snippet']
                # Clean the comment text to remove HTML tags and decode entities
                cleaned_text = clean_comment_text(comment['textDisplay'])
                comments.append({
                    'author': comment['authorDisplayName'],
                    'text': cleaned_text,
                    'like_count': comment['likeCount'],
                    'published_at': comment['publishedAt']
                })
            
            # Check if there are more pages
            next_page_token = response.get('nextPageToken')
            page_num += 1
            
            if not next_page_token:
                # No more pages available
                if verbose:
                    print(f"  No more pages available. Total comments fetched: {len(comments)}")
                break
            
            # Safety check: if we got 0 items, break to avoid infinite loop
            if items_in_page == 0:
                break
        
        return comments
    
    except HttpError as e:
        print(f"An HTTP error occurred: {e}")
        raise


def summarize_constructive_criticism(comments):
    """
    Use Claude API to analyze comments and summarize constructive criticism.
    
    Args:
        comments: List of comment dictionaries
    
    Returns:
        Summary string of constructive criticism
    """
    api_key = os.getenv('TOGETHER_API_KEY')
    
    if not api_key:
        raise ValueError(
            "TOGETHER_API_KEY environment variable is not set. "
            "Please set it using: export TOGETHER_API_KEY='your_api_key'"
        )
    
    client = Together(api_key=api_key)
    
    # Prepare comments text for Claude
    comments_text = "\n\n".join([
        f"Comment {i+1} (Likes: {c['like_count']}):\n{c['text']}"
        for i, c in enumerate(comments)
    ])
    
    prompt=f"""Do your best to analyze the following YouTube comments and provide a representative summary in one paragraph for the creator. Be accurate and concise about the overall sentiment. In another paragraph, give a summary of the feedback (both good and bad) that 
    commenters have for the creator only if present. The feedback should effectively capture the postives and negatives in a proportion that is representative of the comments (just one para in total for feedback please). Also if there's anything sarcastic
    , rude, or offensive, don't include it in the feedback. If no feedback is present, say so.
    Here are the comments:
    {comments_text}"""
    
#     prompt = f"""Please analyze the following YouTube video comments and provide a summary of constructive criticism of the video."

# Focus on:
# - Specific, actionable feedback
# - Suggestions for improvement
# - Thoughtful critiques that could help the creator
# - Issues or concerns raised in a respectful manner

# Ignore:
# - Pure praise without substance
# - Spam or irrelevant comments
# - Hateful or toxic comments
# - Comments that are just jokes or memes

# Here are the comments:

# {comments_text}

# Please provide a concise summary of the constructive criticism found in these comments"""

    try:
        response = client.chat.completions.create(
            model="meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=2000
        )
        
        return response.choices[0].message.content
    
    except Exception as e:
        raise Exception(f"Error calling Together AI API: {e}")


def main():
    """Main function to fetch and print comments."""
    # Video ID extracted from: https://www.youtube.com/watch?v=egNtHu4q-vI&t=915s
    video_id = "egNtHu4q-vI"
    
    try:
        print(f"Fetching comments for video ID: {video_id}")
        print("=" * 80)
        
        youtube = get_youtube_service()
        comments = get_video_comments(youtube, video_id, max_results=100)
        
        if not comments:
            print("No comments found for this video.")
            return
        
        print(f"\nFound {len(comments)} comments")
        print("Analyzing comments for constructive criticism...")
        print("=" * 80)
        
        # Get summary from Claude
        summary = summarize_constructive_criticism(comments)
        
        print("\n" + "=" * 80)
        print("SUMMARY OF CONSTRUCTIVE CRITICISM")
        print("=" * 80)
        print(summary)
        print("=" * 80)
    
    except ValueError as e:
        print(f"Error: {e}")
    except HttpError as e:
        print(f"HTTP Error {e.resp.status}: {e.content.decode()}")
    except Exception as e:
        print(f"An error occurred: {e}")


if __name__ == "__main__":
    main()

