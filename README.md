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
