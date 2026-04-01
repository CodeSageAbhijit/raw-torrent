"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
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
