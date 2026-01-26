# Quick Fix: Enable Places API (New)

## The Issue

You're getting this error:
```
Error fetching reviews: You're calling a legacy API, which is not enabled for your project.
```

This happens because Google has deprecated the old Places API and requires the new version.

## Quick Fix (5 minutes)

### Step 1: Enable Places API (New)

1. **Click this direct link**: https://console.cloud.google.com/apis/library/places-backend.googleapis.com

2. **Select your project** (the same one you're using for YouTube API)

3. **Click the blue "ENABLE" button**

4. **Wait 1-2 minutes** for the API to be fully enabled

### Step 2: Update API Key Restrictions (Optional but Recommended)

1. Go to: https://console.cloud.google.com/apis/credentials

2. Click on your API key

3. Scroll to "API restrictions"

4. If you have restrictions enabled, add **"Places API (New)"** to the list

5. Click **Save**

### Step 3: Test Again

1. Go back to http://localhost:3000

2. Click the "Google Maps" tab

3. Paste a Google Maps URL

4. Click "Analyze"

It should work now! 🎉

## Important Notes

- **"Places API (New)"** is different from the old "Places API"
- The old API is deprecated and will stop working soon
- The new API has better features and more data
- Your existing API key works with both APIs

## Verify It's Enabled

To verify the API is enabled:

1. Go to: https://console.cloud.google.com/apis/dashboard
2. Look for "Places API (New)" in the list
3. It should show "Enabled"

## Still Having Issues?

### Error: "Places API (New) is not enabled"
- Wait 2-3 minutes after enabling
- Refresh the Google Cloud Console page
- Try disabling and re-enabling the API

### Error: "API key not valid"
- Make sure you're using the same API key as YouTube
- Check that the key has no IP restrictions that block localhost
- Verify the key is not expired

### Error: "Could not extract place information from URL"
- Make sure you're copying the full URL from Google Maps
- Try a different business with more reviews
- Use the format: `https://www.google.com/maps/place/...`

## API Costs

The Places API (New) has these costs:

- **Free tier**: $200/month credit (plenty for testing)
- **Place Details**: ~$0.017 per request
- **Text Search**: ~$0.032 per request

For personal use and testing, you'll likely stay within the free tier.

## Need More Help?

- [Places API (New) Documentation](https://developers.google.com/maps/documentation/places/web-service/op-overview)
- [Google Cloud Console](https://console.cloud.google.com/)
- [API Pricing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
