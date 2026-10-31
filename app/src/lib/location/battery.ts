/**
 * Battery and thermal awareness.
 *
 * expo-battery is a native module in the custom dev build. If a dev client
 * predates it, dynamically requiring must not crash the location task — the
 * engine simply loses low-battery throttling in that case.
 */

interface BatteryModule {
  getBatteryLevelAsync(): Promise<number | null>;
  getLowPowerModeAsync(): Promise<boolean>;
  isBatteryOptimizationEnabledAsync(): Promise<boolean>;
}

let cached: BatteryModule | null | undefined;

function loadModule(): BatteryModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Battery = require('expo-battery') as Partial<BatteryModule>;
    cached =
      typeof Battery.getBatteryLevelAsync === 'function' &&
      typeof Battery.isBatteryOptimizationEnabledAsync === 'function'
        ? (Battery as BatteryModule)
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

export interface BatteryStatus {
  level: number | null;       // 0..100
  lowPower: boolean;          // OS-level power saver (iOS) / battery saver (Android)
  optimizationOn: boolean | null; // Android: app is subject to battery optimization
}

const EMPTY: BatteryStatus = { level: null, lowPower: false, optimizationOn: null };

export async function getBatteryStatus(): Promise<BatteryStatus> {
  const Battery = loadModule();
  if (!Battery) return EMPTY;
  const [level, lowPower, optimizationOn] = await Promise.all([
    Battery.getBatteryLevelAsync().then((percent) => (percent === -1 ? null : percent)).catch(() => null),
    Battery.getLowPowerModeAsync().catch(() => false),
    Battery.isBatteryOptimizationEnabledAsync().catch(() => null),
  ]);
  return { level, lowPower, optimizationOn };
}
