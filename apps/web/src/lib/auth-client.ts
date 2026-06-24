"use client";

import { createAuthClient } from "better-auth/react";
import { jwtClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined"
      ? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
      : window.location.origin,
  plugins: [jwtClient()],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
