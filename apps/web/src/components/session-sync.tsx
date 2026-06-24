"use client";

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { markTokenSyncComplete, setApiToken } from "@/lib/api";

let wsToken: string | null = null;

export function getWsToken(): string | null {
  return wsToken;
}

/**
 * Bridges the Better Auth JWT into the REST + WebSocket clients.
 * Retries until a JWT is available — the Go API requires a Bearer JWT and
 * cannot use the opaque better-auth.session_token cookie alone.
 */
export function SessionSync() {
  useEffect(() => {
    let cancelled = false;

    async function fetchToken(): Promise<string | null> {
      try {
        const { data } = await authClient.token();
        return data?.token ?? null;
      } catch {
        return null;
      }
    }

    async function init() {
      for (let attempt = 0; attempt < 15; attempt++) {
        if (cancelled) return;
        const token = await fetchToken();
        if (cancelled) return;
        if (token) {
          wsToken = token;
          setApiToken(token);
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!cancelled) {
        wsToken = null;
        setApiToken(null);
        markTokenSyncComplete();
      }
    }

    void init();

    const id = setInterval(async () => {
      const token = await fetchToken();
      if (token) {
        wsToken = token;
        setApiToken(token);
      }
    }, 45_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return null;
}
