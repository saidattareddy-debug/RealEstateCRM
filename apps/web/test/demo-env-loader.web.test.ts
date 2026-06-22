import { describe, expect, it } from 'vitest';
import { loadLocalEnv, parseEnvText } from '../../../scripts/load-local-env.mjs';

describe('loadLocalEnv', () => {
  it('parses quoted values, trims inline comments, and keeps the first duplicate key', () => {
    const parsed = parseEnvText(`
NEXT_PUBLIC_SUPABASE_URL=https://real-project.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_real_value
EMBEDDINGS_PROVIDER=openai          # openai | gemini
ANTHROPIC_API_KEY= "quoted-value"
`) as Record<string, string>;

    expect(parsed.NEXT_PUBLIC_SUPABASE_URL).toBe('https://real-project.supabase.co');
    expect(parsed.SUPABASE_SERVICE_ROLE_KEY).toBe('sb_secret_real_value');
    expect(parsed.EMBEDDINGS_PROVIDER).toBe('openai');
    expect(parsed.ANTHROPIC_API_KEY).toBe('quoted-value');
  });

  it('does not overwrite explicitly provided environment variables', () => {
    const env = { APP_ENV: 'production' } as unknown as NodeJS.ProcessEnv;
    const loaded = loadLocalEnv({
      cwd: '/tmp/does-not-exist',
      env,
      files: ['missing.env'],
    });

    expect(loaded.env.APP_ENV).toBe('production');
    expect(loaded.loadedFiles).toEqual([]);
  });
});
