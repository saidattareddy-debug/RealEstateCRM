-- =====================================================================
-- Phase 4.1 (wiring) — deterministic waiting-on + message delivery events.
--
-- Implemented as triggers so the state is correct regardless of which code
-- path inserts the message (server action, widget endpoint, future worker) —
-- never computed only in the browser. SECURITY DEFINER so the trigger can
-- update the parent conversation / insert events regardless of the caller's
-- write grants (the caller already passed RLS to insert the message).
-- =====================================================================

-- ---------------------------------------------------------------------------
-- On every non-internal message: recompute waiting-on, timestamps, first
-- response, and seed the initial delivery event.
-- ---------------------------------------------------------------------------
create or replace function public.on_conversation_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_wait public.waiting_on_state;
begin
  -- Internal notes are not part of the customer exchange: they do not change
  -- waiting-on, last-message timestamps, unread, or delivery state.
  if new.direction = 'internal' then
    return new;
  end if;

  if new.sender = 'system' then
    v_wait := 'system';
  elsif new.direction = 'inbound' then
    v_wait := 'agent';
  else
    v_wait := 'lead';
  end if;

  update public.conversations c set
    waiting_on = v_wait,
    needs_response = (v_wait = 'agent'),
    last_message_at = new.created_at,
    last_inbound_at = case when new.direction = 'inbound' then new.created_at else c.last_inbound_at end,
    first_response_at = case
      when new.direction = 'outbound' and new.sender in ('agent','ai') and c.first_response_at is null
        then new.created_at
      else c.first_response_at
    end
  where c.id = new.conversation_id;

  -- Seed the first delivery lifecycle event (inbound received / outbound queued).
  insert into public.message_delivery_events (tenant_id, message_id, conversation_id, status)
  values (
    new.tenant_id, new.id, new.conversation_id,
    case when new.direction = 'inbound' then 'received'::public.message_delivery_status
         else 'queued'::public.message_delivery_status end
  );

  return new;
end; $$;

drop trigger if exists trg_on_conversation_message on public.conversation_messages;
create trigger trg_on_conversation_message
  after insert on public.conversation_messages
  for each row execute function public.on_conversation_message();

-- ---------------------------------------------------------------------------
-- A failed outbound delivery means the agent still owes the lead a reply.
-- ---------------------------------------------------------------------------
create or replace function public.on_delivery_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'failed' then
    update public.conversations
      set waiting_on = 'agent', needs_response = true
      where id = new.conversation_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_on_delivery_event on public.message_delivery_events;
create trigger trg_on_delivery_event
  after insert on public.message_delivery_events
  for each row execute function public.on_delivery_event();
