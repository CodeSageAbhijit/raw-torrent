import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export function Footer() {
  return (
    <footer className="w-full flex items-center justify-center border-t border-foreground/10 mx-auto text-center text-xs gap-8 py-8">
      <p className="text-foreground/40">
        Powered by{" "}
        <Link
          href="https://nextjs.org"
          target="_blank"
          className="font-bold hover:underline"
          rel="noreferrer"
        >
          Next.js
        </Link>
      </p>
      <ThemeToggle />
    </footer>
  );
}
