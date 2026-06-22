// backend/src/db.ts
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Cliente con service role: el backend tiene acceso total e ignora RLS.
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
});
