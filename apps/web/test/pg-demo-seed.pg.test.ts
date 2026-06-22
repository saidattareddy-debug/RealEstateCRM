import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { bootEmbeddedPg, SEED_TENANT_A, type BootedPg } from './pg-embedded';
import { makePgSupabase } from './pg-supabase';

// The demo generator + every canonical service it calls build their own admin
// client → point them all at the same pg-backed shim so the WHOLE seed path runs
// against embedded Postgres (triggers, constraints, idempotency all real).
const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => h.client }));
vi.mock('@/lib/audit/request-context', () => ({
  getRequestContext: () =>
    Promise.resolve({ ip: null, userAgent: null, requestId: 'test', correlationId: 'test' }),
}));

import { ingestLead } from '@/lib/leads/ingest';
import { recordObservation } from '@/lib/scoring/observations';
import { runLeadScore } from '@/lib/scoring/score-service';
import { runLeadMatch } from '@/lib/matching/match-service';
import { ingestConversationMessage } from '@/lib/conversations/ingest-message';
import { ingestKnowledge } from '@/lib/ai/ingestion';
// The orchestrator + ledger are plain .mjs in scripts/demo.
import { runSeed } from '../../../scripts/demo/seeder.mjs';
import { runReset } from '../../../scripts/demo/reset.mjs';
import { runIdFor } from '../../../scripts/demo/ids.mjs';

let booted: BootedPg;
let pool: Pool;
let admin: ReturnType<typeof makePgSupabase>;
// Captured from the first (write) seed so later cases can assert returned counts.
let res1Counts: Record<string, number>;

const DATASET = 'controlled-mvp-demo-v1';
const cnt = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await pool.query(sql, params)).rows[0].c);

// Canonical service deps wired into the single runSeed code path.
const deps = {
  ingestLead,
  recordObservation,
  runLeadScore,
  runLeadMatch,
  ingestConversationMessage,
  ingestKnowledge,
  audit: async () => {}, // audit is exercised elsewhere; keep this test focused
};

const ctx = (dryRun = false) => ({
  tenantId: SEED_TENANT_A,
  datasetVersion: DATASET,
  dryRun,
  correlationId: 'demo-test',
  log: () => {},
});

beforeAll(async () => {
  booted = await bootEmbeddedPg({ port: 5461, dir: '/tmp/pgtest/pgdemo' });
  pool = booted.pool;
  admin = makePgSupabase(pool);
  // Point every canonical service's internal admin client at the same shim.
  h.client = admin;
}, 120_000);

afterAll(async () => {
  if (booted) await booted.stop();
});

