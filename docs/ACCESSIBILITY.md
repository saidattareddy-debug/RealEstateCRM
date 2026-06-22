# Accessibility (Phase 10)

The accessibility posture of the web app and the pass performed during Phase 10
hardening. The app targets WCAG 2.1 AA for the core operator workflows.

## Foundations (in place across the build)

- **Semantic HTML** — pages use `header`/`nav`/`main`/`section`, real `button` and
  `a` elements (server actions via `<form action>`), `dl`/`dt`/`dd` for key-value
  detail, and `table`/`th` for tabular data (analytics, usage, runs).
- **Labels** — every form control has an associated `label` (`htmlFor`/`id`) or an
  accessible name; selects and inputs in the automations/visits/activation/usage
  forms are labelled.
- **Focus visibility** — interactive elements use a `focus-visible` outline (the
  design system sets a visible focus ring; the sidebar nav items have an explicit
  focus-visible outline).
- **Color & contrast** — colors come from the design-token set
  (`packages/ui/src/tokens.css`) with light/dark variants; text uses
  `text-primary`/`text-secondary` against `surface`/`surface-elevated`, and status
  uses `success`/`warning`/`terracotta` rather than color alone (paired with text
  labels, e.g. "ACTIVE", "suppressed (not sent)", "blocked").
- **Keyboard** — all primary actions are reachable via standard tab order; controls
  are native elements (no div-buttons), so Enter/Space activation works.
- **State, not just color** — empty/loading/error/permission-denied states are
  text-based reusable components (`@/components/ui/states`), not color-only signals.
- **Mobile** — responsive layouts + a mobile bottom nav with safe-area handling and
  a11y attributes (Phase 1.1); KPI grids scroll horizontally on small screens.

## Phase 10 pass

- Verified new Phase 8/9 surfaces (automations, sequences, visits, notifications,
  analytics, usage, system-health) use labelled controls, native buttons, table
  semantics, and token-based contrast — consistent with the foundations above.
- Status meanings are always conveyed with text in addition to color (e.g. the
  responder/automation "suppressed", health "down/degraded", usage "over limit").

## Deferrals (`TECH_DEBT.md`)

A full automated axe-core / screen-reader sweep and a documented keyboard-trap audit
across every route are deferred to the hosted-staging browser pass (the in-sandbox
build cannot run a real browser). The Playwright skeleton (`test:e2e:compile`) is the
hook for those checks once staging is provisioned.
