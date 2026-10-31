import { StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
// Registering the GPS task happens at module scope in locationEngine; importing
// it from the app entry guarantees headless JS (task wake-ups) also loads it
// before expo-router boots.
import '@/lib/location/locationEngine';
import { useSession } from '@/lib/auth/useSession';
import { colors } from '@/constants/theme';
import LoadingState from '@/components/LoadingState';

/**
 * Route dispatcher: sends visitors to auth or the app shell.
 * A failed token refresh never kicks a stored session out (see useSession),
 * and loader states are shared components — never a bare spinner.
 */
export default function Index() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <View style={styles.container}>
        <LoadingState label="Connecting to command…" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return <Redirect href="/(root)/home" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ground,
  },
});
