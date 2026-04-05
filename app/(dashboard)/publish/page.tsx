"use client";

// # TO BE IMPLEMENTED
// This feature allows users to create torrents from files and seed them to the network.
// File publishing and seeding implementation is planned for a future release.
// Current implementation is hidden from the UI.

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function PublishPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to dashboard since this feature is not yet available
    const timer = setTimeout(() => {
      router.push("/dashboard");
    }, 2000);
    return () => clearTimeout(timer);
  }, [router]);


  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center min-h-screen bg-background text-foreground">
      <div className="flex flex-col items-center gap-6 text-center max-w-md">
        <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold">Coming Soon</h1>
          <p className="text-foreground/60 mt-2">The Publish feature is currently under development.</p>
          <p className="text-sm text-foreground/50 mt-3">Redirecting you to Dashboard...</p>
        </div>
      </div>
    </div>
  );
}
