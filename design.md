# Vivox — Design System & UI Reference

This document describes the visual language, layout structure, animation system, and component patterns used across the Vivox web application (`apps/web`). The aesthetic is a dark-first control plane with zinc neutrals, **Vivox red** accents, and semantic status colors.

---

## Brand identity

| Asset | Location |
|-------|----------|
| Logo PNG | `apps/web/public/vivox-logo.png` |
| Logo component | `apps/web/src/components/vivox-logo.tsx` — `Image` with inline SVG fallback on error |
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
| **Dark-first** | Default theme is dark (`zinc-950` canvas). Light mode supported. |
| **Operational clarity** | Status badges, live metrics, transient-state control locking. |
| **Layered surfaces** | `zinc-950` → `zinc-900` panels → `zinc-800` borders. |
| **Expressive motion** | Framer Motion + CSS keyframe library on every interactive surface. |
| **Monospace for data** | JetBrains Mono for logs, ports, images, metrics. |
| **Live data** | WebSocket topics; "Live" pill in top bar. |

---

## Color palette

### Core neutrals (dark mode)

| Token | Hex | Usage |
|-------|-----|-------|
| `zinc-950` | `#09090b` | Page background |
| `zinc-900` | `#18181b` | Sidebar, cards, panels |
| `zinc-800` | `#27272a` | Borders, tracks |
| `zinc-400` | `#a1a1aa` | Secondary text |
| `zinc-100` | `#f4f4f5` | Primary text |

**Hover tint:** `#1f1f23`

### Accent tokens (CSS)

```css
--accent-primary: #e5181b;
--accent: 229 24 27;
--accent-soft: 255 85 85;   /* dark */
--accent-soft: 192 16 21;   /* light */
```

### Semantic colors (unchanged)

| Color | Usage |
|-------|-------|
| Emerald | Running, success, memory metrics |
| Amber | Warnings, log cap proximity |
| Red | Crashed, danger, stderr, notification dot |

### Links & interactive accent

Use `text-vivox-400`, `bg-vivox-500`, `ring-vivox-500`, `border-vivox-500/*` — **never** `indigo-*`.

---

## Animation system

Defined in `apps/web/src/app/globals.css` and extended via Framer Motion in components.

### CSS utility classes

| Class | Effect |
|-------|--------|
| `animate-rocket-thrust` | Deploy icon thrust |
| `animate-spin-once` | Restart / save spin |
| `animate-shake-danger` | Danger shake |
| `animate-bounce-down` / `animate-bounce-up` | Download / upload |
| `animate-trash-lid` | Delete lid pop |
| `animate-copy-flash` | Copy swap |
| `animate-play-ripple` | Start ripple (vivox red) |
| `animate-stop-implode` | Stop implode |
| `animate-page-enter` | Route enter |
| `animate-tab-right` / `animate-tab-left` | Tab slide |
| `animate-stagger-up` / `animate-stagger-right` | List/card entrance |
| `animate-glow-danger` | Danger hover glow |
| `animate-collapse-remove` | Row removal |
| `animate-success-flash` | Success background flash |
| `animate-confirm-bounce` | Confirm panel bounce |
| `animate-toast-in` / `animate-toast-out` | Toast slide |
| `animate-backdrop-in` | Modal backdrop |
| `animate-modal-in` | Modal scale-in |
| `animate-dropdown-in` | Dropdown scale-in |
| `animate-number-pop` | Counter pop |
| `animate-input-glow` | Focus ring (vivox red) |
| `animate-drag-lift` | File drag lift |
| `animate-drop-pulse` | Drop target pulse |
| `animate-ping-once` | Notification badge ping |
| `animate-sidebar-nav` | Nav item entrance |

### Button `actionType` prop

| actionType | Icon animation |
|------------|----------------|
| `deploy` | `animate-rocket-thrust` |
| `start` | `animate-play-ripple` |
| `stop` | `animate-stop-implode` |
| `restart` | `animate-spin-once` |
| `delete` | `animate-trash-lid` |
| `save` | `animate-spin-once` + brief "Saved" check |
| `copy` | `animate-copy-flash` + "Copied" |
| `download` | `animate-bounce-down` |
| `upload` | `animate-bounce-up` |
| `none` | Framer hover/tap only |

Buttons use `motion.button` with `whileHover={{ scale: 1.02, y: -0.5 }}` and `whileTap={{ scale: 0.96 }}`.

### Framer Motion surfaces

