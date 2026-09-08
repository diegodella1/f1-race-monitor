# Private pitwall operations (3.0)

## Access and pairing

The dashboard uses `APP_ORIGIN` (default `https://f12025.diegodella.ar`).
All data APIs and Socket.IO connections require a paired device. The only public
application functions are the pairing screen and redemption of a one-time link.
The loopback health endpoint contains no telemetry or session data.

Run `npm run pair` on the server after building. Open the printed HTTPS link on
the tablet and choose a device name. Links expire after ten minutes and can be
used once. Their secret is in the URL fragment and is removed from the address
bar before redemption. Do not publish links or include them in Git.

Settings → Paired devices creates additional links and revokes devices. Cookies
are Secure, HttpOnly and SameSite=Strict, expire after thirty days, and are stored
as hashes in `data/devices.sqlite`. Revocation also closes that device's sockets.
Back up this database together with `data/f1-monitor.sqlite`. Historical race
snapshots require no conversion.

HTTPS is required even on the LAN. The production tunnel terminates HTTPS and
forwards to loopback port 3469. Forwarded protocol headers are trusted only from
loopback; never expose a proxy configuration that accepts arbitrary forwarded
headers from untrusted peers. Writes and socket handshakes require the exact
configured origin. CORS is not opened to third-party sites. Fonts are self-hosted.

Pairing is limited to five attempts per minute per source address; paired devices
are limited to 240 HTTP requests per minute. Socket limits are three per device
and twelve overall. `/api/diagnostics` returns counters and packet health, not raw
packet samples. No debug samples are stored in the periodic diagnostics file.

## Capture and persistence

Use UDP format 2026. Unsupported layouts are counted separately, and malformed
packets cannot refresh telemetry health. `TELEMETRY_SOURCE_IP` pins the game
device; without it the first valid source is locked until a source restart.
Packet frames reject duplicate and out-of-order updates. Explicit flashbacks
reset frame tracking, with a barrier against older pre-flashback packets.

Apply settings explicitly. The `SAVE SESSIONS` option does
not restart capture. A new UDP port must bind successfully before replacing the
current source. Demo changes intentionally start a new source/session.

SQLite runs in a worker. Prepared statements and transactions group saves;
terminal snapshots are idempotent. Pending snapshots from the same session can
coalesce while retaining their decision events. Queues have finite limits and
errors are exposed through `/api/operations`; a persistence failure does not stop
UDP reception. Diagnostics writes are asynchronous and run every five seconds.

Operations reports source errors, persistence queue/error state, connected clients
and event-loop p95. Treat storage errors as loss of recording capability until
resolved. Existing history is never deleted automatically. Analysis can export
frames, decisions and radio events, or explicitly delete a saved session. Active
sessions cannot be deleted.

## Stream and radio

Stream version 2 carries a lightweight race state and server time. Heavy lap
traces are fetched from `/api/analysis` only on the visible Analysis page. Missing
ACKs time out after two seconds and trigger a fresh stream; late ACKs cannot
release a newer frame. Idle heartbeats distinguish a connected browser from
missing game telemetry. The browser displays stale/disconnected data explicitly
and suspends speech until current data returns.

Radio uses local English voices only. Install an offline English voice in Android
Text-to-speech settings, reload, and test before driving. Test and repeat share
the normal speech controller; repeat requires a still-current instruction.
Only one tab per origin can own speech through the Web Locks API.

Essential failed calls retry once while still relevant. Another failure produces
`ATTENTION`, not `READY`. Security/safety calls precede sanctions, weather boxes,
warnings and ordinary advice; queued warnings can be combined into current totals.
The delivery outbox has a five-second request timeout, bounded exponential retry
and per-event results (`accepted`, `retry`, `rejected`). An unknown session is a
permanent rejection, so it cannot block later deliveries.

Driving mode requests a screen wake lock and reacquires it when the page becomes
visible. Android may deny/release the lock. This is a foreground web application:
background or screen-locked audio is not guaranteed. Browser speech callbacks do
not establish that audio was audible; validate that on the actual tablet.

## Validation and recovery

`npm test` includes auth, packet, stream, persistence and speech-failure regressions.
`npm run e2e` starts an isolated HTTPS server, tests pairing and the phone/tablet
layouts, and writes screenshots/traces under ignored `work/`. First install the
test browser with `npx playwright install chromium`. Use `E2E_BUILD_DIR` to select
an isolated directory containing `dist/` and `dist-server/`.

`node scripts/run-redteam-soak.mjs` starts the isolated server from
`work/redteam-release/dist-server`, with scratch data under
`work/redteam-sandbox`. It sends only to HTTP 3479 and UDP 20888, with two clients
and history queries. The default duration is thirty minutes; `SOAK_SECONDS` can
shorten a diagnostic run. Results and server output stay under ignored `work/`.
Never point this generator at the production/game telemetry port.

Deployment backs up both databases and previous builds. A rollback from 3.0 to
2.x also removes application authentication: restrict public access before an
intentional downgrade. Restore database backups only for database recovery, since
doing so discards subsequent recordings and device changes.

## Release validation — 2026-09-08

- 127 unit/integration regressions passed, including simulated full-database
  rollback/recovery, private API access, revocation, malformed packets, flashback,
  lost ACKs, essential speech retries and delivery-outbox recovery.
- Frontend/backend type checks and staged production builds passed.
- Phone (390 × 844) and tablet (1024 × 768) HTTPS browser scenarios passed:
  pairing, live stream, driving layout, deferred settings, English history,
  rejection of remote-only voices, synthetic local voice and tab exclusion.
- Production dependency audit reported zero known vulnerabilities.
- The first completed 30-minute stress run sent 108,002 frames at 59.997 Hz,
  with two clients and history reads. Queue maximum was one; final event-loop
  p95 was 21.02 ms. Six timeouts occurred while browser/tests competed for host
  resources, including database request timeouts. Recovery occurred; this was
  **not** a zero-error pass. The final run without competing local builds/tests
  passed: 1,800.05 seconds, 108,002 input frames (59.999 Hz), 30,518 received
  client frames, one deliberately lost ACK recovered, maximum queue one, zero
  errors. Final event-loop p95 was 20.92 ms; the highest sampled p95 was 21.50 ms.
  The server shut down cleanly. Artifacts are retained under ignored `work/`.

Keep CPU/memory headroom on this shared host: a separate SQLite worker does not
protect against machine-wide resource exhaustion. Local browser tests emulate
viewports and speech callbacks; actual Android audio, wake-lock behavior and wet
race calibration still require real-device/race acceptance.

Independent [GitHub CI](https://github.com/diegodella1/f1-race-monitor/actions/runs/34274915268) also passed installation, all tests, types, build and both browser scenarios on the release code.
