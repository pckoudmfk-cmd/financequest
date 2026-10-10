-- GFP Advisory Practice quest: tables for results and jury scores.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists public.quest_results (
  group_name   text primary key,
  fields       jsonb       not null default '{}'::jsonb,
  locks        jsonb       not null default '{}'::jsonb,
  completed    jsonb       not null default '[]'::jsonb,
  finished_at  timestamptz,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  rev          integer     not null default 0
);

create table if not exists public.quest_jury (
  group_name  text primary key,
  scores      jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Only the server (service role key) may touch the data.
-- RLS is on and no policies exist, so the public (anon) key sees nothing.
alter table public.quest_results enable row level security;
alter table public.quest_jury    enable row level security;

revoke all on public.quest_results from anon, authenticated;
revoke all on public.quest_jury    from anon, authenticated;

-- Jury scores, one row per group and juror (added for several jurors).
create table if not exists public.quest_jury_scores (
  group_name  text        not null,
  juror       text        not null,
  scores      jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (group_name, juror)
);

alter table public.quest_jury_scores enable row level security;
revoke all on public.quest_jury_scores from anon, authenticated;
