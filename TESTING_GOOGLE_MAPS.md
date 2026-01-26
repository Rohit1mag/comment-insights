# Testing Google Maps Review Analysis

Quick guide to test the new Google Maps review analysis feature.

## Prerequisites

1. **Enable Google Places API** (see `GOOGLE_MAPS_SETUP.md`)
2. **Set environment variables**:
   ```bash
   export YOUTUBE_API_KEY='your_google_api_key'  # Must have Places API enabled
   export TOGETHER_API_KEY='your_together_api_key'
   ```

## Starting the Application

### Option 1: Using the startup script
```bash
./start-dev.sh
```

### Option 2: Manual start

**Terminal 1 - Backend:**
```bash
cd backend
python3 main.py
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

## Testing Steps

1. **Open the app**: http://localhost:3000

2. **Sign in** (if authentication is enabled)

3. **Click the "Google Maps" tab**

4. **Find a test URL**:
   - Go to Google Maps
   - Search for a popular restaurant or business
   - Click on the place
   - Copy the URL from the address bar

5. **Paste the URL** into the input field

6. **Click "Analyze"**

7. **Wait 15-30 seconds** for the analysis

8. **Review the results**:
   - Place name, address, and rating
   - AI-generated summary
   - Sentiment breakdown
   - Action items
   - Individual reviews with filters

## Example Test URLs

Here are some example businesses you can test with (replace with actual URLs from Google Maps):

### Restaurants
- Search: "popular restaurant near me"
- Look for places with 100+ reviews
- Copy the URL

### Retail Stores
- Search: "Apple Store" or "Target"
- Select a location
- Copy the URL

### Services
- Search: "hair salon" or "car repair"
- Select a business with reviews
- Copy the URL

## What to Look For

### ✅ Success Indicators
- Place name and address display correctly
- Overall rating shows (e.g., 4.5/5)
- Summary captures the main themes from reviews
- Sentiment breakdown adds up to total reviews
- Action items are relevant to the business
- Reviews display with star ratings
- Filters work (positive/neutral/negative)

### ❌ Common Issues

**"Could not extract place information from URL"**
- Try copying the URL directly from Google Maps
- Make sure it's a place URL, not a search URL
- Try a different business

**"No reviews found for this place"**
- The place might not have reviews yet
- Try a more popular business
- Some places restrict review access

**"GOOGLE_MAPS_API_KEY not set"**
- Make sure `YOUTUBE_API_KEY` is set
- The app uses this key for both APIs

**"This API project is not authorized"**
- Enable Places API in Google Cloud Console
- Wait a few minutes for changes to propagate

## Testing Different Scenarios

### 1. Test with Different Review Counts
- Small business (5-10 reviews)
- Medium business (50-100 reviews)
- Large business (500+ reviews)

### 2. Test with Different Ratings
- High-rated place (4.5+ stars)
- Medium-rated place (3-4 stars)
- Low-rated place (< 3 stars)

### 3. Test Filters
- Filter by positive sentiment
- Filter by negative sentiment
- Search for specific keywords (e.g., "service", "food")
- Combine multiple filters

### 4. Test PDF Export
- Click "Download PDF Report"
- Verify PDF contains all sections
- Check formatting and readability

## Comparing with YouTube

After testing Google Maps, try the YouTube tab:

1. Click "YouTube" tab
2. Paste a YouTube video URL
3. Click "Analyze"
4. Compare the results format

Both should have:
- Similar UI layout
- Same sentiment analysis approach
- Same action items format
- Same filtering capabilities

## Performance Testing

### Expected Times
- **Small places** (< 20 reviews): 10-15 seconds
- **Medium places** (20-100 reviews): 15-25 seconds
- **Large places** (100+ reviews): 20-30 seconds

### If Analysis is Slow
- Check your internet connection
- Verify API keys are correct
- Check Google Cloud Console for API issues
- Look at backend logs for errors

## Debugging

### Check Backend Logs
```bash
# In the terminal running the backend
# Look for error messages or stack traces
```

### Check Frontend Console
```bash
# In browser, open Developer Tools (F12)
# Check Console tab for errors
```

### Test API Directly
```bash
# Test the endpoint directly
curl -X POST http://localhost:8000/analyze-maps \
  -H "Content-Type: application/json" \
  -d '{"maps_url": "YOUR_GOOGLE_MAPS_URL", "user_email": "test@example.com"}'
```

### Verify API Key
```bash
# Check if Places API is enabled
# Go to: https://console.cloud.google.com/apis/library/places-backend.googleapis.com
```

## Usage Limits

Remember that each analysis counts toward your usage limit:
- **Free tier**: 5 analyses/month
- **Pro tier**: 15 analyses/month
- **Unlimited tier**: unlimited

## Next Steps

After successful testing:

1. ✅ Test with various business types
2. ✅ Verify all filters work
3. ✅ Test PDF export
4. ✅ Compare results with actual reviews
5. ✅ Test error handling (invalid URLs, no reviews, etc.)
6. 🚀 Deploy to production
7. 📢 Share with real users

## Need Help?

- Check `GOOGLE_MAPS_SETUP.md` for API setup
- Review `GOOGLE_MAPS_FEATURE.md` for technical details
- Check backend logs for detailed errors
- Verify API quotas in Google Cloud Console

## Feedback

After testing, consider:
- Are the summaries accurate?
- Are the action items helpful?
- Is the sentiment analysis correct?
- Are there any bugs or edge cases?
- What features would improve the experience?
