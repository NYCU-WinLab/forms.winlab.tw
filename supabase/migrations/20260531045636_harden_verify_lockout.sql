-- forms.winlab.tw — harden the access-code verify lockout (audit finding H1)
--
-- Fixes a self-sustaining, unauthenticated DoS in record_verify_attempt:
--   1. The locked branch used to INSERT another failed-attempt row before
--      returning 'form_locked', so every probe re-armed the rolling window and
--      the lock never drained. The locked branch now inserts nothing, so the
--      per-form window can expire and the lock self-heals.
--   2. The per-form lockout gate ran BEFORE the code check, so a legitimate rep
--      submitting the CORRECT code while the form was locked was still refused.
--      The code check now runs first: a correct code always succeeds (never
--      collateral of someone else's brute-force), while wrong codes still trip
--      the lockout.
-- Also gives admins an unlock primitive: regenerate_access_code now clears the
-- form's verify_attempts, so rotating the code immediately lifts any lockout.
--
-- create-or-replace preserves the REVOKEs granted in 20260524110000 (the
-- function privileges are not reset by replacing the body).

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
  -- Per-IP flood gate. No row inserted on rejection.
  select count(*) into v_per_ip
    from public.verify_attempts
    where ip = p_ip
      and created_at > now() - make_interval(secs => p_window_seconds);

  if v_per_ip >= p_max_per_window then
    return query select 'rate_limited'::text, null::integer;
    return;
  end if;

  select f.id, f.access_code, f.access_code_version, f.status
    into v_form
    from public.forms f
    where f.id = p_form_id;

  if v_form is null then
    insert into public.verify_attempts (form_id, ip, succeeded)
      values (p_form_id, p_ip, false);
    return query select 'not_found'::text, null::integer;
    return;
  end if;

  v_match := v_form.access_code = p_code;

  -- A correct code ALWAYS succeeds, even while the form is locked, so a
  -- legitimate rep is never collateral damage of someone else's brute-force.
  if v_match then
    insert into public.verify_attempts (form_id, ip, succeeded)
      values (p_form_id, p_ip, true);
    if v_form.status = 'completed' then
      return query select 'form_completed'::text, null::integer;
      return;
    end if;
    return query select 'ok'::text, v_form.access_code_version;
    return;
  end if;

  -- Wrong code: enforce the per-form distributed brute-force lockout. When the
  -- form is already locked we insert NOTHING, so the rolling window drains and
  -- the lock self-heals instead of being re-armed by every probe.
  select count(*) into v_per_form
    from public.verify_attempts
    where form_id = p_form_id
      and succeeded = false
      and created_at > now() - make_interval(secs => p_per_form_lockout_window_seconds);

  if v_per_form >= p_per_form_lockout_threshold then
    return query select 'form_locked'::text, null::integer;
    return;
  end if;

  insert into public.verify_attempts (form_id, ip, succeeded)
    values (p_form_id, p_ip, false);
  return query select 'wrong_code'::text, null::integer;
end;
$$;

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
  -- Rotating the code also clears accumulated failed attempts, so an admin
  -- regenerate immediately lifts a brute-force lockout (audit finding H1).
  delete from public.verify_attempts where form_id = p_form_id;

  return query
    update public.forms
      set access_code         = p_new_code,
          access_code_version = access_code_version + 1
      where id = p_form_id
      returning access_code_version;
end;
$$;
