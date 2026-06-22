import { randomBytes } from 'node:crypto';
import { sessionUsable, nextExpiry, shouldSlide, nextTokenVersion } from '@re/domain';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { sha256Hex } from '@/lib/leads/security';

/**
 * Website-chat session security (Phase 4.1, Priority 1).
 *
 * `website_chat_sessions` is the ONLY authoritative public-session mechanism.
 * The browser holds a high-entropy opaque token; we store only its SHA-256
 * hash. Internal identifiers (tenant/lead/conversation/project) are never
 * accepted from the browser — they are resolved from the widget (public key)
 * and the token.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const SESSION_TTL_MINUTES = 24 * 60;
const SLIDE_MINUTES = 10;

export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface NewSessionContext {
  tenantId: string;
  widgetId: string;
  conversationId: string;
  language?: string | null;
  projectContext?: string | null;
  pageContext?: string | null;
  utm?: Record<string, string> | null;
  consentState?: string | null;
  anonymousVisitorId?: string | null;
}

export interface IssuedSession {
  publicSessionId: string;
  token: string;
}

/** Create a session bound to widget + tenant + conversation. Returns the opaque token. */
export async function createWebsiteSession(
  admin: Admin,
  ctx: NewSessionContext,
): Promise<IssuedSession | null> {
  const token = generateOpaqueToken();
  const publicSessionId = randomBytes(18).toString('base64url');
  const now = new Date();
  const { error } = await admin.from('website_chat_sessions').insert({
    tenant_id: ctx.tenantId,
    widget_id: ctx.widgetId,
    conversation_id: ctx.conversationId,
    public_session_id: publicSessionId,
    token_hash: sha256Hex(token),
    token_version: 1,
    anonymous_visitor_id: ctx.anonymousVisitorId ?? null,
    language: ctx.language ?? null,
    project_context: ctx.projectContext ?? null,
    page_context: ctx.pageContext ?? null,
    utm: ctx.utm ?? {},
    consent_state: ctx.consentState ?? null,
    status: 'active',
    last_seen_at: now.toISOString(),
    expires_at: nextExpiry(now, SESSION_TTL_MINUTES),
  });
  if (error) return null;
  return { publicSessionId, token };
}

export interface ResolvedSession {
  id: string;
  conversationId: string | null;
  tenantId: string;
  tokenVersion: number;
}

/**
 * Resolve a session from its opaque token, scoped to the widget + tenant. A
 * token belonging to another widget or tenant cannot match (the lookup is
 * scoped and the hash is unique). Expired / rotated / ended tokens are rejected.
 * On success, slides `last_seen_at`/`expires_at` if the window has elapsed.
 */
export async function resolveWebsiteSession(
  admin: Admin,
  args: { tenantId: string; widgetId: string; token: string; now?: Date },
): Promise<ResolvedSession | null> {
  const now = args.now ?? new Date();
  const { data: sess } = await admin
    .from('website_chat_sessions')
    .select('id, conversation_id, tenant_id, token_version, status, expires_at, last_seen_at')
    .eq('tenant_id', args.tenantId)
    .eq('widget_id', args.widgetId)
    .eq('token_hash', sha256Hex(args.token))
    .maybeSingle();
  if (!sess) return null;

  const usable = sessionUsable(
    sess.status as 'active' | 'expired' | 'rotated' | 'ended',
    sess.expires_at as string,
    now,
  );
  if (!usable.usable) {
    // Lazily mark an expired session so it cannot be resumed.
    if (usable.reason === 'expired' && sess.status === 'active') {
      await admin
        .from('website_chat_sessions')
        .update({ status: 'expired' })
        .eq('id', sess.id as string);
    }
    return null;
  }

  if (shouldSlide(sess.last_seen_at as string, now, SLIDE_MINUTES)) {
    await admin
      .from('website_chat_sessions')
      .update({ last_seen_at: now.toISOString(), expires_at: nextExpiry(now, SESSION_TTL_MINUTES) })
      .eq('id', sess.id as string);
  }

  return {
    id: sess.id as string,
    conversationId: (sess.conversation_id as string | null) ?? null,
    tenantId: sess.tenant_id as string,
    tokenVersion: sess.token_version as number,
  };
}

/**
 * Rotate the token in place: the new hash replaces the old, so the previous
 * token can no longer resolve (previous-token invalidation). Returns the new
 * opaque token.
 */
export async function rotateWebsiteSession(
  admin: Admin,
  sessionId: string,
): Promise<string | null> {
  const { data: sess } = await admin
    .from('website_chat_sessions')
    .select('token_version')
    .eq('id', sessionId)
    .maybeSingle();
  if (!sess) return null;
  const token = generateOpaqueToken();
  const { error } = await admin
    .from('website_chat_sessions')
    .update({
      token_hash: sha256Hex(token),
      token_version: nextTokenVersion(sess.token_version as number),
      rotated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
  return error ? null : token;
}

/** Clear-chat: end the session so its token can never be resumed. */
export async function endWebsiteSession(admin: Admin, sessionId: string): Promise<void> {
  await admin.from('website_chat_sessions').update({ status: 'ended' }).eq('id', sessionId);
}
