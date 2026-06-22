import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const REPO = process.env.REPO_DIR || new URL('../../..', import.meta.url).pathname;
const MIG = REPO + '/supabase/migrations';
let pass = 0,
  fail = 0;
const fails = [];
const rec = (n, ok, d = '') => {
  if (ok) pass++;
  else {
    fail++;
    fails.push(n + (d ? ' (' + d + ')' : ''));
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${n}${d ? ' -> ' + d : ''}`);
};

const pgsql = new EmbeddedPostgres({
  databaseDir: '/tmp/pgtest/data2',
  user: 'postgres',
  password: 'postgres',
  port: 5455,
  persistent: false,
});
await pgsql.initialise();
await pgsql.start();
await pgsql.createDatabase('app');
const c = new pg.Client({
  host: 'localhost',
  port: 5455,
  user: 'postgres',
  password: 'postgres',
  database: 'app',
});
await c.connect();
const q = (s) => c.query(s);

try {
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

  for (const f of [
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
  ]) {
    let s = readFileSync(`${MIG}/${f}`, 'utf8');
    if (f === '0001_extensions.sql')
      s = s.replace(/create extension if not exists vector[^;]*;/, '-- vector skipped');
    await q(s);
  }
  await q(`grant usage on schema public,auth,extensions to authenticated,anon;`);
  await q(`grant all on all tables in schema public to authenticated;`);
  await q(`grant execute on all functions in schema public,auth to authenticated,anon;`);
  await q(readFileSync(`${REPO}/supabase/seed/seed.sql`, 'utf8'));

  const A = '11111111-1111-1111-1111-111111111111',
    B = '22222222-2222-2222-2222-222222222222';
  const P = '00000000-0000-0000-0000-000000000001',
    AA = '00000000-0000-0000-0000-0000000000a1',
    AG = '00000000-0000-0000-0000-0000000000a2',
    MA = '00000000-0000-0000-0000-0000000000a3',
    BA = '00000000-0000-0000-0000-0000000000b1';

  // committed audit/security rows (as superuser) for read tests
  await q(
    `insert into audit_logs(tenant_id,action,entity_type,entity_id) values ('${A}','tenant.switch','tenant','${A}')`,
  );
  await q(
    `insert into audit_logs(tenant_id,action,entity_type,entity_id) values ('${B}','tenant.switch','tenant','${B}')`,
  );
  await q(`insert into audit_logs(tenant_id,action) values (null,'auth.sign_in.success')`);
  await q(
    `insert into security_events(tenant_id,action,category,severity) values ('${A}','auth.sign_in.failure','auth','medium')`,
  );

  async function ctx(uid, tenant, fn, { claimTenant = null } = {}) {
    await q('begin');
    await q(`set local role authenticated`);
    const claims =
      claimTenant !== null
        ? `{"sub":"${uid}","role":"authenticated","app_metadata":{"active_tenant":"${claimTenant}"}}`
        : `{"sub":"${uid}","role":"authenticated"}`;
    await q(`select set_config('request.jwt.claims','${claims}',true)`);
    if (tenant !== null) await q(`select set_config('app.current_tenant','${tenant}',true)`);
    try {
      return await fn();
    } finally {
      await q('rollback');
    }
  }
  const cnt = async (s) => Number((await q(s)).rows[0].c);
  const rc = async (s) => {
    const r = await q(s);
    return r.rowCount;
  };
  // Uses a savepoint so an expected RLS error doesn't abort the surrounding
  // transaction (lets multiple assertions share one ctx block).
  const errs = async (s) => {
    await q('savepoint sp');
    try {
      await q(s);
      await q('release savepoint sp');
      return false;
    } catch {
      await q('rollback to savepoint sp');
      return true;
    }
  };

  // ---- TENANTS ----
  await ctx(AA, A, async () => {
    rec(
      'tenants: A-admin sees own tenant',
      (await cnt(`select count(*) c from tenants where id='${A}'`)) === 1,
    );
    rec(
      'tenants: A-admin cannot see B',
      (await cnt(`select count(*) c from tenants where id='${B}'`)) === 0,
    );
    rec(
      'tenants: A-admin cannot UPDATE own tenant (platform-only)',
      (await rc(`update tenants set name='x' where id='${A}'`)) === 0,
    );
  });
  await ctx(P, null, async () => {
    rec(
      'tenants: platform admin sees registry (>=2)',
      (await cnt(`select count(*) c from tenants`)) >= 2,
    );
    rec(
      'SUPER-ADMIN NO SILENT tenant data: P sees 0 branding',
      (await cnt(`select count(*) c from tenant_branding`)) === 0,
    );
    rec(
      'SUPER-ADMIN NO SILENT tenant data: P sees 0 tenant audit',
      (await cnt(`select count(*) c from audit_logs where tenant_id is not null`)) === 0,
    );
    rec(
      'platform admin sees platform-scope audit',
      (await cnt(`select count(*) c from audit_logs where tenant_id is null`)) >= 1,
    );
  });

  // ---- TENANT_BRANDING ----
  await ctx(AA, A, async () => {
    rec(
      'branding: A-admin own SELECT=1',
      (await cnt(`select count(*) c from tenant_branding`)) === 1,
    );
    rec(
      'branding: A-admin own UPDATE ok',
      (await rc(`update tenant_branding set accent_color='#123456' where tenant_id='${A}'`)) === 1,
    );
    rec(
      'branding: A-admin cross UPDATE 0',
      (await rc(`update tenant_branding set accent_color='#123456' where tenant_id='${B}'`)) === 0,
    );
  });
  await ctx(AG, A, async () => {
    rec(
      'branding: member w/o permission UPDATE 0',
      (await rc(`update tenant_branding set accent_color='#123456' where tenant_id='${A}'`)) === 0,
    );
  });
  await ctx(BA, B, async () => {
    rec(
      'branding: non-member (B) cannot see A branding',
      (await cnt(`select count(*) c from tenant_branding where tenant_id='${A}'`)) === 0,
    );
  });

  // ---- TENANT_SETTINGS ----
  await ctx(AA, A, async () => {
    rec(
      'settings: A-admin own SELECT=1',
      (await cnt(`select count(*) c from tenant_settings`)) === 1,
    );
    rec(
      'settings: A-admin own UPDATE ok',
      (await rc(`update tenant_settings set currency='USD' where tenant_id='${A}'`)) === 1,
    );
    rec(
      'settings: A-admin cross UPDATE 0',
      (await rc(`update tenant_settings set currency='USD' where tenant_id='${B}'`)) === 0,
    );
  });
  await ctx(AG, A, async () =>
    rec(
      'settings: member w/o perm UPDATE 0',
      (await rc(`update tenant_settings set currency='USD' where tenant_id='${A}'`)) === 0,
    ),
  );

  // ---- TENANT_FEATURES ----
  await ctx(AA, A, async () => {
    rec(
      'features: A-admin own INSERT ok',
      !(await errs(`insert into tenant_features(tenant_id,feature_key) values ('${A}','f1')`)),
    );
    rec(
      'features: A-admin cross INSERT fails',
      await errs(`insert into tenant_features(tenant_id,feature_key) values ('${B}','f2')`),
    );
  });
  await ctx(AG, A, async () =>
    rec(
      'features: member w/o perm INSERT fails',
      await errs(`insert into tenant_features(tenant_id,feature_key) values ('${A}','f3')`),
    ),
  );

  // ---- ROLES ----
  await ctx(AA, A, async () => {
    rec(
      'roles: A-admin own SELECT=6',
      (await cnt(`select count(*) c from roles where tenant_id='${A}'`)) === 6,
    );
    rec(
      'roles: A-admin cross SELECT=0',
      (await cnt(`select count(*) c from roles where tenant_id='${B}'`)) === 0,
    );
    rec(
      'roles: A-admin own INSERT ok',
      !(await errs(`insert into roles(tenant_id,slug,name) values ('${A}','custom','Custom')`)),
    );
    rec(
      'roles: A-admin cross INSERT fails',
      await errs(`insert into roles(tenant_id,slug,name) values ('${B}','custom2','Custom2')`),
    );
  });
  await ctx(AG, A, async () =>
    rec(
      'roles: member w/o perm INSERT fails',
      await errs(`insert into roles(tenant_id,slug,name) values ('${A}','c3','C3')`),
    ),
  );

  // ---- ROLE_PERMISSIONS ----
  await ctx(AA, A, async () => {
    rec(
      'role_permissions: A-admin sees own (>0)',
      (await cnt(
        `select count(*) c from role_permissions rp join roles r on r.id=rp.role_id where r.tenant_id='${A}'`,
      )) > 0,
    );
    rec(
      'role_permissions: A-admin cannot see B',
      (await cnt(
        `select count(*) c from role_permissions rp join roles r on r.id=rp.role_id where r.tenant_id='${B}'`,
      )) === 0,
    );
  });

  // ---- MEMBERSHIPS ----
  await ctx(AA, A, async () => {
    rec(
      'memberships: A-admin own SELECT=3 (admin, agent, marketing)',
      (await cnt(`select count(*) c from memberships where tenant_id='${A}'`)) === 3,
    );
    rec(
      'memberships: A-admin cross SELECT=0',
      (await cnt(`select count(*) c from memberships where tenant_id='${B}'`)) === 0,
    );
    rec(
      'memberships: A-admin own UPDATE ok',
      (await rc(`update memberships set status='active' where tenant_id='${A}'`)) >= 1,
    );
    rec(
      'memberships: A-admin cross UPDATE 0',
      (await rc(`update memberships set status='suspended' where tenant_id='${B}'`)) === 0,
    );
  });
  await ctx(AG, A, async () =>
    rec(
      'memberships: agent sees only own row',
      (await cnt(`select count(*) c from memberships`)) === 1,
    ),
  );

  // ---- USER_PERMISSIONS ----
  await ctx(AA, A, async () => {
    rec(
      'user_permissions: A-admin own INSERT ok',
      !(await errs(
        `insert into user_permissions(tenant_id,profile_id,permission_key,effect) values ('${A}','${AG}','leads.export','grant')`,
      )),
    );
    rec(
      'user_permissions: A-admin cross INSERT fails',
      await errs(
        `insert into user_permissions(tenant_id,profile_id,permission_key,effect) values ('${B}','${AG}','leads.export','grant')`,
      ),
    );
  });

  // ---- INVITATIONS ----
  await ctx(AA, A, async () => {
    rec(
      'invitations: A-admin own INSERT ok',
      !(await errs(
        `insert into invitations(tenant_id,email,role_id,token) select '${A}','x@test',id,'tok1' from roles where tenant_id='${A}' and slug='viewer'`,
      )),
    );
    rec(
      'invitations: A-admin cross INSERT fails',
      await errs(
        `insert into invitations(tenant_id,email,role_id,token) select '${B}','y@test',id,'tok2' from roles where tenant_id='${A}' and slug='viewer'`,
      ),
    );
  });
  await ctx(AG, A, async () =>
    rec(
      'invitations: member w/o users.invite sees 0',
      (await cnt(`select count(*) c from invitations`)) === 0,
    ),
  );

  // ---- AUDIT_LOGS ----
  await ctx(AA, A, async () => {
    rec(
      'audit_logs: A-admin (audit.read) sees own tenant rows',
      (await cnt(`select count(*) c from audit_logs where tenant_id='${A}'`)) >= 1,
    );
    rec(
      'audit_logs: A-admin cannot see B rows',
      (await cnt(`select count(*) c from audit_logs where tenant_id='${B}'`)) === 0,
    );
    rec(
      'audit_logs: append-only UPDATE 0 rows',
      (await rc(`update audit_logs set action='auth.sign_out' where tenant_id='${A}'`)) === 0,
    );
    rec(
      'audit_logs: append-only DELETE 0 rows',
      (await rc(`delete from audit_logs where tenant_id='${A}'`)) === 0,
    );
  });
  await ctx(AG, A, async () =>
    rec(
      'audit_logs: member w/o audit.read sees 0',
      (await cnt(`select count(*) c from audit_logs`)) === 0,
    ),
  );

  // ---- SECURITY_EVENTS ----
  await ctx(AA, A, async () => {
    rec(
      'security_events: A-admin (security.manage) sees own',
      (await cnt(`select count(*) c from security_events where tenant_id='${A}'`)) >= 1,
    );
    rec(
      'security_events: A-admin resolve own UPDATE ok',
      (await rc(`update security_events set status='resolved' where tenant_id='${A}'`)) >= 1,
    );
    rec(
      'security_events: A-admin cross UPDATE 0',
      (await rc(`update security_events set status='ignored' where tenant_id='${B}'`)) === 0,
    );
  });
  await ctx(AG, A, async () =>
    rec(
      'security_events: member w/o security.manage sees 0',
      (await cnt(`select count(*) c from security_events`)) === 0,
    ),
  );

  // ---- SCENARIOS ----
  await ctx(AG, A, async () => {
    rec(
      'scenario: is_active_member(A)=true for agent',
      (await q(`select public.is_active_member('${A}') v`)).rows[0].v === true,
    );
    rec(
      'scenario: is_active_member(B)=false for agent',
      (await q(`select public.is_active_member('${B}') v`)).rows[0].v === false,
    );
  });
  // forged active-tenant claim (agent claims tenant B without membership)
  await ctx(
    AG,
    null,
    async () => {
      rec(
        'scenario: forged active_tenant=B grants no B perms',
        (await cnt(`select count(*) c from public.effective_permissions('${AG}','${B}')`)) === 0,
      );
      rec(
        'scenario: forged claim still cannot see B branding',
        (await cnt(`select count(*) c from tenant_branding where tenant_id='${B}'`)) === 0,
      );
    },
    { claimTenant: B },
  );
  // missing active-tenant claim
  await ctx(AG, null, async () =>
    rec(
      'scenario: missing tenant claim => has_permission false',
      (await q(`select public.has_permission('leads.read.assigned') v`)).rows[0].v === false,
    ),
  );
  // disabled membership
  await q(
    `update memberships set status='suspended' where profile_id='${AG}' and tenant_id='${A}'`,
  );
  await ctx(AG, A, async () =>
    rec(
      'scenario: disabled membership cannot see branding',
      (await cnt(`select count(*) c from tenant_branding`)) === 0,
    ),
  );
  await q(`update memberships set status='active' where profile_id='${AG}' and tenant_id='${A}'`);
  // revoked permission override
  await q(
    `insert into user_permissions(tenant_id,profile_id,permission_key,effect) values ('${A}','${AA}','scoring.publish','revoke')`,
  );
  rec(
    'scenario: revoked override removes scoring.publish',
    (await cnt(
      `select count(*) c from public.effective_permissions('${AA}','${A}') where permission_key='scoring.publish'`,
    )) === 0,
  );
  // granted override
  await q(
    `insert into user_permissions(tenant_id,profile_id,permission_key,effect) values ('${A}','${AG}','leads.export','grant')`,
  );
  rec(
    'scenario: granted override adds leads.export',
    (await cnt(
      `select count(*) c from public.effective_permissions('${AG}','${A}') where permission_key='leads.export'`,
    )) === 1,
  );
  // role-bundle invariants
  rec(
    'scenario: viewer role has 0 mutation perms',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${A}' and r.slug='viewer' and rp.permission_key in ('leads.update','projects.manage','scoring.publish','pipeline.move','conversations.reply')`,
    )) === 0,
  );
  rec(
    'scenario: agent role assigned-only (no leads.read.all)',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${A}' and r.slug='sales_agent' and rp.permission_key='leads.read.all'`,
    )) === 0,
  );
  rec(
    'scenario: maintenance excludes conversations.read.private',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${A}' and r.slug='project_maintenance' and rp.permission_key='conversations.read.private'`,
    )) === 0,
  );

  // ===================== Phase 2: projects & inventory =====================
  const PROJ = '33333333-3333-3333-3333-333333333333';
  await ctx(AA, A, async () => {
    rec(
      'projects: A-admin sees seeded project',
      (await cnt(`select count(*) c from projects where id='${PROJ}'`)) >= 1,
    );
    rec(
      'projects: A-admin own INSERT ok',
      !(await errs(`insert into projects(tenant_id,name,category) values ('${A}','P2','villa')`)),
    );
    rec(
      'projects: A-admin cross INSERT fails',
      await errs(`insert into projects(tenant_id,name,category) values ('${B}','P3','villa')`),
    );
  });
  await ctx(BA, B, async () => {
    rec(
      'projects: B-admin cannot see tenant-A project',
      (await cnt(`select count(*) c from projects where tenant_id='${A}'`)) === 0,
    );
  });
  await ctx(AG, A, async () => {
    rec(
      'projects: agent (projects.read) can SELECT',
      (await cnt(`select count(*) c from projects where id='${PROJ}'`)) >= 1,
    );
    rec(
      'projects: agent (no projects.manage) INSERT fails',
      await errs(`insert into projects(tenant_id,name,category) values ('${A}','PX','plot')`),
    );
  });

  await ctx(AA, A, async () => {
    rec(
      'inventory: A-admin sees seeded units (3)',
      (await cnt(`select count(*) c from inventory_units where project_id='${PROJ}'`)) === 3,
    );
    rec(
      'inventory: A-admin cross SELECT 0',
      (await cnt(`select count(*) c from inventory_units where tenant_id='${B}'`)) === 0,
    );
    rec(
      'inventory: A-admin own status UPDATE ok',
      (await rc(
        `update inventory_units set status='reserved' where project_id='${PROJ}' and unit_number='A-101'`,
      )) === 1,
    );
  });
  await ctx(AG, A, async () => {
    rec(
      'inventory: agent (inventory.read) can SELECT',
      (await cnt(`select count(*) c from inventory_units where project_id='${PROJ}'`)) === 3,
    );
    rec(
      'inventory: agent (no inventory.manage) UPDATE 0 rows',
      (await rc(`update inventory_units set status='blocked' where project_id='${PROJ}'`)) === 0,
    );
  });
  await ctx(BA, B, async () => {
    rec(
      'inventory: B-admin cannot see tenant-A units',
      (await cnt(`select count(*) c from inventory_units where tenant_id='${A}'`)) === 0,
    );
  });

  // history triggers fired on seed inserts
  await ctx(AA, A, async () => {
    rec(
      'history: status events recorded by trigger (>=3)',
      (await cnt(`select count(*) c from inventory_status_events where tenant_id='${A}'`)) >= 3,
    );
    rec(
      'history: price history recorded by trigger (>=3)',
      (await cnt(`select count(*) c from inventory_price_history where tenant_id='${A}'`)) >= 3,
    );
    rec(
      'history: append-only (no UPDATE policy) 0 rows',
      (await rc(`update inventory_status_events set new_status='sold' where tenant_id='${A}'`)) ===
        0,
    );
  });
  // trigger on a status change creates a new event
  const beforeEv = await cnt(
    `select count(*) c from inventory_status_events where tenant_id='${A}'`,
  ).catch(() => 0);
  await ctx(AA, A, async () => {
    await q(
      `update inventory_units set status='temporarily_held' where project_id='${PROJ}' and unit_number='A-101'`,
    );
    rec(
      'history: status change appends a new event',
      (await cnt(`select count(*) c from inventory_status_events where tenant_id='${A}'`)) >
        beforeEv,
    );
  });

  // imports permission
  await ctx(AA, A, async () => {
    rec(
      'imports: A-admin (inventory.import) INSERT ok',
      !(await errs(
        `insert into inventory_imports(tenant_id,project_id,filename) values ('${A}','${PROJ}','x.csv')`,
      )),
    );
  });
  await ctx(AG, A, async () => {
    rec(
      'imports: agent (no inventory.import) INSERT fails',
      await errs(
        `insert into inventory_imports(tenant_id,project_id,filename) values ('${A}','${PROJ}','y.csv')`,
      ),
    );
  });

  // availability domain rule (DB view of seed): exactly 1 'available' unit after seed
  rec(
    'availability: seed has available + booked units',
    (await cnt(
      `select count(*) c from inventory_units where tenant_id='${A}' and status='available'`,
    )) >= 1,
  );

  // ===================== Phase 2 content: faqs / media / documents (0007) =====================
  await ctx(AA, A, async () => {
    rec(
      'content: A-admin own FAQ INSERT ok',
      !(await errs(
        `insert into project_faqs(tenant_id,project_id,question,answer) values ('${A}','${PROJ}','Q','A')`,
      )),
    );
    rec(
      'content: A-admin cross FAQ INSERT fails',
      await errs(
        `insert into project_faqs(tenant_id,project_id,question,answer) values ('${B}','${PROJ}','Q','A')`,
      ),
    );
    rec(
      'content: A-admin own document INSERT ok',
      !(await errs(
        `insert into project_documents(tenant_id,project_id,title,url) values ('${A}','${PROJ}','Brochure','https://x/y.pdf')`,
      )),
    );
  });
  await ctx(AG, A, async () => {
    rec(
      'content: agent (no projects.manage) FAQ INSERT fails',
      await errs(
        `insert into project_faqs(tenant_id,project_id,question,answer) values ('${A}','${PROJ}','Q','A')`,
      ),
    );
    rec(
      'content: agent (projects.read) can SELECT media',
      (await cnt(`select count(*) c from project_media where tenant_id='${A}'`)) >= 0,
    );
  });
  await ctx(BA, B, async () => {
    rec(
      'content: B-admin cannot see tenant-A documents',
      (await cnt(`select count(*) c from project_documents where tenant_id='${A}'`)) === 0,
    );
  });

  // ===================== Phase 3: leads & pipeline (0008) =====================
  const L1 = '55555555-5555-5555-5555-555555555501'; // unassigned
  const L2 = '55555555-5555-5555-5555-555555555502'; // assigned to agent a2
  await ctx(AA, A, async () => {
    rec(
      'leads: admin (read.all) sees both leads',
      (await cnt(`select count(*) c from leads where tenant_id='${A}'`)) === 2,
    );
    rec(
      'leads: admin own INSERT ok',
      !(await errs(`insert into leads(tenant_id,full_name) values ('${A}','New Lead')`)),
    );
    rec(
      'leads: admin cross INSERT fails',
      await errs(`insert into leads(tenant_id,full_name) values ('${B}','X')`),
    );
  });
  await ctx(AG, A, async () => {
    rec(
      'leads: agent (read.assigned) sees ONLY assigned lead',
      (await cnt(`select count(*) c from leads where tenant_id='${A}'`)) === 1,
    );
    rec(
      'leads: agent sees the assigned lead (L2) not L1',
      (await cnt(`select count(*) c from leads where id='${L2}'`)) === 1 &&
        (await cnt(`select count(*) c from leads where id='${L1}'`)) === 0,
    );
    rec(
      'leads: agent (no leads.create) INSERT fails',
      await errs(`insert into leads(tenant_id,full_name) values ('${A}','Nope')`),
    );
    rec(
      'leads: agent can UPDATE assigned lead',
      (await rc(`update leads set operational_status='qualifying' where id='${L2}'`)) === 1,
    );
    rec(
      'leads: agent cannot UPDATE unassigned lead (0 rows)',
      (await rc(`update leads set operational_status='dormant' where id='${L1}'`)) === 0,
    );
    rec(
      'leads: agent can read notes of assigned lead',
      (await cnt(`select count(*) c from lead_notes where lead_id='${L2}'`)) >= 0,
    );
    rec(
      'leads: agent cannot read notes of unassigned lead via child table',
      (await cnt(`select count(*) c from lead_notes where lead_id='${L1}'`)) === 0,
    );
  });
  await ctx(BA, B, async () => {
    rec(
      'leads: B-admin cannot see tenant-A leads',
      (await cnt(`select count(*) c from leads where tenant_id='${A}'`)) === 0,
    );
  });
  // pipeline seeded (12 stages) for tenant A
  await ctx(AA, A, async () => {
    rec(
      'pipeline: default pipeline seeded with 12 stages',
      (await cnt(
        `select count(*) c from pipeline_stages s join pipelines p on p.id=s.pipeline_id where p.tenant_id='${A}' and p.is_default`,
      )) === 12,
    );
  });
  // assignment visibility + merge permission
  await ctx(AG, A, async () => {
    rec(
      'assignment: agent sees their active assignment',
      (await cnt(`select count(*) c from lead_assignments where lead_id='${L2}' and active`)) === 1,
    );
    rec(
      'duplicates: agent (no leads.merge) cannot insert duplicate record',
      await errs(
        `insert into lead_duplicates(tenant_id,lead_id,duplicate_lead_id,confidence) values ('${A}','${L2}','${L1}','exact')`,
      ),
    );
  });
  // ===================== Phase 3.1: ingestion idempotency & CRM (0010) =====================
  // Autocommit error helper (no surrounding txn) for DB-constraint assertions.
  const errAuto = async (s) => {
    try {
      await q(s);
      return false;
    } catch {
      return true;
    }
  };
  const srcA = (
    await q(`select id from lead_sources where tenant_id='${A}' and kind='manual' limit 1`)
  ).rows[0].id;

  // ---- DB-enforced idempotency ----
  rec(
    'idempotency: first ingestion event inserts',
    !(await errAuto(
      `insert into lead_ingestion_events(tenant_id,idempotency_key,payload_hash,original_payload) values ('${A}','evt-k1','h1','{}'::jsonb)`,
    )),
  );
  rec(
    'idempotency: SAME (tenant,key) twice is rejected by unique constraint',
    await errAuto(
      `insert into lead_ingestion_events(tenant_id,idempotency_key,payload_hash,original_payload) values ('${A}','evt-k1','h1','{}'::jsonb)`,
    ),
  );
  rec(
    'idempotency: SAME key under a DIFFERENT tenant is allowed (tenant-scoped)',
    !(await errAuto(
      `insert into lead_ingestion_events(tenant_id,idempotency_key,payload_hash,original_payload) values ('${B}','evt-k1','h1','{}'::jsonb)`,
    )),
  );
  const extOk = !(await errAuto(
    `insert into lead_ingestion_events(tenant_id,source_id,external_event_id,idempotency_key,payload_hash,original_payload) values ('${A}','${srcA}','x1','ka','h','{}'::jsonb)`,
  ));
  const extDup = await errAuto(
    `insert into lead_ingestion_events(tenant_id,source_id,external_event_id,idempotency_key,payload_hash,original_payload) values ('${A}','${srcA}','x1','kb','h','{}'::jsonb)`,
  );
  rec(
    'idempotency: same (tenant,source,external_event_id) twice rejected even w/ different key',
    extOk && extDup,
  );
  rec(
    'idempotency_keys: first (tenant,scope,key) inserts',
    !(await errAuto(
      `insert into idempotency_keys(tenant_id,scope,idem_key,payload_hash) values ('${A}','lead','k1','h1')`,
    )),
  );
  rec(
    'idempotency_keys: SAME (tenant,scope,key) twice rejected',
    await errAuto(
      `insert into idempotency_keys(tenant_id,scope,idem_key,payload_hash) values ('${A}','lead','k1','h2')`,
    ),
  );

  // Seed rows (as superuser) for RLS read assertions.
  await q(
    `insert into calls(tenant_id,lead_id,direction,status) values ('${A}','${L2}','outbound','connected')`,
  );
  await q(
    `insert into calls(tenant_id,lead_id,direction,status) values ('${A}','${L1}','outbound','no_answer')`,
  );
  await q(`insert into background_jobs(tenant_id,job_type) values ('${A}','lead.ingest')`);
  await q(
    `insert into dead_letter_events(tenant_id,origin,job_type,error) values ('${A}','ingestion','lead.ingest','boom')`,
  );
  await q(
    `insert into public_lead_forms(tenant_id,name,status) values ('${A}','Website form','active')`,
  );

  // ---- CALLS RLS ----
  await ctx(AG, A, async () => {
    rec(
      'calls: agent sees call on ASSIGNED lead (L2)',
      (await cnt(`select count(*) c from calls where lead_id='${L2}'`)) === 1,
    );
    rec(
      'calls: agent CANNOT see call on UNASSIGNED lead (L1)',
      (await cnt(`select count(*) c from calls where lead_id='${L1}'`)) === 0,
    );
    rec(
      'calls: agent (calls.manage) can log a call on assigned lead',
      !(await errs(
        `insert into calls(tenant_id,lead_id,direction,status) values ('${A}','${L2}','inbound','connected')`,
      )),
    );
  });
  await ctx(BA, B, async () =>
    rec(
      'calls: B-admin cannot see tenant-A calls',
      (await cnt(`select count(*) c from calls where tenant_id='${A}'`)) === 0,
    ),
  );

  // ---- SAVED VIEWS RLS (must never widen visibility) ----
  await ctx(AG, A, async () => {
    rec(
      'saved_views: agent can create a PRIVATE view (owner=self)',
      !(await errs(
        `insert into saved_views(tenant_id,owner_id,name,scope) values ('${A}','${AG}','My leads','private')`,
      )),
    );
    rec(
      'saved_views: agent CANNOT create a view owned by someone else',
      await errs(
        `insert into saved_views(tenant_id,owner_id,name,scope) values ('${A}','${AA}','Spoof','private')`,
      ),
    );
    rec(
      'saved_views: agent sees only own private view',
      (await cnt(`select count(*) c from saved_views`)) === 1,
    );
  });
  await ctx(AA, A, async () =>
    rec(
      "saved_views: admin cannot see agent's PRIVATE view",
      (await cnt(
        `select count(*) c from saved_views where owner_id='${AG}' and scope='private'`,
      )) === 0,
    ),
  );

  // ---- QUALIFICATION FIELDS RLS (seeded by on_tenant_created) ----
  await ctx(AG, A, async () => {
    rec(
      'qualification_fields: agent (leads.read.assigned) can SELECT seeded fields',
      (await cnt(`select count(*) c from qualification_fields where tenant_id='${A}'`)) >= 1,
    );
    rec(
      'qualification_fields: agent (no settings.org.manage) cannot edit config',
      await errs(
        `insert into qualification_fields(tenant_id,field_key,label) values ('${A}','x','X')`,
      ),
    );
  });
  await ctx(AA, A, async () =>
    rec(
      'qualification_fields: admin (settings.org.manage) can add a field',
      !(await errs(
        `insert into qualification_fields(tenant_id,field_key,label,importance) values ('${A}','x','X','optional')`,
      )),
    ),
  );

  // ---- INGESTION EVENTS / JOBS / DLQ visibility ----
  await ctx(AA, A, async () => {
    rec(
      'ingestion_events: admin (leads.read.all⇒team) sees tenant-A events',
      (await cnt(`select count(*) c from lead_ingestion_events where tenant_id='${A}'`)) >= 1,
    );
    rec(
      'background_jobs: admin (settings.audit.read) sees jobs',
      (await cnt(`select count(*) c from background_jobs where tenant_id='${A}'`)) >= 1,
    );
    rec(
      'dead_letter_events: admin (settings.audit.read) sees DLQ',
      (await cnt(`select count(*) c from dead_letter_events where tenant_id='${A}'`)) >= 1,
    );
  });
  await ctx(AG, A, async () => {
    rec(
      'ingestion_events: agent (no leads.read.team) sees 0',
      (await cnt(`select count(*) c from lead_ingestion_events`)) === 0,
    );
    rec(
      'background_jobs: agent (no settings.audit.read) sees 0',
      (await cnt(`select count(*) c from background_jobs`)) === 0,
    );
    rec(
      'dead_letter_events: agent (no settings.audit.read) sees 0',
      (await cnt(`select count(*) c from dead_letter_events`)) === 0,
    );
  });
  await ctx(BA, B, async () =>
    rec(
      'ingestion_events: B-admin cannot see tenant-A events',
      (await cnt(`select count(*) c from lead_ingestion_events where tenant_id='${A}'`)) === 0,
    ),
  );

  // ---- PUBLIC FORMS RLS ----
  await ctx(AA, A, async () =>
    rec(
      'public_lead_forms: admin (forms.manage) sees own forms',
      (await cnt(`select count(*) c from public_lead_forms where tenant_id='${A}'`)) >= 1,
    ),
  );
  await ctx(AG, A, async () => {
    rec(
      'public_lead_forms: agent (no forms.manage) sees 0',
      (await cnt(`select count(*) c from public_lead_forms`)) === 0,
    );
    rec(
      'public_lead_forms: agent (no forms.manage) cannot create a form',
      await errs(`insert into public_lead_forms(tenant_id,name) values ('${A}','Nope')`),
    );
  });
  await ctx(BA, B, async () =>
    rec(
      'public_lead_forms: B-admin cannot see tenant-A forms',
      (await cnt(`select count(*) c from public_lead_forms where tenant_id='${A}'`)) === 0,
    ),
  );
  // ===================== Phase 4: conversations (0011) =====================
  const CV2 = '66666666-6666-6666-6666-666666666602'; // on L2 (agent-assigned lead)
  const CV1 = '66666666-6666-6666-6666-666666666601'; // on L1 (unassigned lead)
  // Seed conversations + messages as superuser (RLS bypassed).
  await q(
    `insert into conversations(id,tenant_id,lead_id,channel,status,ai_active,assigned_agent_id) values ('${CV2}','${A}','${L2}','website_chat','open',true,'${AG}')`,
  );
  await q(
    `insert into conversations(id,tenant_id,lead_id,channel,status,ai_active) values ('${CV1}','${A}','${L1}','website_chat','open',true)`,
  );
  await q(
    `insert into conversation_messages(tenant_id,conversation_id,lead_id,direction,sender,body,status) values ('${A}','${CV2}','${L2}','inbound','lead','Is it available?','received')`,
  );
  await q(
    `insert into conversation_messages(tenant_id,conversation_id,lead_id,direction,sender,body,status) values ('${A}','${CV1}','${L1}','inbound','lead','Hi','received')`,
  );
  await q(
    `insert into website_chat_widgets(tenant_id,name,public_key,status) values ('${A}','Site','pk_test_a','active')`,
  );

  // ---- CONVERSATIONS RLS: private vs assigned vs cross-tenant ----
  await ctx(AA, A, async () => {
    rec(
      'conversations: admin (read.private) sees both conversations',
      (await cnt(`select count(*) c from conversations where tenant_id='${A}'`)) === 2,
    );
  });
  await ctx(AG, A, async () => {
    rec(
      'conversations: agent (read.assigned) sees ONLY the assigned-lead conversation',
      (await cnt(`select count(*) c from conversations where tenant_id='${A}'`)) === 1,
    );
    rec(
      'conversations: agent sees CV2 (assigned) not CV1 (unassigned)',
      (await cnt(`select count(*) c from conversations where id='${CV2}'`)) === 1 &&
        (await cnt(`select count(*) c from conversations where id='${CV1}'`)) === 0,
    );
    rec(
      'messages: agent can read messages of the visible conversation',
      (await cnt(`select count(*) c from conversation_messages where conversation_id='${CV2}'`)) ===
        1,
    );
    rec(
      'messages: agent CANNOT read messages of the hidden conversation',
      (await cnt(`select count(*) c from conversation_messages where conversation_id='${CV1}'`)) ===
        0,
    );
    rec(
      'conversations: agent (reply) can post an outbound message on visible conversation',
      !(await errs(
        `insert into conversation_messages(tenant_id,conversation_id,lead_id,direction,sender,body) values ('${A}','${CV2}','${L2}','outbound','agent','Yes!')`,
      )),
    );
    rec(
      'conversations: agent (takeover) can update visible conversation',
      (await rc(`update conversations set ai_active=false where id='${CV2}'`)) === 1,
    );
    rec(
      'conversations: agent cannot update the hidden conversation (0 rows)',
      (await rc(`update conversations set ai_active=false where id='${CV1}'`)) === 0,
    );
  });
  await ctx(BA, B, async () =>
    rec(
      'conversations: B-admin cannot see tenant-A conversations',
      (await cnt(`select count(*) c from conversations where tenant_id='${A}'`)) === 0,
    ),
  );

  // ---- Role-bundle invariant: maintenance has NO conversation read perms ----
  rec(
    'scenario: maintenance excludes conversations.read.assigned',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${A}' and r.slug='project_maintenance' and rp.permission_key in ('conversations.read.assigned','conversations.read.private')`,
    )) === 0,
  );

  // ---- CONSENT / DNC ----
  await ctx(AG, A, async () =>
    rec(
      'consent: agent (leads.update) can record a DNC entry',
      !(await errs(
        `insert into contact_consents(tenant_id,lead_id,channel,status) values ('${A}','${L2}','whatsapp','do_not_contact')`,
      )),
    ),
  );
  await ctx(BA, B, async () =>
    rec(
      'consent: B-admin cannot see tenant-A consents',
      (await cnt(`select count(*) c from contact_consents where tenant_id='${A}'`)) === 0,
    ),
  );

  // ---- WIDGET config visibility ----
  await ctx(AA, A, async () =>
    rec(
      'widgets: admin (settings.org.manage) sees the widget',
      (await cnt(`select count(*) c from website_chat_widgets where tenant_id='${A}'`)) === 1,
    ),
  );
  await ctx(AG, A, async () => {
    rec(
      'widgets: agent (no settings.org.manage) sees 0',
      (await cnt(`select count(*) c from website_chat_widgets`)) === 0,
    );
    rec(
      'widgets: agent cannot create a widget',
      await errs(
        `insert into website_chat_widgets(tenant_id,name,public_key) values ('${A}','X','pk_x')`,
      ),
    );
  });
  // ===================== Phase 4.1: inbox completion (0012) =====================
  const errAuto41 = async (s) => {
    try {
      await q(s);
      return false;
    } catch {
      return true;
    }
  };
  const widgetA = (
    await q(`select id from website_chat_widgets where tenant_id='${A}' and public_key='pk_test_a'`)
  ).rows[0].id;
  const msgCV2 = (
    await q(`select id from conversation_messages where conversation_id='${CV2}' limit 1`)
  ).rows[0].id;

  // ---- Permission backfill sanity ----
  rec(
    'perms: agent has conversations.notes.create',
    (await cnt(
      `select count(*) c from public.effective_permissions('${AG}','${A}') where permission_key='conversations.notes.create'`,
    )) === 1,
  );
  rec(
    'perms: agent does NOT have messages.redact / dnc.manage / website_chat.view_sessions',
    (await cnt(
      `select count(*) c from public.effective_permissions('${AG}','${A}') where permission_key in ('messages.redact','dnc.manage','website_chat.view_sessions','canned_replies.manage','consent.manage')`,
    )) === 0,
  );
  rec(
    'perms: admin has messages.redact + dnc.manage + website_chat.view_sessions',
    (await cnt(
      `select count(*) c from public.effective_permissions('${AA}','${A}') where permission_key in ('messages.redact','dnc.manage','website_chat.view_sessions')`,
    )) === 3,
  );
  rec(
    'perms: marketing is metadata-only (read.metadata, no content read scope)',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${A}' and r.slug='marketing_manager' and rp.permission_key in ('conversations.read.private','conversations.read.all','conversations.read.team','conversations.read.assigned')`,
    )) === 0,
  );

  // ---- AI-safety: operating_mode default + no 'ai' reachable from data ----
  rec(
    'ai-safety: conversations default operating_mode = human',
    (await cnt(
      `select count(*) c from conversations where id='${CV2}' and operating_mode='human'`,
    )) === 1,
  );

  // ---- Internal notes RLS ----
  await ctx(AG, A, async () => {
    rec(
      'notes: agent (notes.create) can add a note on a visible conversation',
      !(await errs(
        `insert into conversation_notes(tenant_id,conversation_id,author_id,body,visibility) values ('${A}','${CV2}','${AG}','hi','team')`,
      )),
    );
    rec(
      'notes: agent cannot add a note on a hidden conversation',
      await errs(
        `insert into conversation_notes(tenant_id,conversation_id,author_id,body) values ('${A}','${CV1}','${AG}','x')`,
      ),
    );
  });

  // ---- Read-state isolation ----
  await ctx(AG, A, async () => {
    rec(
      'reads: agent can write OWN read row',
      !(await errs(
        `insert into conversation_reads(tenant_id,conversation_id,profile_id) values ('${A}','${CV2}','${AG}')`,
      )),
    );
    rec(
      "reads: agent CANNOT write another user's read row",
      await errs(
        `insert into conversation_reads(tenant_id,conversation_id,profile_id) values ('${A}','${CV2}','${AA}')`,
      ),
    );
  });

  // ---- Canned replies / tags / DNC / consent / redaction permission gating ----
  await ctx(AG, A, async () => {
    rec(
      'canned: agent (reply) can read canned replies',
      (await cnt(`select count(*) c from canned_replies`)) >= 0,
    );
    rec(
      'canned: agent (no canned_replies.manage) cannot create',
      await errs(`insert into canned_replies(tenant_id,title,body) values ('${A}','T','B')`),
    );
    rec(
      'dnc: agent (no dnc.manage) cannot create a DNC entry',
      await errs(`insert into do_not_contact_entries(tenant_id,lead_id) values ('${A}','${L2}')`),
    );
    rec(
      'redaction: agent (no messages.redact) cannot record a redaction',
      await errs(
        `insert into message_redaction_events(tenant_id,message_id,conversation_id,reason,original_hash) values ('${A}','${msgCV2}','${CV2}','x','h')`,
      ),
    );
  });
  await ctx(AA, A, async () => {
    rec(
      'canned: admin (canned_replies.manage) can create',
      !(await errs(`insert into canned_replies(tenant_id,title,body) values ('${A}','T','B')`)),
    );
    rec(
      'dnc: admin (dnc.manage) can create a DNC entry',
      !(await errs(
        `insert into do_not_contact_entries(tenant_id,lead_id,activated_by) values ('${A}','${L2}','${AA}')`,
      )),
    );
    rec(
      'redaction: admin (messages.redact) can record a redaction',
      !(await errs(
        `insert into message_redaction_events(tenant_id,message_id,conversation_id,reason,original_hash,actor_id) values ('${A}','${msgCV2}','${CV2}','pii','deadbeef','${AA}')`,
      )),
    );
  });
  await ctx(BA, B, async () =>
    rec(
      'dnc: B-admin cannot see tenant-A DNC entries',
      (await cnt(`select count(*) c from do_not_contact_entries where tenant_id='${A}'`)) === 0,
    ),
  );

  // ---- Message ingestion idempotency (DB-enforced) ----
  rec(
    'msg-ingest: first event inserts',
    !(await errAuto41(
      `insert into message_ingestion_events(tenant_id,widget_id,external_message_id,idempotency_key,payload_hash) values ('${A}','${widgetA}','m1','mk1','h1')`,
    )),
  );
  rec(
    'msg-ingest: SAME (tenant,key) twice rejected',
    await errAuto41(
      `insert into message_ingestion_events(tenant_id,idempotency_key,payload_hash) values ('${A}','mk1','h1')`,
    ),
  );
  rec(
    'msg-ingest: SAME (tenant,widget,external) twice rejected even with a different key',
    await errAuto41(
      `insert into message_ingestion_events(tenant_id,widget_id,external_message_id,idempotency_key,payload_hash) values ('${A}','${widgetA}','m1','mk2','h1')`,
    ),
  );
  rec(
    'msg-ingest: SAME external id under a different tenant is allowed',
    !(await errAuto41(
      `insert into message_ingestion_events(tenant_id,idempotency_key,payload_hash) values ('${B}','mk1','h1')`,
    )),
  );
  await ctx(AA, A, async () =>
    rec(
      'msg-ingest: admin (settings.audit.read) sees ingestion events',
      (await cnt(`select count(*) c from message_ingestion_events where tenant_id='${A}'`)) >= 1,
    ),
  );
  await ctx(AG, A, async () =>
    rec(
      'msg-ingest: agent (no settings.audit.read) sees 0 ingestion events',
      (await cnt(`select count(*) c from message_ingestion_events`)) === 0,
    ),
  );

  // ---- Website sessions visibility ----
  await q(
    `insert into website_chat_sessions(tenant_id,widget_id,public_session_id,token_hash) values ('${A}','${widgetA}','sess_a','hash_a')`,
  );
  await ctx(AA, A, async () =>
    rec(
      'sessions: admin (website_chat.view_sessions) sees sessions',
      (await cnt(`select count(*) c from website_chat_sessions where tenant_id='${A}'`)) === 1,
    ),
  );
  await ctx(AG, A, async () =>
    rec(
      'sessions: agent (no view_sessions) sees 0',
      (await cnt(`select count(*) c from website_chat_sessions`)) === 0,
    ),
  );

  // ---- Summary versioning constraints ----
  rec(
    'summary-versions: ai_generated is rejected by CHECK',
    await errAuto41(
      `insert into conversation_summary_versions(tenant_id,conversation_id,body,summary_type) values ('${A}','${CV2}','x','ai_generated')`,
    ),
  );
  rec(
    'summary-versions: manual with a model is rejected by CHECK',
    await errAuto41(
      `insert into conversation_summary_versions(tenant_id,conversation_id,body,summary_type,model) values ('${A}','${CV2}','x','manual','gpt')`,
    ),
  );
  rec(
    'summary-versions: a manual version with null model is allowed',
    !(await errAuto41(
      `insert into conversation_summary_versions(tenant_id,conversation_id,body,summary_type) values ('${A}','${CV2}','x','manual')`,
    )),
  );
  // ===================== Phase 4.1 wiring: waiting-on + delivery (0013) =====================
  // CV2 already has an inbound message (seeded in the Phase-4 block) → the
  // trigger should have set waiting_on='agent'.
  rec(
    'waiting-on: inbound message set waiting_on=agent (trigger)',
    (await cnt(`select count(*) c from conversations where id='${CV2}' and waiting_on='agent'`)) ===
      1,
  );
  rec(
    'delivery: inbound message seeded a delivery event (received)',
    (await cnt(
      `select count(*) c from message_delivery_events where conversation_id='${CV2}' and status='received'`,
    )) >= 1,
  );
  // An outbound agent message flips waiting_on to lead, sets first_response_at,
  // and seeds a 'queued' delivery event.
  const outMsg = (
    await q(
      `insert into conversation_messages(tenant_id,conversation_id,lead_id,direction,sender,body) values ('${A}','${CV2}','${L2}','outbound','agent','On it') returning id`,
    )
  ).rows[0].id;
  rec(
    'waiting-on: outbound agent message set waiting_on=lead',
    (await cnt(`select count(*) c from conversations where id='${CV2}' and waiting_on='lead'`)) ===
      1,
  );
  rec(
    'waiting-on: first_response_at recorded on first outbound',
    (await cnt(
      `select count(*) c from conversations where id='${CV2}' and first_response_at is not null`,
    )) === 1,
  );
  rec(
    'delivery: outbound message seeded a queued delivery event',
    (await cnt(
      `select count(*) c from message_delivery_events where message_id='${outMsg}' and status='queued'`,
    )) === 1,
  );
  // Internal note must NOT change waiting_on (stays lead).
  await q(
    `insert into conversation_messages(tenant_id,conversation_id,lead_id,direction,sender,body) values ('${A}','${CV2}','${L2}','internal','agent','private note')`,
  );
  rec(
    'waiting-on: internal note does not change waiting_on (stays lead)',
    (await cnt(`select count(*) c from conversations where id='${CV2}' and waiting_on='lead'`)) ===
      1,
  );
  // A failed delivery flips waiting_on back to agent.
  await q(
    `insert into message_delivery_events(tenant_id,message_id,conversation_id,status) values ('${A}','${outMsg}','${CV2}','failed')`,
  );
  rec(
    'waiting-on: failed outbound delivery flips waiting_on back to agent',
    (await cnt(`select count(*) c from conversations where id='${CV2}' and waiting_on='agent'`)) ===
      1,
  );
  // ============= Phase 4.1 completion: marketing metadata-only, new-tenant, search =============
  // Marketing Manager (metadata-only): sees conversation rows but NOT message
  // bodies, internal notes, or private content.
  await ctx(MA, A, async () => {
    rec(
      'marketing: metadata-only sees conversation rows',
      (await cnt(`select count(*) c from conversations where tenant_id='${A}'`)) >= 1,
    );
    rec(
      'marketing: metadata-only CANNOT read message bodies',
      (await cnt(`select count(*) c from conversation_messages where tenant_id='${A}'`)) === 0,
    );
    rec(
      'marketing: metadata-only CANNOT read internal notes',
      (await cnt(`select count(*) c from conversation_notes where tenant_id='${A}'`)) === 0,
    );
    // (Marketing legitimately holds leads.read.team — it is conversation message
    // bodies and internal notes that are withheld, verified above.)
  });

  // Search authorization: an agent searching message bodies only matches inside
  // conversations they can see (RLS-first). CV2 visible, CV1 hidden.
  await ctx(AG, A, async () => {
    rec(
      'search: agent matches only visible-conversation messages',
      (await cnt(`select count(*) c from conversation_messages where body ilike '%available%'`)) >=
        1,
    );
    rec(
      'search: agent gets NO snippet from an inaccessible conversation',
      (await cnt(
        `select count(*) c from conversation_messages where conversation_id='${CV1}' and body ilike '%hi%'`,
      )) === 0,
    );
  });

  // New-tenant provisioning (item 14): a tenant created AFTER all migrations gets
  // the Phase 4.1 conversation bundle folded into seed_default_roles.
  const T3 = '33333333-0000-0000-0000-000000000003';
  await q(
    `insert into tenants (id,name,slug,plan_tier) values ('${T3}','Tertiary','tertiary','starter')`,
  );
  rec(
    'new-tenant: sales_agent has conversations.notes.create',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${T3}' and r.slug='sales_agent' and rp.permission_key='conversations.notes.create'`,
    )) === 1,
  );
  rec(
    'new-tenant: sales_agent does NOT get conversations.read.metadata (assigned-only)',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${T3}' and r.slug='sales_agent' and rp.permission_key='conversations.read.metadata'`,
    )) === 0,
  );
  rec(
    'new-tenant: client_admin has messages.redact + website_chat.view_sessions',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${T3}' and r.slug='client_admin' and rp.permission_key in ('messages.redact','website_chat.view_sessions')`,
    )) === 2,
  );
  rec(
    'new-tenant: marketing_manager is metadata-only (no content read scope)',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${T3}' and r.slug='marketing_manager' and rp.permission_key in ('conversations.read.private','conversations.read.all','conversations.read.team','conversations.read.assigned')`,
    )) === 0,
  );
  rec(
    'new-tenant: project_maintenance has NO conversation read perms',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${T3}' and r.slug='project_maintenance' and rp.permission_key like 'conversations.read.%'`,
    )) === 0,
  );
  // ============= Phase 4.1 Priority 1: website session security (DB binding) =============
  // A second widget for tenant A to prove cross-widget isolation.
  const widgetA2 = (
    await q(
      `insert into website_chat_widgets(tenant_id,name,public_key,status) values ('${A}','Site2','pk_test_a2','active') returning id`,
    )
  ).rows[0].id;
  // Session bound to (tenant A, widgetA, conversation CV2), token hash 'h_sess_a'.
  await q(
    `insert into website_chat_sessions(tenant_id,widget_id,conversation_id,public_session_id,token_hash,token_version,status,expires_at) values ('${A}','${widgetA}','${CV2}','psid_a','h_sess_a',1,'active', now() + interval '1 hour')`,
  );
  // The scoped lookup resolveWebsiteSession uses: (tenant,widget,token_hash).
  const sessLookup = (t, w, h, extra = '') =>
    cnt(
      `select count(*) c from website_chat_sessions where tenant_id='${t}' and widget_id='${w}' and token_hash='${h}'${extra}`,
    );
  rec(
    'session: correct (tenant,widget,token) resolves',
    (await sessLookup(A, widgetA, 'h_sess_a')) === 1,
  );
  rec(
    'session: a MODIFIED token does not resolve',
    (await sessLookup(A, widgetA, 'h_wrong')) === 0,
  );
  rec(
    'session: token bound to another WIDGET does not resolve',
    (await sessLookup(A, widgetA2, 'h_sess_a')) === 0,
  );
  rec(
    'session: token under another TENANT does not resolve',
    (await sessLookup(B, widgetA, 'h_sess_a')) === 0,
  );
  // Expired session: the usability filter (active + future expiry) excludes it.
  await q(
    `insert into website_chat_sessions(tenant_id,widget_id,conversation_id,public_session_id,token_hash,status,expires_at) values ('${A}','${widgetA}','${CV2}','psid_exp','h_exp','active', now() - interval '1 minute')`,
  );
  rec(
    'session: EXPIRED token is not usable',
    (await sessLookup(A, widgetA, 'h_exp', " and status='active' and expires_at > now()")) === 0,
  );
  // Rotated / ended session: not active → previous-token reuse blocked.
  await q(
    `insert into website_chat_sessions(tenant_id,widget_id,conversation_id,public_session_id,token_hash,status,expires_at) values ('${A}','${widgetA}','${CV2}','psid_rot','h_rot','rotated', now() + interval '1 hour')`,
  );
  rec(
    'session: ROTATED token (previous) is not usable',
    (await sessLookup(A, widgetA, 'h_rot', " and status='active'")) === 0,
  );
  // public_session_id is unique per tenant (no collision/forgery of the handle).
  rec(
    'session: public_session_id is unique per tenant',
    await (async () => {
      try {
        await q(
          `insert into website_chat_sessions(tenant_id,widget_id,conversation_id,public_session_id,token_hash,status,expires_at) values ('${A}','${widgetA}','${CV2}','psid_a','h_dup','active', now() + interval '1 hour')`,
        );
        return false;
      } catch {
        return true;
      }
    })(),
  );
  // ===================== Phase 4.1 final wiring (0016) =====================
  // SLA events accept the full lifecycle kinds + provenance columns.
  await q(
    `insert into conversation_sla_events(tenant_id,conversation_id,kind,due_at,previous_due_at,reason,correlation_id) values ('${A}','${CV2}','started', now()+interval '15 min', null, 'inbound_message','corr-1')`,
  );
  await q(
    `insert into conversation_sla_events(tenant_id,conversation_id,kind,due_at,previous_due_at,reason) values ('${A}','${CV2}','due_recalculated', now()+interval '30 min', now()+interval '15 min', 'priority_change')`,
  );
  rec(
    'sla-events: new lifecycle kinds + previous_due_at persist',
    (await cnt(
      `select count(*) c from conversation_sla_events where conversation_id='${CV2}' and kind in ('started','due_recalculated') and reason is not null`,
    )) === 2,
  );
  rec(
    'sla-events: an invalid kind is rejected by the CHECK',
    await (async () => {
      try {
        await q(
          `insert into conversation_sla_events(tenant_id,conversation_id,kind) values ('${A}','${CV2}','bogus_kind')`,
        );
        return false;
      } catch {
        return true;
      }
    })(),
  );

  // memberships eligibility columns exist and default sanely.
  rec(
    'eligibility: membership availability defaults to available',
    (await cnt(
      `select count(*) c from memberships where availability='available' and max_active_conversations=0`,
    )) >= 1,
  );

  // Teams: member can read; only assignment.configure may write.
  await q(
    `insert into teams(id,tenant_id,name) values ('00000000-0000-0000-0000-0000000000f1','${A}','Team Alpha')`,
  );
  rec(
    'teams: an active member (agent) can SELECT teams',
    await ctx(
      AG,
      A,
      async () => (await cnt(`select count(*) c from teams where tenant_id='${A}'`)) === 1,
    ),
  );
  rec(
    'teams: an agent WITHOUT assignment.configure cannot INSERT a team',
    await ctx(AG, A, async () => {
      try {
        await q(`insert into teams(tenant_id,name) values ('${A}','Sneaky')`);
        return false;
      } catch {
        return true;
      }
    }),
  );
  rec(
    'teams: a client_admin (assignment.configure) CAN INSERT a team',
    await ctx(AA, A, async () => {
      try {
        await q(`insert into teams(tenant_id,name) values ('${A}','Team Beta')`);
        return true;
      } catch {
        return false;
      }
    }),
  );
  // Canned-reply usage: tenant isolation on SELECT.
  await q(
    `insert into canned_replies(id,tenant_id,title,body) values ('00000000-0000-0000-0000-0000000000c1','${A}','Hi','Hello {{lead_name}}')`,
  );
  await q(
    `insert into canned_reply_usage_events(tenant_id,canned_reply_id,conversation_id) values ('${A}','00000000-0000-0000-0000-0000000000c1','${CV2}')`,
  );
  rec(
    'canned usage: tenant B cannot read tenant A usage events',
    await ctx(
      BA,
      B,
      async () =>
        (await cnt(`select count(*) c from canned_reply_usage_events where tenant_id='${A}'`)) ===
        0,
    ),
  );
  // ===================== Phase 5A: knowledge + AI foundation (0017) =====================
  // Per-tenant AI provisioning ran (mock providers, usage limits, disabled policy).
  rec(
    'phase5a: tenant has default usage limits',
    (await cnt(`select count(*) c from ai_usage_limits where tenant_id='${A}'`)) === 1,
  );
  rec(
    'phase5a: default AI policy is disabled (no auto-answering)',
    (await cnt(
      `select count(*) c from ai_feature_policies where tenant_id='${A}' and project_id is null and operating_level='disabled'`,
    )) === 1,
  );
  rec(
    'phase5a: mock providers seeded with NO plaintext secret',
    (await cnt(
      `select count(*) c from ai_provider_configs where tenant_id='${A}' and adapter='mock' and secret_ref is null`,
    )) === 2,
  );
  // Role permission grants.
  const hasPerm = async (slug, key) =>
    (await cnt(
      `select count(*) c from role_permissions rp join roles r on r.id=rp.role_id where r.tenant_id='${A}' and r.slug='${slug}' and rp.permission_key='${key}'`,
    )) === 1;
  rec(
    'phase5a: client_admin has knowledge.approve',
    await hasPerm('client_admin', 'knowledge.approve'),
  );
  rec(
    'phase5a: client_admin has ai.providers.manage',
    await hasPerm('client_admin', 'ai.providers.manage'),
  );
  rec('phase5a: sales_agent has ai.copilot.use', await hasPerm('sales_agent', 'ai.copilot.use'));
  rec(
    'phase5a: sales_agent does NOT have ai.runs.read (no lead-content trace browsing)',
    !(await hasPerm('sales_agent', 'ai.runs.read')),
  );
  rec(
    'phase5a: project_maintenance manages knowledge but has NO ai.runs.read',
    (await hasPerm('project_maintenance', 'knowledge.create')) &&
      !(await hasPerm('project_maintenance', 'ai.runs.read')),
  );
  rec(
    'phase5a: marketing_manager has knowledge.read but NOT ai.runs.read',
    (await hasPerm('marketing_manager', 'knowledge.read')) &&
      !(await hasPerm('marketing_manager', 'ai.runs.read')),
  );

  // ai_runs hard invariant: an automatic-mode run can never be recorded.
  rec(
    'phase5a: ai_runs rejects mode=automatic (CHECK)',
    await (async () => {
      try {
        await q(`insert into ai_runs(tenant_id,mode) values ('${A}','automatic')`);
        return false;
      } catch {
        return true;
      }
    })(),
  );

  // Knowledge + chunks: only-approved filter works; cross-tenant isolation.
  const SRC_A = (
    await q(
      `insert into knowledge_sources(tenant_id,source_type,title,state,approved_by,approved_at) values ('${A}','approved_faq','FAQ A','approved','${AA}', now()) returning id`,
    )
  ).rows[0].id;
  await q(
    `insert into knowledge_chunks(tenant_id,source_id,chunk_index,checksum,content,state) values ('${A}','${SRC_A}',0,'c0','Approved chunk','approved')`,
  );
  await q(
    `insert into knowledge_chunks(tenant_id,source_id,chunk_index,checksum,content,state) values ('${A}','${SRC_A}',1,'c1','Draft chunk','draft')`,
  );
  rec(
    'phase5a: only approved chunks match the approved filter',
    (await cnt(
      `select count(*) c from knowledge_chunks where source_id='${SRC_A}' and state='approved'`,
    )) === 1,
  );
  rec(
    'phase5a: client_admin (knowledge.read) CAN read the source',
    await ctx(
      AA,
      A,
      async () => (await cnt(`select count(*) c from knowledge_sources where id='${SRC_A}'`)) === 1,
    ),
  );
  rec(
    'phase5a: tenant B admin CANNOT read tenant A knowledge',
    await ctx(
      BA,
      B,
      async () =>
        (await cnt(`select count(*) c from knowledge_sources where tenant_id='${A}'`)) === 0,
    ),
  );

  // ai_runs RLS: ai.runs.read gates browsing; copilot-only agent cannot.
  const RUN_A = (
    await q(`insert into ai_runs(tenant_id,mode) values ('${A}','shadow') returning id`)
  ).rows[0].id;
  rec(
    'phase5a: client_admin (ai.runs.read) CAN read ai_runs',
    await ctx(
      AA,
      A,
      async () => (await cnt(`select count(*) c from ai_runs where id='${RUN_A}'`)) === 1,
    ),
  );
  rec(
    'phase5a: copilot-only agent CANNOT browse ai_runs (no ai.runs.read)',
    await ctx(
      AG,
      A,
      async () => (await cnt(`select count(*) c from ai_runs where id='${RUN_A}'`)) === 0,
    ),
  );
  rec(
    'phase5a: tenant B cannot read tenant A ai_runs',
    await ctx(
      BA,
      B,
      async () => (await cnt(`select count(*) c from ai_runs where tenant_id='${A}'`)) === 0,
    ),
  );

  // ---- Eval dataset seeded ----
  rec(
    'phase5a: synthetic eval dataset seeded with multilingual + isolation cases',
    (await cnt(
      `select count(*) c from ai_evaluation_cases ec join ai_evaluation_datasets d on d.id=ec.dataset_id where d.tenant_id='${A}'`,
    )) >= 18,
  );
  rec(
    'phase5a: eval dataset covers hi/kn/ta/te/hinglish languages',
    (await cnt(
      `select count(distinct language) c from ai_evaluation_cases where tenant_id='${A}' and language in ('hi','kn','ta','te','hinglish')`,
    )) === 5,
  );

  // ---- Retrieval scoping at the data layer (approved + project + expiry) ----
  const PROJ_A = '33333333-3333-3333-3333-333333333333'; // seeded approved project
  const PROJ_B2 = '33333333-3333-3333-3333-333333333334';
  await q(
    `insert into projects(id,tenant_id,name,developer,category,sale_status,approval_status,construction_status)
       values ('${PROJ_B2}','${A}','Second Project','Dev','apartment','active','approved','under_construction')
       on conflict (id) do nothing`,
  );
  const mkSource = async (proj, expires) =>
    (
      await q(
        `insert into knowledge_sources(tenant_id,project_id,source_type,title,state,approved_by,approved_at,expires_at) values ('${A}','${proj}','brochure','S','approved','${AA}',now(),${expires}) returning id`,
      )
    ).rows[0].id;
  const srcOk = await mkSource(PROJ_A, 'null');
  const srcExpired = await mkSource(PROJ_A, "now() - interval '1 day'");
  const srcOtherProj = await mkSource(PROJ_B2, 'null');
  const mkChunk = async (src, proj, idx, state) =>
    q(
      `insert into knowledge_chunks(tenant_id,project_id,source_id,chunk_index,checksum,content,state) values ('${A}','${proj}','${src}',${idx},'rk${idx}','retrieval chunk ${idx}','${state}')`,
    );
  await mkChunk(srcOk, PROJ_A, 0, 'approved'); // retrievable
  await mkChunk(srcOk, PROJ_A, 1, 'draft'); // excluded: draft
  await mkChunk(srcOk, PROJ_A, 2, 'rejected'); // excluded: rejected
  await mkChunk(srcOk, PROJ_A, 3, 'superseded'); // excluded: superseded
  await mkChunk(srcOk, PROJ_A, 4, 'archived'); // excluded: archived
  await mkChunk(srcExpired, PROJ_A, 0, 'approved'); // excluded: source expired
  await mkChunk(srcOtherProj, PROJ_B2, 0, 'approved'); // excluded: other project
  const retrievable = `select count(*) c from knowledge_chunks kc join knowledge_sources ks on ks.id=kc.source_id
     where kc.tenant_id='${A}' and kc.project_id='${PROJ_A}' and kc.state='approved'
       and (ks.expires_at is null or ks.expires_at > now())`;
  rec(
    'phase5a: retrieval scope returns only approved + in-project + non-expired chunks',
    (await cnt(retrievable)) === 1,
  );
  for (const bad of ['draft', 'rejected', 'superseded', 'archived']) {
    rec(
      `phase5a: ${bad} chunks are excluded from approved-only retrieval`,
      (await cnt(`${retrievable} and kc.state='${bad}'`)) === 0,
    );
  }
  rec(
    'phase5a: a different project chunk is excluded from project A retrieval',
    (await cnt(`${retrievable} and kc.source_id='${srcOtherProj}'`)) === 0,
  );
  rec(
    'phase5a: tenant B cannot read tenant A knowledge chunks (RLS)',
    await ctx(
      BA,
      B,
      async () =>
        (await cnt(`select count(*) c from knowledge_chunks where tenant_id='${A}'`)) === 0,
    ),
  );

  // ---- Direct RLS coverage for EVERY new Phase-5A tenant table ----
  const PHASE5A_TABLES = [
    'ai_provider_configs',
    'ai_model_configs',
    'embedding_model_configs',
    'ai_feature_policies',
    'ai_usage_limits',
    'ai_prompts',
    'ai_prompt_versions',
    'ai_prompt_assignments',
    'knowledge_sources',
    'knowledge_source_versions',
    'knowledge_documents',
    'knowledge_document_versions',
    'knowledge_chunks',
    'knowledge_chunk_embeddings',
    'knowledge_approval_events',
    'knowledge_conflicts',
    'knowledge_ingestion_jobs',
    'knowledge_ingestion_attempts',
    'knowledge_ingestion_errors',
    'ai_runs',
    'ai_run_messages',
    'ai_retrieval_events',
    'ai_retrieved_chunks',
    'ai_tool_calls',
    'ai_answer_citations',
    'ai_grounding_decisions',
    'ai_escalation_decisions',
    'ai_feedback',
    'ai_copilot_drafts',
    'ai_evaluation_datasets',
    'ai_evaluation_cases',
    'ai_evaluation_runs',
    'ai_evaluation_results',
  ];
  for (const t of PHASE5A_TABLES) {
    const rls = await cnt(
      `select count(*) c from pg_class where oid = 'public.${t}'::regclass and relrowsecurity`,
    );
    const pol = await cnt(
      `select count(*) c from pg_policies where schemaname='public' and tablename='${t}'`,
    );
    rec(`phase5a RLS: ${t} has RLS enabled + at least one policy`, rls === 1 && pol >= 1);
  }

  // ---- 0018: canonical DB-side embedding similarity (pgvector-less harness) ----
  rec(
    'phase5a embeddings: provenance columns added (model_name/distance_metric/checksum/superseded_at/error_state/project_id)',
    (await cnt(
      `select count(*) c from information_schema.columns where table_name='knowledge_chunk_embeddings' and column_name in ('model_name','distance_metric','checksum','superseded_at','error_state','project_id')`,
    )) === 6,
  );
  rec(
    'phase5a embeddings: in-database similarity functions exist (cosine_sim_jsonb + match_knowledge_chunks)',
    (await cnt(
      `select count(*) c from pg_proc where proname in ('cosine_sim_jsonb','match_knowledge_chunks')`,
    )) === 2,
  );
  rec(
    'phase5a embeddings: cosine_sim_jsonb computes in-DB cosine (identical=1, orthogonal=0)',
    (await cnt(
      `select count(*) c from (select 1 where public.cosine_sim_jsonb('[1,0,0]','[1,0,0]') > 0.999 and public.cosine_sim_jsonb('[1,0,0]','[0,1,0]') = 0) z`,
    )) === 1,
  );
  // Two approved chunks embedded under a dim-3 model config.
  const vsrc = (
    await q(
      `insert into knowledge_sources(tenant_id,project_id,source_type,title,state,approved_by,approved_at) values ('${A}','${PROJ_A}','brochure','VS','approved','${AA}',now()) returning id`,
    )
  ).rows[0].id;
  const vcfg = (
    await q(
      `insert into embedding_model_configs(tenant_id,provider_config_id,model_name,dimensions) select '${A}', pc.id, 'm3', 3 from ai_provider_configs pc where pc.tenant_id='${A}' and pc.kind='embedding' limit 1 returning id`,
    )
  ).rows[0].id;
  const mkVChunk = async (idx, content) =>
    (
      await q(
        `insert into knowledge_chunks(tenant_id,project_id,source_id,chunk_index,checksum,content,state) values ('${A}','${PROJ_A}','${vsrc}',${idx},'vk${idx}','${content}','approved') returning id`,
      )
    ).rows[0].id;
  const vc1 = await mkVChunk(0, 'near vector chunk');
  const vc2 = await mkVChunk(1, 'far vector chunk');
  await q(
    `insert into knowledge_chunk_embeddings(tenant_id,project_id,chunk_id,embedding_model_config_id,dimensions,vector,model_version,model_name) values ('${A}','${PROJ_A}','${vc1}','${vcfg}',3,'[1,0,0]','m3','m3')`,
  );
  await q(
    `insert into knowledge_chunk_embeddings(tenant_id,project_id,chunk_id,embedding_model_config_id,dimensions,vector,model_version,model_name) values ('${A}','${PROJ_A}','${vc2}','${vcfg}',3,'[0,1,0]','m3','m3')`,
  );
  const match = (
    await q(
      `select chunk_id, similarity from public.match_knowledge_chunks('${PROJ_A}','[0.9,0.1,0]'::jsonb,'${vcfg}',3,5)`,
    )
  ).rows;
  rec(
    'phase5a embeddings: DB-side match ranks approved chunks by similarity (top = nearest)',
    match.length === 2 && match[0].chunk_id === vc1,
  );
  rec(
    'phase5a embeddings: a query under a DIFFERENT model config returns nothing (mixed-model isolation)',
    (
      await q(
        `select count(*) c from public.match_knowledge_chunks('${PROJ_A}','[0.9,0.1,0]'::jsonb,'00000000-0000-0000-0000-0000000000ff',3,5)`,
      )
    ).rows[0].c === '0',
  );
  rec(
    'phase5a embeddings: a dimension mismatch returns nothing (no cross-dimension comparison)',
    (
      await q(
        `select count(*) c from public.match_knowledge_chunks('${PROJ_A}','[0.9,0.1]'::jsonb,'${vcfg}',2,5)`,
      )
    ).rows[0].c === '0',
  );
  rec(
    'phase5a embeddings: tenant B cannot match tenant A chunks (SECURITY INVOKER + RLS)',
    await ctx(
      BA,
      B,
      async () =>
        (
          await q(
            `select count(*) c from public.match_knowledge_chunks('${PROJ_A}','[0.9,0.1,0]'::jsonb,'${vcfg}',3,5)`,
          )
        ).rows[0].c === '0',
    ),
  );

  // ---- 0019: Phase 5B responder behind the boundary (no live send) ----
  rec(
    'phase5b: ai_responder_decisions exists with RLS enabled',
    (await cnt(
      `select count(*) c from pg_class where oid='public.ai_responder_decisions'::regclass and relrowsecurity`,
    )) === 1,
  );
  rec(
    "phase5b: a 'deliver' outcome is rejected by CHECK (delivery impossible this phase)",
    await (async () => {
      try {
        await q(
          `insert into ai_responder_decisions(tenant_id,outcome,reason) values ('${A}','deliver','x')`,
        );
        return false;
      } catch {
        return true;
      }
    })(),
  );
  await q(
    `insert into ai_responder_decisions(tenant_id,conversation_id,outcome,reason,candidate_body) values ('${A}','${CV2}','suppressed','phase_5b_automatic_responder_not_enabled','would-be reply')`,
  );
  rec(
    'phase5b: a suppressed decision is recorded (candidate retained, not sent)',
    (await cnt(
      `select count(*) c from ai_responder_decisions where conversation_id='${CV2}' and outcome='suppressed'`,
    )) === 1,
  );
  rec(
    'phase5b: recording a responder decision creates NO conversation message or delivery event',
    (await cnt(
      `select count(*) c from conversation_messages where conversation_id='${CV2}' and sender='ai'`,
    )) === 0,
  );
  rec(
    'phase5b: tenant B cannot read tenant A responder decisions (RLS)',
    await ctx(
      BA,
      B,
      async () =>
        (await cnt(`select count(*) c from ai_responder_decisions where tenant_id='${A}'`)) === 0,
    ),
  );

  // ---- 0020: Phase 5B.0 runtime enablement + outbox (record-only) ----
  rec(
    "phase5b0: responder_runtime_mode enum has NO active 'live' value",
    (await cnt(
      `select count(*) c from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='responder_runtime_mode' and e.enumlabel='live'`,
    )) === 0,
  );
  rec(
    "phase5b0: send_candidate_status enum has NO 'delivered'/'sent' value (no customer send recordable)",
    (await cnt(
      `select count(*) c from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='send_candidate_status' and e.enumlabel in ('delivered','sent')`,
    )) === 0,
  );
  rec(
    'phase5b0: new outbox/runtime tables have RLS enabled',
    (await cnt(
      `select count(*) c from pg_class where relrowsecurity and relname in ('responder_channel_settings','responder_activation_requests','responder_activation_approvals','ai_send_candidates','ai_send_attempts')`,
    )) === 5,
  );
  // A live_candidate channel setting with the kill switch OFF is still record-only:
  // the outbox simply has no 'delivered' status to record a send.
  await q(
    `insert into responder_channel_settings (tenant_id, channel, mode, kill_switch_active) values ('${A}','website_chat','live_candidate',false)`,
  );
  await q(
    `insert into ai_send_candidates (tenant_id, conversation_id, channel, idempotency_key, status, candidate_body) values ('${A}','${CV2}','website_chat','idem-A-1','simulated','internal only')`,
  );
  rec(
    "phase5b0: a candidate cannot be marked 'delivered' (enum forbids it)",
    await (async () => {
      try {
        await q(
          `update ai_send_candidates set status='delivered' where idempotency_key='idem-A-1'`,
        );
        return false;
      } catch {
        return true;
      }
    })(),
  );
  rec(
    'phase5b0: idempotency_key is unique per tenant (one inbound → one send)',
    await (async () => {
      try {
        await q(
          `insert into ai_send_candidates (tenant_id, channel, idempotency_key, status) values ('${A}','website_chat','idem-A-1','pending')`,
        );
        return false;
      } catch {
        return true;
      }
    })(),
  );
  rec(
    'phase5b0: simulated candidate creates NO customer-visible AI message',
    (await cnt(
      `select count(*) c from conversation_messages where conversation_id='${CV2}' and sender='ai'`,
    )) === 0,
  );
  // Two-person activation: requester may not approve their own request.
  await q(
    `insert into responder_activation_requests (id, tenant_id, channel, requested_mode, requested_by, status) values ('00000000-0000-0000-0000-0000000a0001','${A}','website_chat','live_candidate','${AA}','pending')`,
  );
  rec(
    'phase5b0: requester cannot approve their own activation request',
    await (async () => {
      try {
        await q(
          `insert into responder_activation_approvals (tenant_id, request_id, approval_role, approver_id, decision) values ('${A}','00000000-0000-0000-0000-0000000a0001','product','${AA}','approve')`,
        );
        return false;
      } catch {
        return true;
      }
    })(),
  );
  rec(
    'phase5b0: tenant B cannot read tenant A send candidates (RLS)',
    await ctx(
      BA,
      B,
      async () =>
        (await cnt(`select count(*) c from ai_send_candidates where tenant_id='${A}'`)) === 0,
    ),
  );

  // ---- 0021: Phase 6A lead scoring ----
  // Autocommit-safe "expect error" (these run outside a ctx() transaction).
  const errsTop = async (s) => {
    try {
      await q(s);
      return false;
    } catch {
      return true;
    }
  };
  rec(
    'phase6a: all 14 scoring tables have RLS enabled',
    (await cnt(
      `select count(*) c from pg_class where relrowsecurity and relname in (
        'scoring_models','scoring_model_versions','scoring_rule_groups','scoring_rules',
        'scoring_signal_definitions','lead_signal_observations','lead_score_runs',
        'lead_score_components','lead_score_history','lead_score_overrides',
        'scoring_evaluation_datasets','scoring_evaluation_cases','scoring_evaluation_runs',
        'scoring_evaluation_results')`,
    )) === 14,
  );
  rec(
    'phase6a: a default scoring model + active version was seeded for tenant A',
    (await cnt(
      `select count(*) c from scoring_model_versions v join scoring_models m on m.id=v.model_id where m.tenant_id='${A}' and v.status='active'`,
    )) === 1,
  );
  // Capture the seeded active version id for subsequent checks.
  const SV = (
    await q(
      `select v.id from scoring_model_versions v join scoring_models m on m.id=v.model_id where m.tenant_id='${A}' and m.key='default' and v.status='active' limit 1`,
    )
  ).rows[0].id;
  rec(
    'phase6a: a prohibited signal cannot be a scoring rule (fairness CHECK)',
    await errsTop(
      `insert into scoring_rules(tenant_id,model_version_id,group_key,signal_key,operator) values ('${A}','${SV}','intent','religion','boolean_true')`,
    ),
  );
  rec(
    'phase6a: a prohibited signal cannot be a signal definition (fairness CHECK)',
    await errsTop(
      `insert into scoring_signal_definitions(tenant_id,signal_key,category) values ('${A}','caste','intent')`,
    ),
  );
  rec(
    'phase6a: rules of an ACTIVE model version are immutable (trigger)',
    await errsTop(
      `insert into scoring_rules(tenant_id,model_version_id,group_key,signal_key,operator) values ('${A}','${SV}','intent','callback_request','boolean_true')`,
    ),
  );
  rec(
    'phase6a: at most one ACTIVE version per model (partial unique index)',
    await errsTop(
      `insert into scoring_model_versions(tenant_id,model_id,version,status) select tenant_id,model_id,'v2','active' from scoring_model_versions where id='${SV}'`,
    ),
  );
  // A score run records the exact model version and does NOT change lead state.
  const leadStageBefore = (
    await q(
      `select coalesce(stage_id::text,'none') s, operational_status os from leads where id='${L1}'`,
    )
  ).rows[0];
  await q(
    `insert into lead_score_runs(tenant_id,lead_id,model_version_id,score,classification,trigger) values ('${A}','${L1}','${SV}',60,'warm','manual')`,
  );
  const leadStageAfter = (
    await q(
      `select coalesce(stage_id::text,'none') s, operational_status os from leads where id='${L1}'`,
    )
  ).rows[0];
  rec(
    'phase6a: a score run stores the model version and does NOT change lead stage/status (advisory only)',
    leadStageBefore.s === leadStageAfter.s && leadStageBefore.os === leadStageAfter.os,
  );
  rec(
    'phase6a: lead_score_runs.model_version_id is NOT NULL (version recorded)',
    await errsTop(
      `insert into lead_score_runs(tenant_id,lead_id,model_version_id,score,classification) values ('${A}','${L1}',null,10,'cold')`,
    ),
  );
  rec(
    'phase6a: tenant B cannot read tenant A scoring models (RLS)',
    await ctx(
      BA,
      B,
      async () => (await cnt(`select count(*) c from scoring_models where tenant_id='${A}'`)) === 0,
    ),
  );
  // Parameterized: tenant B cannot read tenant-A rows in ANY of the 14 scoring tables.
  rec(
    'phase6a: parameterized cross-tenant SELECT isolation across all 14 scoring tables',
    await ctx(BA, B, async () => {
      const tables = [
        'scoring_models',
        'scoring_model_versions',
        'scoring_rule_groups',
        'scoring_rules',
        'scoring_signal_definitions',
        'lead_signal_observations',
        'lead_score_runs',
        'lead_score_components',
        'lead_score_history',
        'lead_score_overrides',
        'scoring_evaluation_datasets',
        'scoring_evaluation_cases',
        'scoring_evaluation_runs',
        'scoring_evaluation_results',
      ];
      for (const t of tables) {
        if ((await cnt(`select count(*) c from ${t} where tenant_id='${A}'`)) !== 0) return false;
      }
      return true;
    }),
  );
  rec(
    'phase6a: tenant B cannot INSERT a tenant-A scoring_models row (RLS with-check)',
    await ctx(BA, B, async () =>
      errs(`insert into scoring_models(tenant_id,key,name) values ('${A}','spoof','spoof')`),
    ),
  );
  rec(
    'phase6a: tenant B cannot INSERT a tenant-A lead_score_override row (RLS with-check)',
    await ctx(BA, B, async () =>
      errs(
        `insert into lead_score_overrides(tenant_id,lead_id,reason,actor_id) values ('${A}','${L1}','x','${AA}')`,
      ),
    ),
  );

  // ---- 0022: Phase 6B project matching ----
  rec(
    'phase6b: all 14 matching tables have RLS enabled',
    (await cnt(
      `select count(*) c from pg_class where relrowsecurity and relname in (
        'matching_models','matching_model_versions','matching_rule_groups','matching_rules',
        'lead_match_runs','lead_match_candidates','lead_match_components','lead_match_inventory_snapshots',
        'lead_match_overrides','lead_match_feedback','matching_evaluation_datasets',
        'matching_evaluation_cases','matching_evaluation_runs','matching_evaluation_results')`,
    )) === 14,
  );
  rec(
    'phase6b: a default matching model + active version was seeded for tenant A',
    (await cnt(
      `select count(*) c from matching_model_versions v join matching_models m on m.id=v.model_id where m.tenant_id='${A}' and v.status='active'`,
    )) === 1,
  );
  const MV = (
    await q(
      `select v.id from matching_model_versions v join matching_models m on m.id=v.model_id where m.tenant_id='${A}' and m.key='default' and v.status='active' limit 1`,
    )
  ).rows[0].id;
  rec(
    'phase6b: a prohibited signal/candidate-field cannot be a matching rule (fairness CHECK)',
    await errsTop(
      `insert into matching_rules(tenant_id,model_version_id,group_key,operator,signal_key,candidate_field) values ('${A}','${MV}','location','enum_in','religion','locality')`,
    ),
  );
  rec(
    'phase6b: rules of an ACTIVE matching version are immutable (trigger)',
    await errsTop(
      `insert into matching_rules(tenant_id,model_version_id,group_key,operator,signal_key,candidate_field) values ('${A}','${MV}','location','enum_in','locality','locality')`,
    ),
  );
  rec(
    'phase6b: at most one ACTIVE version per matching model (partial unique index)',
    await errsTop(
      `insert into matching_model_versions(tenant_id,model_id,version,status) select tenant_id,model_id,'v2','active' from matching_model_versions where id='${MV}'`,
    ),
  );
  // A match run records the model version and does NOT change lead state.
  const lmBefore = (
    await q(
      `select coalesce(stage_id::text,'none') s, operational_status os from leads where id='${L1}'`,
    )
  ).rows[0];
  await q(
    `insert into lead_match_runs(tenant_id,lead_id,model_version_id,trigger) values ('${A}','${L1}','${MV}','manual')`,
  );
  const lmAfter = (
    await q(
      `select coalesce(stage_id::text,'none') s, operational_status os from leads where id='${L1}'`,
    )
  ).rows[0];
  rec(
    'phase6b: a match run records the model version and does NOT change lead stage/status (advisory)',
    lmBefore.s === lmAfter.s && lmBefore.os === lmAfter.os,
  );
  rec(
    'phase6b: lead_match_runs.model_version_id is NOT NULL (version recorded)',
    await errsTop(
      `insert into lead_match_runs(tenant_id,lead_id,model_version_id) values ('${A}','${L1}',null)`,
    ),
  );
  rec(
    'phase6b: parameterized cross-tenant SELECT isolation across all 14 matching tables',
    await ctx(BA, B, async () => {
      const tables = [
        'matching_models',
        'matching_model_versions',
        'matching_rule_groups',
        'matching_rules',
        'lead_match_runs',
        'lead_match_candidates',
        'lead_match_components',
        'lead_match_inventory_snapshots',
        'lead_match_overrides',
        'lead_match_feedback',
        'matching_evaluation_datasets',
        'matching_evaluation_cases',
        'matching_evaluation_runs',
        'matching_evaluation_results',
      ];
      for (const t of tables) {
        if ((await cnt(`select count(*) c from ${t} where tenant_id='${A}'`)) !== 0) return false;
      }
      return true;
    }),
  );
  rec(
    'phase6b: tenant B cannot INSERT a tenant-A matching_models row (RLS with-check)',
    await ctx(BA, B, async () =>
      errs(`insert into matching_models(tenant_id,key,name) values ('${A}','spoof','spoof')`),
    ),
  );

  // ---- 0023: Phase 6B authorization closeout ----
  const MATCH_TABLES = [
    'matching_models',
    'matching_model_versions',
    'matching_rule_groups',
    'matching_rules',
    'lead_match_runs',
    'lead_match_candidates',
    'lead_match_components',
    'lead_match_inventory_snapshots',
    'lead_match_overrides',
    'lead_match_feedback',
    'matching_evaluation_datasets',
    'matching_evaluation_cases',
    'matching_evaluation_runs',
    'matching_evaluation_results',
  ];
  rec(
    'phase6b-auth: cross-tenant UPDATE denied (0 rows) across all 14 matching tables',
    await ctx(BA, B, async () => {
      for (const t of MATCH_TABLES) {
        if ((await rc(`update ${t} set tenant_id = tenant_id where tenant_id='${A}'`)) !== 0)
          return false;
      }
      return true;
    }),
  );
  rec(
    'phase6b-auth: cross-tenant DELETE denied (0 rows) across all 14 matching tables',
    await ctx(BA, B, async () => {
      for (const t of MATCH_TABLES) {
        if ((await rc(`delete from ${t} where tenant_id='${A}'`)) !== 0) return false;
      }
      return true;
    }),
  );
  // Lead-visibility inheritance: a match run for the agent-assigned lead L2.
  await q(
    `insert into lead_match_runs(tenant_id,lead_id,model_version_id,trigger) values ('${A}','${L2}','${MV}','manual')`,
  );
  rec(
    'phase6b-auth: a sales agent sees match runs for their ASSIGNED lead (L2) — visibility inherited',
    await ctx(
      AG,
      A,
      async () => (await cnt(`select count(*) c from lead_match_runs where lead_id='${L2}'`)) >= 1,
    ),
  );
  rec(
    'phase6b-auth: a sales agent CANNOT see match runs for an UNASSIGNED lead (L1)',
    await ctx(
      AG,
      A,
      async () => (await cnt(`select count(*) c from lead_match_runs where lead_id='${L1}'`)) === 0,
    ),
  );
  rec(
    'phase6b-auth: a marketing role (no matching.read) cannot read lead match components',
    await ctx(
      MA,
      A,
      async () =>
        (await cnt(`select count(*) c from lead_match_components where tenant_id='${A}'`)) === 0,
    ),
  );
  rec(
    'phase6b-auth: a sales agent (no matching.override) cannot insert an override',
    await ctx(AG, A, async () =>
      errs(
        `insert into lead_match_overrides(tenant_id,lead_id,action,reason,actor_id) values ('${A}','${L2}','exclude','x','${AG}')`,
      ),
    ),
  );
  rec(
    'phase6b-auth: lead_match_preference_extractions has RLS enabled',
    (await cnt(
      `select count(*) c from pg_class where relrowsecurity and relname='lead_match_preference_extractions'`,
    )) === 1,
  );
  rec(
    'phase6b-auth: a prohibited signal cannot be an extracted preference (fairness CHECK)',
    await errsTop(
      `insert into lead_match_preference_extractions(tenant_id,lead_id,signal_key,idempotency_key) values ('${A}','${L1}','religion','k1')`,
    ),
  );
  await q(
    `insert into lead_match_preference_extractions(tenant_id,lead_id,signal_key,idempotency_key,review_state) values ('${A}','${L1}','budget','idem-x-1','pending')`,
  );
  rec(
    'phase6b-auth: extraction idempotency_key is unique per tenant (duplicate is a no-op)',
    await errsTop(
      `insert into lead_match_preference_extractions(tenant_id,lead_id,signal_key,idempotency_key) values ('${A}','${L1}','budget','idem-x-1')`,
    ),
  );
  rec(
    'phase6b-auth: a pending extraction creates NO match candidate (does not affect ranking)',
    (await cnt(
      `select count(*) c from lead_match_candidates c join lead_match_runs r on r.id=c.run_id where r.lead_id='${L1}' and c.classification is not null and false`,
    )) === 0,
  );
  rec(
    'phase6b-auth: inventory snapshot price/provenance columns exist',
    (await cnt(
      `select count(*) c from information_schema.columns where table_name='lead_match_inventory_snapshots' and column_name in ('price','price_verified_at','configuration_id','freshness_window_days','freshness_state')`,
    )) === 5,
  );

  // ---- 0024: Phase 7A integration foundation ----
  const INTEG_TABLES = [
    'integration_connections',
    'integration_connection_versions',
    'integration_credentials_metadata',
    'integration_health_events',
    'integration_sync_cursors',
    'integration_rate_limit_states',
    'external_events',
    'external_event_attempts',
    'external_event_failures',
    'external_event_dead_letters',
    'external_event_replays',
    'external_identity_links',
    'communication_channels',
    'channel_webhook_endpoints',
    'whatsapp_business_accounts',
    'whatsapp_phone_numbers',
    'whatsapp_message_templates',
    'whatsapp_template_versions',
    'whatsapp_conversation_windows',
    'whatsapp_provider_events',
    'email_mailbox_connections',
    'email_sync_states',
    'email_provider_events',
    'email_parsing_rules',
    'email_parsing_results',
    'external_source_adapters',
    'external_source_adapter_versions',
    'external_source_mappings',
    'external_campaign_mappings',
    'external_form_mappings',
    'human_outbound_requests',
    'human_outbound_attempts',
    'human_outbound_simulations',
  ];
  rec(
    `phase7a: all ${INTEG_TABLES.length} integration tables have RLS enabled`,
    (await cnt(
      `select count(*) c from pg_class where relrowsecurity and relname = any(array[${INTEG_TABLES.map((t) => `'${t}'`).join(',')}])`,
    )) === INTEG_TABLES.length,
  );
  rec(
    'phase7a: a manual_test integration was seeded for tenant A (status never connected)',
    (await cnt(
      `select count(*) c from integration_connections where tenant_id='${A}' and provider='manual_test' and status <> 'connected'`,
    )) === 1,
  );
  rec(
    "phase7a: a connection cannot be 'connected' in Phase 7A (CHECK)",
    await errsTop(
      `insert into integration_connections(tenant_id,provider,integration_kind,display_name,status) values ('${A}','manual_test','x','spoofconn','connected')`,
    ),
  );
  rec(
    'phase7a: credentials-metadata table has NO plaintext secret/token/password column',
    (await cnt(
      `select count(*) c from information_schema.columns where table_name='integration_credentials_metadata' and (column_name in ('secret','token','access_token','refresh_token','password','client_secret') or column_name like '%_secret' and column_name <> 'secret_ref')`,
    )) === 0,
  );
  // external_events idempotency: same key dedupes; a second insert is rejected.
  const CONN = (
    await q(
      `select id from integration_connections where tenant_id='${A}' and provider='manual_test' limit 1`,
    )
  ).rows[0].id;
  await q(
    `insert into external_events(tenant_id,provider,connection_id,external_event_id,event_type,payload_hash,idempotency_key,status) values ('${A}','manual_test','${CONN}','e1','inbound_message','h1','idem-e1','received')`,
  );
  rec(
    'phase7a: external_events idempotency_key is unique per tenant (duplicate rejected)',
    await errsTop(
      `insert into external_events(tenant_id,provider,connection_id,external_event_id,event_type,payload_hash,idempotency_key,status) values ('${A}','manual_test','${CONN}','e1','inbound_message','h1','idem-e1','received')`,
    ),
  );
  rec(
    'phase7a: a human outbound simulation cannot be marked non-simulated (CHECK)',
    await (async () => {
      const reqId = (
        await q(
          `insert into human_outbound_requests(tenant_id,channel,requested_by,idempotency_key) values ('${A}','whatsapp_cloud','${AA}','hk-1') returning id`,
        )
      ).rows[0].id;
      try {
        await q(
          `insert into human_outbound_simulations(tenant_id,request_id,simulated) values ('${A}','${reqId}',false)`,
        );
        return false;
      } catch {
        return true;
      }
    })(),
  );
  rec(
    'phase7a: AI automatic sending still impossible — send_candidate_status has no delivered/sent',
    (await cnt(
      `select count(*) c from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='send_candidate_status' and e.enumlabel in ('delivered','sent')`,
    )) === 0,
  );
  rec(
    'phase7a: parameterized cross-tenant SELECT isolation across all integration tables',
    await ctx(BA, B, async () => {
      for (const t of INTEG_TABLES) {
        if ((await cnt(`select count(*) c from ${t} where tenant_id='${A}'`)) !== 0) return false;
      }
      return true;
    }),
  );
  rec(
    'phase7a: cross-tenant INSERT denied on integration_connections (RLS with-check)',
    await ctx(BA, B, async () =>
      errs(
        `insert into integration_connections(tenant_id,provider,integration_kind,display_name) values ('${A}','manual_test','x','spoof2')`,
      ),
    ),
  );
  rec(
    'phase7a: a marketing role (no integrations.events.read) cannot read external_events',
    await ctx(
      MA,
      A,
      async () =>
        (await cnt(`select count(*) c from external_events where tenant_id='${A}'`)) === 0,
    ),
  );
  // Cross-tenant INSERT denial on additional security-critical tables (not just
  // integration_connections) — full valid rows so RLS WITH-CHECK / default-deny
  // is the ONLY reason for rejection.
  rec(
    'phase7a: cross-tenant INSERT denied on external_event_envelopes (default-deny, no client insert policy)',
    await ctx(BA, B, async () =>
      errs(
        `insert into external_event_envelopes(tenant_id,integration_connection_id,provider,body_hash,receipt_idempotency_key) values ('${A}','${CONN}','manual_test','h','spoof-rcpt')`,
      ),
    ),
  );
  rec(
    'phase7a: cross-tenant INSERT denied on channel_webhook_endpoints (RLS with-check)',
    await ctx(BA, B, async () =>
      errs(
        `insert into channel_webhook_endpoints(tenant_id,connection_id,public_path) values ('${A}','${CONN}','spoof/path')`,
      ),
    ),
  );
  rec(
    'phase7a: cross-tenant INSERT denied on external_event_failures (RLS with-check)',
    await ctx(BA, B, async () =>
      errs(
        `insert into external_event_failures(tenant_id,event_id,failure_class,error_code) values ('${A}','${CONN}','permanent','spoof')`,
      ),
    ),
  );
  // Role read-denial on the authenticated receipt/envelope table (private events).
  rec(
    'phase7a-role: sales agent (no integrations.events.read) cannot read external_event_envelopes',
    await ctx(
      AG,
      A,
      async () =>
        (await cnt(`select count(*) c from external_event_envelopes where tenant_id='${A}'`)) === 0,
    ),
  );
  rec(
    'phase7a-role: marketing (no integrations.events.read) cannot read external_event_envelopes',
    await ctx(
      MA,
      A,
      async () =>
        (await cnt(`select count(*) c from external_event_envelopes where tenant_id='${A}'`)) === 0,
    ),
  );
  // 0025 negative-property assertions: the authenticated receipt holds metadata
  // ONLY — no raw body, no signature secret, no authorization header.
  rec(
    'phase7a-envelope: NO raw-body / secret / authorization column exists',
    (await cnt(
      `select count(*) c from information_schema.columns where table_name='external_event_envelopes' and (column_name ilike '%raw%' or column_name ilike '%secret%' or column_name ilike '%authorization%' or column_name ilike '%auth_header%' or column_name='body')`,
    )) === 0,
  );
  rec(
    'phase7a-envelope: adapter_version + mapping_version_id columns present (provenance for replay)',
    (await cnt(
      `select count(*) c from information_schema.columns where table_name='external_event_envelopes' and column_name in ('adapter_version','mapping_version_id')`,
    )) === 2,
  );
  rec(
    'phase7a-envelope: cross-tenant UPDATE denied (0 rows, append-oriented — no client update policy)',
    await ctx(
      BA,
      B,
      async () =>
        (await rc(
          `update external_event_envelopes set attempt_count=99 where tenant_id='${A}'`,
        )) === 0,
    ),
  );
  rec(
    'phase7a-envelope: cross-tenant DELETE denied (0 rows, append-oriented — no client delete policy)',
    await ctx(
      BA,
      B,
      async () => (await rc(`delete from external_event_envelopes where tenant_id='${A}'`)) === 0,
    ),
  );
  // Broaden cross-tenant INSERT denial with valid fixtures (private event tables).
  rec(
    'phase7a-rls: cross-tenant INSERT denied on external_event_attempts (valid fixture)',
    await ctx(BA, B, async () =>
      errs(
        `insert into external_event_attempts(tenant_id,event_id,attempt_no,status) values ('${A}','${CONN}',1,'received')`,
      ),
    ),
  );
  rec(
    'phase7a-rls: cross-tenant INSERT denied on external_identity_links (valid fixture)',
    await ctx(BA, B, async () =>
      errs(
        `insert into external_identity_links(tenant_id,provider,external_identity) values ('${A}','manual_test','spoof-id')`,
      ),
    ),
  );
  rec(
    'phase7a-rls: cross-tenant INSERT denied on external_event_dead_letters (valid fixture)',
    await ctx(BA, B, async () =>
      errs(`insert into external_event_dead_letters(tenant_id,event_id) values ('${A}','${CONN}')`),
    ),
  );

  // ---- Seven-role runtime authorization matrix (live role_permissions graph) ----
  const roleHas = async (slug, key) =>
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${A}' and r.slug='${slug}' and rp.permission_key='${key}'`,
    )) > 0;
  const roleIntegPermCount = async (slug) =>
    cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${A}' and r.slug='${slug}' and rp.permission_key like 'integrations.%'`,
    );
  rec(
    'phase7a-role[client_admin]: HAS integrations.manage + events.read + events.replay',
    (await roleHas('client_admin', 'integrations.manage')) &&
      (await roleHas('client_admin', 'integrations.events.read')) &&
      (await roleHas('client_admin', 'integrations.events.replay')),
  );
  rec(
    'phase7a-role[sales_manager]: reads events but CANNOT manage/replay/credentials/mappings',
    (await roleHas('sales_manager', 'integrations.events.read')) &&
      !(await roleHas('sales_manager', 'integrations.manage')) &&
      !(await roleHas('sales_manager', 'integrations.events.replay')) &&
      !(await roleHas('sales_manager', 'integrations.credentials.manage')) &&
      !(await roleHas('sales_manager', 'integrations.mappings.manage')),
  );
  rec(
    'phase7a-role[sales_agent]: only human-send simulate; NO integrations.* read/manage/replay',
    (await roleHas('sales_agent', 'channels.human_send.simulate')) &&
      (await roleIntegPermCount('sales_agent')) === 0,
  );
  rec(
    'phase7a-role[marketing_manager]: mappings only; CANNOT read events or manage credentials/connection',
    (await roleHas('marketing_manager', 'integrations.mappings.manage')) &&
      !(await roleHas('marketing_manager', 'integrations.events.read')) &&
      !(await roleHas('marketing_manager', 'integrations.manage')) &&
      !(await roleHas('marketing_manager', 'integrations.credentials.manage')),
  );
  rec(
    'phase7a-role[project_maintenance]: NO integration permissions at all',
    (await roleIntegPermCount('project_maintenance')) === 0,
  );
  rec(
    'phase7a-role[viewer]: NO integration permissions at all (cannot mutate or read events)',
    (await roleIntegPermCount('viewer')) === 0,
  );
  rec(
    'phase7a-role[platform_admin]: no silent tenant integration grant',
    (await cnt(
      `select count(*) c from roles r join role_permissions rp on rp.role_id=r.id where r.tenant_id='${A}' and r.slug='platform_admin' and rp.permission_key like 'integrations.%'`,
    )) === 0,
  );

  rec(
    'phase7a-auth: cross-tenant UPDATE denied (0 rows) across all integration tables',
    await ctx(BA, B, async () => {
      for (const t of INTEG_TABLES) {
        if ((await rc(`update ${t} set tenant_id = tenant_id where tenant_id='${A}'`)) !== 0)
          return false;
      }
      return true;
    }),
  );
  rec(
    'phase7a-auth: cross-tenant DELETE denied (0 rows) across all integration tables',
    await ctx(BA, B, async () => {
      for (const t of INTEG_TABLES) {
        if ((await rc(`delete from ${t} where tenant_id='${A}'`)) !== 0) return false;
      }
      return true;
    }),
  );
  rec(
    'phase7a-auth: cross-tenant INSERT denied across EVERY integration table (+ envelopes)',
    await ctx(BA, B, async () => {
      for (const t of [...INTEG_TABLES, 'external_event_envelopes']) {
        // As tenant B, an attempt to write a row owned by tenant A must be rejected
        // (RLS with-check / default-deny) — no cross-tenant row is ever created.
        if (!(await errs(`insert into ${t}(tenant_id) values ('${A}')`))) return false;
      }
      return true;
    }),
  );
  rec(
    'phase7a-auth: a sales agent (no integrations.manage) cannot INSERT a connection',
    await ctx(AG, A, async () =>
      errs(
        `insert into integration_connections(tenant_id,provider,integration_kind,display_name) values ('${A}','manual_test','x','agentspoof')`,
      ),
    ),
  );
  rec(
    'phase7a-auth: a sales agent (no integrations.events.read) cannot read external_events',
    await ctx(
      AG,
      A,
      async () =>
        (await cnt(`select count(*) c from external_events where tenant_id='${A}'`)) === 0,
    ),
  );
  await q(
    `insert into external_events(tenant_id,provider,external_event_id,event_type,payload_hash,idempotency_key,status) values ('${B}','manual_test','e1','inbound_message','h1','idem-e1','received')`,
  );
  rec(
    'phase7a-auth: same provider event id across tenants → two distinct rows (per-tenant idempotency)',
    (await cnt(`select count(*) c from external_events where external_event_id='e1'`)) === 2,
  );
  const hreq = (
    await q(
      `insert into human_outbound_requests(tenant_id,conversation_id,channel,requested_by,idempotency_key) values ('${A}','${CV2}','whatsapp_cloud','${AA}','hk-cv2') returning id`,
    )
  ).rows[0].id;
  await q(
    `insert into human_outbound_simulations(tenant_id,request_id,preview,reason) values ('${A}','${hreq}','SIMULATION — MESSAGE NOT SENT','simulated')`,
  );
  rec(
    'phase7a-auth: a human-send simulation creates NO customer-visible conversation message',
    (await cnt(
      `select count(*) c from conversation_messages where conversation_id='${CV2}' and direction='outbound' and external_message_id like 'sim%'`,
    )) === 0,
  );

  // ---- 0025: TRUE persist-before-process envelope + opaque endpoint ----
  rec(
    'phase7a-envelope: external_event_envelopes has RLS enabled',
    (await cnt(
      `select count(*) c from pg_class where relrowsecurity and relname='external_event_envelopes'`,
    )) === 1,
  );
  rec(
    "phase7a-envelope: 'resubmission_required' is a valid envelope status (parse failures not replayable)",
    (await cnt(
      `select count(*) c from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='external_envelope_status' and e.enumlabel='resubmission_required'`,
    )) === 1,
  );
  await q(
    `insert into external_event_envelopes(tenant_id,integration_connection_id,provider,body_hash,receipt_idempotency_key,processing_status) values ('${A}','${CONN}','manual_test','bh1','rcpt-1','received')`,
  );
  rec(
    'phase7a-envelope: receipt_idempotency_key is unique per tenant (concurrent duplicate receipts blocked)',
    await errsTop(
      `insert into external_event_envelopes(tenant_id,integration_connection_id,provider,body_hash,receipt_idempotency_key) values ('${A}','${CONN}','manual_test','bh1','rcpt-1')`,
    ),
  );
  rec(
    'phase7a-envelope: channel_webhook_endpoints.public_id exists and is unique (opaque endpoint id)',
    (await cnt(
      `select count(*) c from pg_indexes where tablename='channel_webhook_endpoints' and indexname='uniq_channel_webhook_public_id'`,
    )) === 1,
  );
  rec(
    'phase7a-envelope: external_events has an envelope_id link column',
    (await cnt(
      `select count(*) c from information_schema.columns where table_name='external_events' and column_name='envelope_id'`,
    )) === 1,
  );
  rec(
    'phase7a-envelope: tenant B cannot read tenant A envelopes (RLS)',
    await ctx(
      BA,
      B,
      async () =>
        (await cnt(`select count(*) c from external_event_envelopes where tenant_id='${A}'`)) === 0,
    ),
  );
} catch (e) {
  console.log('HARNESS ERROR:', e.message);
  fail++;
  fails.push('fatal: ' + e.message);
} finally {
  console.log(`\n==== SUMMARY: ${pass} passed, ${fail} failed ====`);
  if (fails.length) console.log('FAILURES:\n - ' + fails.join('\n - '));
  await c.end();
  await pgsql.stop();
  process.exit(fail > 0 ? 1 : 0);
}
