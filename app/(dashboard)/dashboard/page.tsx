import Link from "next/link";
import { sessions } from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <div className="flex-1 w-full flex flex-col items-center min-h-screen bg-background text-foreground">

      <main className="flex flex-col gap-12 w-full max-w-5xl px-5 py-10 flex-1">
        {/* Page Header */}
        <header className="animate-fade-in-up">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-foreground/60 mt-1.5 text-lg">
            Monitor network activity and initialize new protocol sessions.
          </p>
        </header>

        {/* Section 1: Overview Stats */}
        <section className="animate-fade-in-up delay-100">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-4 w-1 bg-primary rounded-full"></div>
            <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Network Overview</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            <div className="card-hover rounded-xl border bg-card p-6 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              </div>
              <p className="text-xs font-semibold text-foreground/50 mb-2 uppercase tracking-wider font-mono">Active Sessions</p>
              <div className="flex items-baseline gap-2">
                <p className="text-4xl font-bold tracking-tight text-primary">
                  {sessions.filter((s) => s.status === "active").length}
                </p>
                <p className="text-xs font-medium text-foreground/40 hidden sm:block">torrents</p>
              </div>
            </div>
            
            <div className="card-hover rounded-xl border bg-card p-6 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              </div>
              <p className="text-xs font-semibold text-foreground/50 mb-2 uppercase tracking-wider font-mono">Peer Connections</p>
              <div className="flex items-baseline gap-2">
                <p className="text-4xl font-bold tracking-tight">
                  {sessions.reduce((sum, s) => sum + s.peers, 0)}
                </p>
                <p className="text-xs font-medium text-foreground/40 hidden sm:block">nodes</p>
              </div>
            </div>

            <div className="card-hover rounded-xl border bg-card p-6 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
              </div>
              <p className="text-xs font-semibold text-foreground/50 mb-2 uppercase tracking-wider font-mono">Data Traced</p>
              <div className="flex items-baseline gap-2">
                <p className="text-4xl font-bold tracking-tight">
                  {sessions.reduce((sum, s) => sum + s.sizeGb, 0).toFixed(1)}
                </p>
                <p className="text-xs font-medium text-foreground/40">GB</p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Active Sessions Table */}
        <section className="animate-fade-in-up delay-200">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-4 w-1 bg-primary rounded-full"></div>
            <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Active Torrents</h2>
          </div>
          <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-secondary/30 text-xs font-mono text-foreground/50 uppercase tracking-wider">
                    <th className="text-left p-4 font-semibold">T_Name</th>
                    <th className="text-left p-4 font-semibold">State</th>
                    <th className="text-left p-4 font-semibold">Completion</th>
                    <th className="text-left p-4 font-semibold">Peers</th>
                    <th className="text-left p-4 font-semibold">Rate_Dn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sessions.map((session) => (
                    <tr
                      key={session.id}
                      className="group hover:bg-secondary/40 transition-colors"
                    >
                      <td className="p-4">
                        <Link
                          href={`/torrent/${session.id}`}
                          className="hover:text-primary transition-colors font-medium hover:underline flex items-center gap-2"
                        >
                          <svg className="w-4 h-4 text-foreground/40 group-hover:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          {session.name}
                        </Link>
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase ${
                            session.status === "active"
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : session.status === "paused"
                                ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                : "bg-secondary text-foreground/60 border border-border"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              session.status === "active"
                                ? "bg-primary animate-pulse"
                                : session.status === "paused"
                                  ? "bg-amber-500"
                                  : "bg-foreground/40"
                            }`}
                          />
                          {session.status}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                              className={`h-full bg-primary rounded-full transition-all ${session.status === "active" ? "progress-animated" : ""}`}
                              style={{ width: `${session.progress}%` }}
                            />
                          </div>
                          <span className="text-foreground/70 font-mono text-xs font-medium">
                            {session.progress}%
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-foreground/70 font-mono text-xs">{session.peers}</td>
                      <td className="p-4">
                        <span className="text-primary font-mono text-xs font-medium flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                          </svg>
                          {(session.downSpeedMbps || 0).toFixed(1)} <span className="text-foreground/40">MB/s</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
