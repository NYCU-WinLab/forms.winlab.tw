-- Same ambiguity class as fix_verify_ambiguous_column, this time in
-- chat_persist_turn: `select id, current_phase, status, phase_summaries into
-- v_form from public.forms` left current_phase unqualified, colliding with
-- the OUT TABLE column of the same name. Every chat turn hit `column
-- reference "current_phase" is ambiguous` and surfaced as db-error. Qualify
-- both selects against a table alias.

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

  select f.id, f.current_phase, f.status, f.phase_summaries
    into v_form
    from public.forms f
    where f.id = p_form_id
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

  select f.current_phase, f.status into v_form
    from public.forms f
    where f.id = p_form_id;

  return query select 'ok'::text, v_form.current_phase, v_form.status;
end;
$$;
