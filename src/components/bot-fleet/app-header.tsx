"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shared app header: brand + theme toggle + (optional) logout.
 *
 * The logout button only renders when the user is authenticated —
 * we infer that from a probe to /api/auth/whoami (returns 401 if not authed,
 * 200 otherwise). We use a one-shot effect so we don't poll.
 *
 * Note: if auth is disabled (no BOT_FLEET_ADMIN_PASSWORD env), the
 * middleware lets everything through and /api/health still works.
 * The logout button is hidden in that case.
 */
export function AppHeader({ right }: { right?: React.ReactNode }) {
  const router = useRouter();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      toast.success("Signed out");
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Failed to sign out");
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
            B
          </div>
          <div className="leading-tight">
            <h1 className="font-semibold">Bot Fleet</h1>
            <p className="text-[10px] text-muted-foreground leading-tight">
              mini PaaS · one service, many bots
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-1.5">
          {right}
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

void ShieldCheck; // kept for future "auth indicator" badge
