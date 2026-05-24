-- forms.winlab.tw initial schema
-- All access via server-side service-role client; RLS locks anon + authenticated.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────
-- forms
-- ─────────────────────────────────────────────────────────────────────────
create table public.forms (
  id                text        primary key,
  organization      text        not null,
  unit              text,
  department        text        not null,
  department_brief  text,
  access_code       text        not null,
  current_phase     text        not null default 'context',
  status            text        not null default 'open',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,

  constraint forms_access_code_format check (access_code ~ '^[0-9]{6}$'),
  constraint forms_current_phase_valid
    check (current_phase in ('context', 'workflow', 'pain', 'data', 'wrapup')),
  constraint forms_status_valid
    check (status in ('open', 'completed'))
);

-- ─────────────────────────────────────────────────────────────────────────
-- messages
-- ─────────────────────────────────────────────────────────────────────────
create table public.messages (
  id          uuid        primary key default gen_random_uuid(),
  form_id     text        not null references public.forms(id) on delete cascade,
  role        text        not null,
  content     text        not null,
  phase       text,
  tool_calls  jsonb,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  constraint messages_role_valid
    check (role in ('system', 'assistant', 'user')),
  constraint messages_phase_valid
    check (phase is null or phase in ('context', 'workflow', 'pain', 'data', 'wrapup'))
);

create index messages_form_id_created_at_idx
  on public.messages (form_id, created_at)
  where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.tg_set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger forms_set_updated_at
  before update on public.forms
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- verify_attempts — per-IP rate-limit for /form/[id] access-code gate
-- ─────────────────────────────────────────────────────────────────────────
create table public.verify_attempts (
  id          bigserial   primary key,
  form_id     text        not null,
  ip          text        not null,
  succeeded   boolean     not null,
  created_at  timestamptz not null default now()
);

create index verify_attempts_ip_created_at_idx
  on public.verify_attempts (ip, created_at desc);
create index verify_attempts_form_id_created_at_idx
  on public.verify_attempts (form_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS: enabled with no policies = anon + authenticated locked out.
-- service_role bypasses RLS, which is how the server reaches the data.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.forms            enable row level security;
alter table public.messages         enable row level security;
alter table public.verify_attempts  enable row level security;
