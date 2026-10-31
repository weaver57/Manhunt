# Phase 3 — Location Engine

The GPS engine is the technical heart: it reads, filters, smooths, schedules and
uploads the device position during a game. This document is the map of that
system, the verification checklist, and the edge-case playbook.

## Architecture

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│ Foreground               │        │ Background                    │
│ Location                 │        │ Location                      │
│ .watchPositionAsync      │        │ .startLocationUpdatesAsync    │
│ (Accuracy.High)          │        │  • Android: foreground service│
│                          │        │    "Manhunt is tracking your  │
│                          │        │     location" notification    │
│                          │        │  • iOS: Always permission     │
└────────────┬─────────────┘        └──────────────┬────────────────┘
             │            same JS bundle           │
             ▼                                     ▼
      ┌───────────────────────────────────────────────────┐
      │ locationEngine.ts  ingestReading()                │
      │  engineCore: mock → stale → accuracy → warm-up    │
      │  → jump rejection → accuracy-weighted EMA         │
      │  → shouldQueueFix (adaptive cadence + battery)    │
      └───────────────────────┬───────────────────────────┘
                              ▼
      ┌───────────────────────────────────────────────────┐
      │ flush.ts  shared AsyncStorage queue + lease       │
      │  throttled, batched INSERT into player_locations  │
      │  (recorded_at = fix timestamp) + heartbeat_game   │
      └───────────────────────────────────────────────────┘
```

Files (all under `app/src/lib/location/`):

| File | Role |
| --- | --- |
| `engineCore.ts` | Pure filter chain (unit tested): distance, warm-up chain, jump checks, EMA, queue cadence |
| `uploads.ts` | Pure queue helpers: prune stale/poison rows, FIFO batches, row mapping |
| `flush.ts` | Shared queue persistence + throttled batched upload + lease |
| `locationEngine.ts` | Task definition, start/stop, foreground watch, battery reconciliation, heartbeat, mock reporting |
| `permissions.ts` | Foreground → background permission walk, Settings recovery |
| `battery.ts` | expo-battery wrapper with graceful degradation |
| `useTrackingStore.ts` | Zustand store the UI subscribes to |
| `useGameTracking.ts` | Hook bridging game lifecycle ⇄ engine |

## Key behaviours

- **Warm-up**: the first `minWarmupFixes` (3) fixes must be consistent (within
  40 m of each other and 20 s apart) before any upload happens. A factored
  break resets the chain. Lobby chip shows `GPS warm-up n/3`.
- **Quality gate**: fixes with accuracy > 30 m are dropped (server-side tag
  validation enforces the same limit). The queue keeps the last good fix as
  jump-check anchor; fixes implying > 40 m/s (144 km/h) or 100 m teleports are
  rejected.
- **Cadence**: hard floor 5 s between uploads; moving 8 s / stationary 15 s;
  a move of ≥ 5 m skips the delay so live movement stays responsive.
- **Battery**: below 15 % the cadence becomes ≥ 30 s and the foreground
  service re-registers with distanceInterval 30 m and deferred updates;
  crossing the threshold back re-registers the fast profile.
- **Batching**: queue flushes into `player_locations` in batches of 10 rows
  with a lease so the headless task and the app never double-insert.
- **Offline**: failed flushes back off exponentially, rows retry until 6
  attempts, and 15-minute-old fixes are dropped.
- **Heartbeat**: `heartbeat_game` every 45 s while tracking so the server sees
  liveness; on app wake-up a flush + heartbeat runs immediately (auto-rejoin).
- **Cold restart**: the app persists the tracking room binding; if the app was
  killed mid-game and reopened, `resumeTrackingFromRoom()` restarts the engine
  when the game is still active and stops/clears when it is not.
- **Mock GPS**: Android `mocked` fixes are flagged in the store, reported once
  via `report_mock_location` (migration 0011 sets `game_players.mock_detected_at`),
  and never uploaded (the DB also rejects them, belt and braces).
- **iOS "while using" fallback**: when Always wasn't granted the engine keeps
  the screen awake (expo-keep-awake tag `manhunt-tracking`) during the game
  and the UI warns that tracking pauses with the app closed.

## Start-stop flow

1. Lobby mounts → `useGameTracking` resolves permissions; a gate card appears
   when something is missing and links to `/(root)/location-setup`.
2. Game status enters `countdown|head_start|active|paused` → engine starts
   (service + foreground watch). Spectators don't track.
3. Game returns to `lobby`/`ended` → engine stops, final flush, queue cleared.
4. Navigating away/back mid-game reuses the same persisted filter state — GPS
   does not re-warm.

## Permission mapping

| Platform | Needed | Behaviour when rejected |
| --- | --- | --- |
| Android foreground (fine/coarse) | required | Lobby gate + setup screen; recover in Settings |
| Android background (10+) | optional | FGS started in-app keeps tracking; warning shown |
| iOS WhenInUse | required | same as Android foreground |
| iOS Always | required for pocket play | keep-awake fallback + warning |

## Supabase

Migration `0011_location_engine_phase3.sql` adds
`game_players.mock_detected_at` + `report_mock_location(uuid)`. Push with
`supabase db push` before shipping this phase.

## Verification checklist

Unit (`npm test`): filter chain, warm-up, jumps, smoothing, cadence, queue
lease/concurrency, poison/ stale pruning — 29 assertions.

Manual field tests (each phone, Android + iOS):

- [ ] Start a game → persistent notification appears (Android); status chip
      shows `Background on`.
- [ ] Lock the screen, pocket the phone for 30 minutes → positions keep
      updating on another device at ≤ 15 s intervals. **This is the exit
      criteria.**
- [ ] Deny permission → gate card, "Set up location", block; enable from
      Settings → lobby recovers within ~15 s.
- [ ] Enable battery optimization warning device: chip appears (Android),
      guide followed, service survives.
- [ ] Airplane mode mid-game → `pendingUploads` grows, positions resume within
      one flush after reconnect, stale fixes (>15 min) discarded.
- [ ] Mock GPS app (e.g. Lockito) while in game → chip `Mock GPS detected`,
      host sees `Mock GPS` on the player row, DB has no new position rows.
- [ ] Kill the app mid-game, wait 2 minutes, reopen → player's row marked by
      stale `last_seen_at` meanwhile; on reopen the queue flushes and the fix
      resumes immediately (auto-rejoin).
- [ ] Battery < 15 % → chip shows `· saving`, server writes throttled to ≥ 30 s.
