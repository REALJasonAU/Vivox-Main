"use client";

import { X } from "lucide-react";
import type { DeployTemplate } from "@/lib/types";
import { Button } from "@/components/ui/button";

export function TemplateInfoDialog({
  template,
  onClose,
}: {
  template: DeployTemplate;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{template.name}</h2>
            <p className="mt-1 text-sm text-muted">{template.description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface-raised">
            <X className="size-5" />
          </button>
        </div>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Type</dt>
            <dd className="mt-0.5 font-mono text-foreground">{template.type}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Image</dt>
            <dd className="mt-0.5 font-mono text-foreground">{template.defaultImage || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Default ports</dt>
            <dd className="mt-0.5 font-mono text-foreground">
              {template.defaultPorts.length ? template.defaultPorts.join(", ") : "Configure at deploy"}
            </dd>
          </div>
          {template.defaultStartupCmd && (
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Startup command</dt>
              <dd className="mt-0.5 font-mono text-xs text-foreground">{template.defaultStartupCmd}</dd>
            </div>
          )}
          {template.env.length > 0 && (
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Environment</dt>
              <dd className="mt-1 space-y-2">
                {template.env.map((f) => (
                  <div key={f.key} className="rounded-lg border border-border bg-background/50 px-3 py-2">
                    <p className="font-mono text-xs text-vivox-400">{f.key}</p>
                    <p className="text-sm text-foreground">{f.label}</p>
                    <p className="text-xs text-muted">Default: {f.value}</p>
                    {f.description && <p className="mt-1 text-xs text-muted">{f.description}</p>}
                    {f.options && <p className="text-xs text-subtle">Options: {f.options}</p>}
                  </div>
                ))}
              </dd>
            </div>
          )}
        </dl>
        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
