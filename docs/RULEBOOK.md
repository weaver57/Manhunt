# Manhunt — Rulebook v1

> **Version**: 1.0.0 | **Last updated**: 2026-10-28  
> A real-world GPS hide-and-seek game for groups of friends, played across a city or district.

---

## 1. Overview

**Manhunt** is a location-based game played in real physical space. A group of friends splits into two opposing roles — **Runners** and **Chasers** — and the game unfolds across a real environment: parks, neighbourhoods, city blocks.

Runners try to evade capture. Chasers try to track them down. The game ends when time expires or all runners are tagged.

Live GPS positions are uploaded from every player's phone and shown on a shared map, subject to visibility rules set by the host. There are no virtual avatars — your position *is* your avatar.

---

## 2. Roles

### 2.1 Runner
- Evade chasers for the duration of the game.
- Stay within the designated play area.
- Survive as long as possible — survival time is your score.
- Cannot see other runners' locations by default (host can enable this).

### 2.2 Chaser
- Locate and physically approach runners.
- Tag runners by pressing the **TAG** button when within catch radius.
- Coordinate with other chasers using the shared map.
- Chasers can always see each other's positions.

### 2.3 Host
- Any player who creates the game.
- Sets all game parameters before start: mode, time limit, area, visibility rules, power-ups.
- Can **pause** and **end** the game at any time.
- The host plays as either role (they choose before the game starts).
- If the host leaves the game, the next longest-connected player becomes host.

---

## 3. Win Conditions

| Outcome | Condition |
|---------|-----------|
| **Runners win** | At least one runner is untagged when the timer expires |
| **Chasers win** | All runners are tagged before the timer expires |
| **Draw** | Not possible — time expiry always resolves the game |

### Scoring

| Role | Points |
|------|--------|
| Runner (survived) | Survival time in seconds |
| Runner (tagged) | Time survived before tag |
| Chaser | 100 pts per runner tagged + speed bonus (1 pt per second remaining when tagged) |

---

## 4. Catch Mechanic (the Tag)

### 4.1 How Tagging Works
1. A chaser physically closes in on a runner.
2. Chaser presses the **TAG** button visible on their HUD.
3. The server validates the tag by checking both players' GPS positions.
4. If the tag is valid, the runner is marked as caught.
5. A notification is sent to all players.

### 4.2 Catch Radius
- **Default radius**: 15 metres
- Configurable by host: 10 m / 15 m / 20 m / 30 m
- The radius is validated **server-side**. Client-side position is not trusted.

### 4.3 Server Validation Rules
A tag is accepted only when **all** of the following are true:

| Check | Requirement |
|-------|-------------|
| Distance | Straight-line distance between chaser and runner ≤ catch radius |
| Position freshness | Both GPS readings are ≤ 30 seconds old |
| GPS accuracy | Both players must have GPS accuracy ≤ 30 metres |
| Player state | Runner must be `active` (not already tagged, not in SOS) |
| Chaser state | Chaser must be `active` (not paused, not in SOS) |

### 4.4 After Being Tagged
- Runner is moved to **Spectator** state.
- Runner can still watch the live map, hear audio cues, and see the timer.
- **Optional (host setting)**: Tagged runners become Chasers ("Infection" variant).
- A runner cannot be tagged twice.

### 4.5 Anti-Cheat
- Speed anomaly: if a player moves >25 km/h their position is flagged. Tags made at flagged positions require manual host review.
- Timestamp mismatch: if a position upload is delayed >60 seconds, it is discarded.
- Fake GPS detection: the app uses Expo Location's built-in `mocked` flag; mocked positions are rejected.

---

## 5. Play Area

The host defines the play area before the game. Setting a play area is recommended for any game with fewer than 6 players.

### 5.1 Area Types

| Type | Description | Recommended for |
|------|-------------|-----------------|
| **Circle** | Host drops a pin and sets a radius (500 m – 10 km) | Most games |
| **Polygon** | Host draws boundary vertices on the map | Specific parks or districts |
| **City-wide** | No boundary — city is the arena | Large groups, experienced players |
| **Shrinking Zone** | Zone shrinks at set intervals (see §5.3) | Manhunt Royale mode |

### 5.2 Out-of-Bounds Behaviour
1. Player crosses boundary → 30-second audio/visual warning.
2. Warning dismissed or ignored → Player's **exact** position is revealed to all chasers.
3. After 60 more seconds outside → Player is **auto-tagged** (treated as caught).
4. Runners have 90 seconds total to re-enter before auto-tag.
5. Chasers out-of-bounds: penalised 50 pts per minute outside; cannot tag runners from outside.

