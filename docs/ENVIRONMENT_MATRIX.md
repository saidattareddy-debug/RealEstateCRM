# Environment Matrix

Each environment uses **its own** Supabase project, database, auth config, secrets, widget
credentials, public URL, logging destination, and retention config. **Production secrets must
never equal staging/local/CI secrets.** Service-role keys are **server-only**; no secret may be
exposed through a `NEXT_PUBLIC_*` variable. Production startup **fails clearly** when required
config is absent (`getServerEnv` → `assertDeploymentReady`).

| Variable                              | Local                 | CI                    | Staging          | Production     | Browser-visible? | Secret? | Required (prod)?           |
| ------------------------------------- | --------------------- | --------------------- | ---------------- | -------------- | ---------------- | ------- | -------------------------- |
| `APP_ENV`                             | local                 | local                 | staging          | production     | no               | no      | yes                        |
| `DEPLOYMENT_PROFILE`                  | controlled_mvp        | controlled_mvp        | controlled_mvp   | controlled_mvp | no               | no      | yes                        |
| `NEXT_PUBLIC_SUPABASE_URL`            | local proj            | local proj            | staging proj     | prod proj      | **yes**          | no      | yes                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | local                 | local                 | staging          | prod           | **yes**          | no      | yes                        |
| `SUPABASE_SERVICE_ROLE_KEY`           | local                 | local                 | staging          | prod           | **no**           | **yes** | yes                        |
| `NEXT_PUBLIC_APP_URL`                 | http://localhost:3000 | http://localhost:3000 | https://staging… | https://app…   | **yes**          | no      | yes (https, non-localhost) |
| Auth redirect / callback URL          | localhost             | localhost             | staging URL      | prod URL       | n/a              | no      | yes                        |
| Cookie domain                         | localhost             | localhost             | staging host     | prod host      | n/a              | no      | yes                        |
| `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED` | false                 | false                 | false            | **false**      | no               | no      | must be false              |
| `LIVE_SEND_MASTER_SWITCH`             | false                 | false                 | false            | **false**      | no               | no      | must be false              |
| `RESPONDER_LIVE_SENDING`              | false                 | false                 | false            | **false**      | no               | no      | must be false              |
| `BINARY_MEDIA_RETRIEVAL_ENABLED`      | false                 | false                 | false            | **false**      | no               | no      | must be false              |
| Website-widget public URL             | localhost             | —                     | staging URL      | prod URL       | **yes**          | no      | yes                        |
| `SESSION_SIGNING_SECRET`              | dev value             | dev value             | staging          | prod           | **no**           | **yes** | yes                        |
| HMAC / webhook secrets (per conn)     | n/a (mock)            | n/a                   | n/a (disabled)   | n/a (disabled) | **no**           | **yes** | only in 7B                 |
| Encryption-key references             | n/a                   | n/a                   | n/a              | n/a (7B)       | **no**           | **yes** | only if used               |
| `SENTRY_DSN` (error monitoring)       | optional              | optional              | recommended      | **required**   | no               | partial | yes                        |
| Logging destination                   | stdout                | stdout                | staging sink     | prod sink      | no               | no      | yes                        |
| Uptime health-check token (if used)   | n/a                   | n/a                   | staging          | prod           | no               | **yes** | optional                   |
| Data-retention settings               | defaults              | defaults              | configured       | configured     | no               | no      | yes (documented)           |
| Rate-limit settings                   | dev                   | dev                   | staging          | tuned          | no               | no      | yes                        |

**Rules enforced in code** (`packages/config/src/env.ts`, 11 unit tests):

- Production requires `SENTRY_DSN`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SIGNING_SECRET`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and an https non-localhost `NEXT_PUBLIC_APP_URL`.
- `controlled_mvp` production rejects `INTEGRATION_PUBLIC_WEBHOOKS_ENABLED=true`,
  `LIVE_SEND_MASTER_SWITCH=true`, `RESPONDER_LIVE_SENDING=true`, `BINARY_MEDIA_RETRIEVAL_ENABLED=true`.
- Any server secret found inside a `NEXT_PUBLIC_*` value fails startup.
- Disabled external integrations require **no** provider credentials (they are inert in 7A).
