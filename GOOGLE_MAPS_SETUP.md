# Google Maps Places API Setup Guide

This guide will help you enable the Google Places API for analyzing Google Maps reviews.

## Prerequisites

- A Google Cloud account
- The same API key you're using for YouTube Data API (or a new one)

## Step 1: Enable Google Places API (New)

**IMPORTANT**: You must enable the **NEW** Places API, not the legacy one.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your existing project (or create a new one)
3. Navigate to **APIs & Services** → **Library**
4. Search for "**Places API (New)**" or go directly to:
   - https://console.cloud.google.com/apis/library/places-backend.googleapis.com
5. Click on "**Places API (New)**" (make sure it says "New")
6. Click **Enable**

**Note**: The old "Places API" is deprecated and will NOT work with this application.

## Step 2: Configure API Key

You can use the same API key for both YouTube Data API and Places API (New):

1. Go to **APIs & Services** → **Credentials**
2. Find your existing API key (or create a new one)
3. Click **Edit API key**
4. Under **API restrictions**, ensure both are enabled:
   - YouTube Data API v3
   - **Places API (New)** (NOT the old "Places API")
5. Click **Save**

**Important**: Make sure you select "Places API (New)" in the API restrictions, not the legacy "Places API".

## Step 3: Set Environment Variable

The application will automatically use your `YOUTUBE_API_KEY` for Google Places API as well. No additional configuration needed!

If you want to use a separate key for Places API, you can set:

```bash
export GOOGLE_MAPS_API_KEY='your_places_api_key'
```

## Step 4: Test the Integration

1. Start your backend server:
   ```bash
   cd backend
   python main.py
   ```

2. Go to http://localhost:3000
3. Click on the "Google Maps" tab
4. Paste a Google Maps place URL (e.g., a restaurant or business)
5. Click "Analyze"

## Supported URL Formats

The application supports various Google Maps URL formats:

- Standard place URL: `https://www.google.com/maps/place/Business+Name/@lat,lng,zoom/data=...`
- Short URL: `https://goo.gl/maps/xxxxx`
- CID format: `https://maps.google.com/maps?cid=12345678901234567890`

## API Quotas

The Places API has the following quotas:

- **Free tier**: $200 credit per month (approximately 40,000 requests)
- **Place Details requests**: $0.017 per request
- **Reviews included**: Reviews are included in Place Details at no extra cost

For most use cases, the free tier should be sufficient.

## Troubleshooting

### Error: "GOOGLE_MAPS_API_KEY not set"

**Solution**: Make sure you have `YOUTUBE_API_KEY` set in your `.env` file. The application uses this key for both APIs.

### Error: "This API project is not authorized to use this API"

**Solution**: 
1. Go to Google Cloud Console
2. Enable the Places API for your project
3. Wait a few minutes for the changes to propagate

### Error: "Could not extract place information from URL"

**Solution**: 
- Make sure you're using a valid Google Maps place URL
- Try copying the URL directly from Google Maps
- Ensure the place has reviews (not all places have public reviews)

### Error: "No reviews found for this place"

**Solution**: 
- The place might not have any reviews yet
- Try a different business with more reviews
- Some places restrict review access

## API Rate Limits

To avoid hitting rate limits:

- The application automatically limits to 1000 reviews per place
- Reviews are sampled intelligently for AI analysis
- Consider implementing caching for frequently analyzed places

## Security Best Practices

1. **Never commit API keys** to version control
2. **Use environment variables** for all sensitive data
3. **Restrict your API key** to specific APIs and domains
4. **Monitor usage** in Google Cloud Console to avoid unexpected charges

## Need Help?

- [Google Places API Documentation](https://developers.google.com/maps/documentation/places/web-service)
- [Google Cloud Console](https://console.cloud.google.com/)
- [API Quotas & Pricing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
