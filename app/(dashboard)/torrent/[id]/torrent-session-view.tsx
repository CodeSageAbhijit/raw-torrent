"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import InteractiveMap from "./interactive-map";
import {
  sessions,
  peerSnapshots,
  initialLogs,
  formatSpeed,
} from "@/lib/mock-data";

const LOCAL_CLIENT_COORD: [number, number] = [-74.006, 40.7128]; // NY

const generatedLogs = [
  "[wire] keep-alive received from peer-98a",
  "[encryption] RC4 handshake completed with peer-7dc",
  "[piece] request index=503 from peer-7dc",
  "[wire] interested sent to peer-41b",
  "[encryption] Handshake failed, fallback to Plaintext",
  "[choke] peer-12f choked local client",
  "[wire] unchoke received from peer-12f",
  "[piece] verified sha1 index=503",
  "[announce] tracker update sent! 14 peers returned",
  "[dht] bootstrapping node found",
];

export default function TorrentSessionView({
  sessionId,
}: {
  sessionId: string;
}) {
  const router = useRouter();
  const session = sessions.find((s) => s.id === sessionId) ?? sessions[0];
  const [isRunning, setIsRunning] = useState(true);
  const [progress, setProgress] = useState(session.progress);
  const [downloadSpeed, setDownloadSpeed] = useState(session.downSpeedMbps);
  const [uploadSpeed, setUploadSpeed] = useState(session.upSpeedMbps);
  const [logs, setLogs] = useState(initialLogs);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      const speedWave = Math.random() * 1.8 - 0.9;
      setDownloadSpeed((c) => Math.max(0.4, +(c + speedWave).toFixed(1)));
      setUploadSpeed((c) => Math.max(0.2, +(c + speedWave / 2).toFixed(1)));
      setProgress((c) => Math.min(100, +(c + Math.random() * 0.9).toFixed(1)));
      setLogs((current) => {
        const next =
          generatedLogs[Math.floor(Math.random() * generatedLogs.length)];
        const stamped = `${new Date().toLocaleTimeString("en-US", { hour12: false })} ${next}`;
        return [...current.slice(-20), stamped];
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [isRunning]);

  return (
    <div className="flex-1 w-full flex flex-col items-center min-h-screen bg-background text-foreground">

      <main className="flex flex-col gap-10 w-full max-w-6xl px-5 py-8 flex-1">
        {/* Page Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 animate-fade-in-up">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="relative flex h-2 w-2">
                {isRunning && (
                  <>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </>
                )}
                {!isRunning && (
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-foreground/40" />
                )}
              </span>
              <span className="text-xs font-bold text-primary uppercase tracking-wider font-mono">
                {isRunning ? "Live Analytics" : "Paused"}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{session.name}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-foreground/60 font-mono">
              <span>ID: {sessionId}</span>
              <span className="w-1 h-1 rounded-full bg-foreground/20" />
              <span>{session.sizeGb} GB</span>
              <span className="w-1 h-1 rounded-full bg-foreground/20" />
              <span className="text-primary font-bold">Enc: {session.encryption || "Variable"}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setIsRunning(!isRunning)}
              className={`btn-animate rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors ${
                isRunning ? "hover:bg-secondary text-foreground" : "bg-primary text-primary-foreground border-transparent"
              }`}
            >
              {isRunning ? "Pause Stream" : "Resume"}
            </button>
            <button
              onClick={() => router.push("/dashboard")}
              className="btn-animate rounded-lg bg-destructive/10 px-5 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
            >
              Drop
            </button>
          </div>
        </header>

        {/* Global Tracker Stats Grid */}
        <section className="animate-fade-in-up delay-100 grid gap-4 grid-cols-2 lg:grid-cols-6">
          <div className="col-span-2 rounded-xl border bg-card p-5 relative overflow-hidden">
             <div className="absolute right-0 bottom-0 p-3 opacity-5 pointer-events-none">
                <svg className="w-20 h-20" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
             </div>
             <p className="text-xs font-bold text-foreground/50 mb-1 uppercase tracking-wider font-mono">Network Health</p>
             <div className="flex gap-6 mt-3">
                <div>
                   <p className="text-3xl font-bold tracking-tight text-primary">{session.seeders}</p>
                   <p className="text-xs font-medium text-foreground/40 mt-1">Seeders</p>
                </div>
                <div>
                   <p className="text-3xl font-bold tracking-tight text-accent">{session.leechers}</p>
                   <p className="text-xs font-medium text-foreground/40 mt-1">Leechers</p>
                </div>
             </div>
          </div>
          <div className="rounded-xl border bg-card p-5 flex flex-col justify-center">
            <p className="text-xs font-bold text-foreground/50 mb-1 uppercase tracking-wider font-mono">Trackers</p>
            <p className="text-3xl font-bold tracking-tight text-foreground">{session.trackers}</p>
          </div>
          <div className="col-span-3 rounded-xl border bg-card p-5 flex flex-col justify-center">
             <div className="flex justify-between items-end mb-2">
                 <p className="text-xs font-bold text-foreground/50 uppercase tracking-wider font-mono">Real-time Transfer</p>
                 <div className="flex gap-4 text-sm font-mono font-medium">
                     <span className="text-primary flex items-center gap-1">↓ {formatSpeed(downloadSpeed)}</span>
                     <span className="text-accent flex items-center gap-1">↑ {formatSpeed(uploadSpeed)}</span>
                 </div>
             </div>
             <div className="w-full h-2 rounded-full bg-secondary overflow-hidden mt-2">
                <div className={`h-full rounded-full bg-primary transition-all duration-300 ${isRunning ? 'progress-animated' : ''}`} style={{ width: `${progress}%` }} />
             </div>
             <p className="text-xs font-mono font-medium text-foreground/50 mt-2 text-right">{progress.toFixed(1)}% Completed</p>
          </div>
        </section>

        {/* Geographic Network Map */}
        <section className="animate-fade-in-up delay-200">
           <div className="flex items-center justify-between mb-4">
               <div className="flex items-center gap-3">
                 <div className="h-4 w-1 bg-primary rounded-full"></div>
                 <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Global Handshake Map</h2>
               </div>
               <div className="flex items-center gap-4">
                 <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-secondary text-foreground/70 font-medium">
                    {peerSnapshots.length} Active Nodes
                 </span>
                 <Link
                   href={`/torrent/${sessionId}/map`}
                   className="text-xs font-semibold px-3 py-1.5 rounded-md border border-primary/50 text-primary hover:bg-primary/10 transition-colors"
                 >
                   Launch Full Map ↦
                 </Link>
               </div>
           </div>
           
           <div className="rounded-xl border bg-card overflow-hidden shadow-sm relative h-[400px]">
             <InteractiveMap peerSnapshots={peerSnapshots} localCoord={LOCAL_CLIENT_COORD} />
            
            {/* Map Legend Overlay */}
            <div className="absolute bottom-4 left-4 rounded-lg border bg-background/80 backdrop-blur-sm p-3 shadow-md flex flex-col gap-2">
               <div className="flex items-center gap-2 text-xs font-mono font-medium text-foreground/70">
                  <span className="w-2 h-2 rounded-full bg-foreground border border-background"></span> Local Client
               </div>
               <div className="flex items-center gap-2 text-xs font-mono font-medium text-foreground/70">
                  <span className="w-2 h-2 rounded-full bg-primary"></span> RC4/MSE Encrypted
               </div>
               <div className="flex items-center gap-2 text-xs font-mono font-medium text-foreground/70">
                  <span className="w-2 h-2 rounded-full bg-accent"></span> Plaintext Data
               </div>
            </div>
           </div>
        </section>

        {/* Lower Grid: Peers & Logs */}
        <div className="grid lg:grid-cols-2 gap-10 animate-fade-in-up delay-300">
           
           {/* Connected Peers Table */}
           <section>
              <div className="flex items-center gap-3 mb-4">
                 <div className="h-4 w-1 bg-accent rounded-full"></div>
                 <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Connected Peers</h2>
              </div>
              <div className="rounded-xl border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-secondary/30 text-xs font-mono text-foreground/50 uppercase">
                      <th className="text-left p-4 font-semibold">IP / Node</th>
                      <th className="text-left p-4 font-semibold">Client</th>
                      <th className="text-right p-4 font-semibold">Crypto</th>
                      <th className="text-right p-4 font-semibold">Transfer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {peerSnapshots.map((peer, i) => (
                      <tr key={peer.id} className="group hover:bg-secondary/20 transition-colors">
                        <td className="p-4">
                           <p className="font-mono text-xs text-foreground/80 mb-0.5">{peer.ip}</p>
                           <Link href={`/peer/${peer.id}`} className="text-xs font-medium text-primary hover:underline group-hover:text-primary transition-colors inline-block">{peer.id} →</Link>
                        </td>
                        <td className="p-4 text-xs text-foreground/60">{peer.client}</td>
                        <td className="p-4 text-right">
                           <span className={`inline-flex px-2py-0.5 rounded text-[10px] font-bold font-mono ${i % 2 === 0 ? 'text-primary' : 'text-accent'}`}>
                             {peer.encryption}
                           </span>
                        </td>
                        <td className="p-4 text-right font-mono text-xs">
                           <div className="flex flex-col items-end gap-1">
                             <span className="text-primary font-medium tracking-tighter">↓ {formatSpeed(peer.downloadMbps)}</span>
                             <span className="text-foreground/50 tracking-tighter">↑ {formatSpeed(peer.uploadMbps)}</span>
                           </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
           </section>

           {/* Live Protocol Logs */}
           <section>
              <div className="flex items-center gap-3 mb-4">
                 <div className="h-4 w-1 bg-primary rounded-full"></div>
                 <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Protocol Event Stream</h2>
              </div>
              <div className="rounded-xl border bg-background overflow-hidden relative shadow-inner">
                <div className="absolute top-0 w-full h-8 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
                <div className="h-[360px] overflow-y-auto p-5 font-mono text-xs space-y-2.5 flex flex-col-reverse justify-start">
                   {/* Reversed so newest is at the bottom naturally via map, wait we want newest at bottom, so render in order and scroll, but easier to reverse UI */}
                   {logs.map((line, i) => {
                     const isWarning = line.includes("failed") || line.includes("choke");
                     const isEnc = line.includes("encryption");
                     return (
                      <div key={i} className={`flex items-start gap-3 ${i === logs.length - 1 ? 'animate-fade-in-up' : ''}`}>
                         <span className="text-foreground/30 flex-shrink-0 mt-0.5">{line.substring(0, 8)}</span>
                         <span className={`${isWarning ? 'text-destructive' : isEnc ? 'text-accent' : 'text-foreground/60'}`}>
                           {line.substring(9)}
                         </span>
                      </div>
                     );
                   })}
                </div>
              </div>
           </section>

        </div>
      </main>
    </div>
  );
}
