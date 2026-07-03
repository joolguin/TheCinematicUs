import 'dotenv/config';

const DEFAULT_PORT = 3001;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const config = {
  tmdbApiKey: required('TMDB_API_KEY'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  appPassphrase: required('APP_PASSPHRASE'),
  port: Number(process.env.PORT ?? DEFAULT_PORT),
};
