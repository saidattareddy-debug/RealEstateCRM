import { z } from 'zod';

/** Conversation, messaging, takeover, summary, widget, and consent schemas. */

export const conversationChannels = ['website_chat', 'whatsapp', 'email', 'voice'] as const;
export const consentChannels = ['whatsapp', 'email', 'sms', 'call', 'any'] as const;
export const consentStatuses = ['granted', 'revoked', 'do_not_contact'] as const;

/** Agent-sent outbound message from the inbox. */
export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  language: z.string().max(20).optional().nullable(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const takeoverSchema = z.object({
  conversationId: z.string().uuid(),
  reason: z.string().max(300).optional().nullable(),
});

export const transferSchema = z.object({
  conversationId: z.string().uuid(),
  toAgentId: z.string().uuid(),
  reason: z.string().max(300).optional().nullable(),
});

export const closeConversationSchema = z.object({
  conversationId: z.string().uuid(),
  reopen: z.boolean().default(false),
});

export const consentSchema = z.object({
  leadId: z.string().uuid().optional().nullable(),
  channel: z.enum(consentChannels).default('any'),
  status: z.enum(consentStatuses),
  contactValue: z.string().max(160).optional().nullable(),
  note: z.string().max(300).optional().nullable(),
});
export type ConsentInput = z.infer<typeof consentSchema>;

/**
 * Public website-chat widget payloads. Treated as fully untrusted input.
 * `hp` is the honeypot field — any value means "drop silently".
 */
export const widgetStartSchema = z.object({
  fullName: z.string().max(160).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  message: z.string().max(2000).optional().nullable(),
  pageUrl: z.string().max(2000).optional().nullable(),
  campaign: z.string().max(160).optional().nullable(),
  language: z.string().max(20).optional().nullable(),
  consent: z.boolean().optional(),
  utm: z.record(z.string()).optional(),
  hp: z.string().optional(),
  ts: z.number().optional(),
});
export type WidgetStartInput = z.infer<typeof widgetStartSchema>;

export const widgetMessageSchema = z.object({
  // The opaque session token (the only credential the browser holds). Internal
  // conversation/tenant/lead ids are resolved server-side from it.
  token: z.string().min(16).max(200),
  body: z.string().min(1).max(2000),
  clientMessageId: z.string().max(120).optional().nullable(),
  language: z.string().max(20).optional().nullable(),
  hp: z.string().optional(),
  ts: z.number().optional(),
});
export type WidgetMessageInput = z.infer<typeof widgetMessageSchema>;

export const widgetClearSchema = z.object({
  token: z.string().min(16).max(200),
  hp: z.string().optional(),
});

// --- Phase 4.1 inbox operations ------------------------------------------

export const operatingModes = ['human', 'paused'] as const; // never 'ai' from the UI
export const setModeSchema = z.object({
  conversationId: z.string().uuid(),
  mode: z.enum(operatingModes),
});

export const conversationLifecycles = [
  'open',
  'paused',
  'resolved',
  'closed',
  'spam',
  'archived',
] as const;
export const changeStatusSchema = z.object({
  conversationId: z.string().uuid(),
  lifecycle: z.enum(conversationLifecycles),
  reason: z.string().max(300).optional().nullable(),
});

export const conversationPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export const changePrioritySchema = z.object({
  conversationId: z.string().uuid(),
  priority: z.enum(conversationPriorities),
  reason: z.string().max(300).optional().nullable(),
});

export const noteVisibilities = ['assigned_agent', 'team', 'manager_only'] as const;
export const noteSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  visibility: z.enum(noteVisibilities).default('team'),
  pinned: z.boolean().default(false),
});

export const tagSchema = z.object({
  conversationId: z.string().uuid(),
  tagId: z.string().uuid(),
});

export const markReadSchema = z.object({
  conversationId: z.string().uuid(),
  lastReadMessageId: z.string().uuid().optional().nullable(),
});

export const redactSchema = z.object({
  messageId: z.string().uuid(),
  reason: z.string().min(1).max(300),
});

export const dncReasons = [
  'user_opt_out',
  'wrong_number',
  'complaint',
  'legal_request',
  'admin_action',
  'other',
] as const;
export const dncEntrySchema = z.object({
  leadId: z.string().uuid().optional().nullable(),
  contactValue: z.string().max(160).optional().nullable(),
  channel: z.enum(consentChannels).default('any'),
  reason: z.enum(dncReasons).default('user_opt_out'),
  note: z.string().max(300).optional().nullable(),
});

export const cannedReplyManageSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(4000),
  categoryId: z.string().uuid().optional().nullable(),
  language: z.string().max(20).optional().nullable(),
  channel: z.enum(conversationChannels).optional().nullable(),
  active: z.boolean().default(true),
});
