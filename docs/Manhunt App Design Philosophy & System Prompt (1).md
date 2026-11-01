# Manhunt App: Design Philosophy & Design System Prompt

A reusable prompt plus a full design spec, so every screen your AI coding tool generates looks like it came from the same premium app.

**How to use:** paste **Part 1** at the start of every AI coding session. Paste **Part 2** as the reference spec (or save it in your repo as `DESIGN.md` and tell the AI to read it before touching any UI). The spec is framework-agnostic, so it works for Flutter or Expo.

---

## Part 1: Master prompt (paste this first)

```
You are the lead product designer and mobile engineer of a premium GPS manhunt game app (runners vs chasers, played outdoors with friends, at night and in daylight, often one-handed and on the move).

DESIGN PHILOSOPHY: "Quiet luxury meets night-ops."
- Dark-first, deep ink surfaces, restrained color with one signature accent (violet), a gold reward accent, and role colors, each with a single job.
- Calm, confident, glanceable. The player is running; every pixel must earn its place.
- Depth comes from layered surfaces, hairline borders, soft glows and glass blur, not heavy shadows or gradients everywhere.
- Generous spacing, strict alignment, and consistent rhythm on a 4-point grid.
- Motion is purposeful and fast (150 to 250 ms), paired with haptics. Never decorative.
- The map is the hero. UI floats above it in translucent glass panels and stays out of the way.
- Screens are never flat. Every background is built from layered atmosphere (ambient glow, contour lines, radar rings, grain, vignette) as defined in section 17.

HARD RULES:
1. Never hardcode colors, spacing, radii, font sizes, or durations. Use only the design tokens from the spec (DESIGN.md). If a token is missing, propose one instead of inventing a value.
2. Build reusable components first (Button, Card, Chip, Sheet, Avatar, HudPill, ListRow, Toggle, Input, Toast). Screens are composed from components only.
3. Every screen must have loading, empty, error, and offline states designed, not just the happy path.
4. Touch targets are at least 48 px. Primary actions sit in the bottom thumb zone.
5. Never rely on color alone: roles and statuses also use shape, icon, or label.
6. Support text scaling to 200 percent, reduced motion, and a high-contrast mode.
7. Use one icon set at one stroke weight. No emoji in the interface.
8. Copy is short, calm, and confident. Verbs first. No exclamation spam.
9. Before finishing any screen, run the Consistency Checklist from the spec and fix violations.

When unsure, choose the simpler, quieter, more spacious option.
```

---

## Part 2: Design spec (DESIGN.md)

### 1. Brand personality

| Trait | Means | Does not mean |
| --- | --- | --- |
| Focused | Clear hierarchy, one primary action per screen | Cluttered dashboards |
| Premium | Refined type, rich dark surfaces, precise spacing | Flashy gradients, neon overload |
| Tense but calm | Subtle pulse and glow when danger is near | Constant flashing or loud alerts |
| Social | Avatars, names, friendly microcopy | Childish cartoon styling |

Reference mood: a luxury watch dashboard crossed with a tactical radar, seen at night.

---

### 2. Color system

Dark theme is the default. Light theme is a full alternative for bright sunlight (not an afterthought).

**Neutrals (dark theme)**

| Token | Hex | Use |
| --- | --- | --- |
| `bg.base` | `#0A0C11` | App background, behind the map |
| `bg.raised` | `#11141B` | Screens, large panels |
| `surface.1` | `#171B24` | Cards, list rows |
| `surface.2` | `#1E2330` | Elevated cards, inputs |
| `surface.3` | `#272D3D` | Pressed states, chips |
| `border.subtle` | `#FFFFFF` at 7% | Hairline borders |
| `border.strong` | `#FFFFFF` at 14% | Focus, selected outlines |
| `text.primary` | `#F3F5F9` | Headings, key values |
| `text.secondary` | `#A6ADBC` | Body, labels |
| `text.tertiary` | `#6E778A` | Hints, disabled |

**Brand and roles**

| Token | Hex | Use |
| --- | --- | --- |
| `brand.primary` | `#8E7CFF` (Signal Violet) | Primary buttons, focus, highlights, active tab |
| `brand.primarySoft` | `#8E7CFF` at 16% | Tinted backgrounds, selected rows |
| `role.chaser` | `#FF5A5F` (Ember) | Chaser markers, chaser badge |
| `role.runner` | `#3DD9EB` (Ice) | Runner markers, runner badge |
| `role.spectator` | `#A6ADBC` | Spectators |

**Status**

