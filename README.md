# Manhunt

A real-world GPS hide-and-seek game for friends across the city. Runners evade, chasers hunt, and the live map keeps everyone moving.

---

## Tech Stack

- **Mobile App**: React Native with Expo (SDK 52, custom dev build) + Expo Router
- **Backend & DB**: Supabase (Postgres, PostGIS, Auth with Google Sign-In, Realtime, Edge Functions)
- **Maps**: MapLibre / React Native Maps
- **State & UI**: Zustand, React Query, Tailwind-inspired design tokens

---

## Project Structure

```
manhunt/
├── docs/                 # Rulebook v1 and Design System
├── app/                  # Expo mobile app (Expo Router)
│   ├── src/
│   │   ├── app/          # File-based routes ((auth), (root))
│   │   ├── components/   # UI components
│   │   ├── constants/    # Design tokens (colors, typography, spacing)
│   │   ├── lib/          # Supabase client, auth hooks, location engine
│   │   └── types/        # TypeScript types derived from DB schema
│   └── package.json
└── supabase/             # Supabase migrations and config
    └── migrations/       # 0001 to 0011 (enums → profiles → games → locations → tags → realtime → lobby lifecycle → location engine)
```

---

## Getting Started

### 1. Prerequisites
- Node.js 18+ and npm / yarn
- Supabase CLI (`npm i -g supabase`)
- Expo CLI / EAS CLI
- Android Studio (for Android emulator) or Xcode (for iOS simulator)

### 2. Environment Setup
```bash
# Clone and enter repo
cd manhunt

# Setup mobile app environment
cd app
cp .env.example .env.local
# Fill in your SUPABASE_URL and SUPABASE_ANON_KEY in .env.local
```

### 3. Run Supabase Locally
```bash
cd supabase
supabase start
```

### 4. Run the Mobile App
```bash
cd app
npm install
npx expo start
```

---

## Documentation

- [Rulebook v1](docs/RULEBOOK.md) — Complete game rules, win conditions, and edge cases.
- [Design System](docs/DESIGN_SYSTEM.md) — Color tokens, typography scale, and UI components.
