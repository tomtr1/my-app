# Lifedash — your day in one place

A personal life dashboard for **iPhone** and **Windows**, built from **one codebase**.
It runs entirely on your own device: no account, no backend, no tracking, and no
Claude or other AI service at runtime. External APIs are only called with **your own keys**,
and most of the data sources need no key at all.

| Tab | What it does | Data source |
|---|---|---|
| **Today** (home) | Greeting, KPI tiles, recovery ring (WHOOP-style), steps and calories bars, **“Your plan for today”** hints, agenda with prep chips, weather, quick actions, top news | everything below |
| **Fitness** | Recovery/readiness, live-ish heart rate, steps, sleep stages, HRV, resting HR, Body Battery, stress, SpO₂, VO₂max, 7/28-day trends, weekly insights, activities | Garmin, WHOOP, Apple Health |
| **Calendar** | All calendars merged, a 14-day strip, per-event prep (leave-by time, weather at the venue, things to bring), proactive alerts | iCal links, iPhone calendars (EventKit) |
| **WhatsApp** | WhatsApp Web embedded in its own persistent session, with the unread badge in the sidebar | web.whatsapp.com |
| **Nutrition** | Yazio-style diary: **meal photo → dishes, portions, kcal and macros → confirm**, barcode scan, food search, manual entry, water, goals, 7-day chart | Open Food Facts + your vision model |
| **News** | Personalised feed, cross-source de-duplication, an **“important only”** filter, read-later list | RSS/Atom, Google News RSS, optional GNews |
| **Weather** | Current conditions, 24 h and 7-day forecasts, animated **rain radar**, official **DWD severe-weather warnings**, several saved places | Open-Meteo, Bright Sky (DWD), RainViewer |
| **Apps & Mail** | Gmail, Outlook, Notion or any https web app as an embedded “mini-app”, each with its own isolated login | the sites themselves |

---

## 1. Tech stack and why

**React + TypeScript + Vite** for the whole UI, packaged as:

- **Windows → Tauri 2** (Rust + WebView2). The installer is about 10 MB instead of Electron's 150 MB. Tauri provides real child webviews for embedding WhatsApp and mail, a tray icon, autostart, Credential Manager access, and a Rust HTTP stack. The Rust HTTP stack runs the Garmin sign-in, which can't be done from a browser because of cookies and CORS.
- **iPhone → Capacitor 8** (WKWebView + Swift). HealthKit, EventKit, local notifications, Background Runner and Keychain are all first-class here. The small native parts live in **one first-party Swift plugin** (`ios/App/App/LifeNativePlugin.swift`) rather than many third-party plugins.

**Why not Flutter?** Two of the eight tabs are *embedded websites* (WhatsApp Web, mail). Webviews are where Flutter is weakest and the web stack is strongest. The dashboard UI is mostly cards, charts and lists, so a web UI looks and feels native. React lets 95 % of the code be shared, and the platform differences sit in `src/platform/*`.

```
src/
  platform/   http · secure (keystore) · storage (encrypted DB) · notify · miniapp · oauth · native (Swift bindings)
  services/   weather · calendar · news · garmin · whoop · applehealth · fitness · nutrition · hints · planner · sync
  store/      settings · app state (zustand) · unread counts
  tabs/       Today · Fitness · Calendar · Nutrition · News · Weather · Apps · Settings · Onboarding
  ui/         design kit · charts · icons
src-tauri/    Windows shell: secrets.rs · garmin.rs · miniapp.rs · tray/autostart (lib.rs)
ios/App/App/  LifeNativePlugin.swift (HealthKit, EventKit, WKWebView mini-apps) · Info.plist · entitlements
```

## 2. Getting started

Prerequisites: Node 22+. For Windows builds you also need Rust (stable) and the WebView2 runtime, which Windows 11 already has. For iOS you need a Mac with Xcode 16+.

```bash
npm install
npm run dev          # browser preview at http://localhost:5173 (dev proxy handles CORS)
npm test             # 29 unit tests (hints, ICS, news clustering, readiness, crypto, …)
```

### Windows

