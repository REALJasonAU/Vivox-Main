"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { VivoxLogo } from "./vivox-logo";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8"
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <VivoxLogo size={52} />
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">{title}</h1>
          <p className="text-sm text-zinc-400">{subtitle}</p>
        </div>
        {children}
        <p className="mt-6 text-center text-sm text-zinc-500">{footer}</p>
      </motion.div>
    </div>
  );
}

export function Field({
  id,
  icon,
  type,
  label,
  value,
  onChange,
  autoComplete,
  required,
}: {
  id: string;
  icon: ReactNode;
  type: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className="relative flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3.5 transition-all duration-200 focus-within:border-vivox-500/50"
    >
      <span className="text-zinc-500">{icon}</span>
      <div className="relative min-w-0 flex-1">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          placeholder=" "
          className="peer h-12 w-full bg-transparent pt-3 text-sm text-zinc-100 outline-none"
        />
        <span
          className="pointer-events-none absolute left-0 top-3.5 text-sm text-zinc-500 transition-all duration-200 peer-focus:top-1.5 peer-focus:text-xs peer-focus:text-vivox-400 peer-[:not(:placeholder-shown)]:top-1.5 peer-[:not(:placeholder-shown)]:text-xs"
        >
          {label}
        </span>
      </div>
    </label>
  );
}
