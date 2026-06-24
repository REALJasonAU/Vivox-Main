"use client";

import Image from "next/image";
import { useState } from "react";

function VivoxLogoSvg({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="select-none"
      aria-hidden
    >
      <rect width="36" height="36" rx="10" fill="#e5181b" />
      <path
        d="M9 26L18 10L27 26H23L18 16L13 26H9Z"
        fill="white"
        fillOpacity="0.95"
      />
    </svg>
  );
}

export function VivoxLogo({ size = 36 }: { size?: number }) {
  const [useFallback, setUseFallback] = useState(false);

  if (useFallback) {
    return <VivoxLogoSvg size={size} />;
  }

  return (
    <Image
      src="/vivox-logo.png"
      alt="Vivox"
      width={size}
      height={size}
      priority
      className="select-none rounded-[10px]"
      onError={() => setUseFallback(true)}
    />
  );
}