### 5.3 Shrinking Zone
- Zone shrinks to a new, smaller circle at scheduled intervals.
- Default schedule: 25% of game time, 50%, 75% (three shrinks).
- A 60-second warning is shown before each shrink.
- Zone colour on map: safe = green tint, danger = red tint.
- Players inside the shrinking zone have 60 seconds to move before auto-tag.

### 5.4 No-Go Zones
- Host can mark areas as off-limits (busy roads, private property, construction sites).
- Marked as red overlay on the map.
- Entering a no-go zone → instant warning; 30 seconds to exit → auto-tagged.

---

## 6. Location & Visibility

### 6.1 GPS Update Frequency
Position uploads to the server occur at a configurable rate (host sets this):

| Frequency | Label |
|-----------|-------|
| Every 5 s | Real-time |
| Every 15 s | Fast (default) |
| Every 30 s | Medium |
| Every 60 s | Slow / Battery saver |

### 6.2 Visibility Modes

The host selects one visibility mode before the game begins.

| Mode | Runners see | Chasers see |
|------|-------------|-------------|
| **Always On** | Chaser positions in real-time | Runner positions in real-time |
| **Periodic Pings** | Chaser positions in real-time | Runner positions shown as a dot every 60/120/300 s (configurable), then dot fades |
| **Ghost Mode** | Chaser positions in real-time | Runners not visible at all — chasers navigate by proximity alerts only |
| **Radar** | Directional arrow to nearest chaser, no dots | Runner positions in real-time |
| **Classic Manhunt** | Nothing (runners blind) | Runner positions shown every 120 s |

Chasers **always** see each other in every mode.  
Runners seeing each other is a host-toggle (default: off).

---

## 7. Time Limits

- **Default**: 30 minutes
- **Options**: 10, 15, 20, 30, 45, 60 minutes (host selects)
- A countdown timer is visible to all players throughout the game.

### 7.1 Final Hunt
When `5 minutes remain` (or less), the host can enable **Final Hunt**:
- Ping frequency for runners doubles (regardless of mode).
- Timer pulses red on all screens.
- Audio cue broadcast to all players.

---

## 8. Game Modes

### 8.1 Classic
Standard rules. Chasers hunt runners. Last runner standing wins for Runners; all tagged = Chasers win. Best for first-time players.

### 8.2 Manhunt Royale
- Shrinking zone active.
- "Periodic Pings" visibility (default 120 s interval).
- Last untagged runner wins individually (not team).
- Chasers also compete for most tags.

### 8.3 Team Manhunt
- 2 teams of equal size.
- Team A = all Runners. Team B = all Chasers. Roles assigned by host.
- Team score: Chasers earn 100 pts per tag; Runners earn 1 pt/s survival per member.
- Score displayed as team total.

### 8.4 Infection
- Starts with **1 Chaser** and all others as Runners.
- Tagged runners become Chasers immediately.
- Last untagged runner wins.
- Fastest spreading infection = chaser team wins.

### 8.5 VIP
- One runner is secretly designated **VIP** by the host.
- Chasers must tag the VIP. Tagging non-VIP runners earns 10 pts but does not end the game.
- VIP's icon on the map is identical to all other runners.
- If VIP survives to time expiry → Runners win. If VIP is tagged → Chasers win immediately.
- VIP is revealed to all players after the game.

### 8.6 Relay Chase
- Chasers take turns being **Active**.
- At any time, only 1 chaser is Active (can tag runners). Others are **Resting**.
- Active rotates every 5 minutes (or when the Active chaser tags someone).
- Resting chasers can still see the map.
- Tests coordination and strategy.

---

## 9. Power-ups (Optional)

Power-ups are disabled by default. Host enables them per game.

| Power-up | Who | Effect | Limit |
|----------|-----|--------|-------|
| **Smoke Bomb** | Runner | Invisible for 30 s | 1 per game |
| **Sprint** | Runner | Upload frequency drops to 1/5 min for 2 min (slower ping) | 2 per game |
| **Reveal** | Chaser | Exact location of one chosen runner shown for 10 s | 1 per game |
| **Decoy** | Runner | A fake dot appears at a chosen location for 60 s | 1 per game |
| **EMP** | Runner | All chasers' maps go blank for 15 s | 1 per game, very rare |

