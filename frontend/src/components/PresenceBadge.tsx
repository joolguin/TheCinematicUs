// frontend/src/components/PresenceBadge.tsx
import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { UserName, PresenceStatus } from '../types';

const LABEL: Record<PresenceStatus, string> = {
  'en-linea': 'en línea',
  'swipeando': 'swipeando',
  'termino': 'terminó su mazo',
};

type TrackPayload = { user: UserName; status: PresenceStatus };

// Encapsula el canal Realtime Presence: publica MI estado y muestra el de la OTRA.
export function PresenceBadge({ me, myStatus }: { me: UserName; myStatus: PresenceStatus }) {
  const [otherStatus, setOtherStatus] = useState<PresenceStatus | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const myStatusRef = useRef<PresenceStatus>(myStatus);
  useEffect(() => { myStatusRef.current = myStatus; }, [myStatus]);

  // Crear el canal una sola vez por usuaria.
  useEffect(() => {
    const channel = supabase.channel('presence', { config: { presence: { key: me } } });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<TrackPayload>();
        let found: PresenceStatus | null = null;
        for (const key of Object.keys(state)) {
          for (const pres of state[key]) {
            if (pres.user !== me) found = pres.status;
          }
        }
        setOtherStatus(found);
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') channel.track({ user: me, status: myStatusRef.current });
      });

    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [me]);

  // Re-trackear cuando cambia mi estado, sin recrear el canal.
  useEffect(() => {
    channelRef.current?.track({ user: me, status: myStatus });
  }, [me, myStatus]);

  const other: UserName = me === 'Jo' ? 'Vale' : 'Jo';
  const texto = otherStatus ? LABEL[otherStatus] : 'desconectada';

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`h-1.5 w-1.5 rounded-full ${otherStatus ? 'bg-[#4ade80] animate-dotPulse' : 'bg-[#3a3a50]'}`}
      />
      <span className="text-[14px] text-[#3a3a50]">{other}: {texto}</span>
    </div>
  );
}
