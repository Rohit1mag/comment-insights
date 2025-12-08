#!/usr/bin/env python3
"""
Streamlit app for analyzing YouTube video comments.
"""

import streamlit as st
import re
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from fetch_comments import get_youtube_service, get_video_comments, summarize_constructive_criticism
from together import Together
import plotly.express as px

try:
    # Optional: load environment variables from .env if python-dotenv is installed
    from dotenv import load_dotenv

    env_path = Path(__file__).parent / ".env"
    load_dotenv(env_path)
except ImportError:
    # If python-dotenv is not available, we rely on OS environment variables only
    pass

def extract_video_id(url):
    """Extract video ID from various YouTube URL formats."""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    
    # If no match, try parsing as URL
    parsed = urlparse(url)
    if parsed.hostname and 'youtube.com' in parsed.hostname:
        params = parse_qs(parsed.query)
        if 'v' in params:
            return params['v'][0]
    
    return None


def analyze_sentiment(comments):
    """
    Use Together AI API to analyze sentiment of comments and return counts.
    
    Args:
        comments: List of comment dictionaries
    
    Returns:
        Dictionary with 'positive', 'neutral', 'negative' counts
    """
    api_key = os.getenv('TOGETHER_API_KEY')
    
    if not api_key:
        raise ValueError("TOGETHER_API_KEY environment variable is not set.")
    
    client = Together(api_key=api_key)
    
    # Prepare comments text for Claude
    comments_text = "\n\n".join([
        f"Comment {i+1}: {c['text']}"
        for i, c in enumerate(comments)
    ])
    
    prompt = f"""Analyze the sentiment of the following YouTube video comments and categorize each comment as either "positive", "neutral", or "negative".

Return ONLY a JSON object with this exact format:
{{
  "positive": <number>,
  "neutral": <number>,
  "negative": <number>
}}

Where the numbers represent the count of comments in each category. Be accurate and representative.

Here are the comments:
{comments_text}"""

    try:
        response = client.chat.completions.create(
            model="meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=500
        )
        
        response_text = response.choices[0].message.content.strip()
        
        # Extract JSON from response
        import json
        # Try to find JSON object in the response (handles nested objects)
        json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', response_text)
        if json_match:
            try:
                sentiment_data = json.loads(json_match.group())
                return sentiment_data
            except json.JSONDecodeError:
                pass
        
        # Fallback: try to parse the whole response
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            # If all else fails, return default values
            st.warning("Could not parse sentiment analysis. Using default values.")
            return {"positive": 0, "neutral": 0, "negative": 0}
    
    except Exception as e:
        st.error(f"Error analyzing sentiment: {e}")
        # Return default values if analysis fails
        return {"positive": 0, "neutral": 0, "negative": 0}


def main():
    st.set_page_config(
        page_title="YouTube Comment Insights",
        page_icon="📊",
        layout="wide"
    )
    
    st.title("📊 YouTube Comment Insights")
    st.markdown("Analyze comments from any YouTube video and get sentiment insights")
    
    # Main input area
    col1, col2 = st.columns([4, 1])
    
    with col1:
        youtube_url = st.text_input(
            "Enter YouTube Video URL",
            placeholder="https://www.youtube.com/watch?v=...",
            label_visibility="collapsed"
        )
    
    with col2:
        analyze_button = st.button("🔍 See Insights", type="primary", use_container_width=True)
    
    # Process when button is clicked
    if analyze_button:
        if not youtube_url:
            st.error("Please enter a YouTube URL")
            st.stop()
        
        # Extract video ID
        video_id = extract_video_id(youtube_url)
        
        if not video_id:
            st.error("Invalid YouTube URL. Please check the URL and try again.")
            st.stop()
        
        # Show loading state
        with st.spinner("Fetching comments from YouTube..."):
            try:
                youtube = get_youtube_service()
                comments = get_video_comments(youtube, video_id, max_results=100, verbose=False)
                
                if not comments:
                    st.warning("No comments found for this video.")
                    st.stop()
                
                st.success(f"✅ Fetched {len(comments)} comments")
                
            except Exception as e:
                st.error(f"Error fetching comments: {e}")
                st.stop()
        
        # Analyze comments
        with st.spinner("Analyzing comments with AI..."):
            try:
                # Get summary
                summary = summarize_constructive_criticism(comments)
                
                # Get sentiment breakdown
                sentiment_data = analyze_sentiment(comments)
                
            except Exception as e:
                st.error(f"Error analyzing comments: {e}")
                st.stop()
        
        # Display results
        st.divider()
        
        # Create two columns for summary
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("📝 Summary")
            st.write(summary)
        
        with col2:
            st.subheader("📊 Sentiment Breakdown")
            
            # Create pie chart
            labels = ['Positive', 'Neutral', 'Negative']
            values = [
                sentiment_data.get('positive', 0),
                sentiment_data.get('neutral', 0),
                sentiment_data.get('negative', 0)
            ]
            
            colors = ['#2ecc71', '#f39c12', '#e74c3c']
            
            fig = px.pie(
                values=values,
                names=labels,
                color_discrete_sequence=colors,
                hole=0.4
            )
            
            fig.update_traces(
                textposition='inside',
                textinfo='percent+label',
                hovertemplate='<b>%{label}</b><br>%{value} comments<br>%{percent}<extra></extra>'
            )
            
            fig.update_layout(
                showlegend=True,
                height=400,
                margin=dict(l=20, r=20, t=20, b=20)
            )
            
            st.plotly_chart(fig, use_container_width=True)
            
            # Display counts
            st.markdown("### Comment Counts")
            col_pos, col_neu, col_neg = st.columns(3)
            
            with col_pos:
                st.metric("Positive", sentiment_data.get('positive', 0))
            with col_neu:
                st.metric("Neutral", sentiment_data.get('neutral', 0))
            with col_neg:
                st.metric("Negative", sentiment_data.get('negative', 0))


if __name__ == "__main__":
    main()

