"use client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, configureApi } from "./api/client";
export function QueryProvider({
  children,
  timeoutMs,
}: {
  children: React.ReactNode;
  timeoutMs: number;
}) {
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: (attempt, error) =>
            attempt < 1 && !(error instanceof ApiError && error.status < 500),
          refetchOnWindowFocus: true,
        },
        mutations: { retry: false },
      },
    });
    configureApi(timeoutMs, () => {
      queryClient.clear();
      window.location.replace("/login");
    });
    return queryClient;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
