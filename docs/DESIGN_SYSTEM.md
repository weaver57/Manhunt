# Manhunt Design System

**Direction:** quiet luxury meets night operations. The interface should be calm, precise, and usable while moving. The map leads during play; controls and information stay secondary.

## Principles

- Dark-first, tinted surfaces with restrained violet-to-blue action gradients.
- Add depth through static ambient light, contour lines, hairline borders, and top highlights. Keep decoration away from map content.
- Keep one clear action per screen, place it in the lower thumb zone, and give it a 48 px minimum touch target.
- Use role color only for role markers and badges. Pair every role and status with a word or shape.
- Prefer short labels, sentence case, and left alignment. Keep all UI copy calm and action-oriented.
- Respect device text scaling, reduced motion, and the device light/dark appearance.

## Tokens

The implementation source is src/constants/theme.ts. Do not add one-off visual values in screens or components; add or reuse a token.

### Color

| Token | Dark | Light | Purpose |
| --- | --- | --- | --- |
| Background | #090B14 | #F4F5FA | Screen ground |
| Raised | #0F1220 | #FFFFFF | Floating surfaces |
| Surface 1 | #151929 | #FFFFFF | Cards |
| Surface 2 | #1C2136 | #EEF0F8 | Inputs and selected panels |
| Surface 3 | #262C45 | #E2E6F2 | Markers and pressed surfaces |
| Primary text | #F3F5F9 | #171B24 | Main copy |
| Secondary text | #A6ADBC | #515A6B | Supporting copy |
| Tertiary text | #6E778A | #697386 | Hints |
| Brand | #8E7CFF | #705BEA | Main action and focus |
| Chaser | #FF5A5F | #C93642 | Chaser role only |
| Runner | #3DD9EB | #087C91 | Runner role only |
| Success | #4ADE9A | #187A4C | Successful state |
| Warning | #FFB84D | #865400 | Attention state |
| Danger | #FF3B5C | #B4233A | Error or destructive state |

Brand gradient is #8E7CFF to #5B8CFF and belongs on primary actions and hero treatments. Aurora (#B58CFF to #FF7AC8) is reserved for rare highlights. Champagne gold is for rewards only. Role and system colors keep their separate meanings. These values, ambient glows, contour/ring opacity, and vignette live in the theme tokens.

### Atmosphere and surfaces

`AtmosphereBackground` provides static ambient glows, topographic contours, optional hero/lobby radar rings, and edge vignettes. Use the `home`, `hero`, `lobby`, and `quiet` variants to match screen intent. Keep ambient layers static for performance; avoid introducing blur or animation without a clear need and reduced-motion/low-power fallback. Do not place grain or atmospheric overlays over a future live map.

Shared cards use a gradient hairline border and a subtle inner top highlight. Hero cards may add the brand wash. Primary buttons use the brand gradient and highlight. Limit atmosphere to one visual focal point per screen and preserve text contrast over all background layers.

High-contrast palette values are also defined in theme.ts. The app chooses a dark or light palette from the device appearance.

### Type

- Manrope for interface copy: regular, medium, semibold, and bold.
- JetBrains Mono for codes, timers, and changing numeric values.
- Scale: display 44/48, title 28/34 and 22/28, body 17/24 and 15/22, small 13/18, label 12/16.
- Keep React Native font scaling enabled. Text must wrap instead of being clipped.

### Spacing and shape

- Use the 4 px spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Screen side padding is 20 px. Sections use 24 px; related controls use 12 px.
- Radii: 10 px small, 16 px medium, 24 px large, 32 px sheets, pill.
- Buttons are 40/48/56 px visually; interactive targets must remain at least 48 px.
- Keep layouts scrollable and reflowing; avoid absolute positioning for content.

## Components

src/components/ui.tsx provides Button, Card, Chip, Avatar, HudPill, ListRow, Toggle, Field, PageHeader, InlineNotice, EmptyState, Toast, Sheet, and Screen. Screens should compose these shared primitives instead of inventing local button, input, or panel treatments.

Use one icon family, Lucide, with the shared AppIcon wrapper at 24 px (20 px in dense controls) and 1.75 px stroke.

## Motion and accessibility

- Use the motion tokens: 120 ms press, 200 ms state change, 320 ms sheet, 600 ms map camera.
- Respect the OS reduced-motion setting; navigation transitions are removed when enabled.
- Use labels with role/status shapes and color. Never rely on color alone.
- Buttons expose labels and busy/disabled state to assistive technologies.
- Keep primary controls at least 48 × 48 px and separate neighboring targets by 8 px.
- Text uses native font scaling; flows scroll and labels can wrap.
- Dark and light alternatives are provided; high-contrast tokens are available for contrast-focused screens.
- Show a persistent offline banner when connectivity is unavailable.

## Screen checklist

Before finishing a screen, confirm:

1. One primary action is clear and reachable in the lower thumb zone.
2. Safe areas, scrolling, and large text do not cause content to overlap or clip.
3. Loading, empty, error, and offline states are covered where data or connectivity is involved.
4. Role/status meanings use text or shape as well as color.
5. All colors, type, spacing, radii, and motion come from tokens.
6. Controls have accessible names and at least 48 px touch targets.
7. The layout uses shared components and one Lucide icon style.
8. Motion is purposeful and respects reduced-motion preferences.
9. The background uses a restrained atmosphere recipe rather than an unlayered flat fill.
10. Each color has one role; cards use shared border/highlight treatment.
11. Atmospheric layers do not obscure content, and no more than two live blur layers are introduced.
12. Any gameplay-reactive effects have reduced-motion/low-power behavior and stay at map edges.

## Current app scope

The current app contains sign-in, home, create/join, profile, record placeholder, and lobby screens. A live map/gameplay screen is not present in this codebase yet, so map styling, live HUD, tag action, zone states, and results remain to be built when that route is added.

Grain texture and reactive chaser/runner, zone, offline, countdown, and results effects are intentionally not enabled yet: the corresponding routes/states are absent, and the current implementation avoids extra native dependencies and continuous animation.
