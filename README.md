# YouTube Comment Insights 🎯

**Transform YouTube comments into actionable improvements for your next video.**

A modern, AI-powered web application built for YouTube creators who want to understand their audience and improve their content based on real feedback.

![Tech Stack](https://img.shields.io/badge/Next.js-14-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![FastAPI](https://img.shields.io/badge/FastAPI-0.104-green) ![Python](https://img.shields.io/badge/Python-3.9+-yellow)

---

## ✨ Features

### For Creators
- 🎯 **Actionable Recommendations** - Get 3-5 prioritized action items ranked by impact
- 📊 **Sentiment Analysis** - Understand your audience's overall mood (positive/neutral/negative)
- 💬 **Smart Comment Browser** - Filter by sentiment, likes, date, and search keywords
- ⚡ **Fast Analysis** - Results in 15-30 seconds for up to 100 comments
- 🎨 **Beautiful UI** - Modern, responsive design that works on all devices

### Technical
- 🚀 **Modern Stack** - Next.js 14 (App Router) + FastAPI backend
- 🔒 **Type-Safe** - Full TypeScript on frontend
- 📈 **Data Viz** - Interactive charts with Recharts
- 🎨 **Design System** - shadcn/ui components with Tailwind CSS
- 🌐 **Production Ready** - Easy deployment to Vercel + Railway

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Python 3.9+
- [YouTube Data API key](https://console.cloud.google.com/)
- [Claude API key](https://console.anthropic.com/)

### Option 1: Automated Start (Easiest)

```bash
# Clone the repo
git clone https://github.com/yourusername/YouTubeComments.git
cd YouTubeComments

# Set your API keys in .env file
echo "YOUTUBE_API_KEY=your_key" >> .env
echo "CLAUDE_API_KEY=your_key" >> .env

# Run the startup script
./start-dev.sh
```

Visit http://localhost:3000 and start analyzing! 🎉

### Option 2: Manual Setup

**Backend:**
```bash
cd backend
pip install -r requirements.txt
export YOUTUBE_API_KEY='your_key'
export CLAUDE_API_KEY='your_key'
python main.py
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

📖 **For detailed setup instructions, see [SETUP_GUIDE.md](SETUP_GUIDE.md)**

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
- **[Anthropic Claude](https://www.anthropic.com/)** - AI analysis (Sonnet 4)
- **[YouTube Data API v3](https://developers.google.com/youtube/v3)** - Comment fetching
- **[Pydantic](https://docs.pydantic.dev/)** - Data validation

### Deployment
- **Frontend**: [Vercel](https://vercel.com/) (recommended)
- **Backend**: [Railway](https://railway.app/) or [Render](https://render.com/)

---

## 📊 API Endpoints

### `POST /analyze`

Analyzes a YouTube video's comments and returns insights.

**Request:**
```json
{
  "video_url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

**Response:**
```json
{
  "video_id": "VIDEO_ID",
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

📚 **Full API docs:** http://localhost:8000/docs (when backend is running)

---

## 🌐 Deployment

Deploy to production in minutes:

1. **Backend** → [Railway](https://railway.app) or [Render](https://render.com)
2. **Frontend** → [Vercel](https://vercel.com)

📖 **Step-by-step guide:** [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 🎯 Getting Real Users

Built this for real creators? Here's how to get your first 100 users:

1. **Week 1**: Personal outreach - DM 20 creators with free analysis
2. **Week 2**: Public launch on Reddit, Twitter, Product Hunt
3. **Week 3+**: Word of mouth, content marketing

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

**Frontend:** http://localhost:3000  
**Backend:** http://localhost:8000  
**API Docs:** http://localhost:8000/docs

---

## 🔑 Getting API Keys

### YouTube Data API v3
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create project → Enable YouTube Data API v3
3. Create credentials → API Key
4. Copy key → Add to `.env`

### Claude API
1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign up → Generate API key
3. Copy key → Add to `.env`

---

## 🎯 Roadmap

- [x] Core analysis features
- [x] Beautiful Next.js UI
- [x] Comment filtering and search
- [x] Actionable recommendations
- [ ] Multi-video analysis
- [ ] Export reports as PDF
- [ ] User authentication (Clerk)
- [ ] Analysis history
- [ ] Email reports
- [ ] API rate limiting
- [ ] Redis caching

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
- [Anthropic](https://www.anthropic.com/) for Claude AI
- [Vercel](https://vercel.com/) & [Railway](https://railway.app/) for easy deployment

---

**Made with ❤️ for YouTube creators who want to make better content**

⭐ Star this repo if you find it useful!

