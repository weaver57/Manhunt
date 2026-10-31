import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Polyfills required by Supabase realtime in React Native
import 'react-native-url-polyfill/auto';

SplashScreen.preventAutoHideAsync();

// Font names must match the families exported from src/constants/theme.ts
const FONT_MAP = {
  ManropeRegular: Manrope_400Regular,
  ManropeMedium: Manrope_500Medium,
  ManropeSemiBold: Manrope_600SemiBold,
  ManropeBold: Manrope_700Bold,
  JetBrainsMonoRegular: JetBrainsMono_400Regular,
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
    },
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_MAP);
  const [reduceMotion, setReduceMotion] = useState(false);
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
          <Stack screenOptions={{ headerShown: false, animation: reduceMotion ? 'none' : 'fade' }} />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
