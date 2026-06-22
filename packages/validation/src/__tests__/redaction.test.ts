import { describe, it, expect } from 'vitest';
import {
  redactTokens,
  redactPhone,
  redactEmail,
  redactHeaders,
  redactUrlCredentials,
  redactProviderError,
} from '../redaction';

describe('log redaction', () => {
  it('redacts token-shaped secrets in free text', () => {
    expect(redactTokens('Bearer abcdef0123456789')).toBe('[redacted]');
    expect(redactTokens('key sk-' + 'a'.repeat(20))).toContain('[redacted]');
    expect(redactTokens('hello world')).toBe('hello world');
  });

  it('masks phone numbers to the last 4 digits', () => {
    expect(redactPhone('+919876540001')).toMatch(/^•+0001$/);
    expect(redactPhone('+91 98765 40001')).not.toContain('9876');
  });

  it('masks emails to first char + domain', () => {
    expect(redactEmail('asha@example.com')).toBe('a•••@example.com');
    expect(redactEmail('asha@example.com')).not.toContain('sha');
  });

  it('redacts sensitive headers (authorization, cookie, signature)', () => {
    const r = redactHeaders({
      authorization: 'Bearer secret-token',
      cookie: 'sid=abc',
      'x-hub-signature-256': 'sha256=deadbeef',
      'content-type': 'application/json',
    });
    expect(r.authorization).toBe('[redacted]');
    expect(r.cookie).toBe('[redacted]');
    expect(r['x-hub-signature-256']).toBe('[redacted]');
    expect(r['content-type']).toBe('application/json');
  });

  it('strips credentials and secret query params from URLs', () => {
    expect(redactUrlCredentials('https://user:pass@api.example.com/x')).not.toContain('pass');
    const r = redactUrlCredentials('https://api.example.com/cb?access_token=abc123&id=5');
    expect(decodeURIComponent(r)).toContain('[redacted]');
    expect(r).not.toContain('abc123');
    expect(r).toContain('id=5');
  });

  it('reduces a provider error to a safe {code,message} with tokens stripped', () => {
    const r = redactProviderError({
      code: 'E_RATE',
      message: 'failed Bearer abcdef0123456789',
      extra: 'x',
    });
    expect(r.code).toBe('E_RATE');
    expect(r.message).toContain('[redacted]');
    expect(JSON.stringify(r)).not.toContain('abcdef0123456789');
    expect(JSON.stringify(r)).not.toContain('extra');
  });
});
