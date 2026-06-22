import { createHash } from 'node:crypto';
import { DATASET_ID } from './safety.mjs';

/**
 * Deterministic, namespaced ID derivation for demo data.
 *
 * Every synthetic row gets a UUID derived from (DATASET_ID, tenant, kind, key).
 * Re-running the generator with the same inputs yields the SAME UUIDs, which is
 * how idempotency is achieved: an insert with a deterministic PK either already
 * exists (skip) or is created once. No randomness, so two seeds are identical.
 */

/** RFC-4122-shaped v5-style UUID from a name, using SHA-1 (namespaced). */
export function deterministicUuid(...parts) {
  const name = [DATASET_ID, ...parts].join('|');
  const hash = createHash('sha1').update(name).digest('hex');
  // Take 32 hex chars, set version (5) + variant bits for a valid UUID shape.
  const b = hash.slice(0, 32).split('');
  b[12] = '5';
  // variant 10xx
  const variantNibble = (parseInt(b[16], 16) & 0x3) | 0x8;
  b[16] = variantNibble.toString(16);
  const s = b.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Deterministic external reference string for ledger traceability. */
export function externalRef(kind, key) {
  return `${DATASET_ID}:${kind}:${key}`;
}

/** Stable, reserved-looking but valid E.164 fake phone block (documented fake). */
export function fakePhone(n) {
  // +91 9999 9XXXXX — reserved test block, recorded in the ledger as synthetic.
  const suffix = String(100000 + (n % 900000)).slice(0, 6);
  return `+9199999${suffix}`;
}

/** Deterministic run_id for a dataset version (so re-seeds reuse the run). */
export function runIdFor(tenantId, datasetVersion) {
  return `${datasetVersion}:${tenantId}`;
}
