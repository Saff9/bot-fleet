"use client";

import { Suspense, useState, useEffect, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Next.js 16 requires a <Suspense> boundary around any component that
 * calls useSearchParams() — otherwise static prerendering fails.
 * So LoginPage is just a thin Suspense wrapper around the real form.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const reason = params.get("reason");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(() => {
        // health endpoint doesn't tell us about auth — try a bots call to see if 401
        fetch("/api/bots")
          .then((r) => {
            if (r.status === 401) setAuthEnabled(true);
            else if (r.ok) {
              // already authed OR auth disabled
              setAuthEnabled(false);
              router.push(next);
            } else {
              setAuthEnabled(true);
            }
          })
          .catch(() => setAuthEnabled(true));
      })
      .catch(() => setAuthEnabled(true));
  }, [next, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Login failed");
      }
      toast.success("Welcome back");
      router.push(next);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (authEnabled === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (authEnabled === false) {
    // Auth disabled — should be redirected, but show fallback
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 bg-muted/30">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-sm"
      >
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold">
            B
          </div>
          <div>
            <h1 className="font-semibold text-lg leading-tight">Bot Fleet</h1>
            <p className="text-[10px] text-muted-foreground leading-tight">mini PaaS</p>
          </div>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl flex items-center gap-2">
              <ShieldCheck className="size-5" /> Sign in
            </CardTitle>
            <CardDescription>
              {reason === "rate_limit"
                ? "Too many attempts. Wait a minute and try again."
                : "Enter your admin password to manage your bot fleet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••••••"
                    className="pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={submitting || !password}>
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Signing in…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" /> Sign in
                  </>
                )}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Sessions last 30 days · HTTP-only · SameSite=Strict
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <footer className="mt-8 text-xs text-muted-foreground">
        Protected by HMAC-SHA256 signed cookies + AES-256-GCM env encryption
      </footer>
    </div>
  );
}
