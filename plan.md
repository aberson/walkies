# Can I Walk My Dog? — Project Plan

## 1. What This Is

A native mobile app (iOS + Android) that answers one question: **"Can I safely walk my
dog right now?"** The user enters one dog profile once. The app reads their location and the
current weather, estimates the pavement temperature, factors in their specific dog's
heat/cold vulnerability, and returns a single clear verdict:

- 🟢 **Great time for a walk**
- 🟡 **Short walk in shade recommended**
- 🔴 **Unsafe right now**

…plus practical guidance: estimated pavement temperature, a recommended maximum walk
duration, the best walking windows later today, and any active weather/air-quality alerts.
The product value is **turning weather data into one trustworthy decision** — not showing
more weather. It is explicitly *informational guidance, not veterinary advice* (see
disclaimer, §8).

Scope of v1 (MVP): single dog, single user, "right now" verdict + best-windows-today +
on-device alert notifications. **Out of scope for v1:** multiple dogs, a share/save card,
server-driven always-on push, accounts/login, non-US locations.

## 2. Stack

| Layer | Tool | Why |
|---|---|---|
| App framework | **Expo (React Native) + TypeScript** | One codebase → iOS + Android; first-class push/geolocation/storage; test on a real phone instantly via Expo Go (QR), no App Store needed during dev. Chosen over Flutter to avoid a new language for this workspace. |
| Language | TypeScript (strict) | Type safety across the domain model (the verdict logic is the riskiest code; types catch shape drift). |
| Navigation | `expo-router` (file-based) | Standard Expo navigation; simple stack for Home / Profile / Settings. |
| Location | `expo-location` | Foreground location → lat/lon for weather. No background-location permission in v1 (privacy + store-review friction). |
| Local storage | `@react-native-async-storage/async-storage` | Persist the one dog profile + settings on-device. No backend, no accounts. |
| Notifications | `expo-notifications` | Schedule on-device local notifications for today's safe windows + alerts. |
| Background refresh | `expo-background-fetch` + `expo-task-manager` | Best-effort refresh of scheduled notifications when the OS allows (opportunistic; see §"Key Design Decisions"). |
| Weather + alerts | **NWS `api.weather.gov`** (US government, keyless) | Free, no API key, includes an excellent active-alerts feed. US-only — acceptable for a US personal app. |
| Air quality | **Open-Meteo Air Quality** (keyless) primary; EPA AirNow optional | Open-Meteo returns the US EPA AQI scale (`us_aqi`) with no API key and no rural coverage gaps → keeps the app fully backend-free (no embedded secret). EPA AirNow (the official-observation government source) is documented as an optional upgrade behind a future proxy. |
| Sun position | In-house pure function | Solar-elevation calc (no dependency) feeds the pavement-temperature model's sun-exposure factor. |
| Testing | **Jest + React Native Testing Library** | Unit tests for the pure domain core (heat index, pavement model, verdict) — the highest-value tests. Component tests for screen states. Device UAT is manual via Expo Go. |
| Lint / format / types | ESLint + Prettier + `tsc --noEmit` | Standard Expo tooling; gates run in `/build-step`. |
| Store builds (later) | EAS Build | Cloud-built iOS/Android binaries when moving to TestFlight/Play; not needed during dev. |

## 3. Data Store

No server and no database. All persistent state is local to the device via AsyncStorage;
all weather/AQI data is fetched live and cached briefly in memory.

### 3.1 Persisted entities (AsyncStorage)

| Key | Shape | Notes |
|---|---|---|
| `walkies.profile.v1` | `DogProfile` JSON (see Appendix A) | The single dog profile. Versioned key suffix (`.v1`) so a future schema change can migrate rather than corrupt. |
| `walkies.settings.v1` | `Settings` JSON (units, default walk surface, notification opt-in) | App preferences. |
| `walkies.cache.lastVerdict.v1` | `{ verdict, fetchedAt, lat, lon }` | Last computed verdict, shown instantly on cold start while a fresh fetch runs (offline-friendly). |

- **Identification:** there is exactly one dog profile in v1, so its identity is the fixed
  key `walkies.profile.v1` (no per-dog id needed). When multi-dog lands (later phase), the
  store becomes `walkies.profiles.v1 → { [dogId: uuid]: DogProfile }`; `dogId` will be a
  `crypto.randomUUID()` v4 string. Documented now so the v1 single-profile shape is a clean
  subset.
