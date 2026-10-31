import { useState, useEffect } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';

/**
 * Auth session exposed to the UI.
 *
 * Offline edge case (Phase 1): because `persistSession` writes to SecureStore
 * and `autoRefreshToken` retries on a timer, an expired token never logs the
 * player out on a cold start. When connectivity is regained we additionally
 * force one refresh immediately so the map screens of later phases always
 * start with a valid token instead of waiting for the next timer tick.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let receivedAuthEvent = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      receivedAuthEvent = true;
      if (!active) return;
      setSession(session);
      setLoading(false);
    });

    // Subscribe before reading storage so a sign-in event can't be overwritten
    // by a slower, stale getSession() result.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active || receivedAuthEvent) return;
      setSession(session);
      setLoading(false);
    }).catch(() => {
      if (!active || receivedAuthEvent) return;
      setSession(null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        // Network is back — refresh any possibly-expired token now.
        supabase.auth
          .refreshSession()
          .catch(() => {
            // Refresh failure is non-fatal; autoRefreshToken retries later.
          });
      }
    });

    return unsubscribe;
  }, []);

  return { session, loading };
}
