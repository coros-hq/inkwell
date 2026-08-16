/**
 * Supabase client for inkwell team collaboration (auth, team/vault metadata,
 * Yjs doc sync via Realtime + Postgres). Only touched once a user signs in or
 * shares a vault — unshared, local-only vaults never call any of this.
 */
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: window.localStorage,
  },
})
