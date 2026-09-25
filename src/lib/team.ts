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
  team_id: string | null
  name: string
  client_vault_key: string
  created_by: string
  created_at: string
}

/** Vaults the caller can open (RLS scopes this to vault_role() ≠ null). */
export async function listSharedVaults(): Promise<SharedVault[]> {
  const { data, error } = await supabase.from('vaults').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data as SharedVault[]
}

export async function createSharedVault(teamId: string | null, name: string, clientVaultKey: string, userId: string): Promise<SharedVault> {
  const { data, error } = await supabase
    .from('vaults')
    .insert({ team_id: teamId, name, client_vault_key: clientVaultKey, created_by: userId })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as SharedVault
}

// ── Per-vault members & roles ────────────────────────────────────────────────
// See supabase/migrations/0002_collab.sql — vault_members is the source of
// truth for access; owners manage it, RLS enforces it.

export type VaultRole = 'owner' | 'editor' | 'viewer'

export interface VaultMember {
  id: string
  vault_id: string
  user_id: string | null
  email: string
  role: VaultRole
  status: 'pending' | 'active' | 'removed'
  invited_at: string
  joined_at: string | null
}

export async function getMyVaultRole(vaultId: string): Promise<VaultRole | null> {
  const { data, error } = await supabase.rpc('vault_role', { p_vault: vaultId })
  if (error) throw new Error(error.message)
  return (data as VaultRole | null) ?? null
}

export async function listVaultMembers(vaultId: string): Promise<VaultMember[]> {
  const { data, error } = await supabase
    .from('vault_members')
    .select('*')
    .eq('vault_id', vaultId)
    .order('invited_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data as VaultMember[]
}

/** Owner-only. The invitee gets access once they sign in with this email. */
export async function inviteToVault(vaultId: string, email: string, role: Exclude<VaultRole, 'owner'>): Promise<VaultMember> {
  const { data, error } = await supabase
    .from('vault_members')
    .insert({ vault_id: vaultId, email: email.trim().toLowerCase(), role, status: 'pending' })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('That person is already on this vault.')
    throw new Error(error.message)
  }
  return data as VaultMember
}

export async function setVaultMemberRole(memberId: string, role: VaultRole): Promise<void> {
  const { error } = await supabase.from('vault_members').update({ role }).eq('id', memberId)
  if (error) throw new Error(error.message)
}

/** Owner-only: revoke access. Their devices stop syncing and keep a local copy. */
export async function removeVaultMember(memberId: string): Promise<void> {
  const { error } = await supabase.from('vault_members').update({ status: 'removed' }).eq('id', memberId)
  if (error) throw new Error(error.message)
}

export const INVITE_LINK_PREFIX = 'inkwell://join/'

/** Owner-only. Returns a shareable inkwell://join/<token> link; the token is shown only once. */
export async function createInviteLink(
  vaultId: string,
  role: Exclude<VaultRole, 'owner'>,
  expiresHours = 168,
  maxUses: number | null = null,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_vault_invite', {
    p_vault: vaultId,
    p_role: role,
    p_expires_hours: expiresHours,
    p_max_uses: maxUses,
  })
  if (error) throw new Error(error.message)
  return `${INVITE_LINK_PREFIX}${data as string}`
}

/** Accepts a full invite link or just its token. */
export function parseInviteToken(input: string): string | null {
  const trimmed = input.trim()
  const token = trimmed.startsWith(INVITE_LINK_PREFIX) ? trimmed.slice(INVITE_LINK_PREFIX.length) : trimmed
  const clean = token.replace(/[/?#].*$/, '')
  return /^[0-9a-f]{64}$/i.test(clean) ? clean : null
}

export async function acceptInviteLink(input: string): Promise<{ vaultId: string; vaultName: string; role: VaultRole }> {
  const token = parseInviteToken(input)
  if (!token) throw new Error("That doesn't look like an inkwell invite link.")
  const { data, error } = await supabase.rpc('accept_vault_invite', { p_token: token })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as { vault_id: string; vault_name: string; role: VaultRole } | undefined
  if (!row) throw new Error('Invite could not be accepted.')
  return { vaultId: row.vault_id, vaultName: row.vault_name, role: row.role }
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
  // Vault-level email invites are claimed server-side (the caller can't pick
  // their own role). Ignore failure so a DB without the 0002 migration still works.
  await supabase.rpc('accept_my_vault_invites').then(() => {}, () => {})
}
