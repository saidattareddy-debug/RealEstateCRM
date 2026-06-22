#!/usr/bin/env node
/**
 * Forward-only migration PREFLIGHT for staging / production. READ-ONLY: it never
 * touches a database. It verifies the local migration set is sequential and that
 * the target environment is configured with the controlled-MVP safety gates
 * closed, then STOPS and prints the exact (separate) command an operator must run
 * to apply migrations. It never runs `supabase db reset`.
 *
 * Usage:  TARGET_ENV=staging node scripts/db-preflight.mjs
 *         TARGET_ENV=production node scripts/db-preflight.mjs
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIG_DIR = fileURLToPath(new URL('../supabase/migrations', import.meta.url));
const target = process.env.TARGET_ENV || 'staging';
const problems = [];
const notes = [];

if (!['staging', 'production'].includes(target)) {
  console.error(`TARGET_ENV must be 'staging' or 'production' (got '${target}')`);
  process.exit(2);
}

// 1) Migration sequence 0001..N, no gaps, no duplicate numbers.
const files = readdirSync(MIG_DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();
let expected = 1;
for (const f of files) {
  const n = Number(f.slice(0, 4));
  if (n !== expected)
    problems.push(
      `migration gap/out-of-order at ${f} (expected ${String(expected).padStart(4, '0')})`,
    );
  expected += 1;
}
const range = files.length
  ? `${files[0].slice(0, 4)}-${files[files.length - 1].slice(0, 4)}`
  : 'none';
notes.push(`migrations: ${files.length} files, range ${range}`);

// 2) Required environment variables for the target.
const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_APP_URL',
];
for (const k of required) if (!process.env[k]) problems.push(`missing required env: ${k}`);

// 3) Expected project reference (guards against pointing at the wrong project).
const expectedRef = process.env.EXPECTED_SUPABASE_PROJECT_REF;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1];
if (expectedRef && ref && expectedRef !== ref)
  problems.push(`Supabase project ref mismatch: env points at '${ref}', expected '${expectedRef}'`);
if (ref) notes.push(`supabase project ref: ${ref}`);

// 4) Controlled-MVP safety gates must stay closed.
const gateOn = (k) => process.env[k] === 'true';
if (process.env.DEPLOYMENT_PROFILE && process.env.DEPLOYMENT_PROFILE !== 'controlled_mvp')
  problems.push(
    `DEPLOYMENT_PROFILE must be controlled_mvp (got '${process.env.DEPLOYMENT_PROFILE}')`,
  );
if (gateOn('INTEGRATION_PUBLIC_WEBHOOKS_ENABLED'))
  problems.push('INTEGRATION_PUBLIC_WEBHOOKS_ENABLED must be false');
if (gateOn('LIVE_SEND_MASTER_SWITCH')) problems.push('LIVE_SEND_MASTER_SWITCH must be false');
if (gateOn('RESPONDER_LIVE_SENDING')) problems.push('RESPONDER_LIVE_SENDING must be false');

console.log(`\n=== DB preflight (${target}) — READ-ONLY, no changes applied ===`);
for (const n of notes) console.log(`  • ${n}`);
if (problems.length) {
  console.error('\nPREFLIGHT FAILED:');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('\nFix the above before applying migrations. No changes were made.');
  process.exit(1);
}
console.log('\nPREFLIGHT PASSED. To apply migrations (FORWARD-ONLY, run manually):');
console.log('  supabase link --project-ref <ref>   # safe for staging/production');
console.log('  supabase db push                    # forward-only; NEVER `supabase db reset`');
console.log('This script does not apply changes.');