| Token | Hex | Use |
| --- | --- | --- |
| `status.success` | `#4ADE9A` | Caught confirmed, connected, ready |
| `status.warning` | `#FFB84D` | Weak signal, boundary near |
| `status.danger` | `#FF3B5C` | Out of zone, destructive actions |
| `status.info` | `#6EA8FF` | Tips, neutral notices |

**Color rules**

- 60 percent neutrals, 30 percent surfaces and text, 10 percent accent. Violet marks actions and focus, gold marks rewards, ember and ice mark roles. Each color has one job. Section 17 extends this palette.
- Role colors appear on the map and role badges only. Do not use them as general button colors.
- Chaser = diamond or triangle marker shape, Runner = circle marker shape (color-blind safe).
- Minimum text contrast 4.5:1 (7:1 for the HUD timer and distance).
- Gradients: only subtle (same hue, 6 to 10 percent lightness shift) on hero cards and the primary button. No rainbow gradients.
- Light theme: swap `bg.base` to `#F6F7FB`, surfaces to white and `#EEF0F6`, keep brand and role hues but darken them about 10 percent for contrast.

---

### 3. Typography

**Fonts**

- **UI and body:** Manrope (weights 400, 500, 600, 700). Warm geometric sans with a premium feel.
- **Numbers (timer, distance, stats):** JetBrains Mono, or Manrope with tabular numerals, so digits never jiggle as they change.
- **Display titles (optional, hero moments only):** Space Grotesk 600.
- Always include a system fallback.

**Type scale**

| Token | Size / Line height | Weight | Use |
| --- | --- | --- | --- |
| `display` | 44 / 48 | 700 | Game timer, win/loss screen |
| `title.l` | 28 / 34 | 700 | Screen titles |
| `title.m` | 22 / 28 | 600 | Section titles, sheet titles |
| `body.l` | 17 / 24 | 500 | Primary body, list titles |
| `body.m` | 15 / 22 | 400 | Standard body |
| `body.s` | 13 / 18 | 400 | Captions, helper text |
| `label` | 12 / 16 | 600, uppercase, +8% tracking | Overlines, chips, HUD labels |
| `numeric.l` | 32 / 36 | 600 mono | Distance, countdown |

**Type rules**

- Large text gets slightly tighter tracking (about -1 to -2%). Small uppercase labels get wider tracking.
- Maximum two weights per screen area. Hierarchy comes from size, weight, and color tone, not many fonts.
- Left-align text. Center only titles of short, single-purpose screens and modal text.
- Maximum line length about 38 characters on phone for readability.

---

### 4. Spacing, layout, and grid

**Base unit:** 4 px. All spacing and sizes are multiples of 4.

| Token | Value | Typical use |
| --- | --- | --- |
| `space.1` | 4 | Icon to text gap |
| `space.2` | 8 | Inside chips, tight groups |
| `space.3` | 12 | Between related items |
| `space.4` | 16 | Card padding (compact), list gaps |
| `space.5` | 20 | Screen horizontal padding |
| `space.6` | 24 | Between sections, card padding (roomy) |
| `space.8` | 32 | Major section separation |
| `space.12` | 48 | Hero spacing |

**Layout rules**

- Screen horizontal padding: 20. Respect safe areas (notch, home indicator) always.
- Vertical rhythm: 24 between sections, 12 between items inside a section.
- **Thumb zone:** primary actions in the bottom 40 percent of the screen. Destructive or rare actions sit higher or behind confirmation.
- Bottom action dock: 20 horizontal padding, 16 bottom padding above the safe area, with a soft fade or glass blur behind it.
- Align everything to a consistent left edge. No near-miss alignments.
- Prefer whitespace over dividers. Use a hairline divider only when grouping is not clear otherwise.

---

### 5. Shape, depth, and glass

**Corner radius**

| Token | Value | Use |
| --- | --- | --- |
| `radius.s` | 10 | Chips, small tags, inputs inner |
| `radius.m` | 16 | Buttons, inputs, list rows |
| `radius.l` | 24 | Cards, HUD panels |
| `radius.xl` | 32 | Bottom sheets (top corners) |
| `radius.pill` | 999 | Pills, avatars, toggles |

**Depth recipe (dark theme)**

- Depth is created with **lighter surfaces plus a 1 px top highlight border** (`border.subtle`), not black drop shadows.
- Optional soft shadow under floating elements: offset 0, 8, blur 24, black at 35%.
- **Glass panels** (HUD over map): background `bg.raised` at 70 to 78% opacity, background blur 20 to 24, 1 px `border.subtle`, radius `radius.l`.
- **Glow** (not shadow) marks emphasis: a 0 0 24 px glow in the role or brand color at 30 to 40% for active, danger-near, or selected states.

---

### 6. Iconography and imagery

