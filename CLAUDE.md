# dogwalk — "Can I Walk My Dog?"

## 1. Project overview

A native iOS + Android app (Expo / React Native) that gives a dog owner a single
🟢/🟡/🔴 "can I safely walk my dog right now?" verdict, personalized to one dog profile,
from live weather (NWS), air quality (Open-Meteo), an estimated pavement temperature, and
the dog's heat/cold vulnerability. v1 is single-dog, single-user, US-only, backend-free.
Full plan: [plan.md](plan.md).

## 2. Stack summary

| Layer | Tool |
|---|---|
| Framework | Expo (React Native) + TypeScript (strict) |
| Navigation | expo-router |
| Location / storage / notifications | expo-location · AsyncStorage · expo-notifications + expo-background-fetch |
| Weather + alerts | NWS `api.weather.gov` (keyless; `User-Agent` header required) |
| Air quality | Open-Meteo `air-quality-api` (`us_aqi`, keyless); EPA AirNow optional later |
| Testing | Jest + React Native Testing Library |
| Lint / types | ESLint + Prettier + `tsc --noEmit` |

No backend, no accounts, no API keys in v1.

## 3. Key commands

```powershell
npm install            # install deps
npx expo start         # dev server + QR for Expo Go on a phone
npm test               # Jest unit + component tests
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run smoke          # live NWS+Open-Meteo → domain pipeline smoke (added in Step 8)
```

## 4. Directory layout

```
src/
  domain/      # PURE verdict engine: heatIndex, sunPosition, pavement, dogRisk, verdict, windows, types
  data/        # nws, airQuality, location, cache  (raw JSON → domain types)
  storage/     # profile, settings  (parse-guarded, versioned AsyncStorage keys)
  features/    # home (verdict screen), profile (onboarding/edit), settings (units + disclaimer)
  notifications/  # schedule, backgroundTask
  app/         # expo-router routes
  ui/          # shared components
assets/        # icon, splash, breed seed JSON
documentation/field-checks/   # M3 pavement calibration notes
```

## 5. Architecture summary

- **domain/** is pure (no RN/network/storage) and carries the highest-value unit tests,
  asserted against published calibration data (Berens 1970 pavement points, NWS Rothfusz
  heat-index vectors, RVC VetCompass dog-risk ordering). The verdict = **most restrictive of
  five signals** (pavement burn, heat stress, air quality, cold, active NWS alert).
- **data/** wraps the two external APIs (NWS two-step `points→gridpoints`; Open-Meteo
  `us_aqi`), maps to domain types, caches with TTLs, and degrades gracefully (403, timeout,
  non-US coords, missing AQI). NWS calls **must** send the `User-Agent` header.
- **storage/** persists one `DogProfile` + `Settings` under versioned keys with parse guards.
- **notifications/** schedules on-device local notifications from "best windows today" +
  active alerts (no server in v1); background-fetch refreshes best-effort.
- Dog vulnerability **shifts heat thresholds down**, it does not gate — every dog gets a
  verdict, vulnerable dogs go yellow/red sooner.

## 6. Current state

**Plan written, no code yet.** Build via `/build-phase` over the 8 Automated Steps in
[plan.md](plan.md) §11 (each `--reviewers code --isolation worktree`), then the Manual Steps
M1 (Expo Go device smoke) → M2 (notification/background soak) → M3 (pavement field
calibration). Update this section via `/repo-update` at the end of each phase.

## 7. Environment requirements

- **OS:** Windows 11 for development (workspace default). Builds target iOS + Android.
- **Runtime:** Node 20 LTS. Expo CLI via `npx` (no global install).
- **Device:** a phone with **Expo Go** installed for the dev loop (QR scan); no Apple/Google
  developer account needed until TestFlight/Play (later, via EAS Build).
- **Network:** outbound HTTPS to `api.weather.gov` and `air-quality-api.open-meteo.com`. No
  API keys required in v1. NWS is **US-only**.
- **No secrets, no backend, no database.**
