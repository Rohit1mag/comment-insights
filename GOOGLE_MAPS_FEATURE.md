# Google Maps Review Analysis Feature

## Overview

Added a new tab to analyze Google Maps reviews alongside YouTube comments. Users can now paste a Google Maps place URL and get AI-powered insights about customer reviews.

## What Was Added

### Frontend Changes

1. **Tab Navigation** (`frontend/app/page.tsx`)
   - Added tab switcher between "YouTube" and "Google Maps"
   - Dynamic input field that changes based on selected tab
   - Updated UI text to be more generic (reviews instead of just comments)
   - Added MapPin icon from lucide-react

2. **Analysis Results Component** (`frontend/components/AnalysisResults.tsx`)
   - Made component work with both YouTube and Google Maps data
   - Added support for displaying ratings (Google Maps) vs likes (YouTube)
   - Shows place address and overall rating for Google Maps places
   - Normalized data structure to handle both comment and review types

### Backend Changes

1. **New Module** (`backend/fetch_maps_reviews.py`)
   - Extracts place ID from various Google Maps URL formats
   - Fetches place details using Google Places API
   - Retrieves reviews with ratings and timestamps
   - Supports multiple URL formats (standard, short URLs, CID)

2. **API Endpoint** (`backend/main.py`)
   - Added `POST /analyze-maps` endpoint
   - Reuses existing AI analysis functions with Google Maps data
   - Returns place information, reviews, sentiment, and action items
   - Integrates with existing usage tracking system

3. **AI Analysis Functions**
   - `get_maps_ai_summary()` - Generates summary from reviews
   - `get_maps_sentiment_analysis()` - Analyzes review sentiment
   - `get_maps_action_items()` - Generates actionable recommendations
   - `assign_sentiments_to_reviews()` - Assigns sentiment labels to reviews

4. **Dependencies** (`backend/requirements.txt`)
   - Added `googlemaps>=4.10.0` package

### Documentation

1. **Updated README.md**
   - Changed title to "Review Insights"
   - Added Google Maps feature to feature list
   - Updated API documentation with new endpoint
   - Changed target audience to include business owners
   - Updated API key setup instructions

2. **Created GOOGLE_MAPS_SETUP.md**
   - Step-by-step guide for enabling Places API
   - Troubleshooting common issues
   - API quota and pricing information
   - Security best practices

## How It Works

### User Flow

1. User visits the app and sees two tabs: YouTube and Google Maps
2. User selects "Google Maps" tab
3. User pastes a Google Maps place URL (e.g., restaurant, store, etc.)
4. User clicks "Analyze"
5. Backend extracts place ID from URL
6. Backend fetches reviews using Google Places API
7. AI analyzes reviews and generates insights
8. User sees results with:
   - Place name, address, and overall rating
   - AI-generated summary
   - Sentiment breakdown (positive/neutral/negative)
   - Actionable recommendations
   - Filterable review browser

### Technical Details

**URL Parsing**
- Supports standard Google Maps URLs with place IDs
- Handles short URLs (goo.gl/maps/xxx)
- Extracts place names for text search fallback

**API Integration**
- Uses Google Places API Place Details endpoint
- Fetches up to 1000 reviews per place
- Includes place metadata (name, address, rating)

**AI Analysis**
- Smart sampling: prioritizes high-rated reviews + random sample
- Same LLM prompts adapted for business context
- Generates business-focused recommendations

**Data Structure**
```typescript
interface AnalyzeMapsResponse {
  place_id: string;
  place_name: string;
  place_address: string;
  place_rating: number;
  total_reviews: number;
  summary: string;
  sentiment: { positive: number; neutral: number; negative: number };
  action_items: Array<{ title: string; description: string; impact: string }>;
  reviews: Array<{ author: string; text: string; rating: number; published_at: string; sentiment: string }>;
}
```

## Usage Tracking

- Google Maps analysis counts toward the same usage limits as YouTube
- Free tier: 5 analyses/month
- Pro tier: 15 analyses/month
- Unlimited tier: unlimited analyses

## API Keys Required

1. **Google Cloud API Key**
   - Enable YouTube Data API v3
   - Enable Places API (new)
   - Set as `YOUTUBE_API_KEY` environment variable

2. **Together AI API Key**
   - For Llama 4 Maverick LLM
   - Set as `TOGETHER_API_KEY` environment variable

## Testing

To test the feature:

1. Start the backend:
   ```bash
   cd backend
   python main.py
   ```

2. Start the frontend:
   ```bash
   cd frontend
   npm run dev
   ```

3. Visit http://localhost:3000
4. Click "Google Maps" tab
5. Paste a Google Maps URL (try a popular restaurant)
6. Click "Analyze"

## Example URLs to Test

- **Restaurant**: `https://www.google.com/maps/place/[restaurant-name]`
- **Store**: `https://www.google.com/maps/place/[store-name]`
- **Service**: `https://www.google.com/maps/place/[service-name]`

## Limitations

1. **Review Count**: Google Places API returns max ~5 reviews by default
   - For more reviews, you may need to use the Places API (New) with pagination
   - Current implementation gets the most recent reviews available

2. **API Quotas**: 
   - Free tier: $200/month credit (~40,000 requests)
   - Each analysis uses 1 Place Details request ($0.017)

3. **URL Formats**: 
   - Some shortened URLs may not work
   - Place must have public reviews

## Future Enhancements

- [ ] Pagination to fetch more than default reviews
- [ ] Competitor comparison (analyze multiple places)
- [ ] Historical trend analysis
- [ ] Review response suggestions
- [ ] Export reviews to CSV
- [ ] Automated monitoring for new reviews

## Files Modified

### Created
- `backend/fetch_maps_reviews.py`
- `GOOGLE_MAPS_SETUP.md`
- `GOOGLE_MAPS_FEATURE.md` (this file)

### Modified
- `frontend/app/page.tsx`
- `frontend/components/AnalysisResults.tsx`
- `backend/main.py`
- `backend/requirements.txt`
- `README.md`

## Deployment Notes

When deploying to production:

1. Ensure `YOUTUBE_API_KEY` has both APIs enabled
2. Install new dependency: `pip install googlemaps`
3. Update environment variables on hosting platform
4. Test with real Google Maps URLs
5. Monitor API usage in Google Cloud Console

## Support

For issues or questions:
- Check `GOOGLE_MAPS_SETUP.md` for setup help
- Review Google Places API documentation
- Check API quotas in Google Cloud Console
