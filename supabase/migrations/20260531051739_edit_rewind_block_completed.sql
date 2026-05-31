-- forms.winlab.tw — make the "rep can't resurrect a closed form" invariant
-- authoritative (audit finding M3 / CC-01)
--
-- edit/route.ts checks forms.status = 'completed' in JS before calling
-- edit_message_and_rewind, but that read is non-atomic: an admin closeForm()
-- (a plain UPDATE that takes neither the advisory nor a row lock) can land
-- between the route's read and the RPC, and the RPC would then reopen the form
-- (status='open', completed_at=null) — resurrecting a form the admin closed.
--
-- Fix: inside the advisory lock, take a FOR UPDATE row lock on the form and
-- re-check status. The row lock also serializes against a concurrent admin
-- close, so the invariant holds regardless of interleaving.

create or replace function public.edit_message_and_rewind(
  p_form_id     text,
  p_message_id  uuid,
  p_new_content text
)
returns table (
  result    text,
  new_phase text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock_key bigint := hashtextextended('form:' || p_form_id, 0);
  v_target   record;
  v_phase    text;
  v_status   text;
begin
  perform pg_advisory_xact_lock(v_lock_key);

  -- Authoritative completed-form guard, inside the lock + row lock.
  select status into v_status
    from public.forms
    where id = p_form_id
    for update;

  if v_status is null then
    return query select 'not_found'::text, null::text;
    return;
  end if;

  if v_status = 'completed' then
    return query select 'form_completed'::text, null::text;
    return;
  end if;

  select id, role, form_id, phase, created_at, deleted_at
    into v_target
    from public.messages
    where id = p_message_id;

  if v_target is null or v_target.form_id <> p_form_id or v_target.role <> 'user' then
    return query select 'invalid_target'::text, null::text;
    return;
  end if;

  if v_target.deleted_at is not null then
    return query select 'already_deleted'::text, null::text;
    return;
  end if;

  v_phase := coalesce(v_target.phase, 'context');

  update public.messages
    set deleted_at = now()
    where form_id    = p_form_id
      and created_at >= v_target.created_at
      and deleted_at is null;

  insert into public.messages (form_id, role, content, phase)
    values (p_form_id, 'user', p_new_content, v_phase);

  update public.forms
    set current_phase = v_phase,
        status        = 'open',
        completed_at  = null
    where id = p_form_id;

  return query select 'ok'::text, v_phase::text;
end;
$$;