- One icon family only (recommended: Lucide or Phosphor), size 24 (20 in dense rows), stroke 1.75, rounded caps and joins.
- Icon color follows text tone: `text.secondary` default, `text.primary` active, brand violet for primary emphasis.
- Avatars: circular, 2 px ring in role color during games, 1 px `border.subtle` in lobby. Fallback to initials on `surface.3`.
- Illustrations (empty states): simple line art with one accent color. Never stock cartoons.
- No emoji in the UI. (They look inconsistent across devices.)

---

### 7. Motion and haptics

| Token | Duration | Easing | Use |
| --- | --- | --- | --- |
| `motion.fast` | 120 ms | ease-out | Press feedback, toggles |
| `motion.base` | 200 ms | cubic-bezier(0.2, 0.8, 0.2, 1) | Fades, chips, state changes |
| `motion.slow` | 320 ms | same | Sheets, screen transitions |
| `motion.camera` | 600 ms | ease-in-out | Map camera and 2D to 3D switch |

- Sheets and cards use a gentle spring (no big bounce). Never exceed 400 ms for UI transitions.
- Pressed state: scale to 0.97 and darken one surface step.
- **Map movement:** interpolate markers between updates. Never teleport dots.
- **Pulse** (chaser near): a slow 1.6 s ring pulse in role color, speed increasing as distance falls.
- **Hold-to-tag ring:** fills clockwise over 500 ms with a light haptic tick, then a firm success haptic.
- Skeleton loaders shimmer slowly (1.4 s). No spinners except short inline ones.
- Respect reduced-motion settings: replace motion with simple fades.

**Haptic language**

| Event | Pattern |
| --- | --- |
| Button press | Light tap |
| Tag success | Firm double pulse |
| Chaser nearby | Short pulses that speed up as distance drops |
| Boundary warning | Long, low buzz |
| Caught | Heavy single thud |
| Zone shrinking | Three slow pulses |

Always pair haptics with a visual cue, and let players mute them.

---

### 8. Components

**Buttons**

- Heights: large 56, medium 48, small 40. Radius `radius.m`. Label `body.l` at 600.
- **Primary:** brand violet fill, white text, subtle gradient, soft violet glow when focused.
- **Secondary:** `surface.2` fill, `border.subtle`, primary text.
- **Ghost:** transparent, violet text.
- **Danger:** `status.danger` outline and text, fills only on confirm.
- **Tag button (signature component):** 72 px circular or wide pill, ember glow, proximity ring around it that fills as you get closer, press-and-hold to confirm, disabled state is muted gray with distance text ("Too far, 28 m").
- Always show a loading state inside the button, never shift layout.

**Cards:** `surface.1`, `radius.l`, padding 16 to 24, hairline border. Tappable cards show press scale and a chevron.

**Chips and pills:** height 32, `radius.pill`, `label` text, tinted background (accent at 16%) with matching text. Used for role, mode, status.

**List rows:** 64 px tall, avatar or icon left, title `body.l`, subtitle `body.s` in `text.secondary`, trailing status chip or switch.

**Inputs:** 56 px tall, `surface.2`, `radius.m`, floating label, violet focus border and glow, inline error text in `status.danger` with an icon.

**Bottom sheet:** top radius `radius.xl`, grabber handle (36 x 4), glass or `bg.raised`, snap points at 40, 70, and 92 percent.

**Toasts and banners:** top-center, glass panel, icon plus one line, auto-dismiss in 3 s. Critical events (tagged, zone shrinking, signal lost) use a sticky banner.

**Toggles and segmented controls:** pill shape, violet active state, 200 ms slide.

**HUD pill:** small glass pill with icon plus `numeric` text (timer, players left, distance). Max 3 on screen at once.

---

### 9. Map design (hero element)

**Map style (custom, dark, desaturated)**

| Element | Treatment |
| --- | --- |
| Land | `#0D1017` |
| Water | `#0A1626` |
| Parks | `#0F1A17` (very subtle green) |
| Roads | `#1B2130`, highways slightly brighter `#242B3D` |
| Labels | `text.tertiary`, small, no halos; only major labels |
| Buildings (2D) | `#131824` with hairline outline |
| Buildings (3D) | Extruded, color ramps from `#151A26` at base to `#222A3B` at top; soft ambient light from above-left |

**Play area**

- Outside the area: dim the map with a 55% ink overlay.
- Boundary: 2 px dashed line in `brand.primary`, glowing softly. Turns `status.warning` when a player is within 50 m, `status.danger` when outside.
- Shrinking zone: show the next circle as a thin dotted outline with a countdown label.

**Markers**

