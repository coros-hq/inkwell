/**
 * Supabase client for inkwell's optional cloud backup feature.
 *
 * Cloud backup is opt-in and manual (see cloudSync.ts) — this client is only ever
 * touched when the user explicitly signs in from Settings → Cloud Backup. The app
 * must work fully offline when these env vars are unset.
 *
 * Env vars (see .env.example):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY — Supabase's newer name for the same key)
 */
import { createClient, type Session } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as
  | string
  | undefined

export const isCloudBackupConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = isCloudBackupConfigured
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}

/**
 * Sends a 6-digit login code to the user's email.
 * A desktop app has no HTTP server to catch a magic-link redirect, so we use the
 * code embedded in the same email (verified via verifyLoginCode) instead of the link.
 */
export async function sendLoginCode(email: string): Promise<void> {
  if (!supabase) throw new Error('Cloud backup is not configured (missing VITE_SUPABASE_URL/ANON_KEY).')
  const { error } = await supabase.auth.signInWithOtp({ email })
  if (error) throw error
}

export async function verifyLoginCode(email: string, code: string): Promise<Session> {
  if (!supabase) throw new Error('Cloud backup is not configured (missing VITE_SUPABASE_URL/ANON_KEY).')
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
  if (error) throw error
  if (!data.session) throw new Error('Sign-in succeeded but no session was returned.')
  return data.session
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}
