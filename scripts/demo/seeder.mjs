/**
 * Demo seed orchestration (one code path for CLI and tests).
 *
 * `runSeed(admin, ctx, deps)` is pure-ish: all IO goes through the injected
 * `admin` (Supabase-shaped service-role client) and `deps` (canonical service
 * callables). The CLI wires real env-based deps; embedded-PG tests wire mocked
 * canonical services. Idempotency comes from deterministic IDs + the ledger:
 * a second run finds the same run + already-recorded entities and skips writes.
 *
 * SAFETY: this module performs NO live send, NO external IO, NO AI auto-reply.
 * Leads flow through the canonical ingestLead. Scoring/matching are advisory.
 */

import { deterministicUuid, externalRef } from './ids.mjs';
import {
  PROJECTS,
  buildInventoryPlan,
  buildLeads,
  buildTasks,
  buildConversations,
  buildKnowledgeDocs,
  buildKnowledgeEvalCases,
  AUTOMATION_SPECS,
  AUTOMATION_RUN_SPECS,
  FOLLOWUP_SEQUENCE_SPECS,
  FOLLOWUP_ENROLLMENT_SPECS,
  VISIT_SPECS,
  CALENDAR_BUSY_SPECS,
  NOTIFICATION_SPECS,
  PLAN_LIMITS,
  USAGE_METERED,
  USAGE_INFO,
  HEALTH_SPECS,
  EXPORT_SPECS,
} from './dataset.mjs';
import { findOrCreateRun, recordEntity, completeRun, failRun } from './ledger.mjs';

const ACTOR_PROFILE = '00000000-0000-0000-0000-0000000000a1'; // seeded staging admin

async function upsertById(admin, table, id, row, dryRun) {
  if (dryRun) return id;
  const { data } = await admin.from(table).select('id').eq('id', id).maybeSingle();
  if (data) return id;
  const { error } = await admin
    .from(table)
    .insert({ id, ...row })
    .select('id')
    .maybeSingle();
  if (error && error.code !== '23505') throw new Error(`${table} insert: ${error.message}`);
  return id;
}

/**
 * Map synthetic role keys to EXISTING seeded staging profiles. We never create
 * auth users or new profile rows by default (profiles.id FKs auth.users, and
 * auth-user creation is a separate explicit, documented step). Assignments
 * therefore target the real seeded admin/agent/marketing profiles.
 */
const SEEDED_ADMIN = '00000000-0000-0000-0000-0000000000a1'; // client_admin
const SEEDED_AGENT = '00000000-0000-0000-0000-0000000000a2'; // sales_agent
const SEEDED_MARKETING = '00000000-0000-0000-0000-0000000000a3'; // marketing_manager
function resolveActorIds() {
  return {
    admin: SEEDED_ADMIN,
    manager: SEEDED_ADMIN,
    agent1: SEEDED_AGENT,
    agent2: SEEDED_AGENT,
    marketing: SEEDED_MARKETING,
    ops: SEEDED_ADMIN,
    viewer: SEEDED_ADMIN,
  };
}

