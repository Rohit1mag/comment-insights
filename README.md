# Review Insights 🎯

**Transform YouTube comments and Google Maps reviews into actionable improvements.**

A modern, AI-powered web application built for YouTube creators and business owners who want to understand their audience and improve based on real feedback.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![FastAPI](https://img.shields.io/badge/FastAPI-0.128-green) ![Python](https://img.shields.io/badge/Python-3.9+-yellow)

---

## ✨ Features

### For Creators & Businesses

- 🎯 **Actionable Recommendations** - Get 3-5 prioritized action items ranked by impact
- 📊 **Sentiment Analysis** - Understand your audience's overall mood (positive/neutral/negative)
- 💬 **Smart Review Browser** - Filter by sentiment, likes/ratings, date, and search keywords
- ⚡ **Fast Analysis** - Results in 15-30 seconds
- 🎨 **Beautiful UI** - Modern, responsive design that works on all devices
- 🎥 **YouTube Comments** - Analyze video comments to improve your content
- 🗺️ **Google Maps Reviews** - Analyze business reviews to improve your service

### Technical

- 🚀 **Modern Stack** - Next.js 14 (App Router) + FastAPI backend
- 🔒 **Type-Safe** - Full TypeScript on frontend
- 📈 **Data Viz** - Interactive charts with Recharts
- 🎨 **Design System** - shadcn/ui components with Tailwind CSS
- 🌐 **Production Ready** - Deployed on Vercel (frontend) + Render (backend)
- 💳 **Payment Integration** - Stripe subscription tiers (Free, Pro, Unlimited)
- 🔐 **Authentication** - Clerk user management with usage tracking

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Python 3.9+
- [Google Cloud API key](https://console.cloud.google.com/) (for YouTube Data API & Google Places API)
- [Together AI API key](https://api.together.xyz/) (for Kimi K2.5 via Together AI)

### Option 1: Automated Start (Easiest)

```bash
# Clone the repo
git clone https://github.com/Rohit1mag/comment-insights.git
cd comment-insights

# Set your API keys in .env file
echo "YOUTUBE_API_KEY=your_google_api_key" >> .env
echo "TOGETHER_API_KEY=your_together_api_key" >> .env

# Run the startup script
./start-dev.sh
```

Visit [http://localhost:3000](http://localhost:3000) and start analyzing! 🎉

### Option 2: Manual Setup

**Backend:**

```bash
cd backend
pip install -r requirements.txt
export YOUTUBE_API_KEY='your_google_api_key'
export TOGETHER_API_KEY='your_together_api_key'
python main.py
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

📖 **For detailed setup instructions, see [SETUP_GUIDE.md**](SETUP_GUIDE.md)

---

## 📂 Project Structure

```
YouTubeComments/
├── frontend/              # Next.js 14 application
│   ├── app/              # App router pages
│   │   ├── page.tsx      # Landing page
│   │   └── layout.tsx    # Root layout
│   ├── components/       # React components
│   │   ├── ui/           # shadcn/ui components
│   │   └── AnalysisResults.tsx
│   └── package.json
│
├── backend/              # FastAPI Python backend
│   ├── main.py          # API endpoints & AI logic
│   └── requirements.txt
│
├── fetch_comments.py    # YouTube API wrapper (legacy)
├── app.py              # Streamlit app (deprecated)
│
└── Guides:
    ├── SETUP_GUIDE.md       # Detailed setup instructions
    ├── DEPLOYMENT.md        # Production deployment guide
    └── GETTING_USERS.md     # Marketing strategy for real users
```

---

## 🎨 Tech Stack

### Frontend

- **[Next.js 14](https://nextjs.org/)** - React framework with App Router
- **[TypeScript](https://www.typescriptlang.org/)** - Type safety
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first styling
- **[shadcn/ui](https://ui.shadcn.com/)** - Beautiful, accessible components
- **[Recharts](https://recharts.org/)** - Data visualization
- **[Lucide Icons](https://lucide.dev/)** - Icon library

### Backend

- **[FastAPI](https://fastapi.tiangolo.com/)** - Modern Python web framework
- **[Together AI](https://www.together.ai/)** - AI analysis (moonshotai/Kimi-K2.5)
- **[YouTube Data API v3](https://developers.google.com/youtube/v3)** - Comment fetching
- **[Google Places API (New)](https://developers.google.com/maps/documentation/places/web-service)** - Review fetching
- **[Pydantic](https://docs.pydantic.dev/)** - Data validation
- **[Stripe](https://stripe.com/)** - Payment processing
- **[Clerk](https://clerk.com/)** - Authentication & user management
- **[ReportLab](https://www.reportlab.com/)** - PDF generation

### Deployment

- **Frontend**: [Vercel](https://vercel.com/)
- **Backend**: [Render](https://render.com/)

---

## 📊 API Endpoints

### `POST /analyze`

Analyzes a YouTube video's comments and returns insights.

**Request:**

```json
{
  "video_url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "user_email": "user@example.com"
}
```

**Response:**

```json
{
  "video_id": "VIDEO_ID",
  "video_title": "Video Title",
  "total_comments": 100,
  "summary": "AI-generated summary of comments...",
  "sentiment": {
    "positive": 45,
    "neutral": 30,
    "negative": 25
  },
  "action_items": [
    {
      "title": "Improve audio quality",
      "description": "Multiple viewers mentioned background noise...",
      "impact": "High"
    }
  ],
  "comments": [...]
}
```

### `POST /analyze-maps`

Analyzes a Google Maps place's reviews and returns insights.

**Request:**

```json
{
  "maps_url": "https://www.google.com/maps/place/...",
  "user_email": "user@example.com"
}
```

**Response:**

```json
{
  "place_id": "PLACE_ID",
  "place_name": "Business Name",
  "place_address": "123 Main St, City, State",
  "place_rating": 4.5,
  "total_reviews": 5,
  "summary": "AI-generated summary of reviews...",
  "sentiment": {
    "positive": 3,
    "neutral": 1,
    "negative": 1
  },
  "action_items": [
    {
      "title": "Improve wait times",
      "description": "Multiple customers mentioned long waits...",
      "impact": "High"
    }
  ],
  "reviews": [...]
}
```

📚 **Full API docs:** [http://localhost:8000/docs](http://localhost:8000/docs) (when backend is running)

**Note:** Google Places API returns a maximum of 5 reviews per place due to API limitations. YouTube comments can fetch up to 1000 per video.

---

## 🌐 Deployment

Currently deployed and running in production:

- **Frontend**: Deployed on [Vercel](https://vercel.com)
- **Backend**: Deployed on [Render](https://render.com)

📖 **Step-by-step guide:** [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 🎯 Getting Real Users

Built this for real creators and businesses? Here's how to get your first 100 users:

1. **Week 1**: Personal outreach - DM 20 creators and business owners with free analysis
2. **Week 2**: Public launch on Reddit, Twitter, Product Hunt
3. **Week 3+**: Word of mouth, content marketing

Target audiences:

- YouTube creators wanting to improve their content
- Local business owners wanting to understand customer feedback
- Restaurant and retail owners looking to improve service

📖 **Full strategy:** [GETTING_USERS.md](GETTING_USERS.md)

---

## 🛠️ Development

```bash
# Start both servers
./start-dev.sh

# Or manually:
# Terminal 1: Backend
cd backend && python main.py

# Terminal 2: Frontend
cd frontend && npm run dev
```

**Frontend:** [http://localhost:3000](http://localhost:3000)  
**Backend:** [http://localhost:8000](http://localhost:8000)  
**API Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🔑 Getting API Keys

### Google Cloud API (YouTube + Places)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create project → Enable **YouTube Data API v3** and **Places API (New)**
3. Create credentials → API Key
4. Copy key → Add to `.env` as `YOUTUBE_API_KEY`

**Important**: Enable "Places API (New)", not the legacy "Places API"  
📖 **Detailed guide:** [GOOGLE_MAPS_SETUP.md](GOOGLE_MAPS_SETUP.md)

### Together AI API

1. Go to [Together AI](https://api.together.xyz/)
2. Sign up → Generate API key
3. Copy key → Add to `.env` as `TOGETHER_API_KEY`

---

## 🎯 Roadmap

**Completed:**
- ✅ Core analysis features (YouTube + Google Maps)
- ✅ Beautiful Next.js UI with shadcn/ui
- ✅ Comment/review filtering and search
- ✅ AI-powered actionable recommendations
- ✅ Export reports as PDF
- ✅ User authentication (Clerk)
- ✅ Stripe payment integration
- ✅ Usage tracking and tier limits

**In Progress:**
- 🔄 Analysis history
- 🔄 Multi-video comparison

**Planned:**
- 📋 Email reports
- 📋 API rate limiting
- 📋 Redis caching
- 📋 Competitor analysis (Google Maps)

---

## 📝 License

MIT License - feel free to use this for your own projects!

---

## 🤝 Contributing

This is a personal project, but suggestions and improvements are welcome!

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## 📧 Contact

Built by Rohit Kota  
Questions? Feedback? Reach out!

---

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) for the amazing framework
- [shadcn](https://twitter.com/shadcn) for the beautiful UI components
- [Together AI](https://www.together.ai/) for Kimi K2.5 access
- [Vercel](https://vercel.com/) & [Render](https://render.com/) for hosting
- [Clerk](https://clerk.com/) for authentication
- [Stripe](https://stripe.com/) for payment processing

---

**Made with ❤️ for creators and businesses who want to improve based on real feedback**

⭐ Star this repo if you find it useful!