"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { nodesApi } from "@/lib/api";
import type { Node } from "@/lib/types";
import { Button } from "@/components/ui/button";

const fieldClass =
  "h-10 w-full rounded-lg border border-border bg-background/50 px-3 text-sm text-foreground outline-none transition-all duration-200 focus:border-border-focus";

interface RegisterNodeFormProps {
  onRegistered: (node: Node, token: string) => void;
}

export function RegisterNodeForm({ onRegistered }: RegisterNodeFormProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await nodesApi.register({ name: name.trim() });
      onRegistered(res.node, res.agent_token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <Link
          href="/admin/nodes"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to nodes
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Register node</h1>
        <p className="mt-1 text-sm text-muted">
          Give the edge host a name. CPU, memory, and disk are detected when the agent connects.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">Node name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim().length >= 2) void submit();
            }}
            placeholder="e.g. edge-01"
            className={fieldClass}
          />
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Link
            href="/admin/nodes"
            className="inline-flex h-8 items-center rounded-lg px-3 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            Cancel
          </Link>
          <Button size="sm" onClick={() => void submit()} loading={submitting} disabled={name.trim().length < 2}>
            Register node
          </Button>
        </div>
      </div>
    </div>
  );
}
