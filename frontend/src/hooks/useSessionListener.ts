import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import type { UserName } from '../types';
import type { SessionFilters } from '../api';

export function useSessionListener(
  user: UserName,
  sessionId: string | null,
  onNewSession: (id: string) => void,
  onFiltersChanged?: (filters: SessionFilters | null, by: string) => void,
) {
  const sessionIdRef = useRef(sessionId);
  const onNewSessionRef = useRef(onNewSession);
  const onFiltersChangedRef = useRef(onFiltersChanged);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { onNewSessionRef.current = onNewSession; }, [onNewSession]);
  useEffect(() => { onFiltersChangedRef.current = onFiltersChanged; }, [onFiltersChanged]);

  useEffect(() => {
    const channel = supabase
      .channel('sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' },
        (payload) => {
          const nueva = payload.new as { id: string; started_by: string | null };
          if (nueva.id === sessionIdRef.current) return;
          if (nueva.started_by === user) return;
          onNewSessionRef.current(nueva.id);
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions' },
        (payload) => {
          const row = payload.new as {
            id: string; filters: SessionFilters | null; filters_updated_by: string | null;
          };
          // Solo el UPDATE de la sesión actual, y solo si lo cambió la OTRA usuaria.
          if (row.id !== sessionIdRef.current) return;
          if (!row.filters_updated_by || row.filters_updated_by === user) return;
          onFiltersChangedRef.current?.(row.filters, row.filters_updated_by);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);
}
