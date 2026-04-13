"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  const handleBack = () => {
    router.push("/");
  };

  return (
    <button
      onClick={handleBack}
      className="btn-outline-animate inline-flex h-9 w-9 items-center justify-center text-foreground/60 hover:text-foreground border border-foreground/10 rounded-md hover:bg-foreground/5"
      title="Landing Page"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    </button>
  );
}
