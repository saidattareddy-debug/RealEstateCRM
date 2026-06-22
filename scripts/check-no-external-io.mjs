#!/usr/bin/env node
/**
 * Phase 7A no-external-IO guard.
 *
 * Phase 7A is mock / simulation / record-only: it must never perform external
 * network IO to a provider. This scans the integration server surface for
 * network-capable calls or provider endpoints and fails the build if any appear.
 * Allowed: mock adapters, deterministic fixtures, the local DB, local jobs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps/web/src/lib/integrations', 'apps/web/src/app/api/integrations'];

// Network/provider patterns that must NOT appear in the integration surface.
const FORBIDDEN = [
  { re: /\bfetch\s*\(/, label: 'fetch(' },
  { re: /\baxios\b/, label: 'axios' },
  { re: /\bnodemailer\b/, label: 'nodemailer (SMTP)' },
  { re: /\bnode:net\b|\brequire\(['"]net['"]\)/, label: 'raw TCP (net)' },
  { re: /\bnode:tls\b/, label: 'TLS socket' },
  { re: /\bimapflow\b|\bnode-imap\b|\bimap\b/i, label: 'IMAP client' },
  { re: /graph\.facebook\.com|graph\.instagram\.com/i, label: 'Meta Graph API' },
  { re: /googleapis\.com|gmail\.googleapis|oauth2\.googleapis/i, label: 'Google API' },
  { re: /pubsub|PubSub/, label: 'Pub/Sub' },
  { re: /https?:\/\/(?!localhost|127\.0\.0\.1|example\.)/, label: 'external https URL' },
];

function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out = out.concat(walk(p));
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p);
  }
  return out;
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      // Ignore comments to reduce false positives on documentation.
      const code = line.replace(/\/\/.*$/, '');
      for (const { re, label } of FORBIDDEN) {
        if (re.test(code)) violations.push(`${file}:${i + 1}  ${label}  →  ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error('✖ Phase 7A no-external-IO guard FAILED — provider/network IO found:');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('✔ Phase 7A no-external-IO guard: no provider/network IO in the integration surface.');
