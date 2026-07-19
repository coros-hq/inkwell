-- Inkwell cloud backup schema.
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
--
-- Design notes:
--   * Every table is scoped to auth.uid() via RLS — a user can only ever see their own rows.
--   * notes get real per-row conflict detection because Note has a genuine per-item
--     updatedAt in the local data model (src/types/index.ts). deleted_at is a tombstone,
--     not a hard delete, so pull-after-delete doesn't resurrect a note and
--     push-after-delete can propagate the deletion to other devices.
--   * Folders/Tasks/Boards/BoardColumns/BoardTasks have NO per-item timestamp in the
--     local model — inventing one would make the conflict UI lie about what changed.
--     Instead they're stored as a single jsonb snapshot per user in vault_structural,
--     synced as one unit with one conflict prompt when both sides changed.
--   * Attachment bytes live in Storage (bucket "attachments"), not in a DB table —
--     the bucket listing itself is the source of truth for what's backed up.

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null,
  title text not null default '',
  content text not null default '',
  folder text,
  tags text[] not null default '{}',
  pinned boolean not null default false,
  word_count integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, local_id)
);

create table if not exists vault_structural (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table notes enable row level security;
alter table vault_structural enable row level security;

drop policy if exists "owner_all" on notes;
create policy "owner_all" on notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner_all" on vault_structural;
create policy "owner_all" on vault_structural for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage bucket for attachments/images. Path convention: {user_id}/{filename}
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "attachments_owner_all" on storage.objects;
create policy "attachments_owner_all" on storage.objects
  for all
  using (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);