export async function runSeed(admin, ctx, deps = {}) {
  const { tenantId, datasetVersion, dryRun, correlationId, log = () => {} } = ctx;
  const counts = {
    profiles: 0,
    projects: 0,
    configurations: 0,
    amenities: 0,
    offers: 0,
    faqs: 0,
    media: 0,
    documents: 0,
    inventory_units: 0,
    leads: 0,
    preferences: 0,
    tasks: 0,
    observations: 0,
    score_runs: 0,
    match_runs: 0,
    conversations: 0,
    messages: 0,
    consents: 0,
    dnc_entries: 0,
    knowledge_docs: 0,
    knowledge_versions: 0,
    knowledge_chunks: 0,
    mock_embeddings: 0,
    knowledge_eval_cases: 0,
    // Phase 8 — automations & visits
    automations: 0,
    automation_actions: 0,
    automation_runs: 0,
    automation_run_actions: 0,
    automation_suppressed_actions: 0,
    followup_sequences: 0,
    followup_steps: 0,
    followup_enrollments: 0,
    followup_step_events: 0,
    site_visits: 0,
    visit_events: 0,
    visit_outcomes: 0,
    calendar_busy_blocks: 0,
    calendar_connections: 0,
    double_booking_rejection_cases: 0,
    notifications: 0,
    notification_deliveries: 0,
    notification_external_simulated: 0,
    notification_preferences: 0,
    // Phase 9 — analytics & administration
    usage_counters: 0,
    billing_periods: 0,
    system_health_checks: 0,
    analytics_export_logs: 0,
  };

  const run = await (dryRun
    ? Promise.resolve({
        id: deterministicUuid(tenantId, 'seed_run', datasetVersion),
        created: true,
      })
    : findOrCreateRun(admin, tenantId, datasetVersion, correlationId));
  const runId = run.id;
  log(`run ${runId} (${run.created ? 'new' : 'existing'})`);

  await deps.audit?.('demo.seed.started', { section: 'all' });

  // ---- Profiles: ATTACH to existing seeded staging profiles ----------------
  // By design we do NOT create synthetic auth users / profile rows (profiles.id
  // FKs auth.users; auth-user creation is a separate, explicit, documented
  // step). Lead/task assignments target the real seeded admin/agent/marketing
  // profiles (resolved per-section via resolveActorIds()).
  counts.profiles = 0;

  // ---- Projects + nested content -------------------------------------------
  const projectIds = {};
  const configIds = {};
  for (const p of PROJECTS) {
    const pid = deterministicUuid(tenantId, 'project', p.key);
    projectIds[p.key] = pid;
    await upsertById(
      admin,
      'projects',
      pid,
      {
        tenant_id: tenantId,
        name: p.name,
        developer: p.developer,
        category: p.category,
        sale_status: p.sale_status,
        approval_status: p.approval_status,
        construction_status: p.construction_status,
        locality: p.locality,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        possession_date: p.possession_date,
        price_min: p.price_min,
        price_max: p.price_max,
        currency: p.currency,
        description: p.description,
        created_by: ACTOR_PROFILE,
        approved_by: p.approval_status === 'approved' ? ACTOR_PROFILE : null,
        approved_at: p.approval_status === 'approved' ? new Date().toISOString() : null,
      },
      dryRun,
    );
    if (!dryRun)
      await recordEntity(admin, tenantId, runId, 'project', pid, externalRef('project', p.key));
    counts.projects++;

    for (const c of p.configurations) {
      const cid = deterministicUuid(tenantId, 'config', `${p.key}|${c.key}`);
      configIds[`${p.key}|${c.key}`] = cid;
      await upsertById(
        admin,
        'project_configurations',
        cid,
        {
          tenant_id: tenantId,
          project_id: pid,
          label: c.label,
          carpet_area_sqft: c.carpet,
          builtup_area_sqft: c.builtup,
          saleable_area_sqft: c.saleable,
          base_price: c.base,
        },
        dryRun,
      );
      if (!dryRun) await recordEntity(admin, tenantId, runId, 'project_configuration', cid);
      counts.configurations++;
    }
    for (const [i, a] of p.amenities.entries()) {
      const id = deterministicUuid(tenantId, 'amenity', `${p.key}|${i}`);
      await upsertById(
        admin,
        'project_amenities',
        id,
        { tenant_id: tenantId, project_id: pid, name: a },
        dryRun,
      );
      if (!dryRun) await recordEntity(admin, tenantId, runId, 'project_amenity', id);
      counts.amenities++;
    }
    for (const [i, o] of p.offers.entries()) {
      const id = deterministicUuid(tenantId, 'offer', `${p.key}|${i}`);
      await upsertById(
        admin,
        'project_offers',
        id,
        {
          tenant_id: tenantId,
          project_id: pid,
          title: o.title,
          details: o.details,
          valid_until: o.valid_until,
        },
        dryRun,
      );
      if (!dryRun) await recordEntity(admin, tenantId, runId, 'project_offer', id);
      counts.offers++;
    }
    for (const [i, f] of p.faqs.entries()) {
      const id = deterministicUuid(tenantId, 'faq', `${p.key}|${i}`);
      await upsertById(
        admin,
        'project_faqs',
        id,
        { tenant_id: tenantId, project_id: pid, question: f.q, answer: f.a, sort_order: i },
        dryRun,
      );
      if (!dryRun) await recordEntity(admin, tenantId, runId, 'project_faq', id);
      counts.faqs++;
    }
    for (const [i, m] of p.media.entries()) {
      const id = deterministicUuid(tenantId, 'media', `${p.key}|${i}`);
      await upsertById(
        admin,
        'project_media',
        id,
        { tenant_id: tenantId, project_id: pid, kind: m.kind, url: m.url, caption: m.caption },
        dryRun,
      );
      if (!dryRun) await recordEntity(admin, tenantId, runId, 'project_media', id);
      counts.media++;
    }
    for (const [i, d] of p.documents.entries()) {
      const id = deterministicUuid(tenantId, 'doc', `${p.key}|${i}`);
      await upsertById(
        admin,
        'project_documents',
        id,
        { tenant_id: tenantId, project_id: pid, doc_type: d.doc_type, title: d.title, url: d.url },
        dryRun,
      );
      if (!dryRun) await recordEntity(admin, tenantId, runId, 'project_document', id);
      counts.documents++;
    }
  }
  await deps.audit?.('demo.seed.section_completed', {
    section: 'projects',
    count: counts.projects,
  });

  // ---- Inventory (triggers write status + price history automatically) ------
  for (const u of buildInventoryPlan()) {
    const pid = projectIds[u.projectKey];
    const cid = configIds[`${u.projectKey}|${u.configKey}`];
    const id = deterministicUuid(tenantId, 'unit', u.unitKey);
    const cfg = PROJECTS.find((p) => p.key === u.projectKey).configurations.find(
      (c) => c.key === u.configKey,
    );
    await upsertById(
      admin,
      'inventory_units',
      id,
      {
        tenant_id: tenantId,
        project_id: pid,
        configuration_id: cid,
        unit_number: u.unit_number,
        status: u.status,
        price: cfg.base + u.priceDelta,
        carpet_area_sqft: cfg.carpet,
        last_verified_at: u.last_verified_at,
      },
      dryRun,
    );
    if (!dryRun)
      await recordEntity(
        admin,
        tenantId,
        runId,
        'inventory_unit',
        id,
        externalRef('unit', u.unitKey),
      );
    counts.inventory_units++;
  }
  await deps.audit?.('demo.seed.section_completed', {
    section: 'inventory',
    count: counts.inventory_units,
  });

  // ---- Leads via the canonical ingestLead (idempotent on deterministic key) -
  const leadIds = {};
  for (const l of buildLeads()) {
    const idemKey = externalRef('lead', l.key);
    let leadId = null;
    if (dryRun) {
      counts.leads++;
    } else if (deps.ingestLead) {
      const res = await deps.ingestLead(
        tenantId,
        {
          fullName: l.full_name,
          email: l.email,
          phone: l.phone,
          source: l.source,
          sourceLeadId: idemKey,
        },
        { sourceKind: 'manual', idempotencyKey: idemKey, correlationId },
      );
      leadId = res.leadId || null;
      if (leadId) {
        leadIds[l.key] = leadId;
        await recordEntity(admin, tenantId, runId, 'lead', leadId, idemKey);
        counts.leads++;
        // Preferences (advisory inputs for matching).
        if (l.budget_min || l.preferred_location) {
          await admin
            .from('lead_preferences')
            .insert({
              lead_id: leadId,
              tenant_id: tenantId,
              budget_min: l.edge === 'missing_budget' ? null : (l.budget_min ?? null),
              budget_max: l.edge === 'missing_budget' ? null : (l.budget_max ?? null),
              configuration: l.configuration ?? null,
              preferred_location: l.preferred_location ?? null,
              purpose: l.purpose ?? null,
            })
            .select('lead_id')
            .maybeSingle();
          counts.preferences++;
        }
        // Tags (never used to set scoring class).
        for (const t of l.tags ?? []) {
          await admin
            .from('lead_tags')
            .insert({ tenant_id: tenantId, lead_id: leadId, tag: t })
            .select('tag')
            .maybeSingle();
        }
      }
    }
  }
  await deps.audit?.('demo.seed.section_completed', { section: 'leads', count: counts.leads });

  // ---- Tasks via service-role (existing schema) -----------------------------
  const actorIds = resolveActorIds();
  for (const t of buildTasks()) {
    const id = deterministicUuid(tenantId, 'task', t.key);
    await upsertById(
      admin,
      'tasks',
      id,
      {
        tenant_id: tenantId,
        lead_id: null,
        title: t.title,
        due_at: t.due_at,
        status: t.status,
        assignee_id: t.assignee ? (actorIds[t.assignee] ?? null) : null,
        created_by: ACTOR_PROFILE,
      },
      dryRun,
    );
    if (!dryRun) await recordEntity(admin, tenantId, runId, 'task', id, externalRef('task', t.key));
    counts.tasks++;
  }
  await deps.audit?.('demo.seed.section_completed', { section: 'tasks', count: counts.tasks });

  // ---- Scoring (advisory) — observations + real score run -------------------
  // Score/match runs are append-only by design (each call writes a new immutable
  // run). To keep a RE-SEED idempotent we only run them on the FIRST seed.
  const firstRun = run.created;
  if (!dryRun && firstRun && deps.recordObservation && deps.runLeadScore) {
    for (const l of buildLeads()) {
      const leadId = leadIds[l.key];
      if (!leadId) continue;
      const obs = scoreObservationsFor(l.observe);
      for (const o of obs) {
        const res = await deps.recordObservation(
          {
            tenantId,
            leadId,
            signalKey: o.key,
            value: o.value,
            sourceType: 'demo_seed',
            correlationId,
          },
          admin,
        );
        if (res?.ok) counts.observations++;
      }
      const sr = await deps.runLeadScore(leadId, tenantId, 'manual', admin, ACTOR_PROFILE);
      if (sr?.ok) {
        counts.score_runs++;
        await recordEntity(admin, tenantId, runId, 'lead_score_run', sr.runId ?? leadId);
      }
    }
    await deps.audit?.('demo.seed.section_completed', {
      section: 'scoring',
      count: counts.score_runs,
    });
  }

  // ---- Matching (advisory) — real match run for a representative subset -----
  if (!dryRun && firstRun && deps.runLeadMatch) {
    let matched = 0;
    for (const l of buildLeads()) {
      const leadId = leadIds[l.key];
      if (!leadId) continue;
      if (matched >= 12) break; // representative spread, keeps runtime bounded
      const mr = await deps.runLeadMatch(leadId, tenantId, 'manual', admin, ACTOR_PROFILE);
      if (mr?.ok) {
        counts.match_runs++;
        matched++;
        await recordEntity(admin, tenantId, runId, 'lead_match_run', mr.runId ?? leadId);
      }
    }
    await deps.audit?.('demo.seed.section_completed', {
      section: 'matching',
      count: counts.match_runs,
    });
  }

  // ---- Conversations via the canonical ingestConversationMessage -----------
  // Inbound (lead) messages flow through the canonical service (persist-before-
  // process; DB triggers fire). Agent/system replies, takeover, status,
  // assignment, deterministic summaries, consent/DNC are applied service-role.
  // NO AI auto-reply: the `ai` sender is never written here.
  await seedConversations(admin, { tenantId, runId, dryRun, correlationId, leadIds }, counts, deps);
  await deps.audit?.('demo.seed.section_completed', {
    section: 'conversations',
    count: counts.conversations,
    messages: counts.messages,
    consents: counts.consents,
    dnc_entries: counts.dnc_entries,
  });

  // ---- Knowledge via the canonical ingestKnowledge lifecycle ---------------
  await seedKnowledge(
    admin,
    { tenantId, runId, dryRun, correlationId, projectIds, firstRun: run.created },
    counts,
    deps,
  );
  await deps.audit?.('demo.seed.section_completed', {
    section: 'knowledge',
    count: counts.knowledge_docs,
    chunks: counts.knowledge_chunks,
    mock_embeddings: counts.mock_embeddings,
    eval_cases: counts.knowledge_eval_cases,
  });

  // ---- Phase 8 — automations, follow-ups, visits, notifications ------------
  await seedPhase8(admin, { tenantId, runId, dryRun, correlationId }, counts);
  await deps.audit?.('demo.seed.section_completed', {
    section: 'phase8',
    automations: counts.automations,
    automation_runs: counts.automation_runs,
    followup_enrollments: counts.followup_enrollments,
    site_visits: counts.site_visits,
    notifications: counts.notifications,
    suppressed_actions: counts.automation_suppressed_actions,
  });

  // ---- Phase 9 — usage, billing, system health, export logs ----------------
  await seedPhase9(admin, { tenantId, runId, dryRun }, counts);
  await deps.audit?.('demo.seed.section_completed', {
    section: 'phase9',
    usage_counters: counts.usage_counters,
    billing_periods: counts.billing_periods,
    system_health_checks: counts.system_health_checks,
    analytics_export_logs: counts.analytics_export_logs,
  });

  if (!dryRun) await completeRun(admin, runId, counts);
  await deps.audit?.('demo.seed.completed', { counts });
  return { runId, counts, created: run.created };
}

