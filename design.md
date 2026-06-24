# Vivox — Design System & UI Reference

This document describes the visual language, layout structure, animation system, and component patterns used across the Vivox web application (`apps/web`). The aesthetic is **dark-first** with **light mode** support, semantic surface tokens, **Vivox red** accents, and status colors driven by CSS variables.

---

## Brand identity

| Asset | Location |
|-------|----------|
| Logo PNG | `apps/web/public/vivox-logo.png` |
| Logo component | `apps/web/src/components/vivox-logo.tsx` |
| Wordmark | **Vivox** (sidebar, metadata, auth) |
| Primary accent | `vivox-500` = `#e5181b` |

### Vivox red scale (Tailwind `vivox`)

| Token | Hex |
|-------|-----|
| `vivox-50` | `#fff0f0` |
| `vivox-400` | `#ff5555` |
| **`vivox-500`** | **`#e5181b`** (primary) |
| `vivox-600` | `#c01015` |
| `vivox-950` | `#420b0c` |

### Local storage keys

| Key | Purpose |
|-----|---------|
| `vivox-theme` | Dark/light preference (cookie + localStorage) |
| `vivox-sidebar-collapsed` | Sidebar width state |
| `vivox-view` | Dashboard grid/list preference |

---

## Design principles

| Principle | How it shows up |
|-----------|-----------------|
| **Dark-first, light supported** | Default `.dark` on `<html>`; `.light` overrides in `globals.css` |
| **Semantic tokens** | Prefer `bg-background`, `bg-surface`, `text-foreground`, `text-muted`, `border-border` over raw `zinc-*` |
| **Operational clarity** | Status badges, live metrics, transient-state control locking |
| **Dual panel UX** | Customers see **My Servers**; admins switch to a separate admin panel via footer/profile |
| **Expressive motion** | Framer Motion + CSS keyframe library on interactive surfaces |
| **Monospace for data** | JetBrains Mono for logs, ports, images, metrics |
| **Live data** | WebSocket topics for service + node status; "Live" indicators |

---

## Color palette

### Semantic tokens (preferred in components)

Use Tailwind classes mapped to CSS variables in `globals.css`:

| Class | Role |
|-------|------|
| `bg-background` | Page canvas |
| `bg-surface` | Sidebar, cards, panels |
| `bg-surface-raised` | Hover rows, active nav, elevated chips |
| `text-foreground` | Primary text |
| `text-muted` | Secondary labels |
| `text-subtle` | Hints, disabled copy |
| `border-border` | Default borders |
| `border-border-focus` | Focus rings |
| `text-vivox-400` / `bg-vivox-500` | Brand accent |

### Legacy zinc reference (dark mode)

| Token | Hex | Maps to |
|-------|-----|---------|
| `zinc-950` | `#09090b` | `--background` |
| `zinc-900` | `#18181b` | `--surface` |
| `zinc-800` | `#27272a` | `--border` |
| `zinc-400` | `#a1a1aa` | `--muted` |
| `zinc-100` | `#f4f4f5` | `--foreground` |

**Hover tint (dark):** `bg-surface-raised` or `#1f1f23` where legacy styles remain.

### Status colors

Driven by `--status-*` RGB triples in `globals.css` (used in badges and usage bars):

| Status | Token | UI copy |
|--------|-------|---------|
| PROVISIONING | `--status-provisioning` | "Downloading image and installing server files" |
| STARTING | `--status-starting` | Container spawned |
| RUNNING | `--status-running` | Healthy |
| STOPPING | `--status-stopping` | Graceful shutdown |
| STOPPED | `--status-stopped` | Clean exit |
| CRASHED | `--status-crashed` | Non-zero exit |

Use `rgb(var(--status-running))` or the helper pattern in node/service rows — **not** hardcoded hex in new code.

### Links & interactive accent

Use `text-vivox-400`, `bg-vivox-500`, `ring-vivox-500`, `border-vivox-500/*` — **never** `indigo-*`.

---

## App shell layout

```
┌──────────────────────────────────────────────────────────────────┐
│  SIDEBAR (spring 72↔256px) │  TOP BAR (sticky)                   │
│  VivoxLogo                 │  search · ws · bell · theme         │
│  ─────────────────         ├──────────────────────────────────────┤
│  USER: My Servers          │  MAIN max-w-7xl                     │
│  ADMIN: Dashboard,         │  PageTransition                     │
│    Servers, Users,         │                                     │
│    Nodes, Audit, Templates │                                     │
│  ─────────────────         │                                     │
│  footer: bell · theme      │                                     │
│    · [shield] admin icon   │  (user mode — admins only)          │
│  profile menu              │                                     │
│  ← User panel (text)       │  (admin mode — bottom link)         │
│  collapse chevron          │                                     │
└────────────────────────────┴──────────────────────────────────────┘
```

### Navigation scopes

