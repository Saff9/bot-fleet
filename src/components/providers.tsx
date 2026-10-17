"use client";

import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  // Pre-warm: connect to the bot manager's boot event so any "recovered" bots
  // show up as "stopped" instead of "running" right after deploy.
  useEffect(() => {
    // nothing to do — query polling handles state updates
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
