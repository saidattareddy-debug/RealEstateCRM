#!/usr/bin/env node
/**
 * Lightweight secret scan:
 *  1. The built CLIENT bundle (.next/static) must not contain the service-role
 *     key, its env-var name, or any private-key/JWT material.
 *  2. Tracked source must not contain private-key blocks.
 * Exits non-zero on any finding. No external dependencies.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath as toPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(toPath(new URL('..', import.meta.url)));
const findings = [];

function walk(dir, onFile, skip = []) {
  for (const name of readdirSync(dir)) {
    if (skip.includes(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, onFile, skip);
    else onFile(full);
  }
}

// --- 1. Client bundle ---
const staticDir = path.join(root, 'apps/web/.next/static');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Built dynamically so this scanner file does not match itself.
const PRIVATE_KEY_NEEDLE = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');

if (existsSync(staticDir)) {
  walk(staticDir, (file) => {
    const txt = readFileSync(file, 'utf8');
    if (txt.includes('SUPABASE_SERVICE_ROLE_KEY'))
      findings.push(`client bundle references SUPABASE_SERVICE_ROLE_KEY: ${file}`);
    if (serviceKey && serviceKey.length > 12 && txt.includes(serviceKey))
      findings.push(`client bundle contains the service-role key value: ${file}`);
    if (txt.includes(PRIVATE_KEY_NEEDLE))
      findings.push(`client bundle contains a private key: ${file}`);
  });
} else {
  console.warn('• .next/static not found — run after build for full client-bundle scan.');
}

// --- 2. Tracked source (private-key blocks) ---
const skip = ['node_modules', '.git', '.next', 'dist', 'coverage', '.pnpm-store'];
walk(
  root,
  (file) => {
    if (!/\.(ts|tsx|js|mjs|json|sql|env|example|yml|yaml|md)$/.test(file)) return;
    if (file.endsWith('.env.example')) return; // documented template, no real secrets
    if (file.endsWith('secret-scan.mjs')) return; // the scanner itself
    const txt = readFileSync(file, 'utf8');
    const rsa = ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ');
    if (txt.includes(PRIVATE_KEY_NEEDLE) || txt.includes(rsa))
      findings.push(`private key block in source: ${path.relative(root, file)}`);
  },
  skip,
);

// --- 3. Provider token / credential patterns (Phase 7A) ---
// Real provider credentials must never appear in source/tests/fixtures/docs/
// migrations/seed. We match TOKEN-SHAPED QUOTED LITERALS so regex patterns in
// the redaction source (which are not real tokens) are not false-positives.
const TOKEN_PATTERNS = [
  { re: /['"`]EAA[A-Za-z0-9]{24,}['"`]/, label: 'Meta/WhatsApp access token' },
  { re: /['"`]ya29\.[A-Za-z0-9._-]{24,}['"`]/, label: 'Google OAuth access token' },
  { re: /['"`]1\/\/[A-Za-z0-9._-]{24,}['"`]/, label: 'Google refresh token' },
  { re: /['"`]AIza[A-Za-z0-9_-]{30,}['"`]/, label: 'Google API key' },
  { re: /['"`]sk-[A-Za-z0-9]{24,}['"`]/, label: 'OpenAI-style secret key' },
  { re: /['"`]GOCSPX-[A-Za-z0-9_-]{16,}['"`]/, label: 'Google OAuth client secret' },
  { re: /['"`]xox[baprs]-[A-Za-z0-9-]{16,}['"`]/, label: 'Slack token' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key block' },
  {
    re: /Authorization['"`]?\s*[:=]\s*['"`]Bearer\s+[A-Za-z0-9._-]{20,}['"`]/i,
    label: 'hardcoded Bearer auth header',
  },
];
// Files that legitimately CONTAIN token-shaped patterns as redaction regexes or
// as deliberately-fake fixtures — excluded from the token scan.
const TOKEN_SCAN_SKIP = [
  'packages/domain/src/integrations.ts', // redactSecrets() regex patterns
  'packages/domain/src/__tests__/integrations.test.ts', // constructs 'EAA'+'x'.repeat(30)
  'packages/validation/src/normalized-payload.ts', // secret-detection regex patterns
  'packages/validation/src/__tests__/normalized-payload.test.ts', // secret-bearing fixtures for rejection tests
  'scripts/secret-scan.mjs',
];
walk(
  root,
  (file) => {
    const rel = path.relative(root, file);
    if (!/\.(ts|tsx|js|mjs|json|sql|md|yml|yaml)$/.test(file)) return;
    if (rel.endsWith('.env.example')) return;
    if (TOKEN_SCAN_SKIP.includes(rel)) return;
    const txt = readFileSync(file, 'utf8');
    for (const { re, label } of TOKEN_PATTERNS) {
      const m = txt.match(re);
      if (m) findings.push(`${label} in ${rel}: ${m[0].slice(0, 24)}…`);
    }
  },
  skip,
);

if (findings.length > 0) {
  console.error('✖ Secret scan found issues:');
  for (const f of findings) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  '✔ Secret scan clean (no privileged keys, private keys, or provider tokens in source).',
);
process.exit(0);
