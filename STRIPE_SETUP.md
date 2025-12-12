# Stripe Integration Setup Guide

## Backend Setup

1. **Install dependencies:**

   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Get your Stripe API keys:**

   - Go to https://dashboard.stripe.com/test/apikeys
   - Copy your **Secret key** (starts with `sk_test_` or `sk_live_`)
   - Copy your **Publishable key** (starts with `pk_test_` or `pk_live_`)

3. **Create a Product and Price in Stripe:**

   - Go to https://dashboard.stripe.com/test/products
   - Click "Add product"
   - Name: "Pro Tier"
   - Description: "15 analyses per month"
   - Pricing: $4.99/month (recurring)
   - Copy the **Price ID** (starts with `price_`)

4. **Set up Webhook:**

   - Go to https://dashboard.stripe.com/test/webhooks
   - Click "Add endpoint"
   - Endpoint URL: `https://your-backend-url.com/webhook` (or `http://localhost:8000/webhook` for local testing)
   - Select events to listen to:
     - `checkout.session.completed`
     - `customer.subscription.deleted`
     - `customer.subscription.updated`
   - Copy the **Webhook signing secret** (starts with `whsec_`)

5. **Add to `.env` file:**
   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_ID=price_...
   ```

## Frontend Setup

1. **Install dependencies:**

   ```bash
   cd frontend
   npm install
   ```

2. **Add to `.env.local` file:**
   ```env
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```

## Testing

1. **Start backend:**

   ```bash
   cd backend
   python main.py
   ```

2. **Start frontend:**

   ```bash
   cd frontend
   npm run dev
   ```

3. **Test checkout:**
   - Sign in to your app
   - Click "Subscribe Now" on the Pro tier card
   - Use Stripe test card: `4242 4242 4242 4242`
   - Any future expiry date
   - Any CVC
   - Any ZIP code

## How It Works

1. User clicks "Subscribe Now" → Creates Stripe checkout session
2. User completes payment → Stripe sends webhook to `/webhook`
3. Backend updates user tier to "PRO" → User gets 15 analyses/month
4. On subscription cancellation → User downgrades to "FREE"

## Important Notes

- For production, use **live** Stripe keys (not test keys)
- Make sure your webhook endpoint is publicly accessible
- The webhook secret is different for test and live modes
- Subscription data is stored in `backend/subscriptions_data.json`
- User tiers are stored in `USER_TIERS` dictionary in `backend/main.py`