Power-ups are activated via a button in the HUD. They have a cooldown indicator and cannot overlap (can't use two at once).

---

## 10. Fair Play & Safety

### 10.1 No-Vehicle Rule
- All players must be **on foot** throughout the game.
- Speed monitoring: if a player moves at >25 km/h for >10 seconds, they are **flagged**.
- Flagged status: shown on their icon, cannot tag/be tagged until they slow down and a 30-second reset period passes.
- Vehicles used to escape the area are treated as out-of-bounds.

### 10.2 SOS Button
- Any player can activate **SOS** at any time.
- Effect: game is **paused immediately**, all players receive full location of the SOS sender, an alert sound plays on all phones.
- Use for genuine emergencies (injury, threat, getting lost).
- After SOS: host decides to resume or end the game.
- Misuse of SOS is a sportsmanship violation (tracked but not penalised automatically).

### 10.3 Real-World Conduct
- Players must **obey all traffic laws** (use crossings, do not run into roads).
- Do not trespass on private property.
- Do not enter no-go zones set by the host.
- Remain aware of surroundings — phone should not be held while running in traffic.
- Play during daylight hours is strongly recommended for new players.

### 10.4 Minimum Players
- **Hard minimum**: 2 players (1 chaser, 1 runner) — valid as a 1v1 game.
- **Recommended minimum**: 4 players (2 runners, 2 chasers) for a fuller experience.
- Maximum players: no hard cap, but >20 players may require larger areas.

### 10.5 Age Guidance
- Recommended age: **13+**.
- Under-18 players should have a parent or guardian aware of the game session and the area being used.
- Location data is shared only with players in the same game session — not publicly.

---

## 11. Network & GPS Edge Cases

### 11.1 Poor GPS Signal
- Each position upload includes an **accuracy value** (metres).
- If accuracy is >30 m, the player's icon is shown with a translucent accuracy circle.
- Tags require **both** players to have accuracy ≤30 m at the time of the tag request.
- If accuracy cannot be established, a "GPS weak" badge appears on the HUD.

### 11.2 Offline / Disconnected
- A player who loses connectivity retains their **last known position** on all maps.
- After **2 minutes** of no upload, the icon shows "Signal Lost" state.
- After **5 minutes**, the host is prompted to decide: remove the player or wait.
- On reconnect: the position history is replayed to fill visual gaps in the replay.

### 11.3 Reconnection
- Reconnection is seamless if within the 5-minute window.
- Player state (tagged/active/chaser) is restored from the server.
- Missed events (being tagged while offline) are applied on reconnect.

### 11.4 Battery Saver Mode
- Players can switch to Battery Saver from the HUD settings.
- Effect: upload frequency drops to every 60 seconds; map render rate drops to 2 fps.
- Other players see a "battery saver" badge on the player's icon.
- Chasers cannot use Battery Saver (it degrades the game unfairly).

---

## 12. Post-Game

### 12.1 Stats Screen
Shown to all players immediately after the game ends:

- Total distance travelled (km)
- Calories estimate (rough, based on distance)
- Number of tags made / avoided
- Closest call (minimum distance from a chaser, in metres)
- Survival time (for runners) or avg time-to-tag (for chasers)
- Personal bests flagged

### 12.2 Game Replay
- A map replay of the full game, showing all player movements.
- Scrubber to move through time.
- Tag events highlighted with a burst animation.
- Sharable as a short video export (future feature).

### 12.3 Friend Group Leaderboard
- Cumulative stats across all games within a friend group.
- Rankings: most games won, most runners tagged, longest survival, most distance covered.
- Seasonal resets optional.

---

## Appendix A: Quick-Start for New Players

1. One person creates a game and shares the 6-digit **Game Code**.
2. Everyone joins using the code and their Google account.
3. Host assigns roles (or randomises them).
4. Host sets the play area on the map.
5. Host counts down from 10 — **Runners scatter first, then Chasers can move** (30-second head start by default).
6. Runners evade, chasers hunt, game ends when time is up or all runners are tagged.
7. Check the stats screen, brag, play again.

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Catch radius** | The maximum distance (metres) at which a tag is valid |
| **Ping** | A single position update broadcast to other players |
| **HUD** | Heads-Up Display — the in-game overlay showing timers, buttons, and status |
| **Spectator** | A tagged runner who can watch but not act |
| **Host** | The player who created the game session |
| **Active** | A player currently participating (not tagged, not SOS) |
| **Signal Lost** | State when a player's last GPS upload is >2 minutes old |
| **No-go zone** | A host-defined area that is out of play |
| **GPS accuracy** | The estimated error radius (metres) reported by the device's location hardware |
