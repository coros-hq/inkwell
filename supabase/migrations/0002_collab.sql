-- Inkwell collaboration v2: per-vault roles, invite links, private Realtime
-- channels, attachment storage.
--
-- Apply once, by hand, in the Supabase SQL editor AFTER supabase/schema.sql.
-- Idempotent where practical (drop-if-exists / create-or-replace), so it can be
-- re-run while iterating.
--
-- Access model: vault_members is the source of truth for who can reach a
-- vault and with which role (owner > editor > viewer). A vault may still be
-- attached to a team — active team members get 'editor' and the team owner
-- gets 'owner' unless an explicit vault_members row says otherwise (an
-- explicit 'removed' row revokes access even for a team member).
--
-- After applying: Dashboard → Realtime → Settings → disable "Allow public
-- access" so every channel goes through the realtime.messages policies below.

-- ── Vaults: team is now optional ─────────────────────────────────────────────

alter table vaults alter column team_id drop not null;

-- ── Vault members ────────────────────────────────────────────────────────────

create table if not exists vault_members (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references vaults(id) on delete cascade,
  user_id uuid references auth.users(id),
  email text not null,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'active', 'removed')),
  invited_by uuid references auth.users(id),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (vault_id, email)
);

create index if not exists vault_members_user_idx on vault_members (user_id);

alter table vault_members enable row level security;

-- ── Role helpers ─────────────────────────────────────────────────────────────
-- security definer so policies can call them without recursing through the
-- RLS of the tables they read.