// ===========================================================================
// CONVERSATIONS
// ===========================================================================

const SENDER_DIRECTION = {
  lead: 'inbound',
  agent: 'outbound',
  system: 'internal',
};

async function seedConversations(admin, ctx, counts, deps) {
  const { tenantId, runId, dryRun, correlationId, leadIds } = ctx;
  const actorIds = resolveActorIds();
  const leadKeys = Object.keys(leadIds);

  for (const [ci, conv] of buildConversations().entries()) {
    if (dryRun) {
      counts.conversations++;
      counts.messages += conv.messages.length;
      if (conv.consent) counts.consents++;
      if (conv.dnc) counts.dnc_entries++;
      continue;
    }

    const convId = deterministicUuid(tenantId, 'conversation', conv.key);
    // Link each conversation to a distinct seeded lead (deterministic spread).
    const leadKey = leadKeys.length ? leadKeys[ci % leadKeys.length] : null;
    const leadId = leadKey ? leadIds[leadKey] : null;
    const assignedAgent = conv.assign ? (actorIds[conv.assign] ?? null) : null;

    // last_inbound_at backdated for SLA warning/breached states.
    const inboundAgoMin = conv.inboundAgoMin ?? 1;
    const lastInboundAt = new Date(Date.now() - inboundAgoMin * 60 * 1000).toISOString();

    await upsertById(
      admin,
      'conversations',
      convId,
      {
        tenant_id: tenantId,
        lead_id: leadId,
        channel: conv.channel,
        // `status` is the legacy enum; `lifecycle` is the AI-gating state.
        status: conv.lifecycle === 'closed' ? 'closed' : 'open',
        lifecycle: conv.lifecycle,
        waiting_on: conv.waiting_on,
        subject: conv.subject,
        // Hard safety: AI must never answer in the demo dataset.
        ai_active: false,
        assigned_agent_id: assignedAgent,
        needs_response: Boolean(conv.needsResponse),
        last_inbound_at: lastInboundAt,
      },
      false,
    );
    await recordEntity(
      admin,
      tenantId,
      runId,
      'conversation',
      convId,
      externalRef('conversation', conv.key),
    );
    counts.conversations++;

    // Messages: inbound via canonical service; outbound/internal service-role.
    for (const [mi, msg] of conv.messages.entries()) {
      const idemKey = externalRef('cmsg', `${conv.key}|${mi}`);
      const direction = SENDER_DIRECTION[msg.from] ?? 'inbound';
      let messageId = null;

      if (msg.from === 'lead' && deps.ingestConversationMessage) {
        const res = await deps.ingestConversationMessage(
          {
            tenantId,
            conversationId: convId,
            leadId,
            body: msg.body,
            externalMessageId: idemKey,
            idempotencyKey: idemKey,
            payloadHash: idemKey,
            direction: 'inbound',
            sender: 'lead',
            correlationId,
          },
          admin,
        );
        messageId = res?.messageId ?? null;
      } else {
        // Agent/system rows (never `ai`). Idempotent on external_message_id.
        const mid = deterministicUuid(tenantId, 'cmsg', `${conv.key}|${mi}`);
        await upsertById(
          admin,
          'conversation_messages',
          mid,
          {
            tenant_id: tenantId,
            conversation_id: convId,
            lead_id: leadId,
            direction,
            sender: msg.from,
            sender_id: msg.from === 'agent' ? assignedAgent : null,
            body: msg.body,
            status: msg.from === 'agent' ? 'sent' : 'received',
            external_message_id: idemKey,
          },
          false,
        );
        messageId = mid;
      }
      if (messageId)
        await recordEntity(admin, tenantId, runId, 'conversation_message', messageId, idemKey);
      counts.messages++;
    }

    // Human takeover.
    if (conv.takeover) {
      const takeoverBy = actorIds[conv.takeover] ?? null;
      await admin
        .from('conversations')
        .update({
          human_takeover_by: takeoverBy,
          human_takeover_at: new Date().toISOString(),
          operating_mode: 'human',
        })
        .eq('id', convId)
        .eq('tenant_id', tenantId);
      await insertConversationEvent(admin, tenantId, runId, convId, {
        type: 'takeover',
        actor_id: takeoverBy,
      });
    }

    // Lifecycle/assignment events (close/reopen/transfer/assign).
    for (const [ei, ev] of (conv.events ?? []).entries()) {
      await insertConversationEvent(admin, tenantId, runId, convId, {
        type: ev.type,
        actor_id: assignedAgent,
        from_agent_id: ev.from ? (actorIds[ev.from] ?? null) : null,
        to_agent_id: ev.to ? (actorIds[ev.to] ?? null) : null,
        reason: ev.reason ?? null,
        suffix: `ev${ei}`,
      });
    }

    // Deterministic conversation summary (safe — no AI generation).
    if (conv.summary) {
      const sid = deterministicUuid(tenantId, 'conv_summary', conv.key);
      await upsertById(
        admin,
        'conversation_summaries',
        sid,
        {
          tenant_id: tenantId,
          conversation_id: convId,
          summary: `Demo conversation: ${conv.subject}. ${conv.messages.length} message(s).`,
          unanswered_question: conv.summary.unanswered ?? null,
          recommended_next_action: conv.summary.next ?? null,
          message_count: conv.messages.length,
          source: 'deterministic',
        },
        false,
      );
      await recordEntity(admin, tenantId, runId, 'conversation_summary', sid);
    }

    // Consent / DNC state (§12).
    if (conv.consent && leadId) {
      const consentId = deterministicUuid(tenantId, 'consent', conv.key);
      await upsertById(
        admin,
        'contact_consents',
        consentId,
        {
          tenant_id: tenantId,
          lead_id: leadId,
          channel: 'any',
          status: conv.consent, // 'revoked' | 'do_not_contact'
          source: 'demo_seed',
          note: 'Synthetic demo consent state.',
        },
        false,
      );
      await recordEntity(admin, tenantId, runId, 'contact_consent', consentId);
      counts.consents++;

      const evId = deterministicUuid(tenantId, 'consent_event', conv.key);
      await upsertById(
        admin,
        'consent_events',
        evId,
        {
          tenant_id: tenantId,
          lead_id: leadId,
          type:
            conv.consent === 'do_not_contact'
              ? 'contact_consent_withdrawn'
              : 'contact_consent_withdrawn',
          channel: 'any',
          note: 'Synthetic demo consent event.',
        },
        false,
      );
      await recordEntity(admin, tenantId, runId, 'consent_event', evId);
    }
    if (conv.dnc && leadId) {
      const dncId = deterministicUuid(tenantId, 'dnc', conv.key);
      await upsertById(
        admin,
        'do_not_contact_entries',
        dncId,
        {
          tenant_id: tenantId,
          lead_id: leadId,
          channel: 'any',
          scope: 'lead',
          reason: 'user_opt_out',
          active: true,
        },
        false,
      );
      await recordEntity(admin, tenantId, runId, 'dnc_entry', dncId);
      counts.dnc_entries++;
    }
  }
}

