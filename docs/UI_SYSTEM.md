# UI & Design System

Derived from [`MASTER_SPEC.md`](./MASTER_SPEC.md) §24–26. A premium real-estate SaaS interface: the clarity and spacing of Linear, the CRM organisation of Attio, the pipeline usability of HubSpot, with a restrained premium real-estate identity. Not a clone of any of them. Built in `packages/ui` on shadcn/ui + Radix + Tailwind + Lucide.

---

## 1. Principles

- **Calm density.** Comfortable spacing, clear hierarchy — not the cramped developer-dashboard feel of the prototype.
- **Readability over decoration.** No tiny low-contrast text, no decorative charts, no excessive gradients/glassmorphism, no oversized empty voids.
- **Every screen has all four states.** Loading, error, empty, and permission-denied are designed, not afterthoughts.
- **Mobile is purpose-built**, not a shrunk desktop table.
- **White-label first.** All colour/logo/terminology come from tenant branding tokens at runtime.

## 2. Design tokens

### 2.1 Light theme (default)

| Token                | Value     | Use                        |
| -------------------- | --------- | -------------------------- |
| `--bg-app`           | `#F6F4EF` | application background     |
| `--surface`          | `#FFFFFF` | cards, panels              |
| `--surface-elevated` | `#FCFBF8` | raised surfaces            |
| `--text-primary`     | `#202522` | body/heading text          |
| `--text-secondary`   | `#66706A` | secondary text             |
| `--forest`           | `#274D3D` | primary brand/action       |
| `--forest-deep`      | `#18372B` | hover/active, deep accents |
| `--champagne`        | `#B79257` | accent/premium highlights  |
| `--terracotta`       | `#C95D4B` | alert/destructive          |
| `--success`          | `#2F7D5B` | success                    |
| `--warning`          | `#C38A2E` | warning                    |
| `--border`           | `#E4E1D9` | borders/dividers           |

### 2.2 Dark theme

A refined dark theme is provided. **No pure-black backgrounds** — use deep warm neutrals; maintain contrast ratios (§8 accessibility).

### 2.3 White-label override

Tenant `tenant_branding` overrides primary/secondary/accent at runtime via CSS variables; defaults above are the fallback. Platform branding is hidden when white-label mode is on.

### 2.4 Shape, elevation, motion

- Radius **12–16px** on surfaces; subtle 1px borders; minimal shadows.
- Restrained motion (Motion library) for transitions only — no gratuitous animation.

## 3. Typography

- **One clean sans-serif** for the entire operational interface (UI, tables, forms).
- **Optional elegant serif** only for project titles and selected marketing moments.
- **Max two font families.** Prioritize legibility.

## 4. Layout — desktop

- **Collapsible left navigation** with sections grouped by job (see [`PAGE_MAP.md`](./PAGE_MAP.md)).
- **Tenant + project switcher**, global **search / command palette** (⌘K), notifications, user menu, contextual page actions in the top bar.
- Content uses a responsive grid; tables via TanStack Table with saved/shareable views and bulk actions.

### Lead-detail layout (desktop)

- **Header:** identity, score + category, stage, project match, owner.
- **Main:** conversation + activity timeline.
- **Right context panel:** qualification completeness, score reasons, recommended actions.
- **Tabs:** preferences, matches, visits, notes, files, audit.

## 5. Layout — mobile (mandatory, first-class)

- **Bottom navigation:** Today · Inbox · Leads · Visits · More.
- **Lead pages** carry **sticky actions:** Call · WhatsApp · Add note · Update stage · Schedule visit.
- Use cards, drawers, sheets, and purpose-built layouts — **never** shrink desktop tables.
- **PWA-installable** where practical (offline shell, add-to-home-screen).

## 6. Core components (`packages/ui`)

Buttons, inputs/forms (React Hook Form + Zod), data table (TanStack), score badge + explanation popover, category pill (Hot/Warm/Cold/Disqualified), stage selector, pipeline Kanban card, conversation bubble + source-evidence panel, suggested-reply box, lead context panel, filters/saved-views bar, charts (Recharts) used only with purpose, toast/notification, command palette, empty/loading/error/permission-denied state primitives, drawers/sheets/dialogs (Radix), mobile bottom-nav + sticky action bar.

## 7. State & data fetching

- Server Components for initial render; TanStack Query for client-side server state (inbox, live filters).
- Supabase Realtime drives the inbox, notifications, and presence.
- Every list/detail view implements the four required states and respects permissions (a permission-denied view, not a blank screen).

## 8. Accessibility (tested — §31)

Keyboard navigation, visible focus states, proper labels, sufficient colour contrast (WCAG AA targets, verified for both themes), screen-reader landmarks, correct dialog/focus-trap behaviour, and adequate mobile touch-target sizes. Accessibility is part of the definition of done for every UI phase.

## 9. White-label & terminology

Dashboard/project/agent terminology is configurable per tenant and threaded through the component library via i18n keys (next-intl or equivalent) + tenant terminology overrides. Date/currency/number formats and timezone follow tenant settings.

## 10. Anti-patterns (explicitly disallowed)

Static placeholder pages, fake buttons, non-functional menus, hardcoded demo arrays, decorative charts without data meaning, pure-black dark theme, tiny low-contrast text, and shrunk desktop tables on mobile. Each major page must be backed by real data and real actions ([`MASTER_SPEC.md` §35]).