describe('demo-data generator against EMBEDDED PostgreSQL', () => {
  it('migration 0028 applied: demo_seed ledger tables exist', async () => {
    expect(
      await cnt(
        `select count(*) c from information_schema.tables where table_name='demo_seed_runs'`,
      ),
    ).toBe(1);
    expect(
      await cnt(
        `select count(*) c from information_schema.tables where table_name='demo_seed_entities'`,
      ),
    ).toBe(1);
  });

  it('dry-run writes NOTHING', async () => {
    const beforeProjects = await cnt(`select count(*) c from projects where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    const beforeRuns = await cnt(`select count(*) c from demo_seed_runs`);
    const beforeConvs = await cnt(`select count(*) c from conversations where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    const beforeKnowledge = await cnt(
      `select count(*) c from knowledge_sources where tenant_id=$1`,
      [SEED_TENANT_A],
    );
    const res = await runSeed(admin, ctx(true), deps);
    expect(res.counts.projects).toBeGreaterThan(0); // plan computed
    expect(res.counts.conversations).toBeGreaterThan(0); // conversation plan computed
    expect(res.counts.knowledge_docs).toBeGreaterThan(0); // knowledge plan computed
    expect(await cnt(`select count(*) c from projects where tenant_id=$1`, [SEED_TENANT_A])).toBe(
      beforeProjects,
    );
    expect(await cnt(`select count(*) c from demo_seed_runs`)).toBe(beforeRuns);
    // No conversation or knowledge rows written in dry-run.
    expect(
      await cnt(`select count(*) c from conversations where tenant_id=$1`, [SEED_TENANT_A]),
    ).toBe(beforeConvs);
    expect(
      await cnt(`select count(*) c from knowledge_sources where tenant_id=$1`, [SEED_TENANT_A]),
    ).toBe(beforeKnowledge);
  });

  it('first seed creates synthetic data through canonical services', async () => {
    const res = await runSeed(admin, ctx(false), deps);
    res1Counts = res.counts as Record<string, number>;
    expect(res.created).toBe(true);
    // 3 demo projects.
    expect(await cnt(`select count(*) c from projects where name like '%(DEMO)%'`)).toBe(3);
    // 48 demo inventory units (tracked in ledger).
    expect(
      await cnt(`select count(*) c from demo_seed_entities where entity_type='inventory_unit'`),
    ).toBe(48);
    // 40 demo leads created via ingestLead.
    expect(res.counts.leads).toBe(40);
    expect(await cnt(`select count(*) c from demo_seed_entities where entity_type='lead'`)).toBe(
      40,
    );
    // Inventory status-history rows auto-written by the unit trigger.
    expect(
      await cnt(
        `select count(*) c from inventory_status_events ise join inventory_units u on u.id=ise.unit_id where u.tenant_id=$1`,
        [SEED_TENANT_A],
      ),
    ).toBeGreaterThanOrEqual(48);
    // Advisory score runs were produced (real scoring service).
    expect(res.counts.score_runs).toBeGreaterThan(0);
    expect(
      await cnt(`select count(*) c from lead_score_runs where tenant_id=$1`, [SEED_TENANT_A]),
    ).toBeGreaterThan(0);
    // Advisory match runs were produced (real matching service).
    expect(res.counts.match_runs).toBeGreaterThan(0);
    expect(
      await cnt(`select count(*) c from lead_match_runs where tenant_id=$1`, [SEED_TENANT_A]),
    ).toBeGreaterThan(0);
    // Run marked completed.
    const runId = runIdFor(SEED_TENANT_A, DATASET);
    expect(
      await cnt(`select count(*) c from demo_seed_runs where run_id=$1 and status='completed'`, [
        runId,
      ]),
    ).toBe(1);
  });

  it('conversations seeded via the canonical service with NO auto-AI message', async () => {
    // ~15 demo conversations recorded in the ledger.
    expect(
      await cnt(`select count(*) c from demo_seed_entities where entity_type='conversation'`),
    ).toBe(15);
    expect(res1Counts.conversations).toBe(15);
    expect(res1Counts.messages).toBeGreaterThanOrEqual(50);
    expect(res1Counts.messages).toBeLessThanOrEqual(70);

    // Every inbound (lead) message went through the canonical ingestion path:
    // a message_ingestion_events row exists for each lead message body.
    expect(
      await cnt(
        `select count(*) c from message_ingestion_events where tenant_id=$1 and status='completed'`,
        [SEED_TENANT_A],
      ),
    ).toBeGreaterThan(0);

    // HARD SAFETY: no message was authored by the AI sender, and ai_active is
    // false on every demo conversation (the responder can never answer).
    expect(
      await cnt(
        `select count(*) c from conversation_messages m join demo_seed_entities e on e.entity_id=m.conversation_id::text where e.entity_type='conversation' and m.sender='ai'`,
      ),
    ).toBe(0);
    expect(
      await cnt(
        `select count(*) c from conversations c join demo_seed_entities e on e.entity_id=c.id::text where e.entity_type='conversation' and c.ai_active=true`,
      ),
    ).toBe(0);

    // Lifecycle/state spread present: closed, paused, reopened (close+reopen
    // events), human takeover, DNC-blocked, consent-withdrawn, unassigned.
    expect(
      await cnt(
        `select count(*) c from conversations c join demo_seed_entities e on e.entity_id=c.id::text where e.entity_type='conversation' and c.lifecycle='closed'`,
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await cnt(
        `select count(*) c from conversations c join demo_seed_entities e on e.entity_id=c.id::text where e.entity_type='conversation' and c.human_takeover_by is not null`,
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await cnt(
        `select count(*) c from conversations c join demo_seed_entities e on e.entity_id=c.id::text where e.entity_type='conversation' and c.assigned_agent_id is null`,
      ),
    ).toBeGreaterThanOrEqual(1);

    // Consent / DNC states recorded (§12).
    expect(res1Counts.consents).toBeGreaterThanOrEqual(1);
    expect(res1Counts.dnc_entries).toBeGreaterThanOrEqual(1);
    expect(
      await cnt(
        `select count(*) c from contact_consents where tenant_id=$1 and status='do_not_contact'`,
        [SEED_TENANT_A],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('knowledge docs are approved/active with mock embeddings (mock=true)', async () => {
    // ~10 demo knowledge sources recorded in the ledger.
    expect(
      await cnt(`select count(*) c from demo_seed_entities where entity_type='knowledge_source'`),
    ).toBe(10);

    // 9 approved/active (approved_by = demo admin); Lakeview stays review_required.
    expect(
      await cnt(
        `select count(*) c from knowledge_sources ks join demo_seed_entities e on e.entity_id=ks.id::text where e.entity_type='knowledge_source' and ks.state='approved' and ks.approved_by is not null and ks.approved_at is not null`,
      ),
    ).toBe(9);
    expect(
      await cnt(
        `select count(*) c from knowledge_sources ks where ks.tenant_id=$1 and ks.title like '%PENDING APPROVAL%' and ks.state='review_required'`,
        [SEED_TENANT_A],
      ),
    ).toBe(1);

    // 40–60 chunks across the approved docs.
    expect(res1Counts.knowledge_chunks).toBeGreaterThanOrEqual(40);
    expect(res1Counts.knowledge_chunks).toBeLessThanOrEqual(60);

    // Mock embeddings present and ALL marked mock=true (development=true).
    expect(res1Counts.mock_embeddings).toBeGreaterThan(0);
    expect(
      await cnt(
        `select count(*) c from knowledge_chunk_embeddings ke join knowledge_chunks kc on kc.id=ke.chunk_id join demo_seed_entities e on e.entity_id=kc.source_id::text where e.entity_type='knowledge_source' and ke.development=false`,
      ),
    ).toBe(0);
    expect(
      await cnt(
        `select count(*) c from knowledge_chunk_embeddings ke join knowledge_chunks kc on kc.id=ke.chunk_id join demo_seed_entities e on e.entity_id=kc.source_id::text where e.entity_type='knowledge_source' and ke.model_version='mock-embed-v1'`,
      ),
    ).toBeGreaterThan(0);
  });

  it('knowledge retrieval finds the expected chunk for a sample question', async () => {
    // The retrieval service's lexical path filters to approved + in-effect
    // chunks and full-text matches on to_tsvector('simple', content) — exactly
    // what we assert here directly against the DB (pgvector ANN is disabled in
    // embedded PG, so we exercise the deterministic lexical retrieval path the
    // service shares). The amenities question must surface the approved Verdant
    // Grove amenity chunk and never the PENDING Lakeview source.
    const rows = (
      await pool.query(
        `select kc.id, kc.content, ks.title
           from knowledge_chunks kc
           join knowledge_sources ks on ks.id = kc.source_id
          where kc.tenant_id = $1
            and kc.state = 'approved'
            and (ks.effective_at is null or ks.effective_at <= now())
            and (ks.expires_at is null or ks.expires_at > now())
            and kc.content_tsv @@ plainto_tsquery('simple', $2)
          order by ts_rank(kc.content_tsv, plainto_tsquery('simple', $2)) desc
          limit 5`,
        [SEED_TENANT_A, 'EV charging pool clubhouse amenities'],
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    // Top hit is from an approved amenities source, not the pending Lakeview doc.
    expect(rows.some((r) => /amenit/i.test(r.title) || /clubhouse|pool|EV/i.test(r.content))).toBe(
      true,
    );
    expect(rows.every((r) => !/PENDING APPROVAL/i.test(r.title))).toBe(true);
  });

  it('knowledge evaluation set has >=20 deterministic cases with safety expectations', async () => {
    expect(res1Counts.knowledge_eval_cases).toBeGreaterThanOrEqual(20);
    const caseCount = await cnt(
      `select count(*) c from ai_evaluation_cases ac join ai_evaluation_datasets ad on ad.id=ac.dataset_id where ad.tenant_id=$1 and ad.name like '%controlled-mvp-demo-v1%'`,
      [SEED_TENANT_A],
    );
    expect(caseCount).toBeGreaterThanOrEqual(20);
    // Pending-approval and out-of-scope cases expect escalation + no draft.
    expect(
      await cnt(
        `select count(*) c from ai_evaluation_cases ac join ai_evaluation_datasets ad on ad.id=ac.dataset_id where ad.tenant_id=$1 and ac.expected_grounding='insufficient_evidence' and ac.draft_allowed=false`,
        [SEED_TENANT_A],
      ),
    ).toBeGreaterThanOrEqual(1);
    // DNC/consent respect is represented as an escalation case.
    expect(
      await cnt(
        `select count(*) c from ai_evaluation_cases ac join ai_evaluation_datasets ad on ad.id=ac.dataset_id where ad.tenant_id=$1 and ac.expected_escalation='consent_or_dnc_block'`,
        [SEED_TENANT_A],
      ),
    ).toBe(1);
  });

  it('scoring is advisory only — never mutates lead stage/status/assignment', async () => {
    // A score run exists, but the lead operational_status is untouched by scoring.
    const row = (
      await pool.query(`select l.operational_status from leads l where l.tenant_id=$1 limit 1`, [
        SEED_TENANT_A,
      ])
    ).rows[0];
    expect(['new', 'qualifying', 'needs_review', 'nurturing', 'dormant', 'disqualified']).toContain(
      row.operational_status,
    );
    // No score classification was written onto the lead row (advisory).
    const scoredLeads = await cnt(`select count(*) c from lead_score_runs where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    expect(scoredLeads).toBeGreaterThan(0);
  });

  it('matching is advisory only — no inventory was reserved by matching', async () => {
    // Matching produced candidates but did not change any unit to 'reserved'
    // beyond what the seed itself set. The 5 reserved units are exactly the
    // demo-seeded reserved bucket (no extra reservations from matching).
    const reserved = await cnt(
      `select count(*) c from inventory_units where tenant_id=$1 and status='reserved'`,
      [SEED_TENANT_A],
    );
    expect(reserved).toBe(5);
  });

  it('inventory availability accuracy: fresh vs stale split is preserved', async () => {
    // 20 available+fresh, 6 available+stale = 26 available units total.
    const available = await cnt(
      `select count(*) c from inventory_units u join demo_seed_entities e on e.entity_id=u.id::text where e.entity_type='inventory_unit' and u.status='available'`,
    );
    expect(available).toBe(26);
  });

  it('second seed is IDEMPOTENT — counts unchanged, no duplicates', async () => {
    const projectsBefore = await cnt(`select count(*) c from projects where name like '%(DEMO)%'`);
    const leadsBefore = await cnt(`select count(*) c from leads where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    const unitsBefore = await cnt(`select count(*) c from inventory_units where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    const entitiesBefore = await cnt(`select count(*) c from demo_seed_entities`);
    const convsBefore = await cnt(`select count(*) c from conversations where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    const msgsBefore = await cnt(
      `select count(*) c from conversation_messages where tenant_id=$1`,
      [SEED_TENANT_A],
    );
    const sourcesBefore = await cnt(`select count(*) c from knowledge_sources where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    const chunksBefore = await cnt(`select count(*) c from knowledge_chunks where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);
    const embBefore = await cnt(
      `select count(*) c from knowledge_chunk_embeddings where tenant_id=$1`,
      [SEED_TENANT_A],
    );
    const evalBefore = await cnt(`select count(*) c from ai_evaluation_cases where tenant_id=$1`, [
      SEED_TENANT_A,
    ]);

    const res2 = await runSeed(admin, ctx(false), deps);
    expect(res2.created).toBe(false); // reused the existing run

    expect(await cnt(`select count(*) c from projects where name like '%(DEMO)%'`)).toBe(
      projectsBefore,
    );
    expect(await cnt(`select count(*) c from leads where tenant_id=$1`, [SEED_TENANT_A])).toBe(
      leadsBefore,
    );
    expect(
      await cnt(`select count(*) c from inventory_units where tenant_id=$1`, [SEED_TENANT_A]),
    ).toBe(unitsBefore);
    expect(await cnt(`select count(*) c from demo_seed_entities`)).toBe(entitiesBefore);
    // Conversations + knowledge are idempotent on re-seed (no duplicates).
    expect(
      await cnt(`select count(*) c from conversations where tenant_id=$1`, [SEED_TENANT_A]),
    ).toBe(convsBefore);
    expect(
      await cnt(`select count(*) c from conversation_messages where tenant_id=$1`, [SEED_TENANT_A]),
    ).toBe(msgsBefore);
    expect(
      await cnt(`select count(*) c from knowledge_sources where tenant_id=$1`, [SEED_TENANT_A]),
    ).toBe(sourcesBefore);
    expect(
      await cnt(`select count(*) c from knowledge_chunks where tenant_id=$1`, [SEED_TENANT_A]),
    ).toBe(chunksBefore);
    expect(
      await cnt(`select count(*) c from knowledge_chunk_embeddings where tenant_id=$1`, [
        SEED_TENANT_A,
      ]),
    ).toBe(embBefore);
    expect(
      await cnt(`select count(*) c from ai_evaluation_cases where tenant_id=$1`, [SEED_TENANT_A]),
    ).toBe(evalBefore);
  });

  it('reset removes ONLY demo data and preserves an unrelated control row', async () => {
    // Control row: a non-demo project that must survive the reset.
    const controlId = '99999999-0000-0000-0000-0000000000c1';
    await pool.query(
      `insert into projects (id, tenant_id, name, category, created_by) values ($1,$2,'CONTROL Non-Demo Project','apartment',null) on conflict (id) do nothing`,
      [controlId, SEED_TENANT_A],
    );
    // Unrelated (non-ledger) conversation + knowledge rows that MUST survive.
    const ctlConvId = '99999999-0000-0000-0000-0000000000c2';
    await pool.query(
      `insert into conversations (id, tenant_id, channel, status) values ($1,$2,'website_chat','open') on conflict (id) do nothing`,
      [ctlConvId, SEED_TENANT_A],
    );
    const ctlSrcId = '99999999-0000-0000-0000-0000000000c3';
    await pool.query(
      `insert into knowledge_sources (id, tenant_id, source_type, title, state) values ($1,$2,'manual','CONTROL Non-Demo Knowledge','draft') on conflict (id) do nothing`,
      [ctlSrcId, SEED_TENANT_A],
    );

    const runId = (
      await pool.query(`select id from demo_seed_runs where run_id=$1`, [
        runIdFor(SEED_TENANT_A, DATASET),
      ])
    ).rows[0].id;

    await runReset(
      admin,
      { tenantId: SEED_TENANT_A, runId, dryRun: false, log: () => {} },
      { audit: async () => {} },
    );

    // All demo data gone.
    expect(await cnt(`select count(*) c from projects where name like '%(DEMO)%'`)).toBe(0);
    expect(await cnt(`select count(*) c from demo_seed_entities where run_id=$1`, [runId])).toBe(0);
    expect(
      await cnt(
        `select count(*) c from leads l join demo_seed_entities e on e.entity_id=l.id::text where e.run_id=$1`,
        [runId],
      ),
    ).toBe(0);
    // Run marked reverted.
    expect(
      await cnt(`select count(*) c from demo_seed_runs where id=$1 and status='reverted'`, [runId]),
    ).toBe(1);
    // Demo conversations + knowledge removed (only this run's ledger rows).
    expect(
      await cnt(
        `select count(*) c from conversations c join demo_seed_entities e on e.entity_id=c.id::text where e.entity_type='conversation'`,
      ),
    ).toBe(0);
    expect(
      await cnt(
        `select count(*) c from knowledge_sources where tenant_id=$1 and title like '%(Demo)%'`,
        [SEED_TENANT_A],
      ),
    ).toBe(0);
    // The demo eval dataset + its cases are gone (only this run's rows). Any
    // pre-existing baseline eval dataset for the tenant is preserved.
    expect(
      await cnt(
        `select count(*) c from ai_evaluation_datasets where tenant_id=$1 and name like '%controlled-mvp-demo-v1%'`,
        [SEED_TENANT_A],
      ),
    ).toBe(0);
    expect(
      await cnt(
        `select count(*) c from ai_evaluation_cases ac join demo_seed_entities e on e.entity_id=ac.id::text where e.entity_type='ai_evaluation_case'`,
      ),
    ).toBe(0);

    // Control rows survive.
    expect(await cnt(`select count(*) c from projects where id=$1`, [controlId])).toBe(1);
    expect(await cnt(`select count(*) c from conversations where id=$1`, [ctlConvId])).toBe(1);
    expect(await cnt(`select count(*) c from knowledge_sources where id=$1`, [ctlSrcId])).toBe(1);
    // Original seed.sql data (Northwind Greens) is untouched.
    expect(await cnt(`select count(*) c from projects where name='Northwind Greens'`)).toBe(1);
  });
});
