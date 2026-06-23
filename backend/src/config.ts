// backend/src/config.ts
import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const config = {
  tmdbApiKey: required('TMDB_API_KEY'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  appPassphrase: required('APP_PASSPHRASE'),
  port: Number(process.env.PORT ?? 3001),
  // URLs de watchlist de Letterboxd por usuaria. Opcionales: si falta la de una
  // usuaria, su refresh falla suave ("sin URL de Letterboxd") sin frenar a la otra.
  letterboxdUrls: {
    Jo: process.env.LETTERBOXD_URL_JO ?? null,
    Vale: process.env.LETTERBOXD_URL_VALE ?? null,
  } as Record<string, string | null>,
};
