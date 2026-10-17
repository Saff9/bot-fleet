import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bot Fleet — mini PaaS for bots",
  description:
    "Self-hosted mini-PaaS: deploy many bots from GitHub URLs into a single Railway/Render/Fly service. AES-256-GCM env encryption, signed-cookie auth, rate limiting, Rust-backed log archival.",
  keywords: ["bot hosting", "PaaS", "Railway", "Telegram bot", "Discord bot", "self-hosted"],
  authors: [{ name: "Bot Fleet" }],
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set color-scheme early so first paint matches user's preference */}
        <meta name="color-scheme" content="light dark" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          <QueryProvider>
            {children}
          </QueryProvider>
        </ThemeProvider>
        <Toaster />
        <SonnerToaster richColors position="top-right" />
      </body>
    </html>
  );
}