async function insertConversationEvent(admin, tenantId, runId, convId, ev) {
  const id = deterministicUuid(tenantId, 'conv_event', `${convId}|${ev.type}|${ev.suffix ?? ''}`);
  await upsertById(
    admin,
    'conversation_events',
    id,
    {
      tenant_id: tenantId,
      conversation_id: convId,
      type: ev.type,
      actor_id: ev.actor_id ?? null,
      from_agent_id: ev.from_agent_id ?? null,
      to_agent_id: ev.to_agent_id ?? null,
      reason: ev.reason ?? null,
    },
    false,
  );
  await recordEntity(admin, tenantId, runId, 'conversation_event', id);
}

// ===========================================================================
// KNOWLEDGE
// ===========================================================================

async function seedKnowledge(admin, ctx, counts, deps) {
  const { tenantId, runId, dryRun, projectIds, firstRun } = ctx;

  const docs = buildKnowledgeDocs();
  if (dryRun) {
    counts.knowledge_docs = docs.length;
    counts.knowledge_eval_cases = buildKnowledgeEvalCases().length;
    return;
  }
  if (!deps.ingestKnowledge) {
    // No canonical service wired (plain-Node CLI without a compiled bridge):
    // skip knowledge ingestion. The verified path is the embedded-PG harness.
    return;
  }

  for (const doc of docs) {
    const projectId = doc.projectKey ? (projectIds[doc.projectKey] ?? null) : null;
    const idempotencyKey = externalRef('knowledge', doc.key);

    const input = {
      tenantId,
      actorUserId: SEEDED_ADMIN,
      projectId,
      sourceType: doc.sourceType,
      title: doc.title,
      language: 'en',
      method: doc.method,
      idempotencyKey,
    };
    if (doc.method === 'manual_text' || doc.method === 'markdown') input.text = doc.text;
    else if (doc.method === 'faq') input.faqs = doc.faqs;
    else if (doc.method === 'project_record') input.recordProjectId = projectId;

    const res = await deps.ingestKnowledge(input, admin);
    const sourceId = res?.sourceId ?? null;
    if (!sourceId) continue; // empty/dedup/no-op — skip recording

    await recordEntity(admin, tenantId, runId, 'knowledge_source', sourceId, idempotencyKey);
    counts.knowledge_docs++;
    if (res.sourceVersionId)
      await recordEntity(admin, tenantId, runId, 'knowledge_source_version', res.sourceVersionId);
    counts.knowledge_versions++;
    counts.knowledge_chunks += res.chunkCount ?? 0;

    // Count mock embeddings actually persisted for this source (development=true,
    // i.e. mock=true per schema). Embeddings link to chunks, which link to the
    // source — count via the source's chunk ids.
    const { data: chunkRows } = await admin
      .from('knowledge_chunks')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('source_id', sourceId);
    const chunkIds = (chunkRows ?? []).map((c) => c.id);
    if (chunkIds.length > 0) {
      const { data: embRows } = await admin
        .from('knowledge_chunk_embeddings')
        .select('id, development')
        .eq('tenant_id', tenantId)
        .in('chunk_id', chunkIds);
      const mockEmb = (embRows ?? []).filter((e) => e.development === true).length;
      counts.mock_embeddings += mockEmb;
    }

    // Promote approved docs to state `approved` (approver = demo admin) +
    // effective/review dates + version + tags. Lakeview stays review_required.
    if (doc.approve) {
      const nowIso = new Date().toISOString();
      await admin
        .from('knowledge_sources')
        .update({
          state: 'approved',
          approved_by: SEEDED_ADMIN,
          approved_at: nowIso,
          effective_at: nowIso,
          expires_at: null,
          last_verified_at: nowIso,
          notes: doc.description ?? null,
        })
        .eq('id', sourceId)
        .eq('tenant_id', tenantId);
      if (res.sourceVersionId) {
        await admin
          .from('knowledge_source_versions')
          .update({ state: 'approved' })
          .eq('id', res.sourceVersionId)
          .eq('tenant_id', tenantId);
      }
      // Chunks become approved/in-effect so retrieval can find them.
      await admin
        .from('knowledge_chunks')
        .update({ state: 'approved' })
        .eq('source_id', sourceId)
        .eq('tenant_id', tenantId);
      // Approval-state transition event for the trail.
      const apId = deterministicUuid(tenantId, 'kn_approval', doc.key);
      await upsertById(
        admin,
        'knowledge_approval_events',
        apId,
        {
          tenant_id: tenantId,
          source_id: sourceId,
          source_version_id: res.sourceVersionId ?? null,
          from_state: 'review_required',
          to_state: 'approved',
          actor_id: SEEDED_ADMIN,
          reason: 'Demo seed: approved synthetic source',
        },
        false,
      );
    }
  }

  // -------- Knowledge evaluation set (§15) ----------------------------------
  // Append-only eval cases: only inserted on the FIRST seed (idempotent re-seed).
  if (firstRun) {
    const datasetId = deterministicUuid(tenantId, 'ai_eval_dataset', 'demo-knowledge-v1');
    await upsertById(
      admin,
      'ai_evaluation_datasets',
      datasetId,
      {
        tenant_id: tenantId,
        name: 'Demo Knowledge Eval (controlled-mvp-demo-v1)',
        description:
          'Deterministic >=20-question knowledge eval with §15 safety expectations (cite synthetic source, indicative pricing, never guarantee availability, travel-time unknown, escalate approval uncertainty, respect DNC/consent, never auto-send).',
      },
      false,
    );
    await recordEntity(admin, tenantId, runId, 'ai_evaluation_dataset', datasetId);

    for (const [i, c] of buildKnowledgeEvalCases().entries()) {
      const caseId = deterministicUuid(tenantId, 'ai_eval_case', `demo|${i}`);
      const projectId = c.projectKey ? (projectIds[c.projectKey] ?? null) : null;
      await upsertById(
        admin,
        'ai_evaluation_cases',
        caseId,
        {
          tenant_id: tenantId,
          dataset_id: datasetId,
          project_id: projectId,
          input: c.input,
          language: 'en',
          expected_grounding: c.expected_grounding,
          expected_escalation: c.expected_escalation,
          required_citation_categories: c.required_citation_categories,
          forbidden_claims: c.forbidden_claims,
          expected_tool_calls: c.expected_tool_calls,
          draft_allowed: c.draft_allowed,
        },
        false,
      );
      await recordEntity(admin, tenantId, runId, 'ai_evaluation_case', caseId);
      counts.knowledge_eval_cases++;
    }
  } else {
    // Re-seed: report existing case count without inserting.
    const { data } = await admin.from('ai_evaluation_cases').select('id').eq('tenant_id', tenantId);
    counts.knowledge_eval_cases = (data ?? []).length;
  }
}