| Mode | Routes | Sidebar nav |
|------|--------|-------------|
| **User panel** | `/dashboard`, `/services/*`, `/settings` | My Servers |
| **Admin panel** | `/admin/*`, `/deploy` | Dashboard, Servers, Users, Nodes, Audit, Templates |

**Panel switcher**

- User mode: shield icon in footer icon row → `/admin/dashboard`
- Admin mode: text link at sidebar bottom → `/dashboard`
- Profile menu: **Admin panel** / **User panel** entry between settings and sign out

---

## Animation system

Defined in `apps/web/src/app/globals.css` and Framer Motion in components.

### Button `actionType` prop

| actionType | Icon animation |
|------------|----------------|
| `deploy` | `animate-rocket-thrust` |
| `start` | `animate-play-ripple` |
| `stop` | `animate-stop-implode` |
| `restart` | `animate-spin-once` |
| `delete` | `animate-trash-lid` |
| `save` / `copy` | Spin or flash + brief success label |

Buttons use `motion.button` with spring hover/tap.

### Key motion surfaces

| Surface | Pattern |
|---------|---------|
| **PageTransition** | `AnimatePresence mode="wait"` on route change |
| **Sidebar** | Spring width; `layoutId` active nav pill |
| **NodeSetupPanel** | Modal backdrop + spring panel |
| **Service controls** | Transient status pulsing ring when locked |
| **Toaster** | Spring slide from right |

### Reduced motion

`prefers-reduced-motion: reduce` collapses animation durations in `globals.css`.

---

## Typography

| Role | Font |
|------|------|
| UI | Inter (`--font-sans`) |
| Data | JetBrains Mono (`--font-mono`) |
| Page title | `text-xl font-semibold tracking-tight text-foreground` |
| Section label | `text-xs uppercase tracking-wider text-muted` |

---

## Components

### Buttons (`ui/button.tsx`)

| Variant | Style |
|---------|-------|
| primary | `bg-vivox-500 hover:bg-vivox-600 shadow-vivox-500/20` |
| secondary | `bg-surface-raised border border-border` |
| ghost | `text-muted hover:bg-surface-raised` |
| danger | `bg-red-500/10` + glow on hover |
| outline | `border-border` |

### Cards / panels

```
rounded-xl border border-border bg-surface p-4
```

Elevated inputs: `bg-background/50 border-border focus:border-border-focus`

### Status badges

Rounded pill with dot; colors from `--status-*` via inline `color-mix` for background tint.

### Service controls (`service-controls.tsx`)

Start · Restart · **Reinstall** · Stop — disabled during transient states (`PROVISIONING`, `STARTING`, `STOPPING`).

### Theme toggle (`theme-toggle.tsx`)

Compact icon button in sidebar footer; sun/moon cross-fade.

---

## Page-specific notes

### Customer dashboard (`/dashboard`)

- **My Servers** scope only; grid/list toggle (`vivox-view`)
- Live service status merged from WebSocket hook

### Admin dashboard (`/admin/dashboard`)

- Fleet stats, node health, live node status

### Admin nodes

- List at `/admin/nodes`; create at `/admin/nodes/create` (name-only form)
- Detail page with token rotate + setup panel

### Deploy wizard (`/deploy`)

- Steps: Template → Configure → Environment → Review
- Template cards with info dialog; env fields respect `field_type` (select, password, number)
- Port bindings: bind IP, host port, container port, optional alias

### Service detail

- Console tab streams install + runtime logs (`[vivox] === Installing server files ===`)
- Service controls include reinstall

### Auth

- `VivoxLogo`, floating labels, staggered field entrance
- Landing page at `/` for signed-out users

---

## File reference

| Concern | Path |
|---------|------|
| Design tokens | `apps/web/src/app/globals.css` |
| Tailwind theme | `apps/web/tailwind.config.ts` |
| App shell | `apps/web/src/components/app-shell.tsx` |
| Sidebar + panel switch | `apps/web/src/components/sidebar.tsx` |
| Profile menu | `apps/web/src/components/sidebar-user-menu.tsx` |
| Theme provider | `apps/web/src/components/theme-provider.tsx` |
| Live status hooks | `apps/web/src/hooks/useLiveStatuses.ts` |
| Status metadata | `apps/web/src/lib/status.ts` |
| Buttons | `apps/web/src/components/ui/button.tsx` |

---

## Quick recipes

**Primary CTA:**

```html
<button class="inline-flex h-10 items-center gap-2 rounded-lg bg-vivox-500 px-4 text-sm font-medium text-white shadow-sm shadow-vivox-500/20">
  Action
</button>
```

**Semantic panel:**

```html
<div class="rounded-xl border border-border bg-surface p-5">...</div>
```

**Muted label:**

```html
<p class="text-xs uppercase tracking-wider text-muted">Section</p>
```

---

*Last updated: Sprint 14+ — semantic light/dark tokens, dual admin/user panel, live node status, Pterodactyl-style install UX.*
