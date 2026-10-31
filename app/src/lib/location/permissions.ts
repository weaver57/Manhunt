/**
 * Location permission flow. Handles the three platform quirks:
 *  - Android 10+: ACCESS_BACKGROUND_LOCATION must be requested after the
 *    foreground permission, ideally in a separate session.
 *  - iOS: "while using" still permits -web- (for app-open) tracking; the app
 *    keeps the screen awake as a fallback and nudges towards Always.
 *  - Denied-permanently: only Settings can recover; expo returns canAskAgain=false.
 */
import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import type { LocationPermissionState } from '@/types/location';

export type PermissionBlockReason =
  | 'ok'
  | 'foreground_denied'   // nothing works until user enables in Settings
  | 'background_denied';  // tracking works while app is foregrounded only

export function toPermissionState(
  foreground: Location.LocationPermissionResponse,
  background: Location.LocationPermissionResponse | null,
): LocationPermissionState {
  const status: LocationPermissionState['status'] =
    foreground.granted ? 'granted' : foreground.status === 'denied' ? 'denied' : 'undetermined';
  return {
    foregroundGranted: foreground.granted,
    backgroundGranted: background?.granted ?? false,
    canAskAgain: foreground.canAskAgain,
    foregroundIOSWhileOnly: foreground.granted && Platform.OS === 'ios' && !(background?.granted ?? false),
    status,
  };
}

export async function resolvePermissionState(): Promise<LocationPermissionState> {
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
  return toPermissionState(foreground, background);
}

/**
 * Walk the user through foreground then background permission dialogs.
 * `expectBackground` should be false for screens where the background
 * justification has not been shown yet (Android 11+ requires the always-ask
 * dialog to be user-initiated twice; we settle for foreground + explain).
 */
export async function requestGamePermissions(): Promise<LocationPermissionState> {
  const foregroundResponse = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (!foregroundResponse) {
    // Unavailable (e.g. web / emulator without Play Services).
    return {
      foregroundGranted: false,
      backgroundGranted: false,
      canAskAgain: true,
      foregroundIOSWhileOnly: false,
      status: 'undetermined',
    };
  }

  let backgroundResponse: Location.LocationPermissionResponse | null = null;
  if (
    foregroundResponse.granted &&
    (Platform.OS === 'android' ||
      (Platform.OS === 'ios' && foregroundResponse.canAskAgain))
  ) {
    // iOS: requestAlways is allowed in the same session. Android: the OS
    // requires foreground granted first, so making this request now matches
    // the platform guidance.
    backgroundResponse = await Location.requestBackgroundPermissionsAsync().catch(() => null);
  }

  return toPermissionState(foregroundResponse, backgroundResponse);
}

export function classifyBlock(state: LocationPermissionState): PermissionBlockReason {
  if (!state.foregroundGranted) return 'foreground_denied';
  if (!state.backgroundGranted && !state.foregroundIOSWhileOnly) return 'background_denied';
  return 'ok';
}

export function openSystemSettings(): void {
  void Linking.openSettings();
}