create or replace function public.vault_role(p_vault uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  if auth.uid() is null then
    return null;
  end if;

  select role, status into r
  from vault_members
  where vault_id = p_vault and user_id = auth.uid();
  if found then
    return case when r.status = 'active' then r.role else null end;
  end if;

  if exists (
    select 1 from vaults v join teams t on t.id = v.team_id
    where v.id = p_vault and t.owner_id = auth.uid()
  ) then
    return 'owner';
  end if;

  if exists (
    select 1 from vaults v join team_members m on m.team_id = v.team_id
    where v.id = p_vault and m.user_id = auth.uid() and m.status = 'active'
  ) then
    return 'editor';
  end if;

  return null;
end;
$$;

create or replace function public.has_vault_role(p_vault uuid, p_min text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (case public.vault_role(p_vault) when 'owner' then 3 when 'editor' then 2 when 'viewer' then 1 else 0 end)
      >= (case p_min when 'owner' then 3 when 'editor' then 2 else 1 end),
    false
  );
$$;

-- Topic → vault id for realtime.messages policies. Topics are
-- 'vault:<uuid>' (CRDT updates) and 'vault-presence:<uuid>' (presence +
-- cursors). Returns null for anything else instead of raising on a bad cast.
create or replace function public.vault_id_from_topic(p_topic text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(p_topic, ':', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_topic, ':', 2)::uuid
    else null
  end;
$$;

-- ── Teams: non-recursive membership check ────────────────────────────────────
-- schema.sql's team_members_select policy queries team_members from inside a
-- team_members policy, which Postgres rejects ("infinite recursion detected in
-- policy"). Route both team policies through a security definer helper.

create or replace function public.is_team_member(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from teams t where t.id = p_team and t.owner_id = auth.uid())
      or exists (
        select 1 from team_members m
        where m.team_id = p_team and m.user_id = auth.uid() and m.status = 'active'
      );
$$;

drop policy if exists teams_select on teams;
create policy teams_select on teams for select
  using (owner_id = auth.uid() or public.is_team_member(id));

drop policy if exists team_members_select on team_members;
create policy team_members_select on team_members for select
  using (email = lower(auth.jwt() ->> 'email') or public.is_team_member(team_id));

-- ── Vaults policies ──────────────────────────────────────────────────────────

drop policy if exists vaults_select on vaults;
drop policy if exists vaults_insert on vaults;
drop policy if exists vaults_update on vaults;
drop policy if exists vaults_delete on vaults;

create policy vaults_select on vaults for select
  using (public.has_vault_role(id, 'viewer') or created_by = auth.uid());

create policy vaults_insert on vaults for insert
  with check (
    created_by = auth.uid()
    and (
      team_id is null
      or exists (select 1 from teams t where t.id = vaults.team_id and t.owner_id = auth.uid())
      or exists (
        select 1 from team_members m
        where m.team_id = vaults.team_id and m.user_id = auth.uid() and m.status = 'active'
      )
    )
  );

create policy vaults_update on vaults for update
  using (public.has_vault_role(id, 'owner'));

create policy vaults_delete on vaults for delete
  using (public.has_vault_role(id, 'owner'));

-- The creator becomes the vault's owner.
create or replace function public.vaults_add_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into vault_members (vault_id, user_id, email, role, status, invited_by, joined_at)
  values (
    new.id, new.created_by,
    lower(coalesce((select email from auth.users where id = new.created_by), '')),
    'owner', 'active', new.created_by, now()
  )
  on conflict (vault_id, email) do nothing;
  return new;
end;
$$;

drop trigger if exists vaults_add_owner on vaults;
create trigger vaults_add_owner after insert on vaults
  for each row execute function public.vaults_add_owner();

-- Backfill owner rows for vaults shared before this migration.
insert into vault_members (vault_id, user_id, email, role, status, invited_by, joined_at)
select v.id, v.created_by, lower(coalesce(u.email, '')), 'owner', 'active', v.created_by, v.created_at
from vaults v join auth.users u on u.id = v.created_by
on conflict (vault_id, email) do nothing;

-- ── Vault members policies ───────────────────────────────────────────────────
-- Members see the roster of vaults they can open; only owners change it.
-- Invitees accept through accept_my_vault_invites() (security definer), never
-- by updating their own row directly — otherwise they could pick their role.

drop policy if exists vault_members_select on vault_members;
drop policy if exists vault_members_insert on vault_members;
drop policy if exists vault_members_update on vault_members;
drop policy if exists vault_members_delete on vault_members;

create policy vault_members_select on vault_members for select
  using (public.has_vault_role(vault_id, 'viewer') or email = lower(auth.jwt() ->> 'email'));

create policy vault_members_insert on vault_members for insert
  with check (public.has_vault_role(vault_id, 'owner'));

create policy vault_members_update on vault_members for update
  using (public.has_vault_role(vault_id, 'owner'));

create policy vault_members_delete on vault_members for delete
  using (public.has_vault_role(vault_id, 'owner'));

create or replace function public.accept_my_vault_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  update vault_members
  set user_id = auth.uid(), status = 'active', joined_at = now()
  where email = lower(auth.jwt() ->> 'email') and status = 'pending';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── Invite links ─────────────────────────────────────────────────────────────
-- Only a hash of the token is stored; the plaintext token is returned once, to
-- the owner who created it, and travels inside the inkwell://join/<token> link.

create table if not exists vault_invites (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references vaults(id) on delete cascade,
  token_hash text not null unique,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  expires_at timestamptz not null,
  max_uses integer,
  uses integer not null default 0,
  revoked boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table vault_invites enable row level security;

drop policy if exists vault_invites_select on vault_invites;
drop policy if exists vault_invites_update on vault_invites;

create policy vault_invites_select on vault_invites for select
  using (public.has_vault_role(vault_id, 'owner'));

-- Owners may revoke (update revoked=true); creation goes through the RPC.
create policy vault_invites_update on vault_invites for update
  using (public.has_vault_role(vault_id, 'owner'));

create or replace function public.create_vault_invite(
  p_vault uuid,
  p_role text default 'editor',
  p_expires_hours integer default 168,
  p_max_uses integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  token text;
begin
  if not public.has_vault_role(p_vault, 'owner') then
    raise exception 'Only the vault owner can create invite links' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'Invalid role %', p_role;
  end if;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into vault_invites (vault_id, token_hash, role, expires_at, max_uses, created_by)
  values (
    p_vault,
    encode(sha256(convert_to(token, 'UTF8')), 'hex'),
    p_role,
    now() + make_interval(hours => greatest(p_expires_hours, 1)),
    p_max_uses,
    auth.uid()
  );
  return token;
end;
$$;

create or replace function public.accept_vault_invite(p_token text)
returns table (vault_id uuid, vault_name text, role text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  inv vault_invites%rowtype;
  my_email text := lower(auth.jwt() ->> 'email');
  existing record;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select * into inv from vault_invites
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  for update;

  if not found or inv.revoked then
    raise exception 'This invite link is invalid or was revoked';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invite link has expired';
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception 'This invite link has already been used';
  end if;

  select vm.role, vm.status into existing
  from vault_members vm
  where vm.vault_id = inv.vault_id and (vm.user_id = auth.uid() or vm.email = my_email)
  limit 1;

  if found and existing.status = 'removed' then
    raise exception 'Your access to this vault was revoked by its owner';
  end if;

  if not found then
    insert into vault_members (vault_id, user_id, email, role, status, invited_by, joined_at)
    values (inv.vault_id, auth.uid(), my_email, inv.role, 'active', inv.created_by, now());
    update vault_invites set uses = uses + 1 where id = inv.id;
  elsif existing.status = 'pending' then
    -- An email invite already existed; the link just activates it (keeping the
    -- higher of the two roles would be surprising, so the email invite's role wins).
    update vault_members
    set user_id = auth.uid(), status = 'active', joined_at = now()
    where vault_members.vault_id = inv.vault_id and email = my_email;
    update vault_invites set uses = uses + 1 where id = inv.id;
  end if;

  return query
    select v.id, v.name, public.vault_role(v.id)
    from vaults v where v.id = inv.vault_id;
end;
$$;

-- ── CRDT tables: re-key policies on roles ────────────────────────────────────

drop policy if exists doc_updates_select on doc_updates;
drop policy if exists doc_updates_insert on doc_updates;

create policy doc_updates_select on doc_updates for select
  using (public.has_vault_role(vault_id, 'viewer'));

create policy doc_updates_insert on doc_updates for insert
  with check (public.has_vault_role(vault_id, 'editor') and created_by = auth.uid());

drop policy if exists doc_snapshots_select on doc_snapshots;
drop policy if exists doc_snapshots_upsert on doc_snapshots;
drop policy if exists doc_snapshots_update on doc_snapshots;

create policy doc_snapshots_select on doc_snapshots for select
  using (public.has_vault_role(vault_id, 'viewer'));

create policy doc_snapshots_upsert on doc_snapshots for insert
  with check (public.has_vault_role(vault_id, 'editor'));

create policy doc_snapshots_update on doc_snapshots for update
  using (public.has_vault_role(vault_id, 'editor'));

-- Live updates now travel over Realtime Broadcast; clients no longer
-- subscribe to postgres_changes on doc_updates.
do $$
begin
  alter publication supabase_realtime drop table doc_updates;
exception when others then null;
end;
$$;

-- ── Realtime (private channels) ──────────────────────────────────────────────
-- Realtime evaluates these once when a client joins a channel, not per
-- message — which is why document updates and presence/cursors are on
-- separate topics: viewers must be able to send presence, but not edits.

drop policy if exists inkwell_realtime_select on realtime.messages;
drop policy if exists inkwell_realtime_insert on realtime.messages;

create policy inkwell_realtime_select on realtime.messages for select
  to authenticated
  using (
    public.has_vault_role(public.vault_id_from_topic((select realtime.topic())), 'viewer')
  );

create policy inkwell_realtime_insert on realtime.messages for insert
  to authenticated
  with check (
    case
      when (select realtime.topic()) like 'vault-presence:%'
        then public.has_vault_role(public.vault_id_from_topic((select realtime.topic())), 'viewer')
      when (select realtime.topic()) like 'vault:%'
        then public.has_vault_role(public.vault_id_from_topic((select realtime.topic())), 'editor')
      else false
    end
  );

-- ── Attachments (Storage) ────────────────────────────────────────────────────
-- Object path: {vault_id}/{vault-relative attachment path}

insert into storage.buckets (id, name, public)
values ('vault-attachments', 'vault-attachments', false)
on conflict (id) do nothing;

drop policy if exists inkwell_attachments_select on storage.objects;
drop policy if exists inkwell_attachments_insert on storage.objects;
drop policy if exists inkwell_attachments_update on storage.objects;

create policy inkwell_attachments_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'vault-attachments'
    and public.has_vault_role(public.vault_id_from_topic('x:' || (storage.foldername(name))[1]), 'viewer')
  );

create policy inkwell_attachments_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'vault-attachments'
    and public.has_vault_role(public.vault_id_from_topic('x:' || (storage.foldername(name))[1]), 'editor')
  );

create policy inkwell_attachments_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'vault-attachments'
    and public.has_vault_role(public.vault_id_from_topic('x:' || (storage.foldername(name))[1]), 'editor')
  );
