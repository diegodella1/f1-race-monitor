<p align="center">
  <img src="docs/hero.svg" alt="F1 Race Monitor — a local-first pitwall for F1 25" width="100%" />
</p>

<h1 align="center">F1 Race Monitor</h1>

<p align="center">
  A local-first race engineer for EA SPORTS F1 25.<br />
  Live timing, strategy, race radio and car health — built for a phone or tablet beside the wheel.
</p>

<p align="center">
  <a href="https://github.com/diegodella1/f1-race-monitor/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/diegodella1/f1-race-monitor/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-5FA04E?logo=nodedotjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" />
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-00D2BE" />
  <img alt="Local first" src="https://img.shields.io/badge/cloud-optional-111827" />
</p>

F1 Race Monitor turns the UDP telemetry already produced by F1 25 into a compact pitwall. It follows the cars around you, estimates gap trends and pit outcomes, tracks tyres and damage, and speaks only the message that matters next.

No account or API key required. Sessions stay on the machine running the server; cloud hosting is optional.

Live deployment: [f12025.diegodella.ar](https://f12025.diegodella.ar). See the [deployment runbook](deploy/README.md) and [release history](CHANGELOG.md).

## Why it exists

The default HUD tells you what is happening. A race engineer should help you decide what to do about it.

- **Who matters now:** the car ahead, the car behind, their compounds and the direction of both gaps.
- **One priority:** attack, defend, manage, box or stay safe — never a wall of equally urgent cards.
- **Useful strategy:** pit-window calls, projected rejoin range, undercut/overcut signals and mandatory dry-compound awareness.
- **Quiet radio:** deterministic cooldowns and per-lap limits suppress late, obvious and repetitive messages.
- **Real car state:** wing, floor, sidepod, gearbox, engine, temperatures and tyre wear.
- **Every session type:** tailored views for practice, qualifying and race.

## Current release: V2.8 — English Radio and Live Delivery

| Area | What you get |
| --- | --- |
| Pitwall | Race mode, priority action, target lap, rivals and compact trend history |
| Timing | Position, interval, gap, lap time, sectors, compound and team identity |
| Strategy | Stint degradation, pit-loss estimate, rejoin range and next-lap box calls |
| Race radio | English-only browser speech, rotating concise phrases and local voice preference |
| Analysis | Per-lap traces, driving summaries and filterable radio delivery history |
| Reliability | Pause tolerance, WAITING/CONNECTED state and persisted session decisions |
| Telemetry trust | Live health score, packet freshness and confidence-aware tactical calls |
| Replay | Two-second session frames, enriched decision logs and accelerated offline analysis |
| Proactive engineer | Decision scoring, message families, NOW/NEXT actions and quiet-race outlooks |
| Decision memory | Persistent damage becomes known context, respects a no-repair stop and only interrupts again when it escalates |
| Race narrative | One final-lap call, a chequered-flag message when telemetry confirms the finish and a persisted session summary |
| Radio delivery | Active race follow-up, context-aware queue and per-device delivery history in Analysis |
| Rival policy | Stable multi-lap trends, actionable gap bands and reset-safe calls when the rival changes |
| Race Control | Normalized collisions and retirements, with voice reserved for the player and immediate rivals |
| Strategy guardrails | Suppressed routine terminal-lap box calls, stronger degradation evidence and short-lived tactical opportunity latching |
| Adaptive layout | Dedicated race, qualifying and practice workspaces with separate tablet and desktop compositions |

## Quick start

### Requirements

- Node.js 22 or newer
- EA SPORTS F1 25 on PlayStation, Xbox or PC
- The game device and this computer on the same local network

### Run in development

```bash
git clone https://github.com/diegodella1/f1-race-monitor.git
cd f1-race-monitor
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). For a phone or tablet, use this computer’s LAN IP with port `5173`. Vite proxies API and Socket.IO requests to the backend on port `3000`.

### Run the production build

```bash
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000), or the LAN address shown in Settings. `PORT` changes the production HTTP port; `UDP_PORT` changes the default telemetry port. The hosted deployment uses HTTP port `3469`.

### Try it without a console