- **Deduplication / corruption protection:** every read is wrapped in a parse-guard — on
  `JSON.parse` failure or schema-version mismatch, the value is treated as absent and the
  user is re-onboarded rather than crashing. Writes are last-write-wins (single device,
  single user; no conflict surface).

### 3.2 Live data (fetched, cached in memory only)

| Source | Endpoint | Cache TTL |
|---|---|---|
| NWS gridpoint lookup | `GET /points/{lat},{lon}` | 24 h (grid mapping is stable for a location) |
| NWS hourly forecast | `GET /gridpoints/{wfo}/{x},{y}/forecast/hourly` | 1 h (matches NWS `expires` cadence) |
| NWS sky cover | `GET /gridpoints/{wfo}/{x},{y}` → `properties.skyCover` time-series | 1 h |
| NWS active alerts | `GET /alerts/active?point={lat},{lon}` | 30 min |
| Air quality | `GET https://air-quality-api.open-meteo.com/v1/air-quality?...&current=us_aqi,pm2_5,pm10,ozone` | 1 h |

See Appendix B for verbatim field names and example requests.

## 4. Domain Core — the verdict engine

This is the heart of the app and the most heavily unit-tested module. It is **pure**
(no network, no UI, no storage) so it can be tested against published calibration data.

### 4.1 Inputs
- Current + hourly: air temp (°F), relative humidity (%), wind speed, sky cover (%),
  precipitation probability, `isDaytime`.
- Air quality: US AQI.
- Active NWS alerts (event names + onset/ends).
- Location lat/lon + current time (for sun elevation).
- The `DogProfile`.

### 4.2 Sub-models (each a pure function, each independently tested)

1. **Heat index** — NWS Rothfusz regression (Appendix C, verbatim constants). Apparent
   temperature from air temp + RH.
2. **Sun elevation** — solar-elevation angle from lat/lon + local time + day-of-year.
   `sunFactor = clamp(sin(elevation), 0, 1)` (0 at night).
3. **Pavement temperature** — calibrated to Berens (1970) full-sun data points
   (77°F→125°F, 86°F→135°F, 87°F→143°F):
   ```
   asphaltFullSunDelta = 50   // °F above air, calibrated to Berens
   cloudFactor   = 1 - 0.7 * (skyCover / 100)        // overcast still gains some heat
   surfaceFactor = { asphalt: 1.0, concrete: 0.55, grass: 0.10 }[surface]
   pavementTempF = airTempF + asphaltFullSunDelta * sunFactor * cloudFactor * surfaceFactor
   ```
   Default surface for the headline verdict is **asphalt** (worst-case the dog is likely to
   encounter). Coefficients (`50`, `0.7`) are tunable and validated/adjusted in field-check
   step M3.
4. **Dog vulnerability score** — additive points from profile factors (Appendix D), mapped
   to a heat-threshold **offset** (°F the green/yellow/red heat bands shift *down*) and a
   `respiratorySensitive` flag (tightens AQI bands). Grounded in the RVC VetCompass odds
   ratios and AVMA/AAHA guidance (Appendix D).
5. **Verdict engine** — computes five independent risk signals and returns the **most
   restrictive** as the headline verdict (Appendix E):
   - Pavement-burn risk (paw safety)
   - Heat-stress risk (heat index shifted by dog vulnerability)
   - Air-quality risk
   - Cold risk (small/short-coat dogs)
   - Active-alert risk (NWS warnings/advisories; storms → no walk)

   Output: `{ level: 'green'|'yellow'|'red', headline, reasons[], pavementTempF,
   recommendedMaxMinutes, bindingSignal }`.

### 4.3 Best windows today
Scan the next ~12 hourly periods; run the verdict engine on each; return contiguous
`green`/`yellow` runs as "better windows" (e.g., "after 7:15 PM"). Drives both the Home
strip and the scheduled notifications.

## 5. Modules (`src/`)

