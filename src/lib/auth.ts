/**
 * Auth wrapper around Supabase Auth (email + password) for inkwell team
 * collaboration. Session persistence is handled by the Supabase client itself
 * (see supabase.ts) — this module just exposes a small, app-shaped surface.
 */
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'

export type { Session, User }

const NOT_CONFIGURED =
  'Team features are not available in this build (missing Supabase configuration).'

export async function signUp(email: string, password: string): Promise<User | null> {
  if (!isSupabaseConfigured) throw new Error(NOT_CONFIGURED)
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  return data.user
}

export async function signIn(email: string, password: string): Promise<User | null> {
  if (!isSupabaseConfigured) throw new Error(NOT_CONFIGURED)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  return data.user
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(error.message)
}

export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  return data.session
}

export function onAuthStateChange(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session))
  return () => data.subscription.unsubscribe()
}
