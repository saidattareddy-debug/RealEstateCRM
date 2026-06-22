# Audit Logging

Added in **Phase 1.1**. Application-level audit trail and security-event tracking. Complements (does not replace) Supabase Auth's internal logs. Authoritative spec references: [`MASTER_SPEC.md`](./MASTER_SPEC.md) §28, §32; [`SECURITY.md`](./SECURITY.md).

---

## 1. Goals

- Immutable, queryable record of **security-sensitive** actions per tenant.
- Tenant admins can **read** their tenant's audit trail (with `settings.audit.read`) but can never edit or delete it.
- **No secrets** (passwords, tokens, provider secrets) ever land in audit records — redacted at the service boundary.
- A **single typed catalogue** of actions; no arbitrary audit strings scattered through the app.
- Platform access to tenant audit data follows the audited impersonation model — **no silent access**.

## 2. Schema (migration `0005_audit_logging.sql`)

### Enums

- `audit_event_category`: `auth, tenant, access_control, configuration, data_export, integration, impersonation, abuse`.
- `security_event_severity`: `info, low, medium, high, critical`.
- `security_event_status`: `open, investigating, resolved, ignored`.

### `audit_actions` (catalogue)

`key` (PK), `category`, `description`, `is_security`. Seeded from the catalogue; `audit_logs.action` is FK-constrained to it so unknown actions cannot be written. Mirrors `packages/validation/src/audit.ts`.

### `audit_logs` (append-only)

`id, tenant_id (null = platform-scope), actor_user_id, actor_membership_id, actor_role, action (FK), entity_type, entity_id, previous_values jsonb, new_values jsonb, metadata jsonb, ip_address inet, user_agent, request_id, correlation_id, created_at`. Indexes: `(tenant_id, created_at desc)`, `(action)`, `(actor_user_id)`, `(entity_type, entity_id)`, `(correlation_id)`.

### `security_events` (deduplicated, resolvable)

`id, tenant_id, action (FK), category, severity, status, actor_user_id, entity_type, entity_id, metadata, resolved_by, resolution_notes, first_detected_at, last_detected_at, occurrence_count, created_at`. Indexes: `(tenant_id, status, severity)`, `(category)`, dedupe `(tenant_id, action, entity_type, entity_id, status)`.

### Retention

`tenant_settings.audit_retention_days` (default 365, configurable; enforced by a future scheduled cleanup job).

## 3. RLS

- `audit_actions`: read-only to any authenticated user (static reference).
- `audit_logs`: **SELECT** for tenant members with `settings.audit.read` in their active tenant **only**; platform admin sees **only** platform-scope rows (`tenant_id null`). **No INSERT/UPDATE/DELETE policies** → append-only and immutable for tenant users. Writes are performed exclusively by the service-role audit service.
- `security_events`: **SELECT** for tenant members with `settings.security.manage` (platform admin: platform-scope only); **UPDATE** (resolution fields) with `settings.security.manage`; never deleted.

These properties are verified by `supabase/tests/0002_rls_full_coverage_test.sql` and the local harness (append-only UPDATE/DELETE = 0 rows; member-without-permission sees 0; super-admin sees 0 tenant rows).

## 4. Server services (`apps/web/src/lib/audit/`)

- `audit-service.ts` — `writeAudit(input)` (service-role client; the **only** writer). Redacts sensitive keys via `redactSensitive` before storage, captures IP/user-agent/request+correlation IDs, and — when the action's catalogue entry has `is_security: true` — upserts a deduplicated `security_event` (`recordSecurityEvent`). Audit failures are logged, never thrown into the caller's path.
- `audit-query.ts` — `listAuditLogs(filters)` using the RLS-enforced session client (filters: action, category, actor, entity type, date range).
- `request-context.ts` — extracts `ip / user_agent / request_id / correlation_id` from request headers.

## 5. Typed catalogue (`packages/validation/src/audit.ts`)

`AUDIT_ACTIONS` is the source of truth (mirrored by the DB seed). Each entry: `{ key, category, description, security }`. Helpers: `AUDIT_ACTION_KEYS`, `isAuditActionKey`, `AUDIT_CATEGORIES`, `SECURITY_SEVERITIES`, `SECURITY_STATUSES`, and `redactSensitive` (recursive, case-insensitive key redaction). Unit-tested in `packages/validation/src/__tests__/audit.test.ts`.

## 6. Wired events (Phase 1.1)

| Action key                                                                                                                                          | Where                       | Status                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `auth.sign_in.success` / `auth.sign_in.failure`                                                                                                     | `(auth)/actions.ts`         | ✅ wired                                                                                                      |
| `auth.sign_out`                                                                                                                                     | `(auth)/actions.ts`         | ✅ wired                                                                                                      |
| `tenant.switch` / `tenant.switch.denied`                                                                                                            | `(app)/actions.ts`          | ✅ wired                                                                                                      |
| `settings.branding.update`                                                                                                                          | `(app)/settings/actions.ts` | ✅ wired                                                                                                      |
| `settings.org.update`                                                                                                                               | `(app)/settings/actions.ts` | ✅ wired                                                                                                      |
| `invitation.create`                                                                                                                                 | `(app)/team/actions.ts`     | ✅ wired                                                                                                      |
| `membership.role_change`, `permission.override`, `invitation.accept`, `impersonation.start/end`, `data.export.request`, `integration.config.change` | catalogue + service ready   | ⏳ emitted when their flows ship (Phase 2+); not reachable in Phase 1.1 because those flows are not built yet |

Sign-in failure also raises a `security_event` (category `auth`, severity `medium`); tenant-switch-denied raises an `access_control` event.

## 7. Admin UI

`/audit` (route, `settings.audit.read`): filter bar (category, action, entity type, date range — GET form, server-rendered), table, and a client-side **event-detail drawer** showing the full record incl. previous/new values, metadata, IP, user-agent, request/correlation IDs. No raw secrets are present (redacted at write time).

## 8. What is never stored

Raw passwords, password hashes, auth tokens, provider secrets/API keys, `Authorization` headers, client secrets — stripped by `redactSensitive` (keys matched case-insensitively). Sign-in records store the **email only**, never the password.
