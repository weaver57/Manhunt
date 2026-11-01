# Phase 4 — Live Map & HUD

The live map turns the location engine's uploads into a shared real-time
picture: a MapLibre map where every player sees exactly what the visibility
rules allow, an HUD strip (timer, role, players left, nearest opponent) and a
sliding event feed. This doc mirrors [LOCATION_ENGINE.md](LOCATION_ENGINE.md):
architecture, behaviours, and the edge-case playbook the implementation
follows.

## Architecture

```
games/players realtime          player_locations realtime
        │                              │ INSERT (8–15 s cadence)
        │ useGameLobby                 ▼
        │                      ┌──────────────────────────────┐
        │                      │ useLiveLocations             │
        │                      │  backfill (last 20 min) +    │
        │                      │  channel `locations:<gameId>`│
        │                      │  keeps current + previous    │
        │                      │  fix per user                │
        │                      └──────────────┬───────────────┘
        ▼                                     │ roles, tracks
┌────────────────────┐              ┌─────────▼─────────┐
│ useGameClock (1 s) │              │ mapModel (pure,   │
│ → hudModel         │              │ unit tested):     │
│  timer / role /    │              │  renderPosition,  │
│  left / nearest    │              │  staleness,       │
└─────────┬──────────┘              │  visibility,      │
          │                         │  stacking, bounds │
          ▼                         └─────────┬─────────┘
      HUDBar ◄──────────────────── LiveMap ─┘
                              (Camera follow / recenter / heading-up)
        + EventFeed (useEventFeed + feedModel)
```

Files (all under `app/src/`):

| File | Role |
| --- | --- |
| `lib/map/mapModel.ts` | Pure marker maths (unit tested): interpolation/dead-reckoning, staleness, uncertainty radius, visibility, nearest opponent, stacking, pack bounds |
| `lib/map/hudModel.ts` | Pure HUD maths (unit tested): phase timer, formatRemaining, playersLeft, hudStats |
| `lib/map/feedModel.ts` | Pure feed text (unit tested): every lifecycle event → line/tone, graceful unknown types, buildFeed (newest-first, dedupe, cap) |
| `lib/map/styles.ts` | MapTiler dark/light style URLs, demotiles fallback, key resolution |
| `lib/map/useLiveLocations.ts` | Realtime player_locations stream + backfill (20-min window) |
| `lib/map/useEventFeed.ts` | Realtime events stream + initial query, merge/dedupe/cap 80 |
| `lib/map/useGameClock.ts` | 1-second tick for the HUD timer |
| `lib/map/useOfflinePack.ts` | Offline tile pack create/resume with AsyncStorage dedupe |
| `components/map/LiveMap.tsx` | MapView + Camera follow/heading-up + MarkerView per player |
| `components/map/PlayerMarker.tsx` | Marker visuals: role ring, uncertainty circle, heading cone, staleness fade, "last seen" pill |
| `components/map/HUDBar.tsx` | Timer/role/left/nearest chips + Center/Heading/Low-power controls |
| `components/map/EventFeed.tsx` | 4-line preview, tap to expand, tone dots |
| `app/(root)/game/[gameId].tsx` | Live screen: composes all of the above |
| `app/(root)/lobby/[gameId].tsx` | Auto-navigates to the map when the host starts the game |

## Visual treatment

- Keep the map full bleed. Add only a restrained edge vignette, with a role glow at the bottom edge when the nearest opponent is within 100 m; leave the center clear.
- Use translucent, high-contrast glass for the timer, role, player count, controls, distance, and feed. The timer uses tabular mono numerals.
- Markers pair the role-colored ring with a role glyph. Stale markers fade and retain a readable last-seen label.
- Map controls keep a minimum 48 px touch area. The event feed has its own expand/collapse target so list scrolling does not toggle the panel.
- Offline mode shows a slim saved-map banner and moves the HUD down to avoid overlap. Saved tiles do not imply live positions are current.
- A failed lobby fetch has a retry state; it must not remain on the loading skeleton indefinitely.

## Key behaviours