/** Map a class hint → seeded observations that drive the REAL scoring engine. */
function scoreObservationsFor(hint) {
  switch (hint) {
    case 'hot':
      return [
        { key: 'booking_intent', value: true },
        { key: 'site_visit_request', value: true },
        { key: 'budget', value: 12000000 },
      ];
    case 'warm':
      return [{ key: 'site_visit_request', value: true }];
    case 'review':
      // No budget → required-evidence rule → review_required path.
      return [{ key: 'site_visit_request', value: true }];
    case 'cold':
    default:
      return [];
  }
}

// ===========================================================================
// PHASE 8 — Automations, follow-ups, visits, notifications (fixtures)
// ===========================================================================

/** Resolve existing demo actors (leads come from the demo seed OR base seed.sql). */
async function resolveDemoActors(admin, tenantId) {
  const { data: leadRows } = await admin
    .from('leads')
    .select('id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(5);
  const leads = (leadRows ?? []).map((r) => r.id);
  const { data: projRows } = await admin
    .from('projects')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(1);
  return { leads, projectId: projRows?.[0]?.id ?? null, agentId: SEEDED_AGENT };
}

/** now + dayOffset at `hour`:00 UTC (idempotent via deterministic row ids). */
function visitTime(dayOffset, hour) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function seedPhase8(admin, ctx, counts) {
  const { tenantId, runId, dryRun } = ctx;
  if (dryRun) {
    counts.automations = AUTOMATION_SPECS.length;
    counts.automation_actions = AUTOMATION_SPECS.reduce((n, a) => n + a.actions.length, 0);
    counts.automation_runs = AUTOMATION_RUN_SPECS.length;
    counts.automation_run_actions = AUTOMATION_RUN_SPECS.length;
    counts.automation_suppressed_actions = AUTOMATION_RUN_SPECS.filter(
      (r) => r.action.category === 'customer_send',
    ).length;
    counts.followup_sequences = FOLLOWUP_SEQUENCE_SPECS.length;
    counts.followup_steps = FOLLOWUP_SEQUENCE_SPECS.reduce((n, s) => n + s.steps.length, 0);
    counts.followup_enrollments = FOLLOWUP_ENROLLMENT_SPECS.length;
    counts.followup_step_events = FOLLOWUP_ENROLLMENT_SPECS.reduce(
      (n, e) => n + e.events.length,
      0,
    );
    counts.site_visits = VISIT_SPECS.length;
    counts.visit_events = VISIT_SPECS.reduce((n, v) => n + v.events.length, 0);
    counts.visit_outcomes = VISIT_SPECS.filter((v) => v.outcome).length;
    counts.calendar_busy_blocks = CALENDAR_BUSY_SPECS.length;
    counts.calendar_connections = 1;
    counts.double_booking_rejection_cases = 1;
    counts.notifications = NOTIFICATION_SPECS.length;
    const ext = NOTIFICATION_SPECS.filter((n) => n.priority === 'high' || n.priority === 'urgent');
    counts.notification_deliveries = NOTIFICATION_SPECS.length + ext.length;
    counts.notification_external_simulated = ext.length;
    counts.notification_preferences = 1;
    return;
  }

  const { leads, projectId, agentId } = await resolveDemoActors(admin, tenantId);
  const leadAt = (i) => (leads.length ? leads[i % leads.length] : null);

  // --- Automations + ordered actions ---
  const autoIds = {};
  for (const a of AUTOMATION_SPECS) {
    const aid = deterministicUuid(tenantId, 'automation', a.key);
    autoIds[a.key] = aid;
    await upsertById(
      admin,
      'automations',
      aid,
      {
        tenant_id: tenantId,
        name: a.name,
        trigger: a.trigger,
        enabled: a.enabled,
        condition_group: a.condition_group,
        created_by: SEEDED_ADMIN,
      },
      false,
    );
    await recordEntity(admin, tenantId, runId, 'automation', aid, externalRef('automation', a.key));
    counts.automations++;
    for (const act of a.actions) {
      const actid = deterministicUuid(tenantId, 'automation_action', `${a.key}|${act.ordinal}`);
      await upsertById(
        admin,
        'automation_actions',
        actid,
        {
          tenant_id: tenantId,
          automation_id: aid,
          ordinal: act.ordinal,
          action_type: act.action_type,
          params: act.params ?? {},
        },
        false,
      );
      counts.automation_actions++;
    }
  }

  // --- Automation runs + run actions (+ a materialised demo task) ---
  for (const r of AUTOMATION_RUN_SPECS) {
    const spec = AUTOMATION_SPECS.find((a) => a.key === r.automationKey);
    const arid = deterministicUuid(tenantId, 'automation_run', r.key);
    await upsertById(
      admin,
      'automation_runs',
      arid,
      {
        tenant_id: tenantId,
        automation_id: autoIds[r.automationKey],
        lead_id: leadAt(0),
        trigger: spec.trigger,
        matched: r.matched,
        skipped_reason: null,
        correlation_id: 'demo',
      },
      false,
    );
    await recordEntity(admin, tenantId, runId, 'automation_run', arid, externalRef('arun', r.key));
    counts.automation_runs++;
    const aaid = deterministicUuid(tenantId, 'automation_run_action', r.key);
    await upsertById(
      admin,
      'automation_run_actions',
      aaid,
      {
        tenant_id: tenantId,
        run_id: arid,
        action_type: r.action.action_type,
        category: r.action.category,
        will_send: false, // headline safety invariant — never true
        suppressed_reason: r.action.suppressed_reason ?? null,
        status: r.action.status,
        params: {},
      },
      false,
    );
    counts.automation_run_actions++;
    if (r.action.category === 'customer_send') counts.automation_suppressed_actions++;
    if (r.createsTaskTitle) {
      const tid = deterministicUuid(tenantId, 'automation_task', r.key);
      await upsertById(
        admin,
        'tasks',
        tid,
        {
          tenant_id: tenantId,
          lead_id: leadAt(0),
          title: r.createsTaskTitle,
          status: 'open',
          created_by: SEEDED_ADMIN,
        },
        false,
      );
      await recordEntity(admin, tenantId, runId, 'task', tid, externalRef('atask', r.key));
      counts.tasks++;
    }
  }

  // --- Follow-up sequences + steps ---
  const seqIds = {};
  for (const s of FOLLOWUP_SEQUENCE_SPECS) {
    const sid = deterministicUuid(tenantId, 'followup_sequence', s.key);
    seqIds[s.key] = sid;
    await upsertById(
      admin,
      'followup_sequences',
      sid,
      {
        tenant_id: tenantId,
        name: s.name,
        enabled: s.enabled,
        stop_on_reply: true,
        quiet_start_hour: 20,
        quiet_end_hour: 9,
        created_by: SEEDED_ADMIN,
      },
      false,
    );
    await recordEntity(
      admin,
      tenantId,
      runId,
      'followup_sequence',
      sid,
      externalRef('fseq', s.key),
    );
    counts.followup_sequences++;
    for (const st of s.steps) {
      const stid = deterministicUuid(tenantId, 'followup_step', `${s.key}|${st.step_index}`);
      await upsertById(
        admin,
        'followup_steps',
        stid,
        {
          tenant_id: tenantId,
          sequence_id: sid,
          step_index: st.step_index,
          delay_hours: st.delay_hours,
          channel: st.channel,
          template_id: null,
          only_score_categories: st.only ?? [],
        },
        false,
      );
      counts.followup_steps++;
    }
  }

  // --- Enrollments + step events (every send externally suppressed) ---
  for (const e of FOLLOWUP_ENROLLMENT_SPECS) {
    const leadId = leadAt(e.leadIdx);
    if (!leadId) continue;
    const eid = deterministicUuid(tenantId, 'followup_enrollment', e.key);
    await upsertById(
      admin,
      'followup_enrollments',
      eid,
      {
        tenant_id: tenantId,
        sequence_id: seqIds[e.sequenceKey],
        lead_id: leadId,
        current_step_index: e.current_step_index,
        status: e.status,
        stop_reason: e.stop_reason,
        enrolled_score_category: 'hot',
      },
      false,
    );
    counts.followup_enrollments++;
    for (const [i, ev] of e.events.entries()) {
      const evid = deterministicUuid(tenantId, 'followup_step_event', `${e.key}|${i}`);
      const isSend = ev.outcome === 'send';
      await upsertById(
        admin,
        'followup_step_events',
        evid,
        {
          tenant_id: tenantId,
          enrollment_id: eid,
          step_index: ev.step_index,
          outcome: ev.outcome,
          stop_reason: ev.stop_reason ?? null,
          channel: isSend ? 'whatsapp' : null,
          why_sent: isSend
            ? {
                sequenceId: seqIds[e.sequenceKey],
                stepIndex: ev.step_index,
                channel: 'whatsapp',
                templateId: null,
                enrolledScoreCategory: 'hot',
                reason: 'scheduled_followup_step',
              }
            : null,
          will_send: false, // never a real send
          suppressed_reason: isSend ? 'live_send_master_switch_off' : null,
        },
        false,
      );
      counts.followup_step_events++;
    }
  }

  // --- Site visits + transitions + outcomes ---
  for (const v of VISIT_SPECS) {
    const leadId = leadAt(v.leadIdx);
    if (!leadId) continue;
    const vid = deterministicUuid(tenantId, 'site_visit', v.key);
    await upsertById(
      admin,
      'site_visits',
      vid,
      {
        tenant_id: tenantId,
        lead_id: leadId,
        project_id: projectId,
        agent_id: agentId,
        scheduled_start: visitTime(v.dayOffset, v.hour),
        scheduled_end: visitTime(v.dayOffset, v.hour + 1),
        state: v.state,
        location: 'Demo site office',
        notes: 'Synthetic demo visit.',
        created_by: SEEDED_ADMIN,
      },
      false,
    );
    await recordEntity(admin, tenantId, runId, 'site_visit', vid, externalRef('visit', v.key));
    counts.site_visits++;
    for (const [i, [from, to]] of v.events.entries()) {
      const veid = deterministicUuid(tenantId, 'visit_event', `${v.key}|${i}`);
      await upsertById(
        admin,
        'visit_events',
        veid,
        {
          tenant_id: tenantId,
          visit_id: vid,
          from_state: from,
          to_state: to,
          actor_id: SEEDED_ADMIN,
          reason: 'demo transition',
        },
        false,
      );
      counts.visit_events++;
    }
    if (v.outcome) {
      const void2 = deterministicUuid(tenantId, 'visit_outcome', v.key);
      await upsertById(
        admin,
        'visit_outcomes',
        void2,
        {
          tenant_id: tenantId,
          visit_id: vid,
          attended: v.outcome.attended,
          interest_level: v.outcome.interest_level ?? null,
          feedback: v.outcome.feedback ?? null,
        },
        false,
      );
      counts.visit_outcomes++;
    }
  }
  // The seeded busy block at v_confirmed's slot is the deterministic
  // double-booking rejection case (a new visit there overlaps + is rejected).
  counts.double_booking_rejection_cases = 1;

  // --- Calendar: 1 SIMULATED connection + 3 SIMULATED busy blocks ---
  const ccid = deterministicUuid(tenantId, 'calendar_connection', 'agent');
  await upsertById(
    admin,
    'calendar_connections',
    ccid,
    {
      tenant_id: tenantId,
      agent_id: agentId,
      provider: 'google',
      status: 'simulated', // never 'connected'
      metadata: { demo: true },
    },
    false,
  );
  await recordEntity(admin, tenantId, runId, 'calendar_connection', ccid);
  counts.calendar_connections++;
  for (const b of CALENDAR_BUSY_SPECS) {
    const bid = deterministicUuid(tenantId, 'calendar_busy_block', b.key);
    await upsertById(
      admin,
      'calendar_busy_blocks',
      bid,
      {
        tenant_id: tenantId,
        agent_id: agentId,
        source: 'calendar',
        ref_id: b.key,
        block_start: visitTime(b.dayOffset, b.hour),
        block_end: visitTime(b.dayOffset, b.hour + 1),
      },
      false,
    );
    await recordEntity(admin, tenantId, runId, 'calendar_busy_block', bid);
    counts.calendar_busy_blocks++;
  }

  // --- Notifications + deliveries (external simulated) + preferences ---
  for (const n of NOTIFICATION_SPECS) {
    const nid = deterministicUuid(tenantId, 'notification', n.key);
    await upsertById(
      admin,
      'notifications',
      nid,
      {
        tenant_id: tenantId,
        recipient_user_id: SEEDED_ADMIN,
        kind: n.kind,
        priority: n.priority,
        title: `Demo: ${n.kind}`,
        body: 'Synthetic demo notification.',
        dedupe_key: `demo:${n.key}`,
        read_at: n.read ? new Date().toISOString() : null,
      },
      false,
    );
    await recordEntity(admin, tenantId, runId, 'notification', nid, externalRef('notif', n.key));
    counts.notifications++;
    const inAppId = deterministicUuid(tenantId, 'notif_delivery', `${n.key}|in_app`);
    await upsertById(
      admin,
      'notification_deliveries',
      inAppId,
      {
        tenant_id: tenantId,
        notification_id: nid,
        channel: 'in_app',
        status: 'delivered',
        simulated: false,
      },
      false,
    );
    counts.notification_deliveries++;
    if (n.priority === 'high' || n.priority === 'urgent') {
      const emailId = deterministicUuid(tenantId, 'notif_delivery', `${n.key}|email`);
      await upsertById(
        admin,
        'notification_deliveries',
        emailId,
        {
          tenant_id: tenantId,
          notification_id: nid,
          channel: 'email',
          status: 'simulated',
          simulated: true, // external delivery is always simulated
        },
        false,
      );
      counts.notification_deliveries++;
      counts.notification_external_simulated++;
    }
  }
  const npid = deterministicUuid(tenantId, 'notif_pref', 'admin');
  await upsertById(
    admin,
    'notification_preferences',
    npid,
    {
      tenant_id: tenantId,
      user_id: SEEDED_ADMIN,
      email_enabled: true,
      push_enabled: false,
      quiet_hours_enabled: true,
      muted_kinds: [],
    },
    false,
  );
  await recordEntity(admin, tenantId, runId, 'notification_preference', npid);
  counts.notification_preferences++;
}

// ===========================================================================
// PHASE 9 — Usage, billing, system health, export logs (fixtures)
// ===========================================================================

function currentMonthRange(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10),
  };
}