```
src/
  domain/            # PURE — no RN, no network, no storage. The verdict engine.
    heatIndex.ts         # Rothfusz regression (Appendix C)
    sunPosition.ts       # solar elevation angle
    pavement.ts          # estimated pavement temperature
    dogRisk.ts           # DogProfile → vulnerability score + offsets (Appendix D)
    verdict.ts           # 5-signal engine → green/yellow/red (Appendix E)
    windows.ts           # best-windows-today scan
    types.ts             # DogProfile, Verdict, WeatherSnapshot, AirQuality, Alert (shared)
  data/              # network clients; map raw API JSON → domain types
    nws.ts               # points → hourly + gridpoint skyCover + alerts
    airQuality.ts        # Open-Meteo us_aqi (AirNow adapter stub for later)
    location.ts          # expo-location wrapper (permission + lat/lon)
    cache.ts             # in-memory TTL cache + AsyncStorage last-verdict
  storage/
    profile.ts           # load/save DogProfile (parse-guarded, versioned)
    settings.ts          # load/save Settings
  features/
    home/                # verdict screen: big card, pavement temp, duration, reasons, windows, alerts
    profile/             # dog onboarding + edit form; breed picker (Appendix A seed list)
    settings/            # units toggle, default surface, notifications opt-in, disclaimer/about
  notifications/
    schedule.ts          # build + schedule local notifications from best windows + alerts
    backgroundTask.ts    # expo-background-fetch task: refetch + reschedule (best-effort)
  app/                 # expo-router routes (index = home, /profile, /settings)
  ui/                  # shared components (VerdictCard, RiskBadge, WindowStrip, AlertRow)
```

## 6. API Route Contract

Not applicable — the app has **no backend of its own** in v1. It is a pure client that
consumes two external HTTP APIs (NWS, Open-Meteo). Their request/response contracts are
captured verbatim in Appendix B so the `data/` layer can be built without re-deriving them.

## 7. Project Structure

```
walkies/
  plan.md                  # this document
  CLAUDE.md                # project context for future sessions
  app.json / app.config.ts # Expo config (name, icon, permissions strings, plugins)
  package.json             # scripts: start, ios, android, test, lint, typecheck
  tsconfig.json            # strict TS
  eas.json                 # (added later) EAS Build profiles
  src/                     # see §5
  assets/                  # icon, splash, breed seed JSON
  __tests__/ or *.test.ts  # co-located domain tests + component tests
  documentation/
    field-checks/          # M3 pavement-calibration notes
```

## 8. Key Design Decisions

- **Native app via Expo, not a PWA.** The operator chose a real iOS/Android app; Expo gives
  one TS codebase, push/location/storage out of the box, and an instant on-phone dev loop
  (Expo Go QR) without App Store accounts until launch.
- **NWS for weather, keyless.** `api.weather.gov` is the US government source, free, no key,
  and uniquely provides an active-alerts feed that maps directly onto the app's heat/cold/
  storm/air-quality alerts. Cost: US-only and a two-step `points → gridpoints` flow. A
  required `User-Agent` header identifies the app (omitting it returns HTTP 403).
