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

## Docker Hub Images

If you don't want to build from source, you can use the official pre-built images:

- **Frontend**: `abhijitkad/rawtorrent-frontend:latest`
- **Backend**: `abhijitkad/rawtorrent-backend:latest`

## Docker Deployment

### 1. Using Pre-built Images (Recommended)

The easiest way to run RawTorrent is using the `docker-compose.hub.yml` file which pulls images directly from Docker Hub.

#### Running without Cloning (Quick Start)
If you don't want to clone the whole repository, you only need the `docker-compose.hub.yml` file.

**On Windows (PowerShell):**
```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/CodeSageAbhijit/raw-torrent/main/docker-compose.hub.yml" -OutFile "docker-compose.yml"
docker compose up -d
```

**On Linux/macOS (curl):**
```bash
curl -L https://raw.githubusercontent.com/CodeSageAbhijit/raw-torrent/main/docker-compose.hub.yml -o docker-compose.yml
docker compose up -d
```

#### Running with the Full Repository
If you have cloned the repository, just run:
```bash
docker compose -f docker-compose.hub.yml up -d
```

3. Open http://localhost:3000

### 2. Building from Source

If you have cloned the repository and want to build locally:

```bash
docker compose up --build -d
```

### Configuration (Optional)

By default, Docker will create a folder named `downloads` in your current directory to store your files.

**If you want to use a different folder (e.g., `D:/MyTorrents`):**
1. Create a file named `.env` in the same folder as your `docker-compose.yml`.
2. Add this line:
   ```env
   RAWTORRENT_DOWNLOADS_DIR=D:/MyTorrents
   ```
3. Run `docker compose up -d` again.

- `RAWTORRENT_DOWNLOADS_DIR`: Path on your host to store downloads (defaults to `./downloads`).
- `AUTO_RESUME_ON_BOOT`: Set to `true` (default) to resume active torrents when the container restarts.
- `WEBTORRENT_UTP`: Set to `false` (default) to disable uTP if you experience network instability in Docker.


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
