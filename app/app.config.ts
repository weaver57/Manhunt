import { existsSync } from 'fs';
import { ExpoConfig, ConfigContext } from 'expo/config';

// google-services.json is a credential file (gitignored). Only wire it into
// the Android build when it exists, so `expo prebuild` works before the
// OAuth credentials are downloaded.
const googleServicesFile = existsSync('./google-services.json')
  ? './google-services.json'
  : undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Manhunt',
  slug: 'manhunt',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'manhunt',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/images/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#131211',
  },
  updates: {
  url: 'https://u.expo.dev/e1d74056-33e0-4c60-9588-5bb8d49bdda6',
  fallbackToCacheTimeout: 0,
  },
  runtimeVersion: '1.0.0',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.manhunt.app',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Manhunt needs your location to show your position on the game map.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Manhunt needs your location in the background so other players can see you during a game.',
      NSLocationAlwaysUsageDescription:
        'Manhunt needs your location in the background so other players can see you during a game.',
      UIBackgroundModes: ['location', 'fetch'],
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#131211',
    },
    package: 'com.manhunt.app',
    ...(googleServicesFile ? { googleServicesFile } : {}),
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'RECEIVE_BOOT_COMPLETED',
      'VIBRATE',
      'WAKE_LOCK',
      'CAMERA',
    ],
  },
  web: {
    bundler: 'metro',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-font',
    [
      'expo-camera',
      {
        cameraPermission: 'Manhunt uses the camera only to scan a game QR code.',
      },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Manhunt needs your location to show your position on the game map and during active games.',
        locationAlwaysPermission:
          'Allow Manhunt to access your location in the background during active games.',
        locationWhenInUsePermission:
          'Manhunt needs your location to show your position on the game map.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: '#E8350E',
        sounds: ['./assets/sounds/tag.wav', './assets/sounds/sos.wav'],
      },
    ],
    // Wires @react-native-google-signin/google-signin into the native build
    // (gradle deps + plist handling) for the custom dev build.
    '@react-native-google-signin/google-signin',
    [
      // SDK 52 pins Kotlin 1.9.24 but expo-dev-launcher's Compose Compiler
      // 1.5.15 needs 1.9.25 (expo/expo#32844) — bump Kotlin for the prebuild.
      'expo-build-properties',
      {
        android: { kotlinVersion: '1.9.25' },
      },
    ],
  ],
  extra: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    // Read in-app via expo-constants (src/lib/auth/useGoogleSignIn.ts).
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
    eas: {
      projectId: 'e1d74056-33e0-4c60-9588-5bb8d49bdda6',
    },
  },
});
