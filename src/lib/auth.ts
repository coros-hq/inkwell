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

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Where the confirmation email sends the user. Without an explicit value
 * Supabase falls back to the project's Site URL (localhost by default). The
 * desktop app registers the inkwell:// scheme, so the link reopens the app.
 * Must be listed under Auth → URL Configuration → Redirect URLs in Supabase. */
export const AUTH_CALLBACK_PREFIX = 'inkwell://auth/callback'

export async function signUp(email: string, password: string): Promise<User | null> {
  if (!isSupabaseConfigured) throw new Error(NOT_CONFIGURED)
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: isTauri ? AUTH_CALLBACK_PREFIX : window.location.origin },
  })
  if (error) throw new Error(error.message)
  return data.user
}

/** Completes sign-in from an inkwell://auth/callback link. Supabase appends
 * the session as a URL fragment (#access_token=…&refresh_token=…), or an
 * error (#error_description=…) when the link is expired or already used. */
export async function completeAuthCallback(link: string): Promise<void> {
  const url = new URL(link)
  const params = new URLSearchParams(url.hash.slice(1) || url.search.slice(1))
  const failure = params.get('error_description') ?? params.get('error')
  if (failure) throw new Error(failure.replace(/\+/g, ' '))
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (!access_token || !refresh_token) throw new Error('This confirmation link is missing its sign-in details.')
  const { error } = await supabase.auth.setSession({ access_token, refresh_token })
  if (error) throw new Error(error.message)
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
