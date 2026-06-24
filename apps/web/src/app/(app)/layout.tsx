import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/toaster";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppShell>{children}</AppShell>
      <Toaster />
    </>
  );
}
