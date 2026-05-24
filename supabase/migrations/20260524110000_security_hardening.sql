-- forms.winlab.tw security hardening
--
-- Adds:
--   • forms.owner_id            — scope dashboard reads to creating admin
--   • forms.access_code_version — bump on regenerate so old rep JWTs become invalid
--   • forms.phase_summaries     — older-phase summaries for context-window truncation
--   • messages.role 'tool'      — allow tool-result persistence
--   • messages.incomplete       — partial-stream recovery flag
--   • audit_log                 — admin action trail
--
-- Atomic RPCs (security definer so service_role bypass remains the only path):
--   • record_verify_attempt     — rate-limit + lockout + code check + version
--   • chat_persist_turn         — optimistic-phase assistant write w/ summary capture
--   • edit_message_and_rewind   — soft-delete + rewind under advisory lock
--   • regenerate_access_code    — new code + version bump
--   • cleanup_verify_attempts   — retention sweep

-- ─────────────────────────────────────────────────────────────────────────
-- forms additions
-- ─────────────────────────────────────────────────────────────────────────
alter table public.forms
  add column owner_id            uuid references auth.users(id) on delete set null,
  add column access_code_version integer not null default 1,
  add column phase_summaries     jsonb   not null default '{}'::jsonb;

create index forms_owner_id_idx           on public.forms (owner_id);
create index forms_owner_updated_at_idx   on public.forms (owner_id, updated_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- messages additions
-- ─────────────────────────────────────────────────────────────────────────
alter table public.messages
  drop constraint messages_role_valid,
  add  constraint messages_role_valid
    check (role in ('system', 'assistant', 'user', 'tool'));

alter table public.messages
  add column incomplete boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────────
-- audit_log
-- ─────────────────────────────────────────────────────────────────────────
create table public.audit_log (
  id          bigserial   primary key,
  actor_id    uuid        references auth.users(id) on delete set null,
  actor_email text,
  action      text        not null,
  form_id     text,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_form_id_created_at_idx on public.audit_log (form_id, created_at desc);
create index audit_log_actor_created_at_idx   on public.audit_log (actor_id, created_at desc);

alter table public.audit_log enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- record_verify_attempt
--   Single round-trip: rate-limit gate, per-form lockout, code check, insert
--   attempt row. Caller never inspects verify_attempts directly.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.record_verify_attempt(
  p_form_id text,
  p_ip text,
  p_code text,
  p_window_seconds                  integer default 60,
  p_max_per_window                  integer default 5,
  p_per_form_lockout_threshold      integer default 20,
  p_per_form_lockout_window_seconds integer default 3600
)
returns table (
  result               text,
  access_code_version  integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_per_ip   integer;
  v_per_form integer;
  v_form     record;
  v_match    boolean;
begin
  -- Per-IP recent attempts.
  select count(*) into v_per_ip
    from public.verify_attempts
    where ip = p_ip
      and created_at > now() - make_interval(secs => p_window_seconds);

  if v_per_ip >= p_max_per_window then
    return query select 'rate_limited'::text, null::integer;
    return;
  end if;

  -- Per-form distributed brute-force lockout (across many IPs).
  select count(*) into v_per_form
    from public.verify_attempts
    where form_id = p_form_id
      and succeeded = false
      and created_at > now() - make_interval(secs => p_per_form_lockout_window_seconds);

  if v_per_form >= p_per_form_lockout_threshold then
    insert into public.verify_attempts (form_id, ip, succeeded)
      values (p_form_id, p_ip, false);
    return query select 'form_locked'::text, null::integer;
    return;
  end if;

  select id, access_code, access_code_version, status
    into v_form
    from public.forms
    where id = p_form_id;

  if v_form is null then
    insert into public.verify_attempts (form_id, ip, succeeded)
      values (p_form_id, p_ip, false);
    return query select 'not_found'::text, null::integer;
    return;
  end if;

  v_match := v_form.access_code = p_code;

  insert into public.verify_attempts (form_id, ip, succeeded)
    values (p_form_id, p_ip, v_match);

  if not v_match then
    return query select 'wrong_code'::text, null::integer;
    return;
  end if;

  if v_form.status = 'completed' then
    return query select 'form_completed'::text, null::integer;
    return;
  end if;

  return query select 'ok'::text, v_form.access_code_version;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- chat_persist_turn
--   Atomically: (a) write the assistant message, (b) advance phase iff the
--   form is still on p_expected_phase (optimistic lock), (c) capture an
--   old-phase summary, (d) mark completed. Advisory lock prevents
--   interleaving with edit_message_and_rewind on the same form.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.chat_persist_turn(
  p_form_id               text,
  p_expected_phase        text,
  p_content               text,
  p_phase                 text,
  p_tool_calls            jsonb,
  p_incomplete            boolean default false,
  p_new_phase             text    default null,
  p_summary_for_old_phase text    default null,
  p_complete              boolean default false
)
returns table (
  result        text,
  current_phase text,
  status        text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock_key bigint := hashtextextended('form:' || p_form_id, 0);
  v_form     record;
begin
  perform pg_advisory_xact_lock(v_lock_key);

  select id, current_phase, status, phase_summaries
    into v_form
    from public.forms
    where id = p_form_id
    for update;

  if v_form is null then
    return query select 'not_found'::text, null::text, null::text;
    return;
  end if;

  if v_form.status = 'completed' and not p_complete then
    return query select 'form_completed'::text, v_form.current_phase, v_form.status;
    return;
  end if;

  if v_form.current_phase <> p_expected_phase then
    return query select 'phase_changed'::text, v_form.current_phase, v_form.status;
    return;
  end if;

  insert into public.messages (form_id, role, content, phase, tool_calls, incomplete)
    values (p_form_id, 'assistant', p_content, p_phase, p_tool_calls, p_incomplete);

  if p_new_phase is not null and p_new_phase <> v_form.current_phase then
    update public.forms
      set current_phase   = p_new_phase,
          phase_summaries = case
            when p_summary_for_old_phase is not null and length(p_summary_for_old_phase) > 0
              then v_form.phase_summaries || jsonb_build_object(v_form.current_phase, p_summary_for_old_phase)
            else v_form.phase_summaries
          end
      where id = p_form_id;
  end if;

  if p_complete then
    update public.forms
      set status       = 'completed',
          completed_at = now()
      where id = p_form_id;
  end if;

  select current_phase, status into v_form
    from public.forms
    where id = p_form_id;

  return query select 'ok'::text, v_form.current_phase, v_form.status;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- edit_message_and_rewind
--   Atomic soft-delete from target.created_at onward, insert replacement
--   user message, rewind form phase + reopen. Shares advisory lock with
--   chat_persist_turn so an in-flight chat round cannot interleave.
-- ─────────────────────────────────────────────────────────────────────────
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
begin
  perform pg_advisory_xact_lock(v_lock_key);

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

-- ─────────────────────────────────────────────────────────────────────────
-- regenerate_access_code
--   Bump version atomically so previously issued rep JWTs become invalid
--   on next verify.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.regenerate_access_code(
  p_form_id  text,
  p_new_code text
)
returns table (new_version integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
    update public.forms
      set access_code         = p_new_code,
          access_code_version = access_code_version + 1
      where id = p_form_id
      returning access_code_version;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- cleanup_verify_attempts
--   Retention sweep. Schedule via Supabase Cron / pg_cron:
--     select cron.schedule('cleanup_verify_attempts', '0 4 * * *',
--       $$ select public.cleanup_verify_attempts(168) $$);
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cleanup_verify_attempts(p_retain_hours integer default 168)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.verify_attempts
    where created_at < now() - make_interval(hours => p_retain_hours);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Lock down direct RPC exposure: only service_role calls these.
-- (RLS already blocks anon/authenticated, so revoking schema-level execute
-- on the public role here is belt-and-braces.)
-- ─────────────────────────────────────────────────────────────────────────
revoke execute on function public.record_verify_attempt(text, text, text, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.chat_persist_turn(text, text, text, text, jsonb, boolean, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.edit_message_and_rewind(text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.regenerate_access_code(text, text)
  from public, anon, authenticated;
revoke execute on function public.cleanup_verify_attempts(integer)
  from public, anon, authenticated;