```bash
npm run win:dev      # run the desktop app
npm run win:build    # → src-tauri/target/release/bundle/{nsis,msi}/Lifedash_*.exe|msi
```

Closing the window sends Lifedash to the **tray**, so syncing and reminders keep running. Turn on *Settings → Start with Windows* to have it start in the tray at login.

### iPhone

```bash
npm run ios:sync     # build web app + copy into the Xcode project
npm run ios:open     # opens Xcode
```

In Xcode, pick your Team under *Signing & Capabilities*. The **HealthKit** capability and the background modes are already configured. Then run it on your iPhone. With a free Apple ID the app has to be re-installed every 7 days; a paid developer account removes that limit.

### CI

`.github/workflows/build.yml` builds the Windows installer and an unsigned iOS simulator build on GitHub's Windows and macOS runners. It only runs when you start it from the Actions tab (*Run workflow*).

## 3. API keys and accounts (all optional, all stored in the OS keystore)

| What | Needed for | How to get it |
|---|---|---|
| — | Weather, radar, DWD warnings, geocoding, travel times, Open Food Facts, RSS | **No key.** Open-Meteo, Bright Sky, RainViewer, OSRM, Nominatim, OFF |
| iCal links | Google / Outlook / iCloud calendars | Google: calendar settings → *Secret address in iCal format*. Outlook: *Settings → Calendar → Shared calendars → Publish*. iCloud: share → *Public calendar*. **On iPhone just enable “iPhone calendars”.** |
| Garmin login | Garmin sync on Windows | Your normal Garmin Connect email and password, entered once. MFA is supported. |
| WHOOP Client ID/Secret | WHOOP recovery, strain, sleep, HRV | Free at **developer-dashboard.whoop.com** → create app → redirect URI `http://localhost:47823/callback` (Windows) and `lifedash://oauth/callback` (iPhone) |
| Vision model | Meal-photo recognition | **Ollama** (local, offline, free: `ollama pull qwen2.5vl:7b`) *or* your OpenAI / Gemini / Mistral / OpenRouter key. Any OpenAI-compatible endpoint works. |
| GNews key | Extra curated headlines (optional) | gnews.io (free tier) |

Keys are entered in **Settings** and saved straight into Windows Credential Manager or the iOS Keychain. Nothing is hard-coded, and no `.env` is needed.

## 4. How each integration works, and the honest limits

**Garmin (Windows), fully automatic.** Garmin's official Health API is only for approved companies, so Lifedash uses the same **mobile SSO flow as the Garmin Connect app**, as documented by the open-source `python-garminconnect` project:

- In 2026 Garmin broke the older `garth` login, so this is the current method.
- Sign-in runs in Rust (`src-tauri/src/garmin.rs`). The password is used once and never stored.
- The refresh token sits in Credential Manager and never reaches JavaScript.
- Data is polled every 15 min, and every 5 min while the Fitness tab is open.
- *Caveat:* this is an unofficial API. Garmin can change it, and Cloudflare sometimes rate-limits sign-ins. If that happens, wait and retry.

**Garmin and WHOOP on iPhone.** Turn on *Apple Health* sync in the Garmin Connect app and the WHOOP app. Lifedash then reads steps, HR, resting HR, HRV, sleep stages, SpO₂, VO₂max and workouts from HealthKit with zero setup. If two devices record the same night, only the source with the most sleep is used. Garmin-only metrics (Body Battery, stress) are not written to Apple Health, so on iPhone they show “–”.

**WHOOP** uses the **official Developer API v2** (OAuth 2.0 with refresh tokens) on both platforms.

**Readiness.** When WHOOP is connected, its recovery score is used. Otherwise Lifedash computes a transparent score: HRV vs your 28-day baseline (45 %), resting HR vs baseline (25 %) and sleep vs goal (30 %), nudged by Body Battery. The formula is in `services/fitness.ts`.

**“Live” heart rate.** Wearables upload when they sync with the phone, typically every few minutes to every 15 min. Lifedash polls frequently, but it can't be faster than the watch's own sync.

