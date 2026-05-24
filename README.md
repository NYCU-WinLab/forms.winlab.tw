```
███████╗ ██████╗ ██████╗ ███╗   ███╗███████╗
██╔════╝██╔═══██╗██╔══██╗████╗ ████║██╔════╝
█████╗  ██║   ██║██████╔╝██╔████╔██║███████╗
██╔══╝  ██║   ██║██╔══██╗██║╚██╔╝██║╚════██║
██║     ╚██████╔╝██║  ██║██║ ╚═╝ ██║███████║
╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝
```

# forms.winlab.tw

AI consultant that pre-interviews department reps so WinLab consultants walk into the kickoff meeting already knowing where to look.

## What it does

Enterprises want AI adoption help. WinLab consultants need to know each department's actual workflow + real pain points before they can find AI intervention points. Calendar-wise, a 30-min interview per department doesn't scale — and a Google Form gets generic answers.

forms.winlab.tw runs a **phase-gated AI conversation** with each department rep, gathering the first 4 of WinLab's 10-step adoption SOP:

| Phase    | What gets collected                                              |
| -------- | ---------------------------------------------------------------- |
| Context  | Department headcount, role in the org, weekly/monthly outputs    |
| Workflow | At least 2 core workflows step-by-step, tools/systems/people     |
| Pain     | At least 3 specific pain points (step + frequency + impact)      |
| Data     | Data the dept produces/consumes, what's manually copy-pasted     |

The AI asks one question at a time, follows up for specifics, and advances phases via tool calls. Transcript lands in the admin dashboard. Consultant takes it from there — phases 5-10 (Opportunity / Risk / Prio / Pilot / Eval / Rollout) stay in human hands.

## Roles

- **Admin** (WinLab consultants) — email + password login at `/login`, creates forms in `/dashboard`, reviews transcripts. Signups are disabled; admin users are provisioned manually via `bun scripts/provision-admin.ts`.
- **Department rep** — gets a link + 6-digit access code, no signup. Anonymous; admin only knows which department they spoke for.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Runtime**: Bun
- **UI**: Tailwind CSS v4 + shadcn/ui (Base UI)
- **DB / Auth**: Supabase (Postgres + email/password auth)
- **LLM**: OpenAI GPT-5.5 via Chat Completions + tool calling
- **Hosting**: Vercel

## Architecture

```
/                           landing
/login                      admin email + password gate (allowlist enforced)
/dashboard                  admin form list + create modal
/dashboard/[id]             admin transcript view + access-code controls

/form/[id]                  rep entry — 6-digit gate → chat UI
/api/form/[id]/verify       6-digit check + per-IP rate-limit + JWT cookie
/api/form/[id]/chat         SSE streaming chat + tool-call phase tracking
/api/form/[id]/edit         soft-delete + rewind phase on user-edited message
```

Two-layer auth — Supabase Auth for admin, a self-signed JWT cookie for rep gate. RLS is enabled on every table with **no policies**, so only the server-side service-role client can reach the data. Browser never talks to the DB directly.

### Schema

```sql
forms             (id, organization, unit, department, department_brief,
                   access_code, current_phase, status, timestamps)
messages          (id, form_id, role, content, phase, tool_calls,
                   created_at, deleted_at)        -- soft-delete for edit rerun
verify_attempts   (id, form_id, ip, succeeded, created_at)  -- rate-limit
```

### AI loop

System prompt injects `{organization, department, department_brief, current_phase}` + per-phase checklists. Each LLM call returns streamed text **and** optional tool calls:

- `advance_phase(to_phase, checklist_summary)` — fires when the current phase's checklist is satisfied.
- `complete_form(summary)` — fires after the wrap-up phase.

Server processes tool calls during streaming, updates `forms.current_phase` / `forms.status`, persists assistant message + tool calls.

## Getting Started

```bash
bun install
bun dev
```

The dev server starts on `http://localhost:3000`. You'll need a Supabase project + an OpenAI key with GPT-5.5 access before anything actually works (see below).

## Environment Variables

Create `.env.local`:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...

# OpenAI
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-5.5

# Admin email allowlist (comma-separated)
ADMIN_EMAILS=you@winlab.tw

# Signs short-lived form gate cookies — `openssl rand -base64 32`
FORM_GATE_SECRET=...
```

`SUPABASE_SECRET_KEY` is the new name for `service_role`. It's server-only — never expose to the browser.

## Supabase Setup

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Apply the migrations under `supabase/migrations/` (paste each into the SQL editor in order, or `supabase db push` if you've linked the CLI).
3. **Authentication → Sign In / Up**: turn **Allow new users to sign up** OFF. Admin users are provisioned via the script below — leaving signups on lets anyone create a Supabase user, even if our app rejects them.
4. Grab `Project URL`, `publishable_key`, `secret_key` from **Project Settings → API** and put them in `.env.local`.
5. Provision the first admin user:

   ```bash
   ADMIN_PASSWORD='paste-the-generated-password' bun run provision-admin
   ```

   The script reads the target email from `ADMIN_EMAILS` (first entry), refuses any email not in the allowlist, and rejects passwords shorter than 16 characters. Re-running it for the same email resets the password.

## Deploy

```bash
vercel link
vercel env pull
# fill in the env vars on Vercel for production
vercel --prod
```

Production checklist:

- Confirm **Allow new users to sign up** is OFF on the prod Supabase project.
- Set all env vars in Vercel project settings — none with `NEXT_PUBLIC_` prefix should contain secrets.
- Run `bun run provision-admin` against the prod project once to seed the admin user (point `.env.local` at the prod Supabase URL + secret_key just for that run, then revert).

## Customization

- **Prompt** — `lib/ai/prompt.ts`. Phase checklists and tone live here.
- **Tools** — `lib/ai/tools.ts`. Phase-advance and form-complete schemas.
- **Model** — `OPENAI_MODEL` env var.
- **Allowlist** — `ADMIN_EMAILS` env var. Adding an email here doesn't create a Supabase user — also run `bun run provision-admin <email>` to set the password.
- **Rate-limit** — `MAX_ATTEMPTS_PER_WINDOW` / `WINDOW_SECONDS` in `app/api/form/[id]/verify/route.ts`.
- **Phase set** — schema check constraint + `lib/db.ts` `PHASES` array + prompt. Change in all three if you add/remove phases.

## License

[MIT](LICENSE.md) — because every consulting tool deserves to be forked, not gatekept.
