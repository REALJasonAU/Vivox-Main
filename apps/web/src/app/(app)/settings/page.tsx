"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, Eye, EyeOff, Key, Moon, Plus, Sun, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient, signOut, useSession } from "@/lib/auth-client";
import { useTheme } from "@/components/theme-provider";
import { API_BASE, apiKeysApi, profileApi, webhooksApi } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { ApiKey, WebhookConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime } from "@/lib/utils";
import { toast } from "@/hooks/useToast";

function AccountSection() {
  const { data, refetch } = useSession();
  const user = data?.user;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setName(user?.name ?? "");
  }, [user?.name, editing]);

  const initial = (name || user?.email || "?").charAt(0).toUpperCase();

  const save = async () => {
    setSaving(true);
    try {
      await profileApi.update(name.trim());
      await refetch();
      toast("Profile updated", "success");
      setEditing(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-100">Account</h2>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
      <div className="mt-4 flex items-center gap-4">
        <motion.div
          key={initial}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 20 }}
          className="grid size-14 place-items-center rounded-full bg-vivox-500/20 text-xl font-semibold text-vivox-400"
        >
          {initial}
        </motion.div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-wrap gap-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void save()}
                placeholder="Your name"
                className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 text-sm text-zinc-100 outline-none focus:border-vivox-500/50"
              />
              <Button size="sm" actionType="save" onClick={() => void save()} loading={saving}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setName(user?.name ?? "");
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <p className="font-medium text-zinc-100">{user?.name ?? "—"}</p>
              <p className="text-sm text-zinc-500">{user?.email ?? "Not signed in"}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = current.length > 0 && next.length >= 8 && next === confirm;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: false,
      });
      if (res.error) throw new Error(res.error.message ?? "Failed");
      toast("Password updated", "success");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-sm font-medium text-zinc-100">Change password</h2>
      <div className="mt-4 flex flex-col gap-3">
        <PasswordField label="Current password" value={current} onChange={setCurrent} />
        <PasswordField
          label="New password"
          value={next}
          onChange={setNext}
          hint={next.length > 0 && next.length < 8 ? "Min 8 characters" : undefined}
        />
        <PasswordField
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          error={confirm.length > 0 && next !== confirm ? "Passwords don't match" : undefined}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving} disabled={!valid} actionType="save" size="sm">
            Update password
          </Button>
        </div>
      </div>
    </section>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 pr-10 text-sm text-zinc-100 outline-none focus:border-vivox-500/50"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </label>
  );
}

const WEBHOOK_EVENTS = ["crash", "alert", "stopped", "running"] as const;