**Proactive notifications.**
- A **morning briefing** (weather, events, recovery and the most important hints) at a time you choose.
- **Before each event**: lead time plus travel time from home (OSRM), with the weather at that hour and things to bring. Bring-items come from the event's title and notes, e.g. “Bring: …” lines, gym → gym bag, doctor → insurance card, rain → umbrella.
- On iPhone these are OS-scheduled local notifications. A Background Runner task refreshes the forecast and re-schedules the briefing while the app is suspended.
- On Windows the tray app fires toasts.
- **Remote push (APNs) is intentionally not used.** It would need a server, which conflicts with the no-cloud requirement. Local notifications cover all the use cases.

**WhatsApp.** There is no official API for personal WhatsApp accounts. WhatsApp Web in an embedded, persistent webview is the realistic option:

- On **Windows** it is a real WebView2 laid inside the dashboard.
- On **iPhone** it opens as a full-screen in-app view with its own saved session.
- To link it: on WhatsApp Web choose **“Link with phone number”**, then on your phone go to *Linked devices → Link a device → Link with phone number instead*.
- Unread counts are read from the page title and shown as badges.
- An “unread chats on top” list or one-tap quick replies outside the WhatsApp UI would mean scripting WhatsApp's page. That is fragile and against WhatsApp's terms, so it is left out. You reply inside the embedded view.

**Mail and mini-apps.** Each app gets its own isolated, persistent browser profile. *Sign out* deletes it.
- Outlook works well.
- Google sometimes blocks sign-in inside embedded browsers (“This browser may not be secure”). If it does, use *Open in browser* once, or add Gmail via Outlook.

**Food photos.** The photo is downscaled to 1024 px and sent only to the endpoint you configured, or stays on your PC with Ollama. You always confirm or correct the items and grams before anything is saved. Fully on-device recognition on iPhone (Core ML) would be the next step.

## 5. Privacy & GDPR

- **Local-first.** All data lives in an SQLite DB on Windows or iOS and is **AES-256-GCM encrypted** before it is written.
- The 256-bit key is generated on first launch and stored in **Credential Manager / Keychain** (this-device-only).
- **No analytics, no telemetry, no third-party SDKs.** Network calls go only to the data sources listed above.
- *Settings → Privacy*: **Export** all data as JSON (Art. 20) and **Delete everything**, including keys and tokens (Art. 17).
- Health data never leaves the device. Meal photos only go to the vision endpoint you configure.
- Embedded web apps get **no access** to Lifedash's IPC or data.

## 6. Design

The visual language follows the reference screenshot and the best app for each job:

- **Today**: WHOOP's recovery hero and Google “At a Glance” style hints.
- **Fitness**: WHOOP and Garmin Connect.
- **Calendar**: Fantastical's day strip and agenda.
- **Nutrition**: Yazio's kcal ring, macro bars and meal sections.
- **News**: Feedly's reading list.
- **Weather**: CARROT and Apple Weather for range bars and the hourly strip.
- **Overall**: Linear and Arc for the calm dark chrome.

It is dark-first with a light theme, using system fonts and no external font or CDN. Mobile gets a bottom tab bar. Every view has skeleton loading, empty states, reduced-motion support and keyboard shortcuts on desktop (`1–8` switch tabs, `N` quick add, `R` refresh).

## 7. Status / verification

| | |
|---|---|
| Web app: typecheck + production build | ✅ |
| Unit tests (29, also under Europe/Berlin & America/Los_Angeles TZ) | ✅ |
| Rust/Tauri shell: `cargo check`, `cargo clippy` (no warnings), `cargo test` (3) | ✅ (on Linux) |
| Browser smoke test of all tabs, desktop + mobile, mocked network, no console errors | ✅ |
| Windows installer build | ▶ run the CI workflow or `npm run win:build` on Windows |
| iOS build (Swift plugin) | ▶ needs Xcode. **Not compiled yet**: the Swift code has not been through a compiler. Run the CI workflow or open in Xcode. |
| Live Garmin / WHOOP / Apple Health against real accounts | ▶ needs your accounts and devices |
