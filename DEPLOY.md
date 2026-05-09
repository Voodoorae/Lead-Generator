# LocalGrid — Deployment Guide

## What this is
Two-page app with:
- `/` — Geo Heatmap simulator (no API key needed)
- `/lead-gen` — Live lead finder using Google Places API

## File structure
```
localgrid/
  client/          ← React + Vite frontend
  server/          ← Express backend (serves API + built frontend)
  package.json     ← Root build script
```

---

## Option A — Deploy to Render.com (Recommended, free)

### 1. Push to GitHub
- Create a GitHub account at github.com if you don't have one
- Create a new repository called `localgrid`
- Upload ALL files from this zip keeping the folder structure

### 2. Sign up at render.com
- Free tier, no credit card needed

### 3. Create a Web Service
- Click **New → Web Service**
- Connect your GitHub repo
- Set these values:

| Setting | Value |
|---------|-------|
| **Environment** | Node |
| **Build Command** | `npm run build` |
| **Start Command** | `npm start` |
| **Node Version** | 18 or higher |

### 4. Add environment variables
In Render dashboard → **Environment** tab:

| Key | Value |
|-----|-------|
| `PORT` | `3000` |
| `GOOGLE_PLACES_API_KEY` | `your-key-here` |

### 5. Deploy
Click **Create Web Service** — Render builds and deploys automatically.
Your URL will be: `https://localgrid.onrender.com`

---

## Option B — Deploy to Railway.app (~$1-2/month)

1. Go to railway.app → New Project → Deploy from GitHub
2. Connect your repo
3. Add environment variables: `PORT=3000` and `GOOGLE_PLACES_API_KEY=your-key`
4. Railway auto-detects Node.js and deploys

---

## Option C — Run locally

```bash
# Install and build everything
npm run build

# Start the server
npm start

# Visit http://localhost:3000
```

For development with hot reload:
```bash
# Terminal 1 — backend
cd server && npm install && npm run dev

# Terminal 2 — frontend  
cd client && npm install && npm run dev
# Visit http://localhost:5173
```

---

## Google Places API key setup

1. Go to console.cloud.google.com
2. Create a new project
3. Enable the **Places API**
4. Go to **Credentials → Create API Key**
5. (Optional) Restrict the key to Places API only
6. Copy the key into your Render/Railway environment variables

**Free tier:** Google gives $200/month credit which covers ~10,000 Places searches.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `GOOGLE_PLACES_API_KEY not configured` | Add the key to environment variables on Render |
| `Places API status: REQUEST_DENIED` | Make sure Places API is enabled in Google Cloud Console |
| `Places API status: OVER_QUERY_LIMIT` | You've hit the free tier limit — check Google Cloud billing |
| White screen on load | Check browser console; make sure build completed successfully |
| `/lead-gen` shows geo heatmap | Clear browser cache — SPA routing needs a hard refresh |
