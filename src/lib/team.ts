/**
 * Team CRUD for inkwell collaboration — teams, invites, membership.
 * All calls go through the Supabase client (see supabase.ts); access control
 * is enforced by Postgres RLS policies (see supabase/schema.sql), not here.
 */
import { supabase } from './supabase'

export interface Team {
  id: string
  name: string
  owner_id: string
  created_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string | null
  email: string
  role: 'owner' | 'member'
  status: 'pending' | 'active' | 'removed'
  invited_at: string
  joined_at: string | null
}

/** Teams the current user owns or is an active member of. */
export async function listMyTeams(): Promise<Team[]> {
  const { data, error } = await supabase.from('teams').select('*').order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data as Team[]
}

export async function createTeam(name: string, ownerId: string): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .insert({ name, owner_id: ownerId })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Team
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from('team_members')
    .select('*')
    .eq('team_id', teamId)
    .order('invited_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data as TeamMember[]
}

/** Owner-only: create a pending invite row for an email. */
export async function inviteMember(teamId: string, email: string): Promise<TeamMember> {
  const { data, error } = await supabase
    .from('team_members')
    .insert({ team_id: teamId, email: email.trim().toLowerCase(), role: 'member', status: 'pending' })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as TeamMember
}

/** Owner-only: revoke access without deleting history. */
export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.from('team_members').update({ status: 'removed' }).eq('id', memberId)
  if (error) throw new Error(error.message)
}

export interface SharedVault {
  id: string
  team_id: string
  name: string
  client_vault_key: string
  created_by: string
  created_at: string
}

/** Vaults shared with any team the caller belongs to (RLS scopes this automatically). */
export async function listSharedVaults(): Promise<SharedVault[]> {
  const { data, error } = await supabase.from('vaults').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data as SharedVault[]
}

export async function createSharedVault(teamId: string, name: string, clientVaultKey: string, userId: string): Promise<SharedVault> {
  const { data, error } = await supabase
    .from('vaults')
    .insert({ team_id: teamId, name, client_vault_key: clientVaultKey, created_by: userId })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as SharedVault
}

/**
 * Self-serve invite acceptance: call after sign-in. Finds any pending invite
 * rows matching the signed-in user's email and flips them to active, claiming
 * them with this user's id — this is what makes an invited teammate's team
 * "just show up" once they sign up/in with the invited email, with no
 * transactional email flow required.
 */
export async function acceptPendingInvites(userId: string, email: string): Promise<void> {
  const { error } = await supabase
    .from('team_members')
    .update({ user_id: userId, status: 'active', joined_at: new Date().toISOString() })
    .eq('email', email.toLowerCase())
    .eq('status', 'pending')
  if (error) throw new Error(error.message)
}
