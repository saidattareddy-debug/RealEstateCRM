import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync } from 'node:fs';
import pg from 'pg';

/**
 * Boots an embedded PostgreSQL, applies the Supabase auth shim + migrations
 * 0001–0025 + seed (the same recipe as `supabase/tests/local-harness/run.mjs`),
 * and returns a `pg.Pool` connected as the DB owner (RLS bypassed — mirrors the
 * service-role admin client). Tests run the REAL canonical services against it.
 */

const MIGRATIONS = [
  '0001_extensions.sql',
  '0002_identity_tenancy.sql',
  '0003_auth_context.sql',
  '0004_roles_seed_and_rls.sql',
  '0005_audit_logging.sql',
  '0006_projects_inventory.sql',
  '0007_project_content.sql',
  '0008_leads_pipeline.sql',
  '0009_broker_overlap.sql',
  '0010_ingestion_idempotency_crm.sql',
  '0011_conversations.sql',
  '0012_inbox_completion.sql',
  '0013_inbox_wiring.sql',
  '0014_base_role_bundles.sql',
  '0015_visitor_read_state.sql',
  '0016_inbox_final_wiring.sql',
  '0017_knowledge_ai_foundation.sql',
  '0018_embedding_pgvector.sql',
  '0019_ai_responder.sql',
  '0020_responder_runtime_outbox.sql',
  '0021_lead_scoring.sql',
  '0022_project_matching.sql',
  '0023_matching_authorization_closeout.sql',
  '0024_integration_foundation.sql',
  '0025_external_event_envelopes.sql',
  '0026_callback_idempotency.sql',
];

export const SEED_TENANT_A = '11111111-1111-1111-1111-111111111111';
export const SEED_TENANT_B = '22222222-2222-2222-2222-222222222222';

export interface BootedPg {
  pool: pg.Pool;
  stop: () => Promise<void>;
}

export async function bootEmbeddedPg(opts?: { port?: number; dir?: string }): Promise<BootedPg> {
  const repo = new URL('../../../', import.meta.url).pathname;
  const mig = repo + 'supabase/migrations';
  const port = opts?.port ?? 5457;
  const dir = opts?.dir ?? '/tmp/pgtest/pgmsg';

  const engine = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  });
  await engine.initialise();
  await engine.start();
  await engine.createDatabase('app');

  const setup = new pg.Client({
    host: 'localhost',
    port,
    user: 'postgres',
    password: 'postgres',
    database: 'app',
  });
  await setup.connect();
  const q = (s: string) => setup.query(s);

  await q(`create role anon nologin noinherit;`);
  await q(`create role authenticated nologin noinherit nobypassrls;`);
  await q(`create schema auth;`);
  await q(
    `create table auth.users(instance_id uuid,id uuid primary key,aud text,role text,email text,encrypted_password text,email_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);`,
  );
  await q(
    `create or replace function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;`,
  );
  await q(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','')::uuid $$;`,
  );
  await q(
    `create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;`,
  );

  for (const f of MIGRATIONS) {
    let s = readFileSync(`${mig}/${f}`, 'utf8');
    if (f === '0001_extensions.sql')
      s = s.replace(/create extension if not exists vector[^;]*;/, '-- vector skipped');
    await q(s);
  }
  await q(`grant usage on schema public,auth,extensions to authenticated,anon;`);
  await q(`grant all on all tables in schema public to authenticated;`);
  await q(`grant execute on all functions in schema public,auth to authenticated,anon;`);
  await q(readFileSync(`${repo}supabase/seed/seed.sql`, 'utf8'));
  await setup.end();

  const pool = new pg.Pool({
    host: 'localhost',
    port,
    user: 'postgres',
    password: 'postgres',
    database: 'app',
    max: 4,
  });

  return {
    pool,
    stop: async () => {
      await pool.end();
      await engine.stop();
    },
  };
}