- **Open-Meteo for AQI, not AirNow, in v1.** AirNow is the official EPA source but requires
  an API key (a secret we'd have to embed in the client or proxy) and is station-based with
  rural gaps. Open-Meteo returns the same US EPA AQI scale (`us_aqi`) keyless and model-based
  (always returns a value), keeping the app fully backend-free. AirNow remains a documented
  later upgrade (`data/airQuality.ts` has an adapter seam).
- **No backend, no accounts, no server-push in v1.** All weather is keyless; the one profile
  lives on-device. Alerts are **local notifications scheduled from the forecast** when the
  app is opened, refreshed best-effort by a background-fetch task. This is the deliberate
  MVP tradeoff: zero infra/cost, but if the app is unopened for days, scheduled alerts can
  go stale. **Truly always-on push (a scheduled server that pushes even when the app is
  closed) is a documented Phase 2** — it requires a backend + a stored copy of location/
  profile.
- **Pavement temperature is an estimate, surfaced as such.** No API measures pavement temp;
  the model is calibrated to Berens (1970) and modulated by sun elevation, sky cover, and
  surface type. The app shows it as an estimate and always recommends the **7-second
  back-of-hand test** as ground truth (Appendix B/E). Model coefficients are validated in M3.
- **"Most restrictive signal wins."** The verdict is the worst of five independent risk
  signals, so a great temperature never hides a hazardous AQI or an active storm warning.
- **Dog vulnerability shifts thresholds, doesn't gate.** Every dog gets a verdict; vulnerable
  dogs (brachycephalic, senior/puppy, obese, double-coat, respiratory/cardiac conditions)
  cross into yellow/red at lower temperatures — the core differentiator versus a plain
  weather app.
- **Informational, not veterinary advice.** A persistent disclaimer + an onboarding
  acknowledgement; this is a safety-relevant pet app and must not present as clinical advice.

## 9. Open Questions / Risks

| Item | Risk | Mitigation |
|---|---|---|
| Pavement-temp model accuracy | Estimated, not measured; could over/under-warn | Calibrated to published data; shown as an estimate; 7-second test always recommended; M3 field-check tunes coefficients; show a ± band, not a false-precise number |
| iOS background-fetch is opportunistic | OS may not run the refresh task on schedule → stale notifications | Schedule a full day of notifications on each app open (not reliant on background run); document the limitation; Phase 2 server-push for guaranteed delivery |
| iOS local-notification limits | iOS caps ~64 pending scheduled notifications | Schedule only the next 24 h of windows/alerts; coalesce |
| NWS US-only | App is useless outside the US | Acceptable for a US personal app; detect non-US lat/lon and show a clear "US-only in v1" message |
| NWS rate/availability (403, outages) | Forecast fetch fails | Required `User-Agent`; exponential backoff; show last cached verdict with a "stale" badge; degrade gracefully |
| AQI station/model gaps | Missing AQI for a location | Open-Meteo always returns a modeled value; if absent, drop the AQI signal rather than block the verdict |
| Liability of a safety recommendation | A wrong "green" could contribute to harm | Conservative thresholds; disclaimer + onboarding acknowledgement; never claim certainty; recommend owner judgment + the 7-second test |
| Dog risk model is heuristic | Weights are expert-informed, not validated on outcomes | Document as v1 heuristics with citations; keep weights in one tunable table (Appendix D); revisit with feedback |
| Embedded contact in NWS User-Agent | Minor; an email in the client binary | Use a project contact address, not personal; documented |
| Open-Meteo free tier is non-commercial | If the app is ever sold/monetized, the free Open-Meteo tier's terms may not cover it | Fine for a personal/free app; if commercialized, switch AQI to EPA AirNow (key behind a proxy) or Open-Meteo's paid plan — the `data/airQuality.ts` adapter seam already supports the swap |
| Dog profile privacy | Profile is personal data | Profile + settings never leave the device; only lat/lon is sent to NWS/Open-Meteo. Never log profile contents. |

## 10. How to Run

```powershell
# Prereqs: Node 20 LTS, then the Expo CLI is invoked via npx (no global install needed).
cd c:\Users\abero\dev\walkies
npm install
npx expo start                 # opens the dev server + QR code
```

Then on the phone: install **Expo Go** (App Store / Play Store), open the camera (iOS) or
Expo Go's scanner, scan the QR — the app loads live. Code changes hot-reload on the phone.

```powershell
npm test            # Jest unit + component tests
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
```

First launch: grant location permission, complete the one-time dog profile, land on the
verdict screen.

## 11. Development Process

Built with `/build-phase` walking the Automated Steps below, each via `/build-step` with
`--reviewers code` (the 4-agent code-review gauntlet + typecheck/lint/test gates).
**Runtime/Playwright reviewers do not apply** — this is a native mobile app, not a web URL,
so visual/device verification is handled by the Manual Steps (Expo Go on a real phone) after
the automated steps complete. Default isolation `worktree`.

The domain core (Step 2) is pure and gets the deepest unit tests, asserted against the
published calibration data in the appendices. A **smoke gate** (Step 7) wires the real APIs
to the real domain core once, end-to-end, to catch producer→consumer drift that mocked unit
tests can't see. The **notification/observation soak** (M2) runs the background+notification
path over a real day — the end-to-end observation this app's always-on behavior requires.

### Automated Steps
(These run unattended via `/build-phase`.)

### Step 1: Project scaffold
- **Problem:** Initialize the Expo + TypeScript app: expo-router skeleton (Home/Profile/
  Settings routes), strict `tsconfig`, ESLint/Prettier, Jest + React Native Testing Library,
  AsyncStorage, and `package.json` scripts (`start`/`test`/`lint`/`typecheck`). Configure
  `app.json` name "Can I Walk My Dog?", bundle id, and location/notification permission
  strings.
- **Type:** code
- **Issue:** #
- **Flags:** --reviewers code --isolation worktree
- **Produces:** Bootable Expo app skeleton, passing placeholder test, green typecheck/lint.
- **Done when:** `npx expo start` boots without error; `npm test`, `npm run typecheck`,
  `npm run lint` all pass.
- **Depends on:** none

### Step 2: Domain core — verdict engine (pure)
- **Problem:** Implement `src/domain/`: `heatIndex.ts` (Rothfusz, Appendix C),
  `sunPosition.ts`, `pavement.ts` (Appendix B calibration), `dogRisk.ts` (Appendix D),
  `verdict.ts` (5-signal engine, Appendix E), `windows.ts`, and shared `types.ts`. No
  network, no RN, no storage.
- **Type:** code
- **Issue:** #
- **Flags:** --reviewers code --isolation worktree
- **Produces:** Pure domain library + exhaustive unit tests.
- **Done when:** Unit tests pass **including calibration assertions**: heat-index test
  vectors match NWS examples within ±1°F; pavement model yields ~125°F for 77°F air in full
  clear-noon sun on asphalt (±5°F); a brachycephalic senior reaches `red` at a strictly
  lower air temp than a healthy adult for identical weather; "most restrictive signal wins"
  is verified (e.g., good temp + AQI 175 → red).
- **Depends on:** 1

### Step 3: Weather + air-quality data layer
- **Problem:** Implement `src/data/nws.ts` (points→hourly, gridpoint `skyCover`, active
  alerts; required `User-Agent` header), `src/data/airQuality.ts` (Open-Meteo `us_aqi`, with
  an AirNow adapter stub), `src/data/cache.ts` (TTL cache + last-verdict persistence), and
  `src/data/location.ts` (expo-location permission + lat/lon). Map raw JSON → `types.ts`.
  Handle timeouts, HTTP 403, non-US coordinates, and missing AQI gracefully.
- **Type:** code
- **Issue:** #
- **Flags:** --reviewers code --isolation worktree
- **Produces:** Typed data clients with recorded-fixture tests.
- **Done when:** Tests pass against captured NWS + Open-Meteo fixture responses; empty-AQI,
  NWS-403, network-timeout, and non-US-lat/lon paths each degrade without throwing.
- **Depends on:** 1, 2

### Step 4: Dog profile + storage
- **Problem:** Implement `src/storage/profile.ts` + `settings.ts` (parse-guarded, versioned
  keys) and the `features/profile/` onboarding/edit form: breed picker from the Appendix A
  seed list (auto-fills brachycephalic/coat/size characteristics) with a "custom" path,
  plus age, sex/neuter, weight + body-condition, coat, and health-condition toggles.
- **Type:** code
- **Issue:** #
- **Flags:** --reviewers code --isolation worktree
- **Produces:** Persisted `DogProfile`, profile form UI, breed seed JSON.
- **Done when:** Saving a profile and reloading the app restores it (storage unit test);
  selecting "French Bulldog" auto-sets brachycephalic=true (component test); corrupt stored
  JSON re-onboards instead of crashing.
- **Depends on:** 1, 2

### Step 5: Home verdict screen
- **Problem:** Wire `location → data → domain` into `features/home/`: a large 🟢/🟡/🔴
  `VerdictCard`, estimated pavement temp (with the 7-second-test note), recommended max
  duration, the binding reasons, an alerts list, and the "better windows today" strip.
  Implement loading, error, stale-cache, and location-permission-denied states.
- **Type:** code
- **Issue:** #
- **Flags:** --reviewers code --isolation worktree
- **Produces:** Functional Home screen rendering real verdicts from live data.
- **Done when:** Component tests render green/yellow/red, stale, error, and permission-denied
  states from mocked inputs; the screen reaches the real domain engine (not a stub). Device
  check deferred to M1.
- **Depends on:** 2, 3, 4

### Step 6: Local notifications + best-windows scheduling
- **Problem:** Implement `src/notifications/schedule.ts` (build notification payloads from
  best windows + active alerts) and `backgroundTask.ts` (expo-background-fetch task that
  refetches and reschedules, best-effort). Add the notification permission flow and a
  Settings opt-in. Cap scheduling to the next 24 h (≤ iOS pending-notification limit).
  **Reschedule idempotently:** every reschedule (foreground open *or* background-fetch run)
  must `cancelAllScheduledNotificationsAsync()` first, then re-schedule the current set — so
  the two trigger paths can never stack duplicate notifications for the same window.
- **Type:** code
- **Issue:** #
- **Flags:** --reviewers code --isolation worktree
- **Produces:** Scheduling logic + registered background task + permission flow.
- **Done when:** Unit tests cover window→notification payload building and the 24h/limit cap;
  rescheduling twice in a row yields the same pending set (no duplicates); the background
  task registers without error; opting out cancels all pending notifications.
- **Depends on:** 2, 3, 5

### Step 7: Settings, units, and safety disclaimer
- **Problem:** Implement `features/settings/`: °F/°C (and mi/km) toggle threaded through the
  domain formatting, default walk-surface selector, notifications opt-in, a data-source/
  attribution section (NWS + Open-Meteo), and the persistent **"informational, not
  veterinary advice"** disclaimer plus a one-time onboarding acknowledgement.
- **Type:** code
- **Issue:** #
- **Flags:** --reviewers code --isolation worktree
- **Produces:** Settings screen, units plumbing, disclaimer + acknowledgement gate.
- **Done when:** Component tests verify the units toggle changes displayed values; the
  disclaimer acknowledgement persists and gates first use.
- **Depends on:** 5

### Step 8: Pipeline smoke gate (real APIs → real verdict)
- **Problem:** Add a headless end-to-end script/test that, for a fixed real lat/lon, calls
  the **live** NWS + Open-Meteo clients, runs the result through the real domain core, and
  asserts a well-formed `Verdict` (level ∈ {green,yellow,red}, finite `pavementTempF`,
  non-empty `reasons`) with **no exception**. Network-gated so it's skipped offline/in CI
  without network. This is the producer→consumer drift catch, distinct from the mocked unit
  tests.
- **Type:** code
- **Issue:** #
- **Flags:** --reviewers code --isolation worktree
- **Produces:** One-shot live-pipeline smoke test + npm script `npm run smoke`.
- **Done when:** `npm run smoke` completes one real cycle and prints a valid verdict without
  crashing; assertion failures name the offending field.
- **Depends on:** 2, 3

### Manual Steps
(These run after `/build-phase` completes. Operator drives, on a real phone via Expo Go.)

### Step M1: Device smoke on Expo Go
- **Source step:** Steps 4, 5, 7 (UI surfaces)
- **Issue:** #
- **Commands:**
  ```powershell
  cd c:\Users\abero\dev\walkies
  npx expo start
  # Scan the QR with Expo Go on the phone.
  ```
- **What to look for:**
  | Check | Expected outcome |
  |---|---|
  | Location permission prompt appears, then a verdict renders | A 🟢/🟡/🔴 card for the real current location |
  | Estimated pavement temp + 7-second-test note shown | Plausible value (e.g., warmer than air in sun) with the field-test reminder |
  | Edit dog profile → "French Bulldog", age 10 | Verdict becomes stricter than for a young healthy mixed-breed in identical weather |
  | Best-windows strip | Shows later safe time(s) when current is yellow/red, or "good all day" when green |
  | Active NWS alert (if any in area) | Alert row appears with the event name |
  | Disclaimer acknowledgement | Appears once on first run, persists after |

### Step M2: Notification + background soak (end-to-end observation)
- **Source step:** Step 6
- **Issue:** #
- **Type:** wait (run across part of a real day)
- **Commands:**
  ```powershell
  cd c:\Users\abero\dev\walkies
  npx expo start
  # On the phone: enable notifications; set a vulnerable dog profile (e.g., senior bulldog);
  # leave the app backgrounded. To force a near-term test, temporarily set a window a few
  # minutes out (or use a warm-location override) and confirm the notification fires.
  ```
- **What to look for:**
  | Check | Expected outcome |
  |---|---|
  | Safe-window notification fires at the scheduled time | Notification arrives with the correct window text |
  | Heat/cold/AQI alert notification (if conditions warrant) | Fires with the correct event/severity |
  | App reopened later | Notifications rescheduled; no duplicates; no crash |
  | Opt out of notifications | All pending notifications cancelled |
  | Left backgrounded for hours | Best-effort background refresh either updated or (acceptably) left the day's schedule intact |

### Step M3: Pavement-temperature field calibration
- **Source step:** Step 2 (`pavement.ts`)
- **Issue:** #
- **Commands:**
  ```powershell
  # No commands — physical measurement. Record findings under documentation/field-checks/.
  ```
- **What to look for:**
  | Check | Expected outcome |
  |---|---|
  | Compare app estimate to a real surface (IR thermometer or 7-second test) on sunny asphalt | App estimate within a sensible band of reality; note over/under-estimate |
  | Same time, shaded grass | App estimate much lower; matches the qualitative reality |
  | If estimates are systematically off | File a tuning issue to adjust `asphaltFullSunDelta` / `cloudFactor`; record before/after in `documentation/field-checks/` |

**Please run M1 next** once the Automated Steps complete.

## 12. Appendix

### Appendix A — DogProfile schema + breed seed

```ts
type Surface = 'asphalt' | 'concrete' | 'grass';
type Coat = 'short' | 'medium' | 'double_thick';
type Size = 'small' | 'medium' | 'large' | 'giant';   // <10kg / 10–25 / 25–45 / >45 kg

interface DogProfile {
  name: string;
  breed: string;              // from seed list or "custom"
  brachycephalic: boolean;    // flat-faced; auto-set from breed, user-overridable
  ageMonths: number;          // puppy <6 mo, senior >=84 mo (7 yr)
  size: Size;
  bodyCondition: 'under' | 'ideal' | 'overweight' | 'obese';
  coat: Coat;
  darkCoat: boolean;          // minor factor (weak evidence)
  conditions: Array<'respiratory' | 'cardiac' | 'laryngeal_paralysis' | 'tracheal_collapse' | 'none'>;
  schemaVersion: 1;
}
```

**Breed seed (auto-fills brachycephalic / coat / size; user can override).** Brachycephalic
TRUE: English Bulldog, French Bulldog, Pug, Boston Terrier, Boxer, Shih Tzu, Pekingese,
Cavalier King Charles Spaniel, Chow Chow (also double-coat), Lhasa Apso, Brussels Griffon.
Double-coat TRUE: Siberian Husky, Alaskan Malamute, Chow Chow, Golden Retriever, Collie,
German Shepherd, Samoyed, Bernese Mountain Dog (also giant). Plus common non-brachy breeds
(Labrador, mixed-breed/other) defaulting to short/medium coat. "Custom/Other" → user sets
the characteristic toggles directly. *(Source: RVC VetCompass; AKC breed groupings.)*

### Appendix B — External API contracts (verbatim)

**NWS (`https://api.weather.gov`), keyless. Required header:**
`User-Agent: (CanIWalkMyDog, <project-contact-email>)` — omitting it returns HTTP 403.
Fair use ~1–2 requests/min is fine.

1. `GET /points/{lat},{lon}` → `properties.gridId` (WFO), `properties.gridX`,
   `properties.gridY`, `properties.forecastHourly`, `properties.forecastGridData`.
   *(Cache 24 h.)*
2. `GET /gridpoints/{gridId}/{gridX},{gridY}/forecast/hourly` → `properties.periods[]` with:
   `startTime`, `endTime`, `isDaytime`, `temperature`, `temperatureUnit` ("F"),
   `relativeHumidity.value` (%), `dewpoint.value`, `windSpeed` (string e.g. "5 mph"),
   `probabilityOfPrecipitation.value` (0–100), `shortForecast`. *(humidity/dewpoint exist in
   `/forecast/hourly` and `forecastGridData` but were removed from the 12-hour `/forecast` on
   2024-06-20 — use the hourly endpoint.)*
3. `GET /gridpoints/{gridId}/{gridX},{gridY}` → `properties.skyCover` time-series
   (`values[]` of `{validTime, value}` %, 0–100). **No solar-radiation field exists** — use
   `skyCover` + `isDaytime` + computed sun elevation as the sun-exposure proxy.
4. `GET /alerts/active?point={lat},{lon}` → GeoJSON `features[].properties`: `event`,
   `severity`, `headline`, `onset`, `ends`, `description`. Relevant `event` values:
   *Extreme Heat Warning*, *Extreme Heat Watch*, *Heat Advisory*, *Extreme Cold Warning*,
   *Cold Weather Advisory*, *Wind Chill Advisory*, *Winter Storm Warning*, *Blizzard
   Warning*, *Ice Storm Warning*, *High Wind Warning*, *Wind Advisory*, *Air Quality Alert*,
   *Air Stagnation Advisory*, *Dense Smoke Advisory*, *Red Flag Warning*.

**Open-Meteo Air Quality (keyless, US AQI):**
`GET https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&current=us_aqi,pm2_5,pm10,ozone`
→ `current.us_aqi` (US EPA AQI 0–500+), `current.pm2_5`, `current.pm10`, `current.ozone`
(µg/m³). Always returns a modeled value (no station gaps).

**EPA AirNow (optional later upgrade, requires free key):**
`GET https://api.airnowapi.org/observation/latLong/current/?latitude={lat}&longitude={lon}&format=application/json&distance=25&API_KEY={key}`
→ array of `{ AQI, Category.Number (1–6), Category.Name, ParameterName (O3/PM2.5/PM10),
DateObserved, ReportingArea }`. US-only, station-based (rural gaps → empty result).

### Appendix C — Heat Index (NWS Rothfusz regression)

T = air temp °F, RH = relative humidity %. *(Source: NWS WPC
wpc.ncep.noaa.gov/html/heatindex_equation.shtml.)*

First compute the simple form:
```
HI_simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094)
```
If the average of `HI_simple` and `T` is < 80°F, use `HI_simple`. Otherwise use the full
regression:
```
HI = -42.379 + 2.04901523*T + 10.14333127*RH - 0.22475541*T*RH
     - 0.00683783*T*T - 0.05481717*RH*RH + 0.00122874*T*T*RH
     + 0.00085282*T*RH*RH - 0.00000199*T*T*RH*RH
```
Adjustments:
- If `RH < 13` and `80 <= T <= 112`:
  `HI -= ((13 - RH) / 4) * sqrt((17 - abs(T - 95)) / 17)`
- If `RH > 85` and `80 <= T <= 87`:
  `HI += ((RH - 85) / 10) * ((87 - T) / 5)`

### Appendix D — Dog vulnerability scoring (v1 heuristic, tunable)

Additive points (one source of truth; all weights in `dogRisk.ts`). *(Sources: RVC
VetCompass 2016 odds ratios — Chow Chow 17×, Bulldog 14×, French Bulldog 6×, Pug 3×;
AVMA/AAHA warm-weather guidance; Moritz & Henriques burn thresholds.)*

| Factor | Points |
|---|---|
| Brachycephalic | +3 |
| Senior (≥7 yr) or puppy (<6 mo) | +2 |
| Respiratory/cardiac/laryngeal/tracheal condition | +3 |
| Obese | +2 / Overweight | +1 |
| Double/thick coat | +2 |
| Giant size | +1 / Large | +0.5 |
| Dark coat (minor) | +0.5 |

`heatOffsetF = min(totalPoints, 8) * 1.5`  → subtract from the heat-stress bands below
(cap ≈ 12°F). `respiratorySensitive = (brachycephalic || respiratory/cardiac condition)` →
tightens AQI bands (≥101 becomes red).

### Appendix E — Verdict thresholds (v1, healthy-adult baseline; shifted by Appendix D)

Headline verdict = **most restrictive** of these five signals.

1. **Pavement burn (asphalt estimate):** `<115°F` green · `115–124°F` yellow · `≥125°F` red.
   *(125°F damages skin in ~60 s — Moritz & Henriques.)* Always append the 7-second-test note.
2. **Heat stress (heat index, then subtract `heatOffsetF`):** `<75` green · `75–84` yellow ·
   `85–89` high (yellow→red for any vulnerable dog) · `≥90` red. Quick backstop: if
   `airTempF + RH ≥ 150`, force at least yellow (red for vulnerable dogs).
3. **Air quality (US AQI):** `<100` green · `100–150` yellow (red if `respiratorySensitive`)
   · `>150` red.
4. **Cold:** `>32°F` green · `20–32°F` yellow for small or short-coat dogs · `<20°F` (or any
   active Extreme Cold Warning) red for small/short-coat, yellow otherwise.
5. **Active NWS alert:** Warning-class heat/cold/wind/winter/air → red; Advisory-class →
   yellow; any thunderstorm/tornado/severe → red (don't walk in lightning).

`recommendedMaxMinutes`: green → 30–60; yellow → 10–15 (shade/grass); red → 0 (potty-break
only). Reasons list names the binding signal(s) in plain language, e.g. *"For your 10-year-old
French Bulldog, the heat index (88°F) is unsafe — wait for a cooler window."*
