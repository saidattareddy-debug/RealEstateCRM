/**
 * Central, typed audit-event catalogue. The single source of truth shared by
 * the DB seed (`audit_actions`), the server audit service, the admin UI and the
 * tests. Arbitrary audit-action strings must NEVER be scattered through the
 * app — add an entry here and to migration 0005 instead. See docs/AUDIT_LOGGING.md.
 */

export const AUDIT_CATEGORIES = [
  'auth',
  'tenant',
  'access_control',
  'configuration',
  'data_export',
  'integration',
  'impersonation',
  'abuse',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const SECURITY_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

export const SECURITY_STATUSES = ['open', 'investigating', 'resolved', 'ignored'] as const;
export type SecurityStatus = (typeof SECURITY_STATUSES)[number];

export interface AuditActionDef {
  readonly key: string;
  readonly category: AuditCategory;
  readonly description: string;
  /** When true, an occurrence also raises/updates a security_event. */
  readonly security: boolean;
}

/** The catalogue. Keys are stable identifiers stored in `audit_logs.action`. */
export const AUDIT_ACTIONS = {
  SIGN_IN_SUCCESS: {
    key: 'auth.sign_in.success',
    category: 'auth',
    description: 'User signed in',
    security: false,
  },
  SIGN_IN_FAILURE: {
    key: 'auth.sign_in.failure',
    category: 'auth',
    description: 'Failed sign-in attempt',
    security: true,
  },
  SIGN_OUT: {
    key: 'auth.sign_out',
    category: 'auth',
    description: 'User signed out',
    security: false,
  },
  TENANT_SWITCH: {
    key: 'tenant.switch',
    category: 'tenant',
    description: 'Active tenant switched',
    security: false,
  },
  TENANT_SWITCH_DENIED: {
    key: 'tenant.switch.denied',
    category: 'access_control',
    description: 'Tenant switch denied (not a member)',
    security: true,
  },
  INVITATION_CREATE: {
    key: 'invitation.create',
    category: 'access_control',
    description: 'Invitation created',
    security: false,
  },
  INVITATION_ACCEPT: {
    key: 'invitation.accept',
    category: 'access_control',
    description: 'Invitation accepted',
    security: false,
  },
  ROLE_CHANGE: {
    key: 'membership.role_change',
    category: 'access_control',
    description: 'Member role changed',
    security: true,
  },
  PERMISSION_OVERRIDE: {
    key: 'permission.override',
    category: 'access_control',
    description: 'Per-user permission grant/revoke',
    security: true,
  },
  BRANDING_UPDATE: {
    key: 'settings.branding.update',
    category: 'configuration',
    description: 'Branding updated',
    security: false,
  },
  ORG_SETTINGS_UPDATE: {
    key: 'settings.org.update',
    category: 'configuration',
    description: 'Organisation settings updated',
    security: false,
  },
  IMPERSONATION_START: {
    key: 'impersonation.start',
    category: 'impersonation',
    description: 'Support impersonation started',
    security: true,
  },
  IMPERSONATION_END: {
    key: 'impersonation.end',
    category: 'impersonation',
    description: 'Support impersonation ended',
    security: true,
  },
  EXPORT_REQUEST: {
    key: 'data.export.request',
    category: 'data_export',
    description: 'Data export requested',
    security: true,
  },
  INTEGRATION_CONFIG_CHANGE: {
    key: 'integration.config.change',
    category: 'integration',
    description: 'Integration/secret configuration changed',
    security: true,
  },
  // Phase 2 — projects & inventory
  PROJECT_CREATE: {
    key: 'project.create',
    category: 'configuration',
    description: 'Project created',
    security: false,
  },
  PROJECT_UPDATE: {
    key: 'project.update',
    category: 'configuration',
    description: 'Project updated',
    security: false,
  },
  PROJECT_APPROVE: {
    key: 'project.approve',
    category: 'configuration',
    description: 'Project approved/published',
    security: true,
  },
  INVENTORY_UPDATE: {
    key: 'inventory.update',
    category: 'configuration',
    description: 'Inventory unit updated',
    security: false,
  },
  INVENTORY_STATUS_CHANGE: {
    key: 'inventory.status_change',
    category: 'configuration',
    description: 'Inventory status changed',
    security: false,
  },
  INVENTORY_IMPORT: {
    key: 'inventory.import',
    category: 'configuration',
    description: 'Inventory imported',
    security: false,
  },
  STALEDATA_RESOLVE: {
    key: 'staledata.resolve',
    category: 'configuration',
    description: 'Stale inventory re-verified',
    security: false,
  },
  // Phase 3 — leads
  LEAD_CREATE: {
    key: 'lead.create',
    category: 'configuration',
    description: 'Lead created',
    security: false,
  },
  LEAD_UPDATE: {
    key: 'lead.update',
    category: 'configuration',
    description: 'Lead updated',
    security: false,
  },
  LEAD_MERGE: {
    key: 'lead.merge',
    category: 'configuration',
    description: 'Duplicate leads merged',
    security: true,
  },
  LEAD_DEDUPE_DISMISS: {
    key: 'lead.dedupe.dismiss',
    category: 'configuration',
    description: 'Duplicate dismissed',
    security: false,
  },
  LEAD_ASSIGN: {
    key: 'lead.assign',
    category: 'access_control',
    description: 'Lead assigned',
    security: false,
  },
  LEAD_STAGE_CHANGE: {
    key: 'lead.stage_change',
    category: 'configuration',
    description: 'Lead pipeline stage changed',
    security: false,
  },
  LEAD_NOTE_ADD: {
    key: 'lead.note.add',
    category: 'configuration',
    description: 'Note added to lead',
    security: false,
  },
  TASK_CREATE: {
    key: 'task.create',
    category: 'configuration',
    description: 'Task created',
    security: false,
  },
  // Phase 3.1 — ingestion, calls, views, forms, durable jobs
  LEAD_INGEST: {
    key: 'lead.ingest',
    category: 'configuration',
    description: 'Lead ingested via API/webhook/form',
    security: false,
  },
  CALL_LOG: {
    key: 'call.log',
    category: 'configuration',
    description: 'Call logged',
    security: false,
  },
  VIEW_SAVE: {
    key: 'view.save',
    category: 'configuration',
    description: 'Saved view created/updated',
    security: false,
  },
  FORM_CONFIG_UPDATE: {
    key: 'form.config.update',
    category: 'configuration',
    description: 'Public form configured',
    security: false,
  },
  INGESTION_DEAD_LETTER: {
    key: 'ingestion.dead_letter',
    category: 'integration',
    description: 'Ingestion event dead-lettered',
    security: true,
  },
  JOB_REPLAY: {
    key: 'job.replay',
    category: 'integration',
    description: 'Background job/event replayed',
    security: true,
  },
  CONVERSATION_REPLY: {
    key: 'conversation.reply',
    category: 'configuration',
    description: 'Agent sent an outbound message',
    security: false,
  },
  CONVERSATION_TAKEOVER: {
    key: 'conversation.takeover',
    category: 'configuration',
    description: 'Human took over a conversation (AI paused)',
    security: false,
  },
  CONVERSATION_RESUME: {
    key: 'conversation.resume',
    category: 'configuration',
    description: 'AI handling resumed on a conversation',
    security: false,
  },
  CONVERSATION_TRANSFER: {
    key: 'conversation.transfer',
    category: 'configuration',
    description: 'Conversation transferred to another agent',
    security: false,
  },
  CONVERSATION_CLOSE: {
    key: 'conversation.close',
    category: 'configuration',
    description: 'Conversation closed or reopened',
    security: false,
  },
  CONVERSATION_SUMMARY: {
    key: 'conversation.summary',
    category: 'configuration',
    description: 'Conversation summary generated',
    security: false,
  },
  CONSENT_UPDATE: {
    key: 'consent.update',
    category: 'access_control',
    description: 'Contact consent / do-not-contact updated',
    security: true,
  },
  WIDGET_CONFIG_UPDATE: {
    key: 'widget.config.update',
    category: 'configuration',
    description: 'Website chat widget configured',
    security: false,
  },
  CONVERSATION_ASSIGN: {
    key: 'conversation.assign',
    category: 'configuration',
    description: 'Conversation assigned',
    security: false,
  },
  CONVERSATION_STATUS_CHANGE: {
    key: 'conversation.status_change',
    category: 'configuration',
    description: 'Conversation status changed',
    security: false,
  },
  CONVERSATION_PRIORITY_CHANGE: {
    key: 'conversation.priority_change',
    category: 'configuration',
    description: 'Conversation priority changed',
    security: false,
  },
  CONVERSATION_NOTE: {
    key: 'conversation.note',
    category: 'configuration',
    description: 'Internal note created/edited',
    security: false,
  },
  CONVERSATION_TAG: {
    key: 'conversation.tag',
    category: 'configuration',
    description: 'Conversation tag changed',
    security: false,
  },
  MESSAGE_REDACT: {
    key: 'message.redact',
    category: 'access_control',
    description: 'Message redacted',
    security: true,
  },
  CONSENT_EVENT: {
    key: 'consent.event',
    category: 'access_control',
    description: 'Consent event recorded',
    security: true,
  },
  DNC_UPDATE: {
    key: 'dnc.update',
    category: 'access_control',
    description: 'Do-not-contact entry changed',
    security: true,
  },
  CANNED_REPLY_MANAGE: {
    key: 'canned_reply.manage',
    category: 'configuration',
    description: 'Canned reply created/updated',
    security: false,
  },
  WEBSITE_CHAT_SESSION: {
    key: 'website_chat.session',
    category: 'integration',
    description: 'Website chat session lifecycle',
    security: false,
  },
  MESSAGE_INGEST: {
    key: 'message.ingest',
    category: 'integration',
    description: 'Inbound message ingested',
    security: false,
  },
  MESSAGE_DEAD_LETTER: {
    key: 'message.dead_letter',
    category: 'integration',
    description: 'Inbound message dead-lettered',
    security: true,
  },
  // Phase 5A — knowledge / RAG / AI foundation. Reference ids + safe summaries
  // only; never full knowledge content, messages, prompts, credentials or
  // generated answers (enforced by the audit service redaction + call sites).
  KNOWLEDGE_SOURCE_CREATED: {
    key: 'knowledge.source.created',
    category: 'configuration',
    description: 'Knowledge source created',
    security: false,
  },
  KNOWLEDGE_SOURCE_UPDATED: {
    key: 'knowledge.source.updated',
    category: 'configuration',
    description: 'Knowledge source updated',
    security: false,
  },
  KNOWLEDGE_VERSION_CREATED: {
    key: 'knowledge.version.created',
    category: 'configuration',
    description: 'Knowledge version created',
    security: false,
  },
  KNOWLEDGE_APPROVED: {
    key: 'knowledge.approved',
    category: 'configuration',
    description: 'Knowledge approved',
    security: false,
  },
  KNOWLEDGE_REJECTED: {
    key: 'knowledge.rejected',
    category: 'configuration',
    description: 'Knowledge rejected',
    security: false,
  },
  KNOWLEDGE_SUPERSEDED: {
    key: 'knowledge.superseded',
    category: 'configuration',
    description: 'Knowledge superseded',
    security: false,
  },
  KNOWLEDGE_ARCHIVED: {
    key: 'knowledge.archived',
    category: 'configuration',
    description: 'Knowledge archived',
    security: false,
  },
  KNOWLEDGE_INGESTION_STARTED: {
    key: 'knowledge.ingestion.started',
    category: 'configuration',
    description: 'Knowledge ingestion started',
    security: false,
  },
  KNOWLEDGE_INGESTION_FAILED: {
    key: 'knowledge.ingestion.failed',
    category: 'configuration',
    description: 'Knowledge ingestion failed',
    security: false,
  },
  KNOWLEDGE_EMBEDDING_GENERATED: {
    key: 'knowledge.embedding.generated',
    category: 'configuration',
    description: 'Knowledge embedding generated',
    security: false,
  },
  KNOWLEDGE_CONFLICT_DETECTED: {
    key: 'knowledge.conflict.detected',
    category: 'configuration',
    description: 'Knowledge conflict detected',
    security: false,
  },
  KNOWLEDGE_CONFLICT_RESOLVED: {
    key: 'knowledge.conflict.resolved',
    category: 'configuration',
    description: 'Knowledge conflict resolved',
    security: false,
  },
  AI_PROVIDER_UPDATED: {
    key: 'ai.provider.updated',
    category: 'configuration',
    description: 'AI provider configuration updated',
    security: false,
  },
  RESPONDER_ACTIVATION_REQUESTED: {
    key: 'responder.activation.requested',
    category: 'configuration',
    description: 'Responder live-activation requested',
    security: true,
  },
  RESPONDER_ACTIVATION_APPROVED: {
    key: 'responder.activation.approved',
    category: 'configuration',
    description: 'Responder live-activation approval recorded',
    security: true,
  },
  RESPONDER_CHANNEL_UPDATED: {
    key: 'responder.channel.updated',
    category: 'configuration',
    description: 'Responder channel runtime settings updated',
    security: true,
  },
  RESPONDER_KILLSWITCH_ACTIVATED: {
    key: 'responder.killswitch.activated',
    category: 'configuration',
    description: 'Responder kill switch activated',
    security: true,
  },
  RESPONDER_CANDIDATE_SIMULATED: {
    key: 'responder.candidate.simulated',
    category: 'configuration',
    description: 'Responder delivery candidate simulated (not sent)',
    security: false,
  },
  RESPONDER_CANDIDATE_SUPPRESSED: {
    key: 'responder.candidate.suppressed',
    category: 'configuration',
    description: 'Responder delivery candidate suppressed',
    security: false,
  },
  SCORING_MODEL_CREATED: {
    key: 'scoring.model.created',
    category: 'configuration',
    description: 'Scoring model created',
    security: false,
  },
  SCORING_MODEL_VERSION_CREATED: {
    key: 'scoring.model_version.created',
    category: 'configuration',
    description: 'Scoring model version created',
    security: false,
  },
  SCORING_MODEL_SUBMITTED: {
    key: 'scoring.model.submitted',
    category: 'configuration',
    description: 'Scoring model submitted for approval',
    security: false,
  },
  SCORING_MODEL_APPROVED: {
    key: 'scoring.model.approved',
    category: 'configuration',
    description: 'Scoring model approved',
    security: true,
  },
  SCORING_MODEL_ACTIVATED: {
    key: 'scoring.model.activated',
    category: 'configuration',
    description: 'Scoring model version activated',
    security: true,
  },
  SCORING_MODEL_RETIRED: {
    key: 'scoring.model.retired',
    category: 'configuration',
    description: 'Scoring model version retired',
    security: false,
  },
  SCORING_SIGNAL_CREATED: {
    key: 'scoring.signal.created',
    category: 'configuration',
    description: 'Scoring signal definition created',
    security: false,
  },
  SCORING_OBSERVATION_RECORDED: {
    key: 'scoring.observation.recorded',
    category: 'configuration',
    description: 'Lead signal observation recorded',
    security: false,
  },
  SCORING_CALCULATED: {
    key: 'scoring.calculated',
    category: 'configuration',
    description: 'Lead score calculated',
    security: false,
  },
  SCORING_RECALCULATED: {
    key: 'scoring.recalculated',
    category: 'configuration',
    description: 'Lead score recalculated',
    security: false,
  },
  SCORING_OVERRIDE_APPLIED: {
    key: 'scoring.override.applied',
    category: 'configuration',
    description: 'Lead score override applied',
    security: true,
  },
  SCORING_OVERRIDE_REMOVED: {
    key: 'scoring.override.removed',
    category: 'configuration',
    description: 'Lead score override removed',
    security: true,
  },
  SCORING_DISQUALIFICATION_RECOMMENDED: {
    key: 'scoring.disqualification.recommended',
    category: 'configuration',
    description: 'Lead disqualification recommended',
    security: false,
  },
  SCORING_REVIEW_REQUIRED: {
    key: 'scoring.review.required',
    category: 'configuration',
    description: 'Lead review required',
    security: false,
  },
  SCORING_EXTRACTION_PROPOSED: {
    key: 'scoring.extraction.proposed',
    category: 'configuration',
    description: 'AI signal extraction proposed',
    security: false,
  },
  SCORING_EXTRACTION_APPROVED: {
    key: 'scoring.extraction.approved',
    category: 'configuration',
    description: 'AI signal extraction approved',
    security: false,
  },
  SCORING_EXTRACTION_REJECTED: {
    key: 'scoring.extraction.rejected',
    category: 'configuration',
    description: 'AI signal extraction rejected',
    security: false,
  },
  MATCHING_MODEL_CREATED: {
    key: 'matching.model.created',
    category: 'configuration',
    description: 'Matching model created',
    security: false,
  },
  MATCHING_VERSION_CREATED: {
    key: 'matching.version.created',
    category: 'configuration',
    description: 'Matching model version created',
    security: false,
  },
  MATCHING_MODEL_SUBMITTED: {
    key: 'matching.model.submitted',
    category: 'configuration',
    description: 'Matching model submitted for approval',
    security: false,
  },
  MATCHING_MODEL_APPROVED: {
    key: 'matching.model.approved',
    category: 'configuration',
    description: 'Matching model approved',
    security: true,
  },
  MATCHING_MODEL_ACTIVATED: {
    key: 'matching.model.activated',
    category: 'configuration',
    description: 'Matching model version activated',
    security: true,
  },
  MATCHING_MODEL_RETIRED: {
    key: 'matching.model.retired',
    category: 'configuration',
    description: 'Matching model version retired',
    security: false,
  },
  MATCHING_CALCULATED: {
    key: 'matching.calculated',
    category: 'configuration',
    description: 'Lead match calculated',
    security: false,
  },
  MATCHING_RECALCULATED: {
    key: 'matching.recalculated',
    category: 'configuration',
    description: 'Lead match recalculated',
    security: false,
  },
  MATCHING_CANDIDATE_EXCLUDED: {
    key: 'matching.candidate.excluded',
    category: 'configuration',
    description: 'Match candidate excluded',
    security: false,
  },
  MATCHING_INVENTORY_STALE: {
    key: 'matching.inventory.stale',
    category: 'configuration',
    description: 'Match inventory marked stale',
    security: false,
  },
  MATCHING_OVERRIDE_APPLIED: {
    key: 'matching.override.applied',
    category: 'configuration',
    description: 'Match override applied',
    security: true,
  },
  MATCHING_OVERRIDE_REMOVED: {
    key: 'matching.override.removed',
    category: 'configuration',
    description: 'Match override removed',
    security: true,
  },
  MATCHING_FEEDBACK_RECORDED: {
    key: 'matching.feedback.recorded',
    category: 'configuration',
    description: 'Match feedback recorded',
    security: false,
  },
  MATCHING_EXTRACTION_PROPOSED: {
    key: 'matching.extraction.proposed',
    category: 'configuration',
    description: 'AI preference extraction proposed',
    security: false,
  },
  MATCHING_EXTRACTION_APPROVED: {
    key: 'matching.extraction.approved',
    category: 'configuration',
    description: 'AI preference extraction approved',
    security: false,
  },
  MATCHING_EXTRACTION_REJECTED: {
    key: 'matching.extraction.rejected',
    category: 'configuration',
    description: 'AI preference extraction rejected',
    security: false,
  },
  INTEGRATION_CREATED: {
    key: 'integration.created',
    category: 'configuration',
    description: 'Integration created',
    security: false,
  },
  INTEGRATION_UPDATED: {
    key: 'integration.updated',
    category: 'configuration',
    description: 'Integration updated',
    security: false,
  },
  INTEGRATION_DISABLED: {
    key: 'integration.disabled',
    category: 'configuration',
    description: 'Integration disabled',
    security: true,
  },
  INTEGRATION_VERIFICATION_ATTEMPTED: {
    key: 'integration.verification.attempted',
    category: 'configuration',
    description: 'Integration verification attempted',
    security: false,
  },
  INTEGRATION_VERIFICATION_SUCCEEDED: {
    key: 'integration.verification.succeeded',
    category: 'configuration',
    description: 'Integration verification succeeded',
    security: false,
  },
  INTEGRATION_VERIFICATION_FAILED: {
    key: 'integration.verification.failed',
    category: 'configuration',
    description: 'Integration verification failed',
    security: false,
  },
  INTEGRATION_SECRET_REF_UPDATED: {
    key: 'integration.secret_ref.updated',
    category: 'configuration',
    description: 'Integration secret reference updated',
    security: true,
  },
  INTEGRATION_WEBHOOK_VERIFIED: {
    key: 'integration.webhook.verified',
    category: 'configuration',
    description: 'Webhook verified',
    security: false,
  },
  INTEGRATION_WEBHOOK_REJECTED: {
    key: 'integration.webhook.rejected',
    category: 'configuration',
    description: 'Webhook rejected',
    security: true,
  },
  INTEGRATION_EVENT_RECEIVED: {
    key: 'integration.event.received',
    category: 'configuration',
    description: 'External event received',
    security: false,
  },
  INTEGRATION_ENVELOPE_RECEIVED: {
    key: 'integration.envelope.received',
    category: 'configuration',
    description: 'Authenticated webhook envelope persisted',
    security: false,
  },
  INTEGRATION_ENVELOPE_RESUBMISSION_REQUIRED: {
    key: 'integration.envelope.resubmission_required',
    category: 'configuration',
    description: 'Parse failure — resubmission required (not replayable)',
    security: false,
  },
  INTEGRATION_EVENT_DUPLICATE: {
    key: 'integration.event.duplicate',
    category: 'configuration',
    description: 'External event duplicate',
    security: false,
  },
  INTEGRATION_EVENT_PROCESSED: {
    key: 'integration.event.processed',
    category: 'configuration',
    description: 'External event processed',
    security: false,
  },
  INTEGRATION_EVENT_FAILED: {
    key: 'integration.event.failed',
    category: 'configuration',
    description: 'External event failed',
    security: false,
  },
  INTEGRATION_EVENT_DEAD_LETTERED: {
    key: 'integration.event.dead_lettered',
    category: 'configuration',
    description: 'External event dead-lettered',
    security: true,
  },
  INTEGRATION_EVENT_REPLAYED: {
    key: 'integration.event.replayed',
    category: 'configuration',
    description: 'External event replayed',
    security: true,
  },
  INTEGRATION_MAPPING_CREATED: {
    key: 'integration.mapping.created',
    category: 'configuration',
    description: 'Source mapping created',
    security: false,
  },
  INTEGRATION_MAPPING_ACTIVATED: {
    key: 'integration.mapping.activated',
    category: 'configuration',
    description: 'Source mapping activated',
    security: false,
  },
  WHATSAPP_TEMPLATE_IMPORTED: {
    key: 'whatsapp.template.imported',
    category: 'configuration',
    description: 'WhatsApp template imported',
    security: false,
  },
  WHATSAPP_TEMPLATE_STATUS_CHANGED: {
    key: 'whatsapp.template.status_changed',
    category: 'configuration',
    description: 'WhatsApp template status changed',
    security: false,
  },
  INTEGRATION_HUMAN_MESSAGE_SIMULATED: {
    key: 'integration.human_message.simulated',
    category: 'configuration',
    description: 'Human message simulated (not sent)',
    security: false,
  },
  EMAIL_PARSER_RULE_CREATED: {
    key: 'email.parser_rule.created',
    category: 'configuration',
    description: 'Email parser rule created',
    security: false,
  },
  EMAIL_PARSER_RULE_UPDATED: {
    key: 'email.parser_rule.updated',
    category: 'configuration',
    description: 'Email parser rule updated',
    security: false,
  },
  EMAIL_MAILBOX_WATCH_CHANGED: {
    key: 'email.mailbox_watch.changed',
    category: 'configuration',
    description: 'Mailbox watch state changed',
    security: false,
  },
  INTEGRATION_HEALTH_CHANGED: {
    key: 'integration.health.changed',
    category: 'configuration',
    description: 'Integration health state changed',
    security: false,
  },
  AI_MODEL_UPDATED: {
    key: 'ai.model.updated',
    category: 'configuration',
    description: 'AI model configuration updated',
    security: false,
  },
  AI_PROMPT_VERSION_CREATED: {
    key: 'ai.prompt.version.created',
    category: 'configuration',
    description: 'AI prompt version created',
    security: false,
  },
  AI_PROMPT_ACTIVATED: {
    key: 'ai.prompt.activated',
    category: 'configuration',
    description: 'AI prompt activated',
    security: false,
  },
  AI_POLICY_UPDATED: {
    key: 'ai.policy.updated',
    category: 'configuration',
    description: 'AI policy updated',
    security: false,
  },
  AI_TEST_RUN_EXECUTED: {
    key: 'ai.test_run.executed',
    category: 'configuration',
    description: 'AI test run executed',
    security: false,
  },
  AI_COPILOT_DRAFT_GENERATED: {
    key: 'ai.copilot.draft.generated',
    category: 'configuration',
    description: 'Copilot draft generated',
    security: false,
  },
  AI_COPILOT_DRAFT_ACCEPTED: {
    key: 'ai.copilot.draft.accepted',
    category: 'configuration',
    description: 'Copilot draft accepted',
    security: false,
  },
  AI_COPILOT_DRAFT_EDITED: {
    key: 'ai.copilot.draft.edited',
    category: 'configuration',
    description: 'Copilot draft edited',
    security: false,
  },
  AI_COPILOT_DRAFT_DISCARDED: {
    key: 'ai.copilot.draft.discarded',
    category: 'configuration',
    description: 'Copilot draft discarded',
    security: false,
  },
  AI_ESCALATION_RECOMMENDED: {
    key: 'ai.escalation.recommended',
    category: 'configuration',
    description: 'AI escalation recommended',
    security: false,
  },
  AI_USAGE_LIMIT_REACHED: {
    key: 'ai.usage.limit_reached',
    category: 'abuse',
    description: 'AI usage limit reached',
    security: true,
  },
  // Phase 8 — Automations & Visits
  AUTOMATION_CREATED: {
    key: 'automation.created',
    category: 'configuration',
    description: 'Automation created',
    security: true,
  },
  AUTOMATION_UPDATED: {
    key: 'automation.updated',
    category: 'configuration',
    description: 'Automation updated',
    security: true,
  },
  AUTOMATION_RUN: {
    key: 'automation.run',
    category: 'configuration',
    description: 'Automation evaluated for an event',
    security: false,
  },
  AUTOMATION_ACTION_EXECUTED: {
    key: 'automation.action_executed',
    category: 'configuration',
    description: 'Automation internal action executed',
    security: false,
  },
  AUTOMATION_ACTION_SUPPRESSED: {
    key: 'automation.action_suppressed',
    category: 'configuration',
    description: 'Automation customer-send action suppressed (not sent)',
    security: false,
  },
  FOLLOWUP_SEQUENCE_UPDATED: {
    key: 'followup.sequence.updated',
    category: 'configuration',
    description: 'Follow-up sequence updated',
    security: true,
  },
  FOLLOWUP_ENROLLED: {
    key: 'followup.enrolled',
    category: 'configuration',
    description: 'Lead enrolled in a follow-up sequence',
    security: false,
  },
  FOLLOWUP_UNENROLLED: {
    key: 'followup.unenrolled',
    category: 'configuration',
    description: 'Lead unenrolled / sequence stopped',
    security: false,
  },
  FOLLOWUP_STEP_SUPPRESSED: {
    key: 'followup.step.suppressed',
    category: 'configuration',
    description: 'Follow-up step recorded as suppressed (not sent)',
    security: false,
  },
  VISIT_SCHEDULED: {
    key: 'visit.scheduled',
    category: 'configuration',
    description: 'Site visit scheduled',
    security: false,
  },
  VISIT_TRANSITIONED: {
    key: 'visit.transitioned',
    category: 'configuration',
    description: 'Site visit state transitioned',
    security: false,
  },
  VISIT_OUTCOME_RECORDED: {
    key: 'visit.outcome_recorded',
    category: 'configuration',
    description: 'Site visit outcome recorded',
    security: false,
  },
  NOTIFICATION_CREATED: {
    key: 'notification.created',
    category: 'configuration',
    description: 'Notification created',
    security: false,
  },
  // Phase 9 — Analytics & Administration
  USAGE_RECORDED: {
    key: 'usage.recorded',
    category: 'configuration',
    description: 'Usage counter recorded',
    security: false,
  },
  BILLING_PERIOD_UPDATED: {
    key: 'billing.period.updated',
    category: 'configuration',
    description: 'Billing period updated',
    security: true,
  },
  ANALYTICS_EXPORTED: {
    key: 'analytics.exported',
    category: 'data_export',
    description: 'Analytics/report exported',
    security: true,
  },
  SYSTEM_HEALTH_RECORDED: {
    key: 'system.health.recorded',
    category: 'configuration',
    description: 'System health snapshot recorded',
    security: false,
  },
} as const satisfies Record<string, AuditActionDef>;

export type AuditActionName = keyof typeof AUDIT_ACTIONS;
export type AuditActionKey = (typeof AUDIT_ACTIONS)[AuditActionName]['key'];

export const AUDIT_ACTION_LIST: readonly AuditActionDef[] = Object.values(AUDIT_ACTIONS);
export const AUDIT_ACTION_KEYS: readonly string[] = AUDIT_ACTION_LIST.map((a) => a.key);

export function isAuditActionKey(value: string): boolean {
  return AUDIT_ACTION_KEYS.includes(value);
}

/**
 * Keys that must NEVER appear in audit payloads (previous/new values, metadata):
 * raw passwords, tokens, provider secrets. The audit service redacts these.
 */
export const AUDIT_REDACT_KEYS = [
  'password',
  'encrypted_password',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'api_key',
  'apikey',
  'service_role_key',
  'authorization',
  'client_secret',
] as const;

/** Recursively redact sensitive keys from an arbitrary value before storage. */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      out[k] = AUDIT_REDACT_KEYS.some((r) => lower.includes(r)) ? '[REDACTED]' : redactSensitive(v);
    }
    return out;
  }
  return value;
}
