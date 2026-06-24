"use client";



import type { ReactNode } from "react";

import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";



export function EmptyState({

  icon,

  title,

  description,

  action,

}: {

  icon: ReactNode;

  title: string;

  description: string;

  action?: ReactNode;

}) {

  return (

    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">

      <span className="grid size-12 place-items-center rounded-xl border border-border bg-surface-raised text-vivox-400">

        {icon}

      </span>

      <h3 className="text-base font-medium tracking-tight text-foreground">{title}</h3>

      <p className="max-w-sm text-sm text-muted">{description}</p>

      {action && <div className="mt-2">{action}</div>}

    </div>

  );

}



export function ErrorBanner({ message }: { message: string }) {

  return (

    <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">

      <AlertTriangle className="size-4 shrink-0" />

      <span>{message}</span>

    </div>

  );

}



export function Skeleton({ className }: { className?: string }) {

  return (

    <div

      className={cn(

        "relative overflow-hidden rounded-xl border border-border bg-surface",

        "after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer",

        "after:bg-gradient-to-r after:from-transparent after:via-surface-raised/60 after:to-transparent",

        className,

      )}

    />

  );

}


