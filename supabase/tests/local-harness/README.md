# Local RLS harness (developer convenience — NOT authoritative)

`run.mjs` boots an **embedded PostgreSQL**, stubs the Supabase `auth` schema
(`auth.users`, `auth.uid()`, `auth.jwt()`, `auth.role()`), applies migrations
`0001`–`0005` from a clean database (pgvector's `create extension` line is
skipped because the embedded build lacks it), applies the seed, and runs the
full tenant-isolation assertion set as the non-superuser `authenticated` role.

It exists so RLS can be exercised on machines without Docker. **It is not a
migration and not the official test.** The authoritative database verification
is `supabase test db` (pgTAP, see `../0001_*` and `../0002_*`), run in CI on a
Docker-capable runner. No migration depends on this harness.

## Run

```bash
cd supabase/tests/local-harness
npm install embedded-postgres pg
node run.mjs            # exits non-zero on any failed assertion
```

Last local result: **56 passed, 0 failed** (2026-06-19).
