# RawTorrent

RawTorrent is a web-based torrent monitoring and control dashboard.
It provides live torrent progress, peer telemetry, session controls, and file/session cleanup in a modern Next.js UI backed by a Node.js WebTorrent service.

## Features

- Live torrent session dashboard (status, peers, progress)
- Detailed per-session telemetry views (pieces, peers, map)
- Start, pause, resume, stop, and delete session controls
- Backend auto-resume support for persisted sessions
- Disk safety guard limits to prevent sustained SSD overload

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- Backend: Node.js, Express, TypeScript, WebTorrent
- Realtime: WebSocket event stream from backend to UI

## Prerequisites

- Node.js 20+
- npm 10+

## Getting Started

1. Install frontend dependencies:

```bash
npm install
```

2. Install backend dependencies:

```bash
cd rawtorrent_backend
npm install
cd ..
```

3. Configure environment values:

Frontend `.env.local`:

```env
NEXT_PUBLIC_BACKEND_HTTP_URL=http://localhost:4000
NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:4000
```

Backend `rawtorrent_backend/.env` (example):

```env
TORRENT_STORAGE_DIR=C:\\rawtorrent-data
DISK_SAFETY_GUARD=true
DISK_SAFETY_MAX_DOWNLOAD_KB=12288
DISK_SAFETY_MAX_PEERS=120
DISK_SAFETY_MAX_REQUESTS_PER_PEER=24
```

4. Start backend:

```bash
cd rawtorrent_backend
npm run dev
```

5. Start frontend:

```bash
npm run dev
```

6. Open the app:

- Frontend: http://localhost:3000
- Backend: http://localhost:4000

## Docker Compose

Use the included compose file to run frontend and backend together with persistent storage mounted from the host.

Optional: set a custom host download directory by creating a `.env` file next to `docker-compose.yml`:

```env
RAWTORRENT_DOWNLOADS_DIR=C:/rawtorrent-data
```

```bash
docker compose up --build
```

Key details in [docker-compose.yml](docker-compose.yml):

- Backend storage mount: `${RAWTORRENT_DOWNLOADS_DIR:-./downloads}:/app/downloads`
- Backend storage root inside container: `TORRENT_STORAGE_DIR=/app/downloads`
- Auto-resume on container restart: `AUTO_RESUME_ON_BOOT=true`
- Frontend HTTP calls use same-origin proxy (`NEXT_PUBLIC_BACKEND_HTTP_URL=/api`) to avoid container-network mismatches
- Frontend settings/API server-side proxy uses internal Docker DNS (`BACKEND_URL=http://backend:4000`)

After startup:

- Open UI at http://localhost:3000
- Session data, `resumable-sessions.json`, source torrents, and downloaded payloads are persisted under the host path configured by `RAWTORRENT_DOWNLOADS_DIR` (or `./downloads` by default)

### Docker Image Users (No Repository)

If you run the backend image directly, always pass a host bind mount so pieces do not stay only inside the container filesystem:

```bash
docker run -d --name rawtorrent-backend \
	-p 4000:4000 \
	-e TORRENT_STORAGE_DIR=/app/downloads \
	-e AUTO_RESUME_ON_BOOT=true \
	-e WEBTORRENT_UTP=false \
	-v C:/rawtorrent-data:/app/downloads \
	<your-backend-image>
```

## Project Structure

- `app/(dashboard)/*` - Main dashboard, controls, and analytics pages
- `app/api/settings/route.ts` - Frontend settings proxy to backend
- `components/*` - Shared UI components
- `lib/backend.ts` - Backend URL helpers for frontend
- `rawtorrent_backend/src/routes/*` - Backend API routes
- `rawtorrent_backend/src/services/*` - Core torrent/session logic
- `rawtorrent_backend/src/ws/socket.ts` - WebSocket broadcasting

## License

MIT
