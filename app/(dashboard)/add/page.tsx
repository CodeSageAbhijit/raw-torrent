import { StartSessionForm } from "@/components/start-session-form";

export default function AddTorrentPage() {
  return (
    <div className="flex-1 w-full flex flex-col items-center min-h-screen bg-background text-foreground">

      <main className="flex flex-col gap-12 w-full max-w-5xl px-5 py-10 flex-1">
        <header className="animate-fade-in-up">
          <h1 className="text-3xl font-bold tracking-tight">Add Torrent</h1>
          <p className="text-foreground/60 mt-1.5 text-lg">
            Initialize a new protocol visualization session.
          </p>
        </header>

        <section className="animate-fade-in-up delay-100">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-4 w-1 bg-accent rounded-full"></div>
            <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Select Source</h2>
          </div>
          <div className="rounded-xl border bg-card p-8 shadow-sm relative">
            <div className="absolute top-0 right-0 h-full w-1/3 bg-gradient-to-l from-primary/5 to-transparent pointer-events-none rounded-r-xl" />
            <StartSessionForm />
          </div>
        </section>
      </main>
    </div>
  );
}
