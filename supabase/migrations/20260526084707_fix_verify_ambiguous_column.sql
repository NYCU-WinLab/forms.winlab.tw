-- Fix: record_verify_attempt's `select ... into v_form from public.forms`
-- left `access_code_version` unqualified, colliding with the OUT TABLE column
-- of the same name and tripping `column reference ... is ambiguous` at call
-- time. Qualify the select list against a table alias so PostgreSQL resolves
-- the columns to forms.* unambiguously.

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
  select count(*) into v_per_ip
    from public.verify_attempts
    where ip = p_ip
      and created_at > now() - make_interval(secs => p_window_seconds);

  if v_per_ip >= p_max_per_window then
    return query select 'rate_limited'::text, null::integer;
    return;
  end if;

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