- Runner: circle, 36 px, avatar inside, ice ring.
- Chaser: diamond-shaped badge, 36 px, avatar inside, ember ring.
- You: larger marker with heading cone and an accuracy ring (violet at 12% fill).
- Stale player: marker fades to 50%, label shows "last seen 40s", and a growing uncertainty circle appears.
- Name labels: `label` style, appear on tap or when zoomed in, never all at once.

**3D mode**

- Pitch 55 to 65 degrees for tilt view, 60 degrees follow-cam behind the player. Buildings fade slightly near the camera so markers stay visible.
- Subtle fog at the horizon and a very dark sky gradient.
- Always keep numeric distance on the HUD, since tilted views distort perception.
- Auto-fallback to 2D on low frame rates or low battery, with a calm toast.

**Map controls:** glass circular buttons (48 px) stacked on the right, above the thumb-reach limit: re-center, 2D/3D, layers. Nothing on the left edge to avoid accidental taps.

---

### 10. Screen anatomy

**Game screen (most important)**

1. Full-bleed map.
2. Top: glass bar with role badge (left), timer (center, `display` mono), players-left pill (right).
3. Right edge: map controls.
4. Bottom: action dock with the main action (Tag for chasers, Power-up for runners), a distance readout to the nearest relevant player, and a small connection-status dot.
5. Event toasts slide in below the top bar.
6. Everything else lives in a swipe-up sheet (roster, rules, settings, SOS).

**Lobby:** large game code with copy and share buttons, player grid of avatar cards with ready states, rules summary card, sticky bottom Start button (host) or Ready button.

**Create game:** presets as large selectable cards first (Quick game, City hunt, Hardcore), then an Advanced section with grouped settings in collapsible cards.

**Results:** big win/loss `display` title, stat cards, replay map preview, Rematch primary button.

---

### 11. States: loading, empty, error, offline

| State | Design |
| --- | --- |
| Loading | Skeletons matching the final layout, never blank screens |
| Empty | Line illustration, one-sentence explanation, one clear action |
| Error | Icon, plain-language message, what to do next, Retry button |
| Offline | Persistent slim banner, status dot turns red, "Offline since 0:42", queued actions show a clock icon |
| Weak signal | Yellow dot, "Weak signal", low-data styling kicks in |
| Pending action (e.g. tag queued) | Button shows a small clock and "Pending", resolves to success or a clear failure |

**Connection dot:** green good, yellow weak, red offline, pulsing violet while reconnecting. Always visible in the HUD.

---

### 12. Voice, tone, and microcopy

- Short, calm, confident. Say what happened and what to do.
- Examples:
  - Good: "Tag sent." "Too far, 28 m." "Zone shrinks in 60 s." "Signal lost. Your position is saved."
  - Avoid: "Oops! Something went wrong!!!" "Awesome!!! You did it!!!"
- Use plain verbs on buttons: Start game, Join, Tag, Leave. Avoid vague labels like Submit or OK.
- Numbers always have units (m, s, min).
- One exclamation mark at most, and only for wins.

---

### 13. Accessibility and inclusivity

- Contrast at least 4.5:1 for text and 3:1 for icons and boundaries; HUD key values at 7:1.
- Touch targets at least 48 x 48 px with 8 px spacing.
- Role and status always combine color with shape, icon, or text.
- Dynamic text up to 200 percent without clipping; layouts reflow instead.
- Reduced motion mode, high-contrast theme, and a large-text mode in settings.
- Screen-reader labels for every control, including the Tag button states.
- Sunlight mode: auto or manual light theme with bolder map labels.
- Safety first: never require precise tapping or reading small text while moving. Use audio and haptic cues for critical alerts.

---

### 14. Design tokens (copy into your code)

Translate this into your framework's theme file (a Dart `ThemeData` extension for Flutter, or a `theme.ts` for Expo).

```json
{
  "color": {
    "bg": { "base": "#0A0C11", "raised": "#11141B" },
    "surface": { "1": "#171B24", "2": "#1E2330", "3": "#272D3D" },
    "text": { "primary": "#F3F5F9", "secondary": "#A6ADBC", "tertiary": "#6E778A" },
    "brand": { "primary": "#8E7CFF" },
    "role": { "chaser": "#FF5A5F", "runner": "#3DD9EB", "spectator": "#A6ADBC" },
    "status": { "success": "#4ADE9A", "warning": "#FFB84D", "danger": "#FF3B5C", "info": "#6EA8FF" }
  },
  "space": [0, 4, 8, 12, 16, 20, 24, 32, 48],
  "radius": { "s": 10, "m": 16, "l": 24, "xl": 32, "pill": 999 },
  "font": { "ui": "Manrope", "mono": "JetBrains Mono", "display": "Space Grotesk" },
  "motion": { "fast": 120, "base": 200, "slow": 320, "camera": 600 }
}
```

