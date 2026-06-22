#!/usr/bin/env node
/**
 * STAGING-ONLY performance baseline. Issues a small, conservative set of authenticated
 * GETs against key pages and records latency. NOT a load/stress test — sequential,
 * low volume. Refuses to run without acknowledgement and never targets production.
 *
 * Required: STAGING_ONLY_ACK=yes, STAGING_BASE_URL, STAGING_SESSION_COOKIE (server-only).
 * Output: docs/PERFORMANCE_BASELINE.result.json
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.STAGING_ONLY_ACK !== 'yes') {
  console.error('Refusing to run: set STAGING_ONLY_ACK=yes (staging only).');
  process.exit(2);
}
const base = process.env.STAGING_BASE_URL;
const cookie = process.env.STAGING_SESSION_COOKIE; // never hard-coded
if (!base || !cookie) {
  console.error('STAGING_BASE_URL and STAGING_SESSION_COOKIE are required.');
  process.exit(2);
}

const PAGES = [
  '/dashboard',
  '/leads',
  '/leads?view=detail-sample',
  '/pipeline',
  '/tasks',
  '/inbox',
  '/projects',
  '/inventory',
  '/scoring/test-lab',
  '/matching/test-lab',
  '/settings/audit-log',
  '/api/health',
];
const SAMPLES = Number(process.env.SAMPLES || 5); // conservative

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function main() {
  const out = [];
  for (const path of PAGES) {
    const times = [];
    let errors = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = Date.now();
      try {
        const res = await fetch(base + path, { headers: { cookie }, redirect: 'manual' });
        if (res.status >= 400) errors += 1;
      } catch {
        errors += 1;
      }
      times.push(Date.now() - t0);
    }
    out.push({
      path,
      samples: SAMPLES,
      median_ms: Math.round(pct(times, 50)),
      p95_ms: Math.round(pct(times, 95)),
      p99_ms: Math.round(pct(times, 99)),
      error_rate: errors / SAMPLES,
    });
    console.log(
      `${path}  median=${Math.round(pct(times, 50))}ms p95=${Math.round(pct(times, 95))}ms err=${errors}/${SAMPLES}`,
    );
  }
  const file = fileURLToPath(new URL('../docs/PERFORMANCE_BASELINE.result.json', import.meta.url));
  writeFileSync(
    file,
    JSON.stringify({ base, at: new Date().toISOString(), results: out }, null, 2),
  );
  console.log(
    '\nWrote docs/PERFORMANCE_BASELINE.result.json — set alert thresholds from these measured values.',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
