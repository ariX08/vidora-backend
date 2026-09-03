# Vidora Backend

YouTube download API for [Vidora](https://github.com/ariX08/vidora-yt-downloader).

Uses **yt-dlp + ffmpeg** so it can merge high-quality video+audio and convert to real MP3.

## Deploy on Railway

1. Create a new project on [railway.app](https://railway.app)
2. Deploy from this GitHub repo
3. Railway will build the **Dockerfile** (installs yt-dlp + ffmpeg automatically)
4. Set optional env:
   - `FRONTEND_URL` = your Vercel frontend origin (e.g. `https://vidora.vercel.app`) for CORS
5. Copy the public URL (e.g. `https://vidora-backend-production.up.railway.app`)

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/info` | Body `{ "url": "..." }` → video metadata + qualities |
| GET | `/api/download?url=&format=mp4\|mp3&quality=720p&title=` | Streams the file |

## Local run

```bash
# need yt-dlp + ffmpeg installed
npm install
npm run dev
```

## Frontend

In the Vidora Next.js app set:

```
NEXT_PUBLIC_API_URL=https://your-railway-url.up.railway.app
```

Then redeploy Vercel.
