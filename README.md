# White-Label AI Real-Estate Sales Platform

A multi-tenant, white-labelled **AI lead qualification, scoring and sales automation** platform built exclusively for real-estate sales. It ingests leads from every source, converses with buyers on WhatsApp and website chat in their own language, answers only from approved project data, qualifies and scores leads with an explainable engine, matches buyers to available units, assigns agents, follows up until a site visit is booked, and gives managers a complete operational picture — all from one codebase an agency can sell to many clients.

> **Status:** Phases 0–10 are implemented and locally verified. The repo can produce a repeatable release candidate, but hosted staging sign-off is still required before production approval. See [`docs/BUILD_STATUS.md`](./docs/BUILD_STATUS.md) and [`docs/CONTROLLED_MVP_DEPLOYMENT_AUDIT.md`](./docs/CONTROLLED_MVP_DEPLOYMENT_AUDIT.md).

## Documentation

Start with [`docs/MASTER_SPEC.md`](./docs/MASTER_SPEC.md) (authoritative), then:

| Area                             | Doc                                                            |
| -------------------------------- | -------------------------------------------------------------- |
| Product requirements             | [`docs/PRD.md`](./docs/PRD.md)                                 |
| System architecture (+ diagrams) | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)               |
| Database model (+ ERD)           | [`docs/DATABASE.md`](./docs/DATABASE.md)                       |
| Security & RLS                   | [`docs/SECURITY.md`](./docs/SECURITY.md)                       |
| Permissions matrix               | [`docs/PERMISSIONS_MATRIX.md`](./docs/PERMISSIONS_MATRIX.md)   |
| AI system & RAG                  | [`docs/AI_SYSTEM.md`](./docs/AI_SYSTEM.md)                     |
| Scoring & matching               | [`docs/SCORING_ENGINE.md`](./docs/SCORING_ENGINE.md)           |
| Integrations                     | [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md)               |
| UI & design system               | [`docs/UI_SYSTEM.md`](./docs/UI_SYSTEM.md)                     |
| Page map                         | [`docs/PAGE_MAP.md`](./docs/PAGE_MAP.md)                       |
| API map                          | [`docs/API_MAP.md`](./docs/API_MAP.md)                         |
| Test plan                        | [`docs/TEST_PLAN.md`](./docs/TEST_PLAN.md)                     |
| Deployment                       | [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)                   |
| Contradictions resolved          | [`docs/CONTRADICTIONS.md`](./docs/CONTRADICTIONS.md)           |
| Assumptions & defaults           | [`docs/ASSUMPTIONS.md`](./docs/ASSUMPTIONS.md)                 |
| Risk register                    | [`docs/RISKS.md`](./docs/RISKS.md)                             |
| Implementation plan              | [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) |
| Build status                     | [`docs/BUILD_STATUS.md`](./docs/BUILD_STATUS.md)               |

Working rules for contributors/agents: [`CLAUDE.md`](./CLAUDE.md).

## Stack

Next.js App Router · React · TypeScript (strict) · pnpm · Tailwind · shadcn/ui · Radix · TanStack Table/Query · React Hook Form · Zod · Recharts · next-intl — on **Supabase** (Postgres + RLS + Auth + Storage + Realtime + Edge Functions + PGMQ + pgvector + FTS), with a provider-neutral **AI** layer (Anthropic / OpenAI / Gemini). Hosted on **Vercel**. Versions are pinned in Phase 1.

## Repository layout

```text
apps/web            Next.js application
packages/           ui · domain · validation · ai · integrations · analytics · config
supabase/           migrations · seed · functions · tests
docs/               documentation (this phase)
```

## Getting started

1. `pnpm install`
2. Copy `.env.example` to `.env.local` and fill the local values
3. `supabase start`
4. `supabase db reset`
5. `pnpm dev`

The repo-root `pnpm dev` and demo CLI commands auto-load the repo-root `.env.local`.

## Production readiness

- Repo-side release gate: `pnpm verify:release-candidate`
- Environment contract: [`docs/ENVIRONMENT_MATRIX.md`](./docs/ENVIRONMENT_MATRIX.md)
- Hosted staging execution: [`docs/HOSTED_STAGING_RUNBOOK.md`](./docs/HOSTED_STAGING_RUNBOOK.md)
- Deployment and rollback guidance: [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)
