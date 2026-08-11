-- Inkwell team collaboration schema (reference only).
--
-- This file is NOT auto-applied — there's no migration tooling in this repo.
-- Run it once, by hand, in the Supabase SQL editor for the project referenced
-- by VITE_SUPABASE_URL in .env.
--
-- Scope: whole-vault sharing, async sync (no presence/live-cursors), boards +
-- (later) note content synced via Yjs CRDT updates. Binary attachments are
-- explicitly out of scope for v1 (see vault-attachments bucket note at the end).

-- ── Teams ───────────────────────────────────────────────────────────────────

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table teams enable row level security;

create policy teams_select on teams for select
  using (
    auth.uid() = owner_id
    or exists (
      select 1 from team_members m
      where m.team_id = teams.id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy teams_insert on teams for insert
  with check (auth.uid() = owner_id);

create policy teams_update on teams for update
  using (auth.uid() = owner_id);

-- ── Team membership + invites ────────────────────────────────────────────────
-- Single table covers both pending invites and active members. An invite is a
-- row with status='pending' and user_id=null, keyed by email. When the invited
-- email signs up/in, the client flips the row to status='active' and sets
-- user_id — allowed by team_members_self_update below, matched on JWT email.

create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid references auth.users(id),
  email text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'pending' check (status in ('pending', 'active', 'removed')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (team_id, email)
);

alter table team_members enable row level security;

-- A caller can see membership rows for any team they belong to (or own), plus
-- their own pending invite row (by email) so they can discover it before
-- joining.
create policy team_members_select on team_members for select
  using (
    email = auth.jwt() ->> 'email'
    or exists (
      select 1 from teams t
      where t.id = team_members.team_id and t.owner_id = auth.uid()
    )
    or exists (
      select 1 from team_members m2
      where m2.team_id = team_members.team_id
        and m2.user_id = auth.uid()
        and m2.status = 'active'
    )
  );

-- Only the team owner can create invites.
create policy team_members_insert on team_members for insert
  with check (
    exists (select 1 from teams t where t.id = team_members.team_id and t.owner_id = auth.uid())
  );

-- The team owner can update any row (e.g. removing a member); an invited user
-- can update their own row to accept (status pending -> active, user_id set)
-- once their JWT email matches the invite's email.
create policy team_members_update on team_members for update
  using (
    exists (select 1 from teams t where t.id = team_members.team_id and t.owner_id = auth.uid())
    or email = auth.jwt() ->> 'email'
  );

-- ── Vaults ────────────────────────────────────────────────────────────────────
-- One row per *shared* vault only. Local-only vaults never get a row here.
-- client_vault_key is a random id minted on first share and stored in the
-- vault's local .inkwell/team.json — it's the durable link between an
-- OS-specific folder path and this cloud record, since paths differ per machine.

create table vaults (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  client_vault_key text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table vaults enable row level security;

create policy vaults_select on vaults for select
  using (
    exists (
      select 1 from team_members m
      where m.team_id = vaults.team_id and m.user_id = auth.uid() and m.status = 'active'
    )
    or exists (select 1 from teams t where t.id = vaults.team_id and t.owner_id = auth.uid())
  );

create policy vaults_insert on vaults for insert
  with check (
    exists (
      select 1 from team_members m
      where m.team_id = vaults.team_id and m.user_id = auth.uid() and m.status = 'active'
    )
    or exists (select 1 from teams t where t.id = vaults.team_id and t.owner_id = auth.uid())
  );

-- ── Yjs doc sync ──────────────────────────────────────────────────────────────
-- doc_updates is an append-only log of Yjs binary updates. doc_name identifies
-- the logical CRDT document within a vault: 'boards' for board/column/task
-- state (Phase 2), 'note:<noteId>' for individual note content (Phase 3).
-- doc_snapshots holds periodic compactions so a client doesn't have to replay
-- the entire history from row 1 on every reconnect.

create table doc_updates (
  id bigserial primary key,
  vault_id uuid not null references vaults(id) on delete cascade,
  doc_name text not null,
  update bytea not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index doc_updates_vault_doc_id_idx on doc_updates (vault_id, doc_name, id);

alter table doc_updates enable row level security;

create policy doc_updates_select on doc_updates for select
  using (
    exists (
      select 1 from vaults v
      join team_members m on m.team_id = v.team_id
      where v.id = doc_updates.vault_id and m.user_id = auth.uid() and m.status = 'active'
    )
    or exists (
      select 1 from vaults v join teams t on t.id = v.team_id
      where v.id = doc_updates.vault_id and t.owner_id = auth.uid()
    )
  );

create policy doc_updates_insert on doc_updates for insert
  with check (
    exists (
      select 1 from vaults v
      join team_members m on m.team_id = v.team_id
      where v.id = doc_updates.vault_id and m.user_id = auth.uid() and m.status = 'active'
    )
    or exists (
      select 1 from vaults v join teams t on t.id = v.team_id
      where v.id = doc_updates.vault_id and t.owner_id = auth.uid()
    )
  );
-- No update/delete policy: doc_updates is append-only by design.

create table doc_snapshots (
  vault_id uuid not null references vaults(id) on delete cascade,
  doc_name text not null,
  snapshot bytea not null,
  up_to_update_id bigint not null,
  updated_at timestamptz not null default now(),
  primary key (vault_id, doc_name)
);

alter table doc_snapshots enable row level security;

create policy doc_snapshots_select on doc_snapshots for select
  using (
    exists (
      select 1 from vaults v
      join team_members m on m.team_id = v.team_id
      where v.id = doc_snapshots.vault_id and m.user_id = auth.uid() and m.status = 'active'
    )
    or exists (
      select 1 from vaults v join teams t on t.id = v.team_id
      where v.id = doc_snapshots.vault_id and t.owner_id = auth.uid()
    )
  );

create policy doc_snapshots_upsert on doc_snapshots for insert
  with check (
    exists (
      select 1 from vaults v
      join team_members m on m.team_id = v.team_id
      where v.id = doc_snapshots.vault_id and m.user_id = auth.uid() and m.status = 'active'
    )
    or exists (
      select 1 from vaults v join teams t on t.id = v.team_id
      where v.id = doc_snapshots.vault_id and t.owner_id = auth.uid()
    )
  );

create policy doc_snapshots_update on doc_snapshots for update
  using (
    exists (
      select 1 from vaults v
      join team_members m on m.team_id = v.team_id
      where v.id = doc_snapshots.vault_id and m.user_id = auth.uid() and m.status = 'active'
    )
    or exists (
      select 1 from vaults v join teams t on t.id = v.team_id
      where v.id = doc_snapshots.vault_id and t.owner_id = auth.uid()
    )
  );

-- ── Enable Realtime ───────────────────────────────────────────────────────────
-- Required so clients can subscribe to postgres_changes INSERT events on
-- doc_updates (this is how a peer's edits get pushed to other open clients).

alter publication supabase_realtime add table doc_updates;

-- ── Attachments (out of scope for v1, noted for future work) ────────────────
-- create a Storage bucket named 'vault-attachments', path convention
-- {vault_id}/{attachment_id}-{filename}, with a storage.objects RLS policy
-- that extracts vault_id from the object path and applies the same
-- team-membership check as doc_updates above. Not implemented here — v1 only
-- syncs board state and (Phase 3) note text, not binary attachments.
