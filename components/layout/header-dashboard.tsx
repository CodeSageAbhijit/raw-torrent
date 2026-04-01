import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/logout-button";
import { createClient } from "@/lib/supabase/server";

export async function HeaderDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isGuest = user?.is_anonymous ?? false;

  return (
    <nav className="w-full flex justify-center border-b border-foreground/10 h-16">
      <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex items-center gap-5 font-semibold">
          <Link href="/dashboard" className="flex items-center gap-2 text-foreground hover:text-foreground/80 transition-colors">
            <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            RawTorrent
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-foreground/60 hover:text-foreground transition-colors font-medium">
            Dashboard
          </Link>
          <Link href="/add" className="text-foreground/60 hover:text-foreground transition-colors font-medium">
            Download
          </Link>
          {!isGuest && (
            <>
              <Link href="/publish" className="text-foreground/60 hover:text-foreground transition-colors font-medium">
                Publish
              </Link>
              <Link href="/settings" className="text-foreground/60 hover:text-foreground transition-colors font-medium">
                Settings
              </Link>
            </>
          )}
          <div className="w-px h-4 bg-foreground/20 mx-1" />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}
