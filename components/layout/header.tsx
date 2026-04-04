import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export function Header() {
  return (
    <nav className="w-full flex justify-center border-b border-foreground/10 h-16">
      <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex items-center gap-5 font-semibold">
          <Link href="/" className="flex items-center gap-2 text-foreground hover:text-foreground/80 transition-colors">
            <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            RawTorrent
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}

export function HeaderAuth() {
  return (
    <nav className="w-full flex justify-center border-b border-foreground/10 h-16">
      <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex items-center gap-5 font-semibold">
          <Link href="/" className="flex items-center gap-2 text-foreground hover:text-foreground/80 transition-colors">
            <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            RawTorrent
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Dashboard
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
