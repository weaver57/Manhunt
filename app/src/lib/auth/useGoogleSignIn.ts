import { useState } from 'react';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';
import { supabase } from '../supabase/client';

// Configured once at module scope. The web client ID comes from app.config.ts
// `extra` (inlined at bundle time via expo-constants) because raw process.env
// values are not available inside React Native source files.
const webClientId = Constants.expoConfig?.extra?.googleWebClientId as
  | string
  | undefined;

GoogleSignin.configure({
  webClientId,
  scopes: ['profile', 'email'],
});

/**
 * google-signin v13 returns { type, data } unions; older versions returned the
 * user object directly. Normalise both shapes down to the idToken.
 */
function extractIdToken(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const withData = raw as { data?: { idToken?: string } | null; idToken?: string };
  return withData.data?.idToken ?? withData.idToken ?? null;
}

export function useGoogleSignIn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setLoading(true);
    setError(null);

    try {
      if (!webClientId) {
        throw new Error('Google sign-in is not configured in this build. Add GOOGLE_WEB_CLIENT_ID to your EAS environment and rebuild.');
      }
      console.log('[GoogleSignIn] webClientId prefix:', webClientId?.slice(0, 20));
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      const idToken = extractIdToken(result);

      if (!idToken) {
        // A successful resolve without a token usually means the flow was
        // cancelled by the user — not an error worth surfacing.
        return;
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });

      if (error) throw error;
    } catch (err: any) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        // User cancelled — not an error worth surfacing
      } else if (err.code === statusCodes.IN_PROGRESS) {
        // Already signing in — ignore
      } else if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setError('Google Play Services not available on this device.');
      } else if (err.code === 'DEVELOPER_ERROR' || String(err.message).includes('DEVELOPER_ERROR')) {
        setError(
          'DEVELOPER_ERROR: SHA-1/package mismatch. Package: com.manhunt.app. Add the EXACT SHA-1 from your installed dev APK (or EAS dev keystore) to an "Android" OAuth client in the SAME Google Cloud project as your Web client. Also try: uninstall app + reboot phone + wait 10 min after changing Cloud. See docs/VERIFY_GOOGLE_SIGNIN.md',
        );
      } else {
        setError(err.message ?? 'Sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    // Clear both the Google session and the Supabase session.
    await Promise.all([GoogleSignin.signOut(), supabase.auth.signOut()]);
  }

  return { signIn, signOut, loading, error };
}
