"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    
    router.push("/");
  };

  return (
    <button
      onClick={handleLogout}
      className="btn-outline-animate text-xs font-semibold text-foreground/60 hover:text-foreground border border-foreground/10 px-3 py-1.5 rounded-md hover:bg-foreground/5"
    >
      Logout
    </button>
  );
}
