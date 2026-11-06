# Disstill

Comment intelligence for YouTube. Paste a public video URL and get a short brief: sentiment, what landed, and the next things to fix.

Live sample (no account): add `?demo=1` to the app URL, or click **View a sample report** on the home page.

## What it does

- **Analyze** — Streams a producer-style brief from up to 1,000 comments: sentiment breakdown, ranked action items, PDF export.
- **Ideas** — Profiles a channel, finds rivals in the same niche, and writes three video ideas in that channel’s voice.
- **History** — Signed-in runs are saved so you can reopen a brief later.

Guests get one free analysis. Signed-in accounts get a monthly allowance (Clerk + Stripe).

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router), TypeScript, Tailwind, shadcn/ui |
| Auth | Clerk |
| API | FastAPI, Pydantic |
| Models | Together AI (`zai-org/GLM-5.3-Flash`) |
| Data | YouTube Data API v3, Neon Postgres |
| Billing | Stripe |
| Host | Vercel Services — Next.js + FastAPI in one project |

## Run locally

**Prerequisites:** Node 22, Python 3.9+, a [YouTube Data API](https://console.cloud.google.com/) key, a [Together AI](https://api.together.xyz/) key, and Clerk keys for sign-in.

```bash
# from the repo root
cp .env.example .env   # or create .env with the keys below

./start-dev.sh
```

Frontend: [http://localhost:3000](http://localhost:3000)  
API: [http://localhost:8000](http://localhost:8000) · docs at `/docs`

Manual split:

```bash
# terminal 1
cd backend
pip install -r requirements.txt
python main.py

# terminal 2
cd frontend
npm install
npm run dev
```

Same-origin API path is `/api/python/*` (rewritten to uvicorn locally, to FastAPI on Vercel).

### Environment

| Variable | Where |
| --- | --- |
| `YOUTUBE_API_KEY` | Backend |
| `TOGETHER_API_KEY` | Backend |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Both (backend verifies session JWTs) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` | Backend, if billing is on |
| `FRONTEND_ORIGINS` | Optional CORS allow-list |
| `DATABASE_URL` | Neon / Postgres, for history and usage |

The sample report at `/?demo=1` is static. It does not call YouTube or the model.

## Deploy

One Vercel project, repo root as the project root, framework preset **Services**. Env vars are shared. Routing lives in root `vercel.json`: `/api/python/*` → FastAPI, everything else → Next.js.

## Built by

[Rohit Kota](https://github.com/Rohit1mag) — MIT.
