-- backend/db/cron.sql
-- Refresh automático diario de watchlists vía Supabase pg_cron + pg_net.
-- APLICAR A MANO en el SQL editor de Supabase. Reemplazar los <placeholders>.
-- No commitear con valores reales (la passphrase es secreta).

-- 1) Extensiones (una vez; también se pueden activar desde el dashboard).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Programar el refresh diario.
-- pg_cron corre en UTC: 21:00 UTC ≈ 18:00 America/Santiago (con DST cae
-- 17:00–18:00, irrelevante para un refresh diario).
-- timeout_milliseconds alto para aguantar el cold-start de Render free (~30s).
select cron.schedule(
  'daily-watchlist-refresh',
  '0 21 * * *',
  $$
  select net.http_post(
    url := 'https://<TU-BACKEND>.onrender.com/watchlists/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-passphrase', '<APP_PASSPHRASE>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Útiles:
--   select * from cron.job;                              -- ver jobs
--   select cron.unschedule('daily-watchlist-refresh');   -- borrar/reprogramar
--   select * from net._http_response order by created desc limit 5;  -- respuestas recientes
