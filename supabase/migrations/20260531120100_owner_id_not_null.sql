-- forms.winlab.tw — make forms.owner_id mandatory (audit finding H2)
--
-- The dashboard owner gate now fails CLOSED (a NULL owner_id is treated as
-- "not yours" instead of open to every admin). Orphaned forms must therefore be
-- re-homed or they become unreachable. owner_id was added in 20260524110000
-- with no default/backfill, so pre-migration rows can be NULL; the FK's
-- `on delete set null` can also produce NULLs when an admin account is removed.
--
-- This backfill assigns any NULL owner_id to the OLDEST admin account (the
-- original / sole operator in a single-admin deployment), then forbids future
-- NULLs.
--
-- ⚠️ REVIEW BEFORE APPLYING: if you run multiple admins AND have genuinely
-- orphaned forms, confirm this target is acceptable — every orphan is assigned
-- to the oldest admin, who can reassign manually afterwards. Adjust the
-- subquery if you need a different owner. If prod has no NULL owner_id rows
-- (the expected steady state), the UPDATE is a no-op and only the NOT NULL
-- constraint is added.

update public.forms
  set owner_id = (select id from auth.users order by created_at asc limit 1)
  where owner_id is null;

alter table public.forms
  alter column owner_id set not null;
