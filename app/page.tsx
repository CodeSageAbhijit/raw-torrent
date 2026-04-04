"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HeaderAuth } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import ParticleBackground from "@/components/ui/particle-background";

const features = [
  {
    title: "Torrent Upload & Magnet Links",
    description: "Upload .torrent files or paste magnet links to begin analyzing real BitTorrent protocol behavior instantly.",
    icon: (
      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    ),
  },
  {
    title: "Live Peer Network Graph",
    description: "Watch your peer-to-peer topology evolve in real time — connections forming, data flowing, and swarm health at a glance.",
    icon: (
      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    title: "Protocol Event Logs",
    description: "Real-time wire-level logging of handshakes, piece requests, choke/unchoke states, and every important protocol event.",
    icon: (
      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    title: "Piece-Level Progress",
    description: "Visual piece map showing exactly which pieces you own, which are downloading, and their availability across the swarm.",
    icon: (
      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    title: "Peer Deep Analytics",
    description: "Detailed insights into each peer — speed, piece availability, contribution ratio, and connection metadata.",
    icon: (
      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    title: "Zero Abstraction",
    description: "No magic, no hidden layers. Every byte, every message, every protocol state change is transparent and visible.",
    icon: (
      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
  },
];

const targetUsers = [
  { label: "Developers", desc: "interested in networking & distributed systems" },
  { label: "Students", desc: "learning how BitTorrent works" },
  { label: "Security Enthusiasts", desc: "analyzing P2P network behavior" },
  { label: "Engineers", desc: "who want low-level visibility into P2P systems" },
];

export default function Home() {
  const heroRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!heroRef.current) return;
      const rect = heroRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setMousePos({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
    };
    const el = heroRef.current;
    el?.addEventListener("mousemove", handleMouseMove);
    return () => el?.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div className="flex-1 w-full flex flex-col items-center relative">
      <ParticleBackground />
      <div className="w-full relative z-10">
        <HeaderAuth />
      </div>

      {/* ===== HERO SECTION ===== */}
      <div ref={heroRef} className="flex flex-col items-center w-full relative overflow-hidden">
        
        <div className="hero-glow" aria-hidden="true" />

        {/* Mouse-following glow */}
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-700"
          aria-hidden="true"
          style={{
            background: `radial-gradient(600px circle at ${mousePos.x * 100}% ${mousePos.y * 100}%, hsla(0, 72%, 58%, 0.06), transparent 60%)`,
          }}
        />

        {/* Grid dots background */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          aria-hidden="true"
          style={{
            backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="flex flex-col gap-10 items-center py-24 lg:py-32 px-5 max-w-4xl w-full relative z-10">
          {/* Epsilon badge */}
          <div className="animate-fade-in-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-4 py-1.5 text-xs font-medium text-foreground/70">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Protocol-first. Open source. Real time.
            </span>
          </div>

          {/* Title */}
          <div className="text-center animate-fade-in-up delay-100">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight !leading-[1.1]">
              See torrents as they{" "}
              <span className="text-primary relative">
                really
                <svg className="absolute -bottom-1 left-0 w-full h-2 text-primary/30" viewBox="0 0 100 8" preserveAspectRatio="none">
                  <path d="M0 7 Q25 0 50 5 Q75 1 100 6" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </span>{" "}
              are.
            </h1>
          </div>

          {/* Subtitle */}
          <p className="text-lg text-foreground/60 text-center max-w-2xl leading-relaxed animate-fade-in-up delay-200">
            A protocol-first BitTorrent client and visualization tool that exposes the raw mechanics of peer-to-peer data exchange in real time.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-4 animate-fade-in-up delay-300">
            <Link
              href="/dashboard"
              className="btn-animate flex items-center justify-center rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground"
            >
              Go to Dashboard
              <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>

          {/* Tagline bar */}
          <div className="flex items-center gap-6 text-xs text-foreground/40 animate-fade-in delay-500">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              No credit card
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Guest mode available
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Open source
            </span>
          </div>
        </div>

        <div className="w-full max-w-5xl px-5">
          <div className="w-full h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
        </div>
      </div>

      {/* ===== WHAT IS RAWTORRENT? ===== */}
      <section className="w-full max-w-5xl px-5 py-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="animate-fade-in-up">
            <span className="text-xs font-semibold text-primary uppercase tracking-widest">What is RawTorrεnt?</span>
            <h2 className="text-3xl font-bold mt-3 !leading-tight">
              Make torrent internals visible and understandable
            </h2>
            <p className="text-foreground/60 mt-4 leading-relaxed">
              RawTorrεnt is a low-level torrent analysis and visualization platform. Instead of acting as a traditional downloader, it focuses on exposing peer communication, piece transfer, and swarm behavior in real time.
            </p>
            <p className="text-foreground/60 mt-3 leading-relaxed">
              Built for developers, students, and engineers who want to deeply understand distributed systems and peer-to-peer networking.
            </p>
          </div>

          {/* Animated terminal mockup */}
          <div className="rounded-xl border border-foreground/10 bg-card overflow-hidden animate-fade-in-up delay-200">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-foreground/10">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="text-xs text-foreground/40 ml-2 font-mono">protocol_log</span>
            </div>
            <div className="p-4 font-mono text-xs text-foreground/60 space-y-1.5 h-48 overflow-hidden">
              <p><span className="text-primary">[handshake]</span> peer-12f connected via TCP/6881</p>
              <p><span className="text-primary">[bitfield]</span> received 256 pieces from peer-12f</p>
              <p><span className="text-accent">[interested]</span> sent to peer-12f</p>
              <p><span className="text-primary">[unchoke]</span> received from peer-12f</p>
              <p><span className="text-accent">[request]</span> piece idx=42 offset=0 len=16384</p>
              <p><span className="text-primary">[piece]</span> received 16384 bytes from peer-12f</p>
              <p><span className="text-green-500">[verify]</span> sha1 hash OK for piece 42</p>
              <p><span className="text-primary">[have]</span> broadcast piece 42 to 23 peers</p>
              <p><span className="text-foreground/30">...</span></p>
            </div>
          </div>
        </div>
      </section>

      <div className="w-full max-w-5xl px-5">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
      </div>

      {/* ===== FEATURES ===== */}
      <section className="w-full max-w-5xl px-5 py-16">
        <div className="text-center mb-12">
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">Features</span>
          <h2 className="text-3xl font-bold mt-3">Everything exposed. Nothing hidden.</h2>
          <p className="text-foreground/60 mt-3 max-w-xl mx-auto">
            Six core capabilities that give you raw, unfiltered visibility into BitTorrent protocol behavior.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={`card-hover rounded-xl border border-foreground/5 p-6 animate-fade-in-up delay-${(i % 3) * 100 + 100}`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  {f.icon}
                </div>
                <h3 className="font-semibold">{f.title}</h3>
              </div>
              <p className="text-sm text-foreground/60 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="w-full max-w-5xl px-5">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
      </div>

      {/* ===== WHO IS THIS FOR? ===== */}
      <section className="w-full max-w-5xl px-5 py-16">
        <div className="text-center mb-10">
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">Built For AND</span>
          <h2 className="text-3xl font-bold mt-3">Made for the curious minds</h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {targetUsers.map((u, i) => (
            <div
              key={u.label}
              className={`card-hover rounded-xl border border-foreground/5 p-6 text-center animate-fade-in-up delay-${i * 100 + 100}`}
            >
              <p className="text-lg font-bold text-primary mb-1">{u.label}</p>
              <p className="text-sm text-foreground/60">{u.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="w-full max-w-5xl px-5">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
      </div>

      {/* ===== KEY DIFFERENTIATORS ===== */}
      <section className="w-full max-w-5xl px-5 py-16">
        <div className="grid sm:grid-cols-4 gap-4">
          <div className="card-hover rounded-xl border border-foreground/5 p-6 text-center animate-fade-in-up delay-100">
            <p className="text-3xl font-bold text-primary mb-1">Protocol</p>
            <p className="text-sm text-foreground/60">First approach</p>
          </div>
          <div className="card-hover rounded-xl border border-foreground/5 p-6 text-center animate-fade-in-up delay-200">
            <p className="text-3xl font-bold text-primary mb-1">Real-time</p>
            <p className="text-sm text-foreground/60">Swarm visualization</p>
          </div>
          <div className="card-hover rounded-xl border border-foreground/5 p-6 text-center animate-fade-in-up delay-300">
            <p className="text-3xl font-bold text-primary mb-1">100%</p>
            <p className="text-sm text-foreground/60">Transparent logging</p>
          </div>
          <div className="card-hover rounded-xl border border-foreground/5 p-6 text-center animate-fade-in-up delay-400">
            <p className="text-3xl font-bold text-primary mb-1">Clean</p>
            <p className="text-sm text-foreground/60">Dev-focused UI</p>
          </div>
        </div>
      </section>

      <div className="w-full max-w-5xl px-5">
        <div className="w-full h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
      </div>

      {/* ===== FINAL CTA ===== */}
      <section className="w-full max-w-5xl px-5 py-16 animate-fade-in-up">
        <div className="relative rounded-xl border border-foreground/5 p-12 text-center overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />
          <div className="relative z-10">
            <h2 className="text-3xl font-bold mb-3">Ready to see behind the curtain?</h2>
            <p className="text-foreground/60 max-w-xl mx-auto mb-8">
              Start exploring BitTorrent protocol internals now. Create a free account or jump straight in as a guest.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/dashboard"
                className="btn-animate rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