---

### 15. Consistency checklist (the AI must run this on every screen)

- [ ] Only tokens used: no raw hex, raw pixel sizes, or raw durations.
- [ ] Built from shared components, no one-off styled widgets.
- [ ] Spacing follows the 4-point scale and screen padding is 20.
- [ ] One primary action, placed in the thumb zone.
- [ ] Type uses the defined scale, with numbers in the mono or tabular style.
- [ ] Roles and statuses use color plus shape or label.
- [ ] Loading, empty, error, and offline states exist.
- [ ] Touch targets 48 px or larger, contrast checked.
- [ ] Glass, borders, and glow follow the depth recipe (no random heavy shadows).
- [ ] Motion uses motion tokens and respects reduced-motion.
- [ ] Copy is short, calm, and unit-labeled.
- [ ] Works at 200% text size and in light theme.

---

### 16. Common mistakes to avoid

- Mixing multiple icon styles or fonts.
- Using violet everywhere (dilutes the accent).
- Pure black backgrounds with pure white text (too harsh); use the ink and off-white tokens.
- Heavy drop shadows on dark backgrounds.
- Cramped layouts. When in doubt, add 4 to 8 px of space.
- Showing every setting at once. Use progressive disclosure: presets first, advanced later.
- Designing only the happy path and forgetting poor-network states.

---

### 17. Richness layer: atmosphere, backgrounds, and a fuller palette

One accent color is fine on its own. What made the design feel empty was flat, solid backgrounds with no light, texture, or depth. This section fixes that. **It extends sections 2 and 5; where they conflict, this section wins.**

#### 17.1 Palette additions

| Token | Value | Use |
| --- | --- | --- |
| `bg.base` (tinted) | `#090B14` | Replaces the neutral ink. A blue-violet tint makes dark feel rich, not gray |
| `bg.raised` (tinted) | `#0F1220` | Large panels |
| `surface.1` (tinted) | `#151929` | Cards |
| `surface.2` (tinted) | `#1C2136` | Elevated cards, inputs |
| `surface.3` (tinted) | `#262C45` | Pressed states, chips |
| `brand.gradient` | `#8E7CFF` to `#5B8CFF`, 135 degrees | Primary button, hero cards, progress rings |
| `brand.aurora` | `#B58CFF` to `#FF7AC8` | Win screen and rare highlights, one per screen at most |
| `accent.gold` | `#F2C879` (champagne) | Winner crown, rank, power-ups, streaks. Under 2 percent of any screen |
| `glow.chaser` | `#FF5A5F` at 35% | Chaser-related glow |
| `glow.runner` | `#3DD9EB` at 35% | Runner-related glow |
| `glow.brand` | `#8E7CFF` at 35% | Focus and primary glow |

**One job per color:** violet = actions and focus, gold = rewards and status, ember and ice = roles, green/amber/red = system status. Never mix these jobs.

#### 17.2 Background layers (stack from bottom to top)

1. **Base:** `bg.base`.
2. **Ambient glow:** two large blurred radial gradients, violet at 22% opacity in the top-left and blue at 14% in the bottom-right, each about 60% of the screen width. Optional slow 20 s drift.
3. **Contour lines:** a topographic line pattern (SVG or vector) in white at 5%, scaled to 1.4x, with 8 px parallax on scroll. This ties every screen to the map theme.
4. **Radar rings:** three concentric hairline circles in white at 6%, centered behind the hero element (game code, countdown, results score).
5. **Grain:** a monochrome noise tile at 3 to 4% opacity with overlay blending across the whole screen. It removes gradient banding and adds a film-like richness.
6. **Vignette:** edges darkened with black at 35%, strongest at the bottom, to focus the eye on the center.
7. **Content.**

#### 17.3 Background per screen

| Screen | Background recipe |
| --- | --- |
| Welcome / sign-in | Ambient glows at full strength, slow drift, contour lines, large logo with soft violet halo |
| Home | Ambient glow, contour lines, hero card with mesh gradient |
| Lobby | Split tone: faint ice glow behind the runner column, faint ember glow behind the chaser column; radar rings behind the game code |
| Countdown | Full-screen radar sweep (rotating conic gradient, 4 s loop), huge `display` number, pulsing ring each second |
| Game | The map is the background. Edge vignette plus role-reactive glow (17.5). No grain over the map |
| Results (win) | Aurora mesh gradient, soft light rays, gold accent on the winner |
| Results (loss) | Desaturated ink with an ember vignette, calm and respectful |
| Settings | Base plus grain only. Quiet on purpose |

#### 17.4 Richer surfaces

