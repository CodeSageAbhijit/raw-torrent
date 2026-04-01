# RawTorrent

**RawTorrent** is a powerful peer-to-peer (P2P) analytics and tracker dashboard built for modern web standards. Monitor torrent sessions, visualize global peer connections with an interactive swarm map, and track real-time transfer speeds and protocol event streams—all within a seamless, high-performance interface.

## 🚀 Features

- **Live Session Analytics**: Real-time visualization of upload/download speeds, active seeders, leechers, and tracker health.
- **Global Handshake Map**: Fully interactive map indicating peer locations dynamically. Supports zoom, scroll, and real-time hover telemetry.
- **Secure Authentication**: Powered by Supabase. Supports Email/Password, Anonymous (Guest) sessions, and OAuth (Google & GitHub). Route protection seamlessly managed via Next.js Middleware.
- **Real-Time Protocol Logs**: Live streaming of RC4-SHA handshakes, DHT lookups, wire keep-alive events, and choked/unchoked signals.
- **Server/Client Boundary Separation**: Strict isolation of UI components and server data fetching to leverage App Router optimizations.
- **Theming**: Integrated beautiful light/dark mode variations with `--primary` and `--accent` color variables mapping via Tailwind V4.

## 🛠️ Tech Stack

- **Framework**: [Next.js 16.2.1](https://nextjs.org/) (App Router, Turbopack)
- **UI Library**: [React 19.2.4](https://react.dev)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) & `next-themes`
- **Data & Auth**: [Supabase SSR](https://supabase.com/) (`@supabase/ssr`, `@supabase/supabase-js`)
- **Mapping & Data Viz**: `react-simple-maps`, `d3-geo`, `topojson-client`

## 📋 Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v20+)
- A [Supabase](https://supabase.com) project loaded with your Auth settings (Email, Anonymous sign-ins, and OAuth providers enabled).

## 💻 Getting Started

1. **Clone the repository** (or download it directly):
   ```bash
   git clone https://github.com/yourusername/rawtorrent.git
   cd rawtorrent
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env.local` file in the root of your project and inject your Supabase credentials:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
   *Make sure you configure the Google/GitHub OAuth Client IDs and Secrets directly inside your Supabase Dashboard > Authentication > Providers.*

4. **Run the Development Server**:
   ```bash
   npm run dev
   ```
   *Note: This project takes advantage of Next.js Turbopack.*

5. **Explore**:
   Open [http://localhost:3000](http://localhost:3000) with your browser to see the result. Log in or continue as a Guest!

## 📂 Project Structure

- `app/(dashboard)/*` - Protected routes requiring valid Supabase sessions.
- `app/(auth)/*` - Auth pathways containing Login, Signup, and OAuth redirects.
- `app/torrent/[id]/*` - Your detailed interactive torrent telemetry views and swarm maps.
- `components/ui/*` - Reusable interface components and layout elements.
- `lib/supabase/*` - Server clients and middleware hooks validating active session cookies.
- `proxy.ts` / `middleware.ts` - Next.js specific proxy layers routing unauthenticated users to `/login`.

## 📜 License

This project is licensed under the MIT License. Feel free to use, modify, and distribute it.
