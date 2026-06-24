"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Gamepad2, Globe, Database, ArrowRight, Zap, Shield, Activity } from "lucide-react";
import { VivoxLogo } from "@/components/vivox-logo";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Gamepad2,
    title: "Game Servers",
    description:
      "Deploy Minecraft, Rust, CS2, and more in seconds. Full console access, live metrics, and automated restarts.",
  },
  {
    icon: Globe,
    title: "Web & App Hosting",
    description:
      "Run Node.js, Python, Docker containers — anything with a port. Custom domains included.",
  },
  {
    icon: Database,
    title: "Managed Databases",
    description:
      "Postgres, MySQL, Redis and more. Automated backups, connection management, zero config.",
  },
];

const PERKS = [
  { icon: Zap, label: "Instant deployment" },
  { icon: Shield, label: "Isolated containers" },
  { icon: Activity, label: "Live monitoring" },
];

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1 + 0.4, duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-900 px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <VivoxLogo size={32} />
          <span className="text-sm font-semibold tracking-tight">Vivox</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/register">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center">
        <section className="flex w-full max-w-5xl flex-col items-center gap-8 px-6 py-24 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <VivoxLogo size={64} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-4"
          >
            <h1 className="text-5xl font-bold tracking-tight text-zinc-50 sm:text-6xl">
              Hosting that{" "}
              <span className="text-vivox-400">just works</span>
            </h1>
            <p className="mx-auto max-w-xl text-lg text-zinc-400">
              Game servers, web apps, and databases — deployed in seconds on edge infrastructure
              built for reliability.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="flex flex-wrap items-center justify-center gap-3"
          >
            <Link href="/register">
              <Button size="lg" actionType="deploy">
                Get started <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="secondary">
                Sign in
              </Button>
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.4 }}
            className="flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-500"
          >
            {PERKS.map(({ icon: Icon, label }) => (
              <span key={label} className="flex items-center gap-1.5">
                <Icon className="size-4 text-vivox-500" />
                {label}
              </span>
            ))}
          </motion.div>
        </section>

        <section className="w-full max-w-5xl px-6 pb-24">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
              >
                <div className="grid size-10 place-items-center rounded-xl bg-vivox-500/10">
                  <f.icon className="size-5 text-vivox-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-100">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{f.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-900 px-6 py-5 text-center text-xs text-zinc-600">
        © {new Date().getFullYear()} Vivox. All rights reserved.
      </footer>
    </div>
  );
}
