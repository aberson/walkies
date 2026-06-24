# walkies — Can I Walk My Dog?

A native iOS + Android app that answers one question: **"Can I safely walk my dog right
now?"** Enter your dog's profile once; the app reads your location and current weather,
estimates the pavement temperature, factors in your specific dog's heat/cold vulnerability,
and returns a single clear verdict:

- 🟢 **Great time for a walk**
- 🟡 **Short walk in shade recommended**
- 🔴 **Unsafe right now**

…plus the estimated pavement temperature, a recommended maximum walk duration, the best
walking windows later today, and any active weather/air-quality alerts. The point isn't more
weather data — it's turning weather into one trustworthy decision, personalized to *your*
dog (a 10-year-old bulldog and a young husky get different answers at the same temperature).

> **Not veterinary advice.** This app provides informational guidance only. Always use your
> own judgment and the 7-second pavement test, and consult a vet for your dog's health needs.

## Stack

| Layer | Tool | Why |
|---|---|---|
| Framework | Expo (React Native) + TypeScript | One codebase → iOS + Android; instant on-phone dev via Expo Go |
| Navigation | expo-router | File-based routing (Home / Profile / Settings) |
| Location | expo-location | Foreground location → lat/lon |
| Storage | AsyncStorage | One dog profile + settings, on-device |
| Notifications | expo-notifications + expo-background-fetch | On-device alerts scheduled from the forecast |
| Weather + alerts | NWS `api.weather.gov` (keyless) | US government source; great active-alerts feed |
| Air quality | Open-Meteo `air-quality-api` (`us_aqi`, keyless) | US EPA AQI scale, no key, no rural gaps |
| Testing | Jest + React Native Testing Library | Deep unit tests on the pure verdict engine |

No backend, no accounts, no API keys in v1.

## Prerequisites

- **Node 20 LTS**
- A phone with **Expo Go** installed (App Store / Play Store) for the dev loop
- US location (NWS is US-only in v1)

## Setup

```bash
npm install
npx expo start      # opens the dev server + a QR code
```

Scan the QR with Expo Go (or the iOS camera). The app loads live and hot-reloads on edits.

```bash
npm test            # Jest unit + component tests
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
```

On first launch: grant location, complete the one-time dog profile, land on the verdict
screen.

## How it decides

The verdict is the **most restrictive of five independent signals**, so a pleasant
temperature never hides a hazardous air quality reading or an active storm warning:

1. **Pavement burn** — an estimated pavement temperature (calibrated to the Berens 1970
   asphalt-burn study, modulated by sun elevation, sky cover, and surface type). Surfaced as
   an estimate, always paired with the 7-second back-of-hand test.
2. **Heat stress** — NWS heat index, with thresholds shifted *down* for vulnerable dogs.
3. **Air quality** — US AQI, tightened for dogs with respiratory/cardiac conditions.
4. **Cold** — for small or short-coated dogs.
5. **Active NWS alerts** — heat/cold/wind/winter warnings; storms → no walk.

**Dog vulnerability** (brachycephalic breeds, puppies/seniors, obesity, double coats,
respiratory/cardiac conditions) lowers the temperature at which the verdict turns yellow/red
— grounded in RVC VetCompass heat-stroke odds ratios and AVMA/AAHA guidance.

## Project structure

```
src/
  domain/         # PURE verdict engine (heat index, pavement, dog risk, verdict, windows)
  data/           # NWS + Open-Meteo clients, location, cache
  storage/        # profile + settings (versioned, parse-guarded)
  features/       # home (verdict), profile (onboarding), settings (units + disclaimer)
  notifications/  # schedule + background-fetch task
  ui/             # shared components
```

See [plan.md](plan.md) for the full design, build steps, and appendices (schemas, API
contracts, the heat-index formula, and the dog-risk model with citations).

## Status

Plan complete; build in progress via the steps in [plan.md](plan.md) §11.
