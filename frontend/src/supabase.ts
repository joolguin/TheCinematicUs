// frontend/src/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Anon key: por RLS solo puede leer movies y matches. Nunca ve swipes ajenos.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