function WebhooksSection() {
  const { data: hooks, refetch } = useApi(() => webhooksApi.list(), []);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>(["crash", "alert", "stopped"]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const webhookList = hooks ?? [];

  const toggleEvent = (ev: string) => {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  };

  const createWebhook = async () => {
    if (!url.trim().startsWith("https://")) {
      toast("URL must start with https://", "error");
      return;
    }
    setSaving(true);
    try {
      await webhooksApi.create({
        url: url.trim(),
        secret: secret.trim() || undefined,
        events,
      });
      setUrl("");
      setSecret("");
      setCreating(false);
      void refetch();
      toast("Webhook created", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create webhook", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleHook = async (hook: WebhookConfig) => {
    try {
      await webhooksApi.toggle(hook.id, !hook.enabled);
      void refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to update webhook", "error");
    }
  };

  const deleteHook = async (id: string) => {
    setDeletingId(id);
    try {
      await webhooksApi.remove(id);
      void refetch();
      toast("Webhook deleted", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to delete", "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-100">Webhooks</h2>
          <p className="mt-1 text-sm text-zinc-500">
            POST to a URL when services crash, alert, or stop.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" /> Add webhook
        </Button>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {webhookList.map((hook) => (
            <motion.li
              key={hook.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 text-sm"
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  hook.enabled ? "bg-vivox-500" : "bg-zinc-600",
                )}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">
                {hook.url}
              </span>
              <span className="text-xs text-zinc-500">{hook.events.join(", ")}</span>
              <button
                type="button"
                onClick={() => void toggleHook(hook)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                {hook.enabled ? "Pause" : "Enable"}
              </button>
              <Button
                size="sm"
                variant="ghost"
                actionType="delete"
                loading={deletingId === hook.id}
                onClick={() => void deleteHook(hook.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950/50 p-4"
          >
            <div className="flex flex-col gap-3">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/..."
                className="h-10 rounded-lg border border-zinc-800 bg-zinc-900 px-3 font-mono text-sm text-zinc-100"
              />
              <input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Signing secret (optional)"
                className="h-10 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100"
              />
              <div className="flex flex-wrap gap-3">
                {WEBHOOK_EVENTS.map((ev) => (
                  <label key={ev} className="flex items-center gap-1.5 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={events.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                      className="rounded border-zinc-600"
                    />
                    {ev}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" actionType="save" loading={saving} onClick={() => void createWebhook()}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-500">
        <p className="mb-1 font-medium text-zinc-400">Payload format</p>
        <code className="font-mono text-zinc-400">
          {"{ event, service_id, service_name, timestamp, meta }"}
        </code>
        <p className="mt-2">Signed with X-Vivox-Signature: sha256=… when a secret is set.</p>
      </div>
    </section>
  );
}

function AccountDangerZone() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOutAll = async () => {
    if (!window.confirm("Sign out from all devices? You will need to sign in again.")) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/revoke-sessions", { method: "POST", credentials: "include" });
      await signOut();
      router.push("/login");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to sign out", "error");
      setSigningOut(false);
    }
  };

  return (
    <section className="rounded-xl border border-red-500/20 bg-red-500/5 p-6">
      <h2 className="text-sm font-medium text-red-400">Account danger zone</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Signing out from all devices will invalidate all active sessions.
      </p>
      <Button
        variant="danger"
        size="sm"
        className="mt-3"
        loading={signingOut}
        onClick={() => void signOutAll()}
      >
        Sign out all devices
      </Button>
    </section>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { data: keys, refetch } = useApi(() => apiKeysApi.list(), []);
  const [revealedKey, setRevealedKey] = useState<{ key: ApiKey; plaintext: string } | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!revealedKey) return;
    setCountdown(5);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          setRevealedKey(null);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [revealedKey]);

  const createKeyWithName = async (name: string) => {
    try {
      const res = await apiKeysApi.create(name);
      setRevealedKey(res);
      void refetch();
      toast("API key created", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to create key", "error");
    }
  };

  const deleteKey = async (id: string) => {
    setDeletingId(id);
    try {
      await apiKeysApi.remove(id);
      void refetch();
      toast("API key deleted", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to delete key", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const copyPlaintext = async () => {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey.plaintext);
    toast("Copied to clipboard", "success");
  };

  const apiKeys = keys ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Workspace and appearance.</p>
      </div>

      <AccountSection />

      <PasswordSection />

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-sm font-medium text-zinc-100">Appearance</h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(["dark", "light"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm capitalize transition-all duration-200",
                theme === t
                  ? "border-vivox-500/50 bg-vivox-500/10 text-zinc-100"
                  : "border-zinc-800 text-zinc-400 hover:border-zinc-700",
              )}
            >
              {t === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
              {t}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-zinc-100">API Keys</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Use API keys to trigger deployments from CI/CD.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const name = window.prompt("Key name (e.g. github-actions)");
              if (name) void createKeyWithName(name);
            }}
          >
            <Plus className="size-3.5" /> Create new key
          </Button>
        </div>

        <AnimatePresence>
          {revealedKey && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -8 }}
              className="mt-4 overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
            >
              <p className="text-xs font-medium uppercase tracking-wider text-amber-400">
                Shown once — save it now
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200">
                  {revealedKey.plaintext}
                </code>
                <Button size="sm" variant="ghost" onClick={() => void copyPlaintext()}>
                  <Copy className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRevealedKey(null)}>
                  <X className="size-4" />
                </Button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">Auto-closing in {countdown}s</p>
            </motion.div>
          )}
        </AnimatePresence>

        <ul className="mt-4 flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {apiKeys.map((key) => (
              <motion.li
                key={key.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5"
              >
                <Key className="size-4 shrink-0 text-vivox-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">{key.name}</p>
                  <p className="font-mono text-xs text-zinc-500">
                    {key.key_prefix}… · Created {formatRelativeTime(key.created_at)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  actionType="delete"
                  loading={deletingId === key.id}
                  onClick={() => void deleteKey(key.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </motion.li>
            ))}
          </AnimatePresence>
          {apiKeys.length === 0 && (
            <p className="py-4 text-center text-sm text-zinc-500">No API keys yet.</p>
          )}
        </ul>

        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Redeploy from CI/CD</p>
          <code className="block font-mono text-xs leading-relaxed text-zinc-400">
            curl -X POST {API_BASE}/services/{"{service_id}"}/redeploy \<br />
            {"  "}-H &quot;Authorization: ApiKey vvx_...&quot;
          </code>
        </div>
      </section>

      <WebhooksSection />

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-sm font-medium text-zinc-100">Control plane</h2>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-zinc-500">API endpoint</span>
          <code className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-400">
            {API_BASE}
          </code>
        </div>
      </section>

      <AccountDangerZone />
    </div>
  );
}