- **Gradient hairline border:** 1 px, white at 14% in the top-left fading to 2% in the bottom-right, on every card.
- **Inner highlight:** a 1 px top edge gradient (white 10% to 0) that makes surfaces feel lit from above.
- **Hero card:** `surface.1` with a mesh gradient (violet, blue, and magenta blobs, blurred 80, at 30% opacity) plus grain.
- **Glass:** blur 24, saturation 140%, background at 70% with a faint violet tint, plus the gradient hairline border.
- **Primary button:** `brand.gradient`, inner top highlight, soft glow (0, 8, 24 in violet at 35%).
- **Avatars of key players:** soft role-colored halo behind them.
- **Numbers (timer, distance):** subtle text glow in the role color when urgent.

#### 17.5 Reactive atmosphere (the background reacts to the game)

| Situation | Background reaction |
| --- | --- |
| Chaser within 100 m (runner view) | Bottom edge glows ember and pulses every 1.6 s, intensity rising as distance falls |
| Runner nearby (chaser view) | Soft ice glow along the edge nearest the runner's direction |
| Zone shrinking | Vignette tightens, boundary glow shifts from violet to amber |
| Out of zone | Danger-red edge vignette, map slightly desaturated |
| Offline | Grain rises slightly, colors cool toward slate, slim banner appears |
| Night vs day | Ambient glows dim 30% at night; the light theme uses pale tinted glows instead |
| Win | Aurora mesh and gold accent fade in over 600 ms |

#### 17.6 Typography richness

- Hero numbers (timer, scores) use `display` in Space Grotesk with a very subtle vertical gradient fill (text.primary to text.secondary).
- Section overlines use `label` in `brand.primary` at 80%.
- Pair each screen title with one short line of `text.secondary` to add polish and context.

#### 17.7 Implementation hints

- **Flutter:** `Stack` of `Container` widgets with `RadialGradient`, `ImageFiltered` or `BackdropFilter` for blur and glass, `CustomPaint` for contour lines and radar rings, a small grain PNG drawn with `BlendMode.overlay`.
- **Expo (React Native):** `expo-linear-gradient` for gradients, `expo-blur` for glass, and `@shopify/react-native-skia` for blurred glow blobs, noise, contours, and the radar sweep.
- Build one reusable `AtmosphereBackground` widget or component that takes a `variant` (home, lobby, countdown, results, settings) so every screen stays consistent.

#### 17.8 Performance and accessibility guardrails

- Use at most 2 live blur layers per screen. Pre-render glows, contours, and grain as static images or gradients when possible.
- Animate only transform and opacity. Disable drift and sweep in low-power mode and when reduced motion is on.
- Verify text contrast on top of glows. Keep grain at 4% or lower.
- The game screen stays lighter than the others: the map and clarity come first.

#### 17.9 Tokens added

```json
{
  "color": {
    "bg": { "base": "#090B14", "raised": "#0F1220" },
    "surface": { "1": "#151929", "2": "#1C2136", "3": "#262C45" },
    "accent": { "gold": "#F2C879" },
    "gradient": {
      "brand": ["#8E7CFF", "#5B8CFF"],
      "aurora": ["#B58CFF", "#FF7AC8"]
    },
    "glow": { "brand": "#8E7CFF59", "chaser": "#FF5A5F59", "runner": "#3DD9EB59" }
  },
  "atmosphere": {
    "grainOpacity": 0.04,
    "contourOpacity": 0.05,
    "ringOpacity": 0.06,
    "vignette": 0.35,
    "ambientViolet": 0.22,
    "ambientBlue": 0.14
  }
}
```

#### 17.10 Added to the consistency checklist (section 15)

- [ ] Background is built from the layered atmosphere recipe, never a flat solid color.
- [ ] Each color does only its one job (violet, gold, roles, status).
- [ ] Cards use the gradient hairline border and top highlight.
- [ ] Reactive background states exist for chaser nearby, zone shrinking, out of zone, and offline.
- [ ] No more than 2 live blur layers; low-power and reduced-motion fallbacks exist.
- [ ] Game screen keeps the map clear: vignette and glow only at the edges.

---

### 18. Motion system: seamless, restrained, premium

Motion should feel like physics, not decoration. The goal is an app that feels alive and expensive, where the player barely notices the animation but would miss it if it were gone. **This section extends section 7; where they conflict, this one wins.**

#### 18.1 Principles

1. **Purpose:** every animation explains something (where it came from, what changed, what to do next). If it does not, delete it.
2. **Continuity:** elements move from where they were to where they are going. Nothing pops in or out of existence.
3. **Responsiveness:** animations never block input. They are interruptible and respond to touch velocity.
4. **Hierarchy:** one hero motion per screen at most. Everything else is a quiet micro-interaction.
5. **Restraint:** no more than two things draw attention at the same time. Fast, soft, and subtle beats long and bouncy.
6. **Consistency:** the same kind of change always uses the same motion token.

