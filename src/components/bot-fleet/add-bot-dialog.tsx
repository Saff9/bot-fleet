"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

const formSchema = z.object({
  name: z.string().min(1, "Name is required").max(60),
  githubUrl: z
    .string()
    .min(1, "GitHub URL is required")
    .refine(
      (v) =>
        v.startsWith("https://github.com/") ||
        v.startsWith("http://github.com/") ||
        v.startsWith("git@github.com:"),
      "Must be a github.com URL"
    ),
  branch: z.string().optional(),
  startCommand: z.string().min(1, "Start command is required").max(200),
  installCommand: z.string().optional(),
  envVars: z.string().optional(),
  autoRestart: z.boolean().default(true),
});

type FormValues = z.infer<typeof formSchema>;

const EXAMPLES = [
  { label: "Node.js (npm)", install: "npm install", start: "node index.js" },
  { label: "Bun", install: "bun install", start: "bun run index.ts" },
  { label: "Python", install: "pip install -r requirements.txt", start: "python bot.py" },
  { label: "Discord.js", install: "npm install", start: "npm start" },
];

export function AddBotDialog({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      githubUrl: "",
      branch: "",
      startCommand: "",
      installCommand: "",
      envVars: "",
      autoRestart: true,
    },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      let envVars: Record<string, string> = {};
      if (values.envVars?.trim()) {
        try {
          const parsed = JSON.parse(values.envVars);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            envVars = Object.fromEntries(
              Object.entries(parsed).map(([k, v]) => [k, String(v)])
            );
          } else {
            throw new Error("not an object");
          }
        } catch {
          throw new Error('Env vars must be valid JSON: { "KEY": "value" }');
        }
      }
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          githubUrl: values.githubUrl,
          branch: values.branch || undefined,
          startCommand: values.startCommand,
          installCommand: values.installCommand || undefined,
          envVars,
          autoRestart: values.autoRestart,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      const bot = await res.json();
      toast.success(`Bot "${bot.name}" created — deploying...`);
      setOpen(false);
      form.reset();
      onCreated?.();
      router.push(`/bots/${bot.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create bot");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Rocket className="size-4" />
          Deploy Bot
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deploy a new bot</DialogTitle>
          <DialogDescription>
            Point at a GitHub repo, give it a start command, and we&apos;ll clone, install and run it inside this service.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bot name</FormLabel>
                  <FormControl>
                    <Input placeholder="my-telegram-bot" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="githubUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>GitHub URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://github.com/owner/repo"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Public repo. Accepts <code>?branch</code>, <code>/tree/branch</code>, or SSH URL.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="branch"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="main" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="autoRestart"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Auto-restart</FormLabel>
                      <FormDescription>On crash, up to 5 attempts</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="installCommand"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Install command (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="npm install" {...field} />
                  </FormControl>
                  <FormDescription>
                    Auto-detected from lockfile if blank. Examples:{" "}
                    {EXAMPLES.map((e, i) => (
                      <button
                        type="button"
                        key={e.label}
                        onClick={() => {
                          form.setValue("installCommand", e.install);
                          if (!form.watch("startCommand")) {
                            form.setValue("startCommand", e.start);
                          }
                        }}
                        className="mx-1 underline decoration-dotted hover:text-foreground"
                      >
                        {e.label}{i < EXAMPLES.length - 1 ? " ·" : ""}
                      </button>
                    ))}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="startCommand"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Start command</FormLabel>
                  <FormControl>
                    <Input placeholder="node index.js" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="envVars"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Environment variables (JSON)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={'{\n  "BOT_TOKEN": "xxx",\n  "API_KEY": "yyy"\n}'}
                      className="font-mono text-xs min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Passed to the bot process. Stored in the local SQLite DB.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Deploying...
                  </>
                ) : (
                  <>
                    <Rocket className="size-4" /> Deploy
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
