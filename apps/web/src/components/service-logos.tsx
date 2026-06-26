"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

export function RustLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/Rust-Logo.png"
      alt="Rust"
      width={447}
      height={447}
      className={cn("object-contain drop-shadow-sm", className ?? "size-6")}
      unoptimized
    />
  );
}

export function MinecraftLogo({ className }: { className?: string }) {
  // Source image is 3840×2160 landscape banner — we center-crop to a square
  // by wrapping in an overflow-hidden square container.
  const sizeClass = className ?? "size-6";
  return (
    <span className={cn("relative block overflow-hidden rounded-sm", sizeClass)}>
      <Image
        src="/Minecraft-Logo.png"
        alt="Minecraft"
        width={3840}
        height={2160}
        className="absolute inset-0 h-full w-full object-cover object-center"
        unoptimized
      />
    </span>
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
      <path d="M3 14h14c2.5 0 4.5 1.2 5 3.5H3V14z" fill="#2496ED" />
    </svg>
  );
}