Open **Settings** and enable **Demo mode**. A simulated race immediately feeds every screen, so you can evaluate the dashboard and radio before configuring telemetry.

## Connect F1 25

In the game, open **Settings → Telemetry Settings** and use:

| Setting | Value |
| --- | --- |
| UDP Telemetry | On |
| UDP Broadcast Mode | Off |
| UDP IP Address | The LAN IP shown by F1 Race Monitor |
| UDP Port | `20777` by default |
| UDP Send Rate | 20 Hz |
| UDP Format | 2026 |

The app deliberately ignores self-assigned `169.254.x.x` interfaces and prefers private `192.168.x.x`, `10.x.x.x` or `172.16–31.x.x` addresses.

## The five screens

- **Pit Wall** — an adaptive race, qualifying or practice workspace with one immediate action.
- **Timing** — a scan-friendly classification with lap, gap, interval, sectors, tyres and team colour.
- **Car** — live controls, energy, four-wheel temperatures and wear, damage and component health.
- **Analysis** — lap-by-lap traces, driving comparisons and radio history filtered by session, device, lap, category and status.
- **Settings** — connection health, LAN QR, UDP configuration, demo mode and radio preferences.

## How it works

```mermaid
flowchart LR
    A[F1 25<br/>PlayStation · Xbox · PC] -->|UDP 2026| B[Packet parser]
    B --> C[Normalized RaceState]
    C --> D[Coach + strategy engine]
    D --> E[Socket.IO]
    E --> F[React pitwall]
    D --> G[(Local SQLite)]
    E --> H[Browser race radio]
```

The backend validates F1 25 packets, normalizes partial updates into one `RaceState` and streams the latest state through Socket.IO at up to 10 Hz. Modern clients acknowledge each frame; only one frame per client is in flight, avoiding a backlog on slow connections. UDP parsing and engine evaluation still run at their normal cadence. The coaching and strategy layers are deterministic: every recommendation can be traced back to current telemetry and recent history. SQLite stores local sessions, laps, alerts and decision logs.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Backend and Vite frontend with live reload |
| `npm test` | Parser, persistence, radio, coaching and strategy tests |
| `npm run check` | Type-check backend and frontend |
| `npm run build` | Create production frontend and backend builds |
| `npm start` | Serve the production build |
| `npm run replay -- --session 12` | Re-run the engineer against a saved session |

See [active engineer and delivery history](docs/active-engineer.md) for radio behavior, APIs and read-only replay.

Saved-session diagnostics are also available through `/api/sessions/:id/report`, `/api/sessions/:id/decisions`, `/api/sessions/:id/replay` and `/api/sessions/:id/radio`.

## Privacy and scope

Telemetry and session history are written only to `data/` on the machine running the app. That directory, SQLite files, logs, environment files and build outputs are excluded from Git.

This project does not use an LLM, speech recognition, external telemetry service or cloud database. Voice output uses the browser's built-in speech synthesis. Automatic selection prefers a local English voice; availability depends on the browser and operating system, and remote voices may use their provider’s service.

Enable radio from the browser with a user gesture. Refresh existing tabs after upgrading. Analysis separates queue delay from speech-engine startup; STARTED/COMPLETED callbacks do not prove that sound was audible. See [radio behavior and diagnostics](docs/active-engineer.md).

A public deployment exposes the dashboard and its APIs through the configured hostname. Session data remains in server-side SQLite.

## Roadmap

The [Brazil session review](docs/brazil-session-5-review.md) documents the baseline and the evidence behind these priorities. These improvements are still pending:

- Stabilize thermal mode changes with sustained evidence and separate entry/exit thresholds
- Improve rejoin confidence when several rivals stop together
- Validate finish/classification handling with complete end-of-race recordings
- Add factual post-push and stint feedback from comparable laps

- More circuit-aware corner coaching built from lap deltas
- Stronger safety-car and mixed-weather strategy models
- Session comparison and export
- Broader validation against real F1 25 packet captures
- Installable desktop/mobile packaging

Ideas and packet captures with personal data removed are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

This is an independent, unofficial community project. It is not affiliated with or endorsed by Formula 1, the FIA, Electronic Arts or Codemasters. All trademarks belong to their respective owners.

## License

[MIT](LICENSE)
