import { describe, it, expect } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_KEYS,
  AUDIT_CATEGORIES,
  isAuditActionKey,
  redactSensitive,
} from '../audit';

describe('audit catalogue', () => {
  it('has unique action keys', () => {
    expect(new Set(AUDIT_ACTION_KEYS).size).toBe(AUDIT_ACTION_KEYS.length);
  });

  it('every action has a valid category', () => {
    for (const def of Object.values(AUDIT_ACTIONS)) {
      expect(AUDIT_CATEGORIES).toContain(def.category);
    }
  });

  it('recognises catalogue keys and rejects arbitrary strings', () => {
    expect(isAuditActionKey('tenant.switch')).toBe(true);
    expect(isAuditActionKey('totally.made.up')).toBe(false);
  });

  it('flags the expected security-relevant actions', () => {
    expect(AUDIT_ACTIONS.SIGN_IN_FAILURE.security).toBe(true);
    expect(AUDIT_ACTIONS.IMPERSONATION_START.security).toBe(true);
    expect(AUDIT_ACTIONS.SIGN_IN_SUCCESS.security).toBe(false);
    expect(AUDIT_ACTIONS.TENANT_SWITCH.security).toBe(false);
  });
});

describe('redactSensitive', () => {
  it('redacts sensitive keys at any depth, case-insensitively', () => {
    const out = redactSensitive({
      email: 'a@b.com',
      password: 'hunter2',
      nested: { access_token: 'abc', Authorization: 'Bearer x', keep: 1 },
      list: [{ client_secret: 's' }],
    }) as Record<string, unknown>;

    expect(out.email).toBe('a@b.com');
    expect(out.password).toBe('[REDACTED]');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.access_token).toBe('[REDACTED]');
    expect(nested.Authorization).toBe('[REDACTED]');
    expect(nested.keep).toBe(1);
    expect((out.list as Record<string, unknown>[])[0]!.client_secret).toBe('[REDACTED]');
  });

  it('passes through primitives unchanged', () => {
    expect(redactSensitive('plain')).toBe('plain');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBe(null);
  });
});