#### 18.2 Motion tokens

| Token | Value | Use |
| --- | --- | --- |
| `dur.instant` | 80 ms | Press feedback, color changes |
| `dur.fast` | 140 ms | Toggles, chip selection, icon swaps |
| `dur.base` | 220 ms | Fades, card changes, banners |
| `dur.slow` | 340 ms | Screen transitions, sheets |
| `dur.hero` | 520 ms | Win screen, countdown, one-time hero moments |
| `dur.camera` | 600 ms | Map camera, 2D/3D tilt |
| `ease.out` | cubic-bezier(0.2, 0.8, 0.2, 1) | Default for things entering or settling |
| `ease.inOut` | cubic-bezier(0.65, 0, 0.35, 1) | Things moving across the screen |
| `ease.in` | cubic-bezier(0.4, 0, 1, 1) | Things leaving (use sparingly, keep short) |
| `spring.snappy` | stiffness 420, damping 32, mass 1 | Buttons, toggles, small elements |
| `spring.smooth` | stiffness 240, damping 28, mass 1 | Sheets, cards, markers |
| `spring.gentle` | stiffness 130, damping 22, mass 1 | Hero elements, avatar pop-ins |

Springs have very little bounce on purpose: overshoot of 2 to 4 percent at most. Nothing wobbles.

#### 18.3 Choreography by element

| Element | Motion |
| --- | --- |
| **Screen transitions** | Push: new screen slides 24 px with a fade (`dur.slow`, `ease.out`), old screen dims slightly. Modal: sheet rises with `spring.smooth`. Same-level swap: cross-fade (`dur.base`) |
| **Shared elements** | Game card to lobby, avatar to profile, and map to results use a shared-element morph so the player sees continuity |
| **Lists and grids** | Items fade in and rise 12 px with a 30 ms stagger, capped at the first 6 items. Never re-animate on scroll |
| **Buttons** | Press scales to 0.97 (`spring.snappy`) with a surface step darker. On loading, the label fades out and a small spinner fades in, with the width unchanged |
| **Cards** | Press scales to 0.985, border highlight brightens. Release springs back |
| **Bottom sheets** | `spring.smooth`, follow finger velocity, rubber-band at the edges, backdrop dims from 0 to 40% |
| **Toasts and banners** | Slide down 16 px and fade in (`dur.base`), auto-dismiss after 3 s with a quiet fade |
| **Toggles and segmented controls** | Thumb slides with `spring.snappy`, color cross-fades (`dur.fast`) |
| **Numbers** | Counters roll digit by digit (tabular numerals) over `dur.base`. Scores count up over 800 ms. Timer digits roll each second |
| **Skeletons** | Slow shimmer, 1.4 s loop, then cross-fade to real content (`dur.base`) |
| **Inputs** | Floating label glides up (`dur.fast`), focus border and glow fade in. Invalid input gives one subtle 4 px shake, two cycles, plus a haptic |
| **Progress rings** | Fill with `ease.inOut`, a soft glow travels with the leading edge |
| **Empty states** | Illustration fades in once, with an optional very slow 4 s float. No looping on other screens |

#### 18.4 Game-specific motion (the signature moments)

| Moment | Motion |
| --- | --- |
| **Lobby join** | New player's avatar pops in (`spring.gentle`, scale 0.8 to 1) with a brief role-colored halo that fades in 600 ms |
| **Ready toggle** | Ring fills, check mark draws in (stroke animation, `dur.fast`), card gets a soft glow |
| **Countdown** | Each number scales from 1.15 to 1 with a fade (`dur.base`), a ring pulse expands outward each second, final "GO" gets a brief radial flash |
| **Hold-to-tag** | Ring fills clockwise over 500 ms with escalating haptic ticks. On success: ring expands and fades once (one ripple), the button briefly turns success green, then settles |
| **Tag failure** | Ring recoils (`spring.snappy`), distance text swaps with a quick fade, one soft haptic. No shake |
| **Runner caught** | The runner's marker flashes ember, morphs from a circle to the chaser diamond over 400 ms, and the event toast slides in. In infection mode, the marker keeps its avatar |
| **Player markers** | Position changes interpolate linearly over the update interval, so dots glide and never teleport. Marker scale gently eases (1.0 to 1.08) on tap |
| **Stale marker** | Fades to 50% over `dur.slow`, the uncertainty circle expands slowly |
| **Chaser nearby (runner view)** | Edge glow breathes on a 1.6 s cycle. Speed rises as distance falls, never faster than 0.6 s |
| **Boundary** | Dashed line marches very slowly (one dash per 2 s). Color shifts smoothly to amber or red when approaching or crossing |
| **Zone shrink** | Radius tweens smoothly over the whole shrink period, with a gentle tightening of the vignette. The next circle outline fades in 10 s before |
| **2D to 3D** | Camera pitch and zoom tween together over `dur.camera` with `ease.inOut`, buildings rise from flat to full height (300 ms staggered by distance), HUD stays still |
| **Connection change** | Status dot cross-fades color, banner slides in and out. Reconnecting uses one soft violet pulse |
| **Win screen** | Aurora mesh fades in (`dur.hero`), winner avatar scales in with `spring.gentle`, gold crown gets a single shimmer sweep, stats count up in sequence with a 120 ms stagger |
| **Loss screen** | Quiet fade only, no celebration, no shaking |

