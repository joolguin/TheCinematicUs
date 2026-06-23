import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import type { UserName } from '../types';

export function useSessionListener(user: UserName, sessionId: string | null, onNewSession: (id: string) => void) {
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const channel = supabase
      .channel('sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' },
        (payload) => {
          const nueva = payload.new as { id: string; started_by: string | null };
          if (nueva.id === sessionIdRef.current) return;
          if (nueva.started_by === user) return;
          onNewSession(nueva.id);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, onNewSession]);
}
