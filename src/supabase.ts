import { createClient } from "@supabase/supabase-js"

import type { AppConfig } from "./config.js"
import type { SupabaseLike } from "./types.js"

export function createSupabaseClient(config: AppConfig): SupabaseLike {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as SupabaseLike
}