- **Never teleport dots.** Between the previous and current fix the marker is
  interpolated linearly; after the latest fix it dead-reckons along the
  reported heading (or A→B bearing) for at most 4 s at ≤ 8 m/s, then freezes.
  Out-of-order/duplicate INSERTs are ignored by timestamp comparison.
- **Stale data degrades visibly.** Freshness buckets: ≤10 s = live (full
  opacity), ≤40 s = recent (75 %), ≤5 min = stale (45 %, "last seen Ns ago"),
  older = offline (25 %). The uncertainty circle grows from the reported GPS
  accuracy by 0.6 m per stale second, capped at 150 m.
- **Visibility rules** (minimal for this phase; Phase 7 refines):
  - self always; spectators see everyone;
  - chasers see every defined role;
  - runners see other runners only with `runnersCanSeEachOther`
    (typo matches the DB settings column);
  - runner viewers never see chaser positions — the HUD shows distance only.
- **HUD nearest hint.** Runners get "Chaser · 340 m", chasers get
  "Runner · 1.2 km"; computed on raw fixes (not interpolated positions) and
  ignoring fixes older than the stale cutoff.
- **Overlap → clusters.** Visible markers within 12 m stack into one dot
  anchored on the freshest member, labelled "N close by" (stable, id-sorted).
- **Camera.** Native UserTrackingMode follows the device; a manual pan pauses
  follow, the Center button re-enables it and flies to the newest fix.
  Heading-up toggles `FollowWithHeading`; in north-up mode the self marker
  draws a heading cone. Low-power (< 25 % battery at entry, or manual toggle)
  disables pitch/rotate and shortens animations.
- **Timer.** Per-phase deadline from the games row (countdown/head_start/
  max_ends_at), 1 s tick, clamped at zero; paused shows PAUSED.
- **Event feed.** Initial query (30 recent) + realtime INSERTs; newest-first,
  deduped, capped at 80 rows / 30 rendered. Unknown future event types render
  as "user: type words" instead of crashing (Phase 5 tag events land here).

## Tiles & offline

- Styles come from the free MapTiler tier (`EXPO_PUBLIC_MAPTILER_KEY` →
  `app.config.ts` extra → `styles.ts`); without a key the map falls back to
  the public MapLibre demotiles (world-wide, zoom ≤ 6) so the game stays
  playable while a key is being arranged.
- At lobby/entry time an offline pack covering the play area (+300 m padding,
  zoom 8–14) is downloaded for the active style. Pack names embed the style
  suffix so dark/light packs don't collide in the native store; an
  AsyncStorage record (`manhunt.map.pack.<gameId>.<styleUrl>`) plus a native
  `getPacks()` check dedupe across sessions. Interrupted downloads resume;
  native errors surface as an error chip with retry.
- Pack bounds freeze once the first usable fixes/play area arrive so the
  download never restarts while players move.

## The prebuild note

`@maplibre/maplibre-react-native` needs native code, so after pulling this
phase you must rebuild the dev client:

```bash
cd app
npx expo prebuild --clean
npx expo run:android   # or run:ios
```

## Verification checklist

Model level (jest, `npm test` — 70 tests green):

- [x] bearing/interpolation/dead-reckoning incl. time- and speed-caps, out-of-order guard, freeze without bearing
- [x] freshness buckets, "last seen" labels, uncertainty growth + 150 m cap
- [x] visibility matrix (self/spectator/chaser/runner ± `runnersCanSeEachOther`, unknown roles hidden)
- [x] nearest-opponent direction per role, stale fixes excluded, distance formatting
- [x] stacking: within-12 m grouping, no infinite loop, order-stable
- [x] pack bounds enclose points + play circle + padding; play-area-only fallback
- [x] HUD timer per status (incl. missing/garbage deadlines, negative clamp), formatRemaining, playersLeft
- [x] feed: every lifecycle type, nickname precedence, unknown-actor/"Someone", future types, ordering/dedupe/cap

Needs a device (manual):

- [ ] two players see each other move smoothly in real time (no jumps)
- [ ] airplane mode → map renders from the offline pack
- [ ] dark/light theme switch re-keys the style URL
- [ ] pause → HUD freezes with PAUSED; ended → frozen map + back to lobby
