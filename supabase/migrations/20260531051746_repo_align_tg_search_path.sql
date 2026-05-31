-- forms.winlab.tw — repo/prod alignment: pin search_path on tg_set_updated_at
--
-- Prod hardened this trigger function's search_path early (ledger migration
-- `harden_function_search_path`, 20260524022521) but that step has no
-- counterpart file in this repo, so a fresh replay of these migrations would
-- recreate tg_set_updated_at WITHOUT a pinned search_path (the Supabase linter
-- flags `function_search_path_mutable`). This idempotent create-or-replace
-- closes that gap so the repo reproduces prod. Empty search_path matches prod;
-- now() resolves from pg_catalog, which is always implicitly in scope.

create or replace function public.tg_set_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
