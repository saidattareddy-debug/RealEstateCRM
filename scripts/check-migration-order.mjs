#!/usr/bin/env node
/**
 * Validates that supabase/migrations are sequentially numbered (NNNN_*.sql)
 * with no gaps or duplicates — so a clean `supabase db reset` applies them in a
 * deterministic, reproducible order.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../supabase/migrations', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const nums = [];
for (const f of files) {
  const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f);
  if (!m) {
    console.error(`✖ Migration "${f}" does not match NNNN_snake_case.sql`);
    process.exit(1);
  }
  nums.push(Number(m[1]));
}

const seen = new Set();
for (let i = 0; i < nums.length; i++) {
  const n = nums[i];
  if (seen.has(n)) {
    console.error(`✖ Duplicate migration number ${String(n).padStart(4, '0')}`);
    process.exit(1);
  }
  seen.add(n);
  if (i > 0 && n !== nums[i - 1] + 1) {
    console.error(`✖ Gap in migration sequence near ${String(n).padStart(4, '0')}`);
    process.exit(1);
  }
}

console.log(`✔ ${files.length} migrations are sequential and well-formed: ${files.join(', ')}`);
process.exit(0);
