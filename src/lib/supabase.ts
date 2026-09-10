/**
 * Supabase client for inkwell team collaboration (auth, team/vault metadata,
 * Yjs doc sync via Realtime + Postgres). Only touched once a user signs in or
 * shares a vault — unshared, local-only vaults never call any of this.
 */
import { createClient } from '@supabase/supabase-js'

// Falls back to a placeholder so importing this module never throws when the
// env vars aren't set (e.g. local dev without a .env). Only calling one of
// the client's methods without real credentials will fail, not the import.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'placeholder-anon-key'

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: window.localStorage,
  },
})
