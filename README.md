# White-Label AI Real-Estate Sales Platform

A multi-tenant, white-labelled **AI lead qualification, scoring and sales automation** platform built exclusively for real-estate sales. It ingests leads from every source, converses with buyers on WhatsApp and website chat in their own language, answers only from approved project data, qualifies and scores leads with an explainable engine, matches buyers to available units, assigns agents, follows up until a site visit is booked, and gives managers a complete operational picture — all from one codebase an agency can sell to many clients.

> **Status: Phase 0 (Architecture & Documentation).** No application code yet. This phase produced the authoritative documentation set in [`/docs`](./docs). Implementation begins at Phase 1 per [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md).

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

## Stack (planned)

Next.js App Router · React · TypeScript (strict) · pnpm · Tailwind · shadcn/ui · Radix · TanStack Table/Query · React Hook Form · Zod · Recharts · next-intl — on **Supabase** (Postgres + RLS + Auth + Storage + Realtime + Edge Functions + PGMQ + pgvector + FTS), with a provider-neutral **AI** layer (Anthropic / OpenAI / Gemini). Hosted on **Vercel**. Versions are pinned in Phase 1.

## Repository layout (target)

```text
apps/web            Next.js application
packages/           ui · domain · validation · ai · integrations · analytics · config
supabase/           migrations · seed · functions · tests
docs/               documentation (this phase)
```

## Getting started

Local development setup, environment variables, migrations, and seeding will be documented here and in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) once the Phase 1 scaffold lands.
