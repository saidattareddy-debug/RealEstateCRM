#!/usr/bin/env node
/**
 * Phase 1.1 final gate. The official Supabase verification (supabase start /
 * db reset / test db) MUST be run on a Docker-capable environment and its
 * result recorded in supabase/.official-verification.json. Until then this
 * gate FAILS, so the milestone cannot be marked green on an unverified DB.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../supabase/.official-verification.json', import.meta.url));

let marker;
try {
  marker = JSON.parse(readFileSync(path, 'utf8'));
} catch {
  console.error('✖ Missing supabase/.official-verification.json');
  process.exit(1);
}

const required = [
  'official_supabase_passed',
  'migrations_applied_from_clean_db',
  'pgvector_available',
  'seed_applied',
  'pgtap_passed',
];
const failures = required.filter((k) => marker[k] !== true);

if (failures.length > 0) {
  console.error('✖ Official Supabase verification is NOT recorded as passing.');
  console.error('  Unsatisfied:', failures.join(', '));
  console.error('\n  Run this on a machine with Docker + the Supabase CLI:\n');
  console.error('    supabase start');
  console.error('    supabase db reset      # applies migrations 0001..0005 + seed from clean DB');
  console.error('    supabase test db       # runs pgTAP RLS suite\n');
  console.error('  Then set the corresponding fields to true (with recorded_at / pgtap_total)');
  console.error('  in supabase/.official-verification.json and commit it.');
  process.exit(1);
}

console.log(
  `✔ Official Supabase verification recorded (pgtap_total=${marker.pgtap_total ?? '?'}, at ${marker.recorded_at}).`,
);
process.exit(0);
