# RawTorrent - Desktop Torrent Application

**RawTorrent** is a high-performance, modern Desktop BitTorrent client built with web technologies but designed to operate seamlessly as a native desktop application. It combines a rich, data-driven visual interface with granular protocol controls to offer a robust and visually stunning peer-to-peer downloading experience.

---

## 🏗️ Architecture Deep Scan

RawTorrent implements an isomorphic, multi-process architecture bundled locally by Electron:

1. **The Desktop Shell (Electron)**  
   Packages the application into an executable. It internally spins up an Express daemon to handle the backend jobs and routes the Next.js static renderer safely into the local WebView.
   
2. **The Frontend Layer (Next.js + React 19 + TailwindCSS v4)**  
   Provides a highly reactive user interface.
   - **Visual Analytics**: Interactive map projections mapping global peer IPs directly onto standard DHT logic using `d3-geo`, `react-simple-maps`, and `topojson-client`.
   - **Progress Engine**: A specialized React tree processes WebSockets frames continuously to render block grids without layout-thrashing the DOM.

3. **The Backend Layer (Node.js + Express + WebTorrent)**  
   A dedicated daemon operating outside the UI thread, bypassing Electron WebView memory constraints.
   - **WebTorrent Core**: `webtorrent` module augmented by `bittorrent-dht` and `bittorrent-tracker` for maximal swarm acquisition.
   - **Real-time Pipeline**: Express REST APIs for complex mutations (Pause/Resume/Delete) and an integrated WebSocket server (`ws`) pushing high-frequency piece block data directly to the frontend.
   - **Safe Storage**: Uses an intelligent sequential writing pipeline, minimizing SSD degradation by tracking pieces asynchronously.

---

## ⚡ Core Features

- **Turbo Mode**: Disables heavy analytics and intensive geo-computations during high-speed peer flows, ensuring system resources are dedicated entirely to pulling file chunks.
- **Advanced Piece Visualizations**: See exact bitfield progression matrices mimicking old-school BitTorrent tools but inside a minimal dashboard.
- **Auto-Tuning Capabilities**: Automatically clamps request volumes and peer bounds preventing local hardware exhaustion depending on user bandwidth patterns.
- **Session Continuation**: Fully resumable indexing persists in hidden storage caches, maintaining your swarm integrity even during a reboot.
- **Geospatial Swarm Mapping**: Tracks precisely where all active peer connections are located using IP routing lookups projected on a globe visual.

---

## 🛠️ Development & Build Commands

This project relies purely on standard `npm` infrastructure without Docker or native languages required (besides Node).

### 1. Initial Setup
Install the necessary package tree. The backend and frontend technically use separate isolation dependencies.

```bash
# Install root/Next.js/Electron modules
npm install

# Install the API backend dependencies
cd rawtorrent_backend
npm install
cd ..
```

### 2. Available Scripts

Run these from the root directory to manage your development workflow:

- **Starts purely the Web UI context** (Helpful for styling work): 
  ```bash
  npm run dev
  ```
- **Compiles the UI to a standalone application**: 
  ```bash
  npm run build
  ```
- **Starts the Desktop Application in Development**:
  ```bash
  npm run electron:start
  ```
- **Production Executable Build (Windows/Mac/Linux)**:
  Compiles the Node binaries, generates the Webpack tree, copies the backend payloads, and feeds it into `electron-builder` to generate an installer (`.exe`/`.dmg`).
  ```bash
  npm run electron:build
  ```

*(To run the API daemon independently, navigate into `rawtorrent_backend` and run `npm run dev` or `npm run start`).*

---

## 📁 Repository Structure

```text
rawtorrent/
├── app/                      # Next.js 16 file-based React router
│   ├── (dashboard)/          # Authenticated/Main GUI components
│   └── api/                  # Proxy routing to handle backend bridging
├── components/               # Sharable Radix/Tailwind components (UI Kit)
├── electron/                 # Electron main process layer
│   └── main.js               # IPC logic, Express spawning, and window frame setups
├── lib/                      # Frontend utilities (WebSocket endpoints, auth wrappers)
├── rawtorrent_backend/       # Independent Tracker and File Daemon
│   ├── src/
│   │   ├── routes/           # REST endpoints
│   │   ├── services/         # Storage layer, Torrent engine loops
│   │   ├── ws/               # WebSocket broadcasters
│   │   └── index.ts          # Express startup bootstrap
│   └── package.json          # Isolated backend dependencies
├── electron-builder.yml      # Desktop compiler configurations
└── package.json              # Main project dependencies & script tasks
```

---

## ⚙️ Configuration (.env)

The `.env` configuration generally relies on dynamic fallback mechanisms if not hardcoded natively. The primary `.env.local` frontend configuration bridges Electron paths dynamically.

If modifying the backend directly, `rawtorrent_backend/.env` can be configured as follows:
```dotenv
PORT=4000
TORRENT_STORAGE_DIR="Choose specific static mapping paths here if desired"
DISK_SAFETY_GUARD=true
```

*(Note: RawTorrent generally provisions internal temporary paths automatically based on the detected OS).*

---

## 📄 License

MIT © RawTorrent Contributors.
