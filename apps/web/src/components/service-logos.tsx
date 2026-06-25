"use client";

import { cn } from "@/lib/utils";

export function RustLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-5", className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" fill="#CE422B" />
      <circle cx="12" cy="12" r="5.5" fill="#1a1a1a" />
      <path
        d="M12 6.5v11M6.5 12h11M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6"
        stroke="#CE422B"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MinecraftLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-5", className)}
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#5D8C3E" />
      <rect x="3" y="3" width="18" height="6" fill="#4A7032" />
      <rect x="5" y="11" width="4" height="4" fill="#8B6914" />
      <rect x="11" y="11" width="4" height="4" fill="#8B6914" />
      <rect x="17" y="11" width="2" height="4" fill="#6E5410" />
      <rect x="5" y="17" width="14" height="4" fill="#6E5410" />
    </svg>
  );
}

export function PostgresLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3" fill="#336791" />
      <path
        d="M8 16c0-3 1.5-5 4-5s4 2 4 5"
        stroke="#fff"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="1" fill="#fff" />
      <circle cx="14" cy="10" r="1" fill="#fff" />
    </svg>
  );
}

export function StaticSiteLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" fill="#3B82F6" opacity="0.85" />
      <rect x="6" y="8" width="8" height="2" rx="0.5" fill="#fff" opacity="0.9" />
      <rect x="6" y="12" width="12" height="1.5" rx="0.5" fill="#fff" opacity="0.7" />
      <rect x="6" y="15" width="10" height="1.5" rx="0.5" fill="#fff" opacity="0.7" />
    </svg>
  );
}

export function DockerLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden>
      <rect x="3" y="10" width="3" height="3" fill="#2496ED" />
      <rect x="7" y="10" width="3" height="3" fill="#2496ED" />
      <rect x="11" y="10" width="3" height="3" fill="#2496ED" />
      <rect x="7" y="6" width="3" height="3" fill="#2496ED" />
      <rect x="11" y="6" width="3" height="3" fill="#2496ED" />
      <rect x="15" y="10" width="3" height="3" fill="#2496ED" />
      <path
        d="M3 14h14c2.5 0 4.5 1.2 5 3.5H3V14z"
        fill="#2496ED"
      />
    </svg>
  );
}