| Surface | Pattern |
|---------|---------|
| **PageTransition** | `AnimatePresence mode="wait"` — slide + fade on route change |
| **Service tabs** | Direction-aware `x` slide based on tab index |
| **Dashboard grid** | `staggerChildren: 0.055` card entrance |
| **ServiceCard** | Hover lift + vivox border tint |
| **Sidebar** | Spring width `64↔256`, logo hover rotate, nav stagger |
| **Toaster** | Spring slide from right, `popLayout` |
| **Dropdowns** | Scale + `y` (account menu, notification bell) |
| **NodeSetupPanel** | Backdrop fade + panel spring |
| **Login/register** | Field stagger `0.08s` |
| **Summary cards** | `useSpring` animated numbers |
| **Delete confirm** | Pulsing red border + shake |
| **Schedule rows** | Collapse-out on delete |

### Input focus

Global rule applies `animate-input-glow` and `border-color: rgba(229, 24, 27, 0.5)` on focus. Auth fields use floating labels with `peer-focus:text-vivox-400`.

### Reduced motion

`prefers-reduced-motion: reduce` collapses all animation durations to ~0ms in `globals.css`.

---

## App shell layout

```
┌──────────────────────────────────────────────────────────────────┐
│  SIDEBAR (spring width)    │  TOP BAR (sticky, h-16)              │
│  VivoxLogo + wordmark      │  search · ws · bell · theme · user   │
│  staggered nav             ├──────────────────────────────────────┤
│  Deploy CTA (actionType)   │  MAIN max-w-7xl                      │
│  collapse chevron rotate   │  PageTransition (AnimatePresence)    │
└────────────────────────────┴──────────────────────────────────────┘
```

---

## Typography

| Role | Font |
|------|------|
| UI | Inter (`--font-sans`) |
| Data | JetBrains Mono (`--font-mono`) |
| Page title | `text-2xl font-semibold tracking-tight text-zinc-100` |
| Section label | `text-xs uppercase tracking-wider text-zinc-500` |

---

## Components

### Buttons (`ui/button.tsx`)

| Variant | Style |
|---------|-------|
| primary | `bg-vivox-500 hover:bg-vivox-600 shadow-vivox-500/20` |
| secondary | `bg-zinc-800` |
| ghost | `hover:bg-[#1f1f23]` |
| danger | `bg-red-500/10` + `hover:animate-glow-danger` |
| outline | `border-zinc-800` |

### Cards

```
rounded-xl border border-zinc-800 bg-zinc-900 p-5
```

Service cards: motion hover `y: -2`, border `rgba(229,24,27,0.25)`, animated metric bars.

### Status badges

Spring mount `scale 0.8→1`. Colors via `--status-*` CSS variables.

### Toasts

Bottom-right, variant tints. Info uses `border-vivox-500/25 bg-vivox-500/10`.

---

## Service status colors

| Status | Color | Animation |
|--------|-------|-----------|
| PROVISIONING | Amber | Spinner |
| STARTING | Teal | Pulse |
| RUNNING | Emerald | — |
| STOPPING | Orange | Pulse |
| STOPPED | Zinc | — |
| CRASHED | Red | — |

---

## Page-specific notes

### Dashboard
- Grid/list toggle (`vivox-view`)
- Staggered service card grid
- `AnimatedNumber` summary cards (running, stopped, RAM)

### Service detail
- Tab bar underline: `bg-vivox-500`
- Direction-aware tab content transitions
- Settings danger zone: glow + shake on confirm

### Deploy wizard
- Animated stepper circles (`#e5181b` fill when complete)
- Final deploy button: `actionType="deploy"`

### Auth
- `VivoxLogo` size 52
- Floating labels on fields
- Staggered form entrance

---

## File reference

| Concern | Path |
|---------|------|
| Design tokens | `apps/web/src/app/globals.css` |
| Tailwind theme | `apps/web/tailwind.config.ts` |
| Logo | `apps/web/src/components/vivox-logo.tsx` |
| Buttons + actionType | `apps/web/src/components/ui/button.tsx` |
| Page transitions | `apps/web/src/components/page-transition.tsx` |
| Theme cookie | `vivox-theme` in `theme-provider.tsx` |

---

## Quick recipes

**Primary CTA:**
```html
<button class="inline-flex h-10 items-center gap-2 rounded-lg bg-vivox-500 px-4 text-sm font-medium text-white shadow-sm shadow-vivox-500/20">
  Action
</button>
```

**Accent link:**
```html
<a class="text-vivox-400 hover:underline">Link</a>
```

**Panel:**
```html
<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-5">...</div>
```

---

*Last updated: Sprint 10 — Vivox rebrand, red accent, comprehensive animation system.*
