-- =====================================================================
-- Phase 4.1 (Priority 3) — website visitor read-state on the session.
-- The visitor's unread is tracked on the SIGNED SESSION (never an internal
-- user row): the last acknowledged outbound message + the time of ack.
-- Forward-only; reuses the existing website_chat_sessions table.
-- =====================================================================

alter table public.website_chat_sessions
  add column visitor_last_acked_message_id uuid references public.conversation_messages(id) on delete set null,
  add column visitor_last_read_at timestamptz;
