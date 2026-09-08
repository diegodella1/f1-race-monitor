# Changelog

## 3.0.0 — 2026-09-08

- Require private device pairing, secure cookies and exact-origin checks for APIs
  and live sockets. Add revocation, request/connection limits and self-hosted fonts.
- Reject malformed/unsupported UDP layouts, lock the telemetry source and handle
  out-of-order frames and explicit flashbacks without false healthy readings.
- Recover missing stream ACKs and show stale data independently of game pause.
- Use local English speech only; retry essential failures once and expose audio
  problems. Test/repeat share the queue and tabs coordinate ownership.
- Add foreground Android driving mode, screen wake lock and an English interface.
- Apply settings explicitly and validate ports before replacing the source.
- Move persistence to a worker with transactions, prepared statements, bounded
  queues and terminal snapshot deduplication. Add paginated history and export.
- Add fault-injection regressions, HTTPS phone/tablet browser tests and an isolated
  sustained-load harness. Real-device audio and wet-race calibration remain manual
  acceptance steps; synthesized callbacks cannot prove audible output.

Breaking change: HTTP-only/unpaired clients cannot read or control the dashboard.
Run `npm run pair` on the server to enroll devices.

## 2.9.0 — 2026-09-08

- Retain penalties and warnings in a dedicated radio queue, correlate PENA events
  with lap counters, and show current race-control totals on the pitwall.
- Handle pause, flashback, repeated sanctions and interruption without silently
  replacing relevant notices. Add a regression from the Bahrain recording.
- Announce confirmed weather changes and rain forecasts with time and probability.
- Recommend slicks, intermediates or full wets using comparable rival pace and
  estimated net benefit after pit loss. Cancel stale or neutralized weather calls.
- Add a weather panel and decision history; reset obsolete pace and corner
  references through weather transitions.
- Correct dry-compound compliance: rain alone does not waive the requirement.
- Preserve rival lap quality through participant refreshes.
- Validate 111 tests, frontend/backend types and production builds. Wet-weather
  scenarios are synthetic; calibration with a real wet race remains pending.
- Keep existing snapshots readable without a schema migration.

## 2.8.0 — 2026-09-07

- Keep radio in English, prefer local English voices automatically, and rotate
  shorter phrases without changing the facts of an already selected event.
- Speak target laps to tenths and shorten recurring race balances and battle calls.
- Limit dashboard streaming to 10 Hz with one acknowledged frame in flight per
  modern client. Replace intermediate states instead of accumulating a backlog.
- Record DEFERRED and SUBMITTED events to distinguish queue delay from speech
  startup. Recover from missing speech callbacks with bounded timeouts.
- Check the queue every 100 ms and confirm safe speaking windows for 500 ms.
- Add regression coverage for English copy, voice selection and slow clients.

The measured baseline and remaining work are documented in the
[Brazil session review](docs/brazil-session-5-review.md). A new real-race recording
is needed to quantify the improvement in audible latency.

## 2.7.0 — 2026-09-07

- Add active race follow-up, post-stop push phases and context-aware radio
  scheduling with critical interruption and stale-message expiry.
- Persist per-device delivery events with idempotent ingestion and bounded client
  retries. Add filterable radio history to Analysis.
- Correct immediate rejoin assumptions, separate pit-lane duration from net pit
  loss, and suppress stale rival predictions in close battles.
- Keep persistent damage as known context while allowing escalation to interrupt.
- Make saved-session replay read-only and add focused Spa regression fixtures.
- Document the systemd and Cloudflare deployment.

## 2.6.0

Previous published baseline: race engineer narrative, decision memory,
telemetry-aware recommendations and persisted session analysis.