#### 18.5 Where NOT to animate

- Critical in-game values (distance, timer, caught status) never bounce or overshoot; they change cleanly so they can be read at a glance.
- No animation that delays a tap, a tag, or an SOS press by even one frame.
- No parallax or drifting backgrounds on the game screen.
- No looping decorative animation near the Tag button.
- No auto-playing animation longer than 1 second except the countdown and the win screen.
- Error messages appear with a plain fade. Alerts that matter use haptics and sound, not motion alone.

#### 18.6 Motion budget per screen

| Screen | Max simultaneous animated elements | Notes |
| --- | --- | --- |
| Welcome, Home | 3 | Slow ambient drift allowed |
| Lobby | 3 | Join pop-ins and ready toggles only |
| Countdown | 2 | Number plus ring pulse |
| Game | 2 | Marker motion plus one HUD change; map camera counts as one |
| Results | 3 | Sequenced, never all at once |
| Settings | 1 | Almost static |

#### 18.7 Performance rules

- Animate only `transform` and `opacity`. Avoid animating layout, shadows, or blur radius in real time.
- Target 60 fps (120 fps where supported). If a mid-range Android phone drops frames, simplify that animation, not the phone.
- Run animations on the UI thread (Reanimated worklets in Expo, native animation controllers in Flutter).
- Pre-render glows and gradients as static layers, then animate their opacity.
- Respect reduced motion: replace movement with short cross-fades, stop ambient drift, keep haptics.
- Low-power mode disables ambient drift, sweeps, and shimmer, and halves stagger delays.
- Test every animation with 5 simulated players moving on the map to confirm nothing stutters.

#### 18.8 Implementation hints

- **Flutter:** implicit animations (`AnimatedContainer`, `AnimatedOpacity`, `TweenAnimationBuilder`), `Hero` for shared elements, `SpringSimulation` for springs, the `flutter_animate` package for staggered sequences, and Rive or Lottie only for a few hero assets (win crown, logo).
- **Expo (React Native):** `react-native-reanimated` for springs and shared transitions, `react-native-gesture-handler` for sheet dragging, Moti for declarative enter and exit animations, Skia for glows and custom effects, `lottie-react-native` for a few hero assets.
- Build a single `motion.ts` or `motion.dart` file with the tokens above, plus reusable wrappers (`FadeInUp`, `PressScale`, `Stagger`, `CountUp`, `PulseRing`). Screens must use these and never define their own durations or curves.

#### 18.9 Motion tokens (copy into code)

```json
{
  "motion": {
    "duration": { "instant": 80, "fast": 140, "base": 220, "slow": 340, "hero": 520, "camera": 600 },
    "easing": {
      "out": [0.2, 0.8, 0.2, 1],
      "inOut": [0.65, 0, 0.35, 1],
      "in": [0.4, 0, 1, 1]
    },
    "spring": {
      "snappy": { "stiffness": 420, "damping": 32, "mass": 1 },
      "smooth": { "stiffness": 240, "damping": 28, "mass": 1 },
      "gentle": { "stiffness": 130, "damping": 22, "mass": 1 }
    },
    "stagger": { "step": 30, "maxItems": 6 },
    "press": { "button": 0.97, "card": 0.985 }
  }
}
```

#### 18.10 Added to the consistency checklist (section 15)

- [ ] Every animation uses a motion token (duration, easing, or spring), none hardcoded.
- [ ] Each screen stays within its motion budget (section 18.6).
- [ ] Only transform and opacity are animated; no layout animation.
- [ ] Critical game values change cleanly with no bounce.
- [ ] Reduced-motion and low-power fallbacks are implemented.
- [ ] Every animation is interruptible and never delays input.
- [ ] Each animation has a purpose a player could explain in one sentence.
