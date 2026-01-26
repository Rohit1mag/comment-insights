#!/usr/bin/env python3
"""
Fetch Google Maps reviews using Google Places API (New)
"""

import os
import re
import requests
from typing import List, Dict, Optional
from urllib.parse import urlparse, parse_qs
from datetime import datetime


def get_place_id_from_url(maps_url: str) -> Optional[str]:
    """
    Extract place ID from various Google Maps URL formats.
    
    Supports formats like:
    - https://www.google.com/maps/place/.../@lat,lng,zoom/data=...!1s<PLACE_ID>...
    - https://maps.google.com/maps?cid=<CID>
    - https://goo.gl/maps/<SHORT_CODE>
    """
    # Try to find place_id in URL
    place_id_match = re.search(r'!1s([a-zA-Z0-9_-]+)', maps_url)
    if place_id_match:
        return place_id_match.group(1)
    
    # Try to find CID (Customer ID) and convert it
    cid_match = re.search(r'cid=(\d+)', maps_url)
    if cid_match:
        # CID needs to be converted to place_id via API
        return None  # We'll handle this in the main function
    
    # If URL contains /place/ try to extract the name
    place_match = re.search(r'/place/([^/@]+)', maps_url)
    if place_match:
        # Return the place name for text search
        place_name = place_match.group(1).replace('+', ' ')
        return place_name
    
    return None


def get_api_key() -> str:
    """Get the Google API key."""
    api_key = os.getenv('GOOGLE_MAPS_API_KEY') or os.getenv('YOUTUBE_API_KEY')
    if not api_key:
        raise ValueError("GOOGLE_MAPS_API_KEY or YOUTUBE_API_KEY not set")
    return api_key


def get_place_details(place_id: str) -> Dict:
    """
    Get place details including name, address, rating, etc.
    Uses the new Places API (New) with direct HTTP requests.
    """
    api_key = get_api_key()
    
    # New Places API endpoint
    url = f"https://places.googleapis.com/v1/places/{place_id}"
    
    headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': api_key,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,reviews'
    }
    
    try:
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 403:
            raise ValueError(
                "Places API (New) is not enabled. Please enable it in Google Cloud Console: "
                "https://console.cloud.google.com/apis/library/places-backend.googleapis.com"
            )
        else:
            error_data = response.json() if response.text else {}
            error_msg = error_data.get('error', {}).get('message', f"HTTP {response.status_code}")
            raise ValueError(f"Failed to get place details: {error_msg}")
            
    except requests.exceptions.RequestException as e:
        raise ValueError(f"Network error fetching place details: {str(e)}")


def search_place_by_name(place_name: str) -> Optional[str]:
    """
    Search for a place by name and return its place_id.
    Uses the new Places API Text Search.
    """
    api_key = get_api_key()
    
    url = "https://places.googleapis.com/v1/places:searchText"
    
    headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': api_key,
        'X-Goog-FieldMask': 'places.id,places.displayName'
    }
    
    data = {
        'textQuery': place_name
    }
    
    try:
        response = requests.post(url, headers=headers, json=data)
        
        if response.status_code == 200:
            result = response.json()
            places = result.get('places', [])
            if places:
                # Return the first result's ID (remove 'places/' prefix)
                place_id = places[0].get('id', '')
                return place_id.replace('places/', '') if place_id else None
        return None
    except Exception as e:
        print(f"Error searching for place: {str(e)}")
        return None


def get_place_reviews(place_id: str, max_results: int = 100) -> tuple[List[Dict], Dict]:
    """
    Fetch reviews for a Google Maps place using the new Places API.
    
    Note: Google Places API typically returns only 5 reviews per request.
    This function will return up to max_results reviews if available, but
    may be limited by Google's API constraints.
    
    Returns:
        tuple: (reviews_list, place_info)
    """
    try:
        # First, get place details to extract place info
        place_details = get_place_details(place_id)
        
        # Extract place info (new API format)
        display_name = place_details.get('displayName', {})
        place_info = {
            'name': display_name.get('text', 'Unknown Place') if isinstance(display_name, dict) else str(display_name),
            'address': place_details.get('formattedAddress', ''),
            'rating': place_details.get('rating', 0),
            'total_ratings': place_details.get('userRatingCount', 0)
        }
        
        # Get reviews from place details
        # Note: Google Places API typically returns only 5 reviews
        # The new API might return more, but we'll cap at max_results
        reviews_raw = place_details.get('reviews', [])
        
        # Process reviews
        reviews = []
        for review in reviews_raw[:max_results]:
            # Get author name
            author_attribution = review.get('authorAttribution', {})
            author_name = author_attribution.get('displayName', 'Anonymous')
            
            # Get review text
            text_obj = review.get('text', {})
            review_text = text_obj.get('text', '') if isinstance(text_obj, dict) else str(text_obj)
            
            # Skip empty reviews
            if not review_text.strip():
                continue
            
            # Get publish time
            publish_time = review.get('publishTime', '')
            try:
                # Convert ISO format to timestamp
                if publish_time:
                    from dateutil import parser
                    dt = parser.parse(publish_time)
                    published_at = dt.isoformat()
                else:
                    published_at = datetime.now().isoformat()
            except:
                published_at = datetime.now().isoformat()
            
            reviews.append({
                'author': author_name,
                'text': review_text,
                'rating': review.get('rating', 0),
                'time': 0,  # Not used in new API
                'published_at': published_at,
                'like_count': 0  # Google Places API doesn't provide like counts
            })
        
        # If we got fewer reviews than requested, that's okay
        # Google Places API has limitations on how many reviews it returns
        # Typically it's 5 reviews, but the new API might return more
        
        return reviews, place_info
        
    except Exception as e:
        raise ValueError(f"Error fetching reviews: {str(e)}")


def extract_place_id_from_url(maps_url: str) -> str:
    """
    Extract place ID from Google Maps URL or search by name.
    """
    # First try to extract place_id directly from URL
    place_identifier = get_place_id_from_url(maps_url)
    
    if not place_identifier:
        raise ValueError("Could not extract place information from URL")
    
    # If it looks like a place_id (starts with ChIJ or similar)
    if place_identifier.startswith('ChIJ') or place_identifier.startswith('0x'):
        return place_identifier
    
    # Otherwise, search by name
    place_id = search_place_by_name(place_identifier)
    if not place_id:
        raise ValueError(f"Could not find place: {place_identifier}")
    
    return place_id


if __name__ == "__main__":
    # Test the functions
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python fetch_maps_reviews.py <google_maps_url>")
        sys.exit(1)
    
    maps_url = sys.argv[1]
    
    try:
        from dotenv import load_dotenv
        load_dotenv()
        
        print(f"Fetching reviews for: {maps_url}")
        
        # Extract place ID
        place_id = extract_place_id_from_url(maps_url)
        print(f"Place ID: {place_id}")
        
        # Get reviews
        reviews, place_info = get_place_reviews(place_id)
        
        print(f"\nPlace: {place_info['name']}")
        print(f"Address: {place_info['address']}")
        print(f"Rating: {place_info['rating']} ({place_info['total_ratings']} ratings)")
        print(f"\nFetched {len(reviews)} reviews")
        
        # Print first few reviews
        for i, review in enumerate(reviews[:3], 1):
            print(f"\nReview {i}:")
            print(f"Author: {review['author']}")
            print(f"Rating: {review['rating']}/5")
            print(f"Text: {review['text'][:100]}...")
            
    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)