async function seedPhase9(admin, ctx, counts) {
  const { tenantId, runId, dryRun } = ctx;
  if (dryRun) {
    counts.usage_counters = USAGE_METERED.length + USAGE_INFO.length;
    counts.billing_periods = 1;
    counts.system_health_checks = HEALTH_SPECS.length;
    counts.analytics_export_logs = EXPORT_SPECS.length;
    return;
  }

  const { start, end } = currentMonthRange();
  const { data: tRow } = await admin
    .from('tenants')
    .select('plan_tier')
    .eq('id', tenantId)
    .maybeSingle();
  const tier = ['starter', 'growth', 'enterprise'].includes(tRow?.plan_tier)
    ? tRow.plan_tier
    : 'starter';
  const limits = PLAN_LIMITS[tier];

  // Metered counters: below / near / at the plan limit (current month).
  for (const u of USAGE_METERED) {
    const used = Math.round(limits[u.limitKey] * u.frac);
    const id = deterministicUuid(tenantId, 'usage_counter', `${u.metric}|${start}`);
    await upsertById(
      admin,
      'usage_counters',
      id,
      { tenant_id: tenantId, metric: u.metric, period_start: start, period_end: end, used },
      false,
    );
    await recordEntity(admin, tenantId, runId, 'usage_counter', id);
    counts.usage_counters++;
  }
  for (const u of USAGE_INFO) {
    const id = deterministicUuid(tenantId, 'usage_counter', `${u.metric}|${start}`);
    await upsertById(
      admin,
      'usage_counters',
      id,
      { tenant_id: tenantId, metric: u.metric, period_start: start, period_end: end, used: u.used },
      false,
    );
    await recordEntity(admin, tenantId, runId, 'usage_counter', id);
    counts.usage_counters++;
  }

  // One synthetic billing period — NO payment-provider record.
  const bpid = deterministicUuid(tenantId, 'billing_period', start);
  await upsertById(
    admin,
    'billing_periods',
    bpid,
    {
      tenant_id: tenantId,
      period_start: start,
      period_end: end,
      plan_tier: tier,
      status: 'open',
      currency: 'INR',
      amount_due: 0,
    },
    false,
  );
  await recordEntity(admin, tenantId, runId, 'billing_period', bpid);
  counts.billing_periods++;

  // System-health snapshots (6 tenant + 2 platform-level [tenant_id null]).
  for (const h of HEALTH_SPECS) {
    const id = deterministicUuid(tenantId, 'system_health_check', h.key);
    await upsertById(
      admin,
      'system_health_checks',
      id,
      {
        tenant_id: h.platform ? null : tenantId,
        component: h.component,
        state: h.state,
        latency_ms: h.latency_ms,
        detail: 'Synthetic demo health snapshot.',
      },
      false,
    );
    await recordEntity(admin, tenantId, runId, 'system_health_check', id);
    counts.system_health_checks++;
  }

  // Logged analytics exports (data-egress ledger).
  for (const e of EXPORT_SPECS) {
    const id = deterministicUuid(tenantId, 'analytics_export_log', e.key);
    await upsertById(
      admin,
      'analytics_export_logs',
      id,
      {
        tenant_id: tenantId,
        actor_user_id: SEEDED_ADMIN,
        report: e.report,
        format: e.format,
        row_count: e.row_count,
        filters: {},
      },
      false,
    );
    await recordEntity(admin, tenantId, runId, 'analytics_export_log', id);
    counts.analytics_export_logs++;
  }
}

export { failRun };
