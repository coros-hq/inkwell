-- Inkwell: cap the number of teams an account can own at 2.
--
-- Apply once, by hand, in the Supabase SQL editor AFTER 0002_collab.sql.
-- Idempotent (create-or-replace / drop-if-exists), so it can be re-run.
--
-- Enforced by a trigger rather than RLS so it also covers ownership transfers
-- (teams_update lets an owner rewrite owner_id). The per-owner advisory lock
-- serialises concurrent inserts so two parallel requests can't both slip in.

create or replace function public.enforce_team_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('team_limit:' || new.owner_id::text));
  if (select count(*) from teams t where t.owner_id = new.owner_id and t.id <> new.id) >= 2 then
    raise exception 'You can own at most 2 teams.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists teams_limit on teams;
create trigger teams_limit
  before insert or update of owner_id on teams
  for each row execute function public.enforce_team_limit();
