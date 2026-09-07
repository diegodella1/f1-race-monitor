# Active engineer and radio delivery

The engineer follows the race with up to three ordinary calls per lap, at least
15 seconds apart at the server. The browser applies a 3-second minimum for action calls, 6 seconds for opportunities and 15 seconds for information. Useful lap balances can start on lap two after 45 seconds of
silence. Critical safety, mandatory stops, escalating damage and race completion
take precedence. The radio revalidates pending messages against the current rival,
mode and lifecycle before speaking.

Post-stop push covers the out lap and the next two laps. Close battles, car
limitations and safety restrictions take priority. Immediate rejoin estimates
include the field rather than assuming other cars will pit. Unknown projections
and net pit losses remain unknown; pit lane time is recorded separately.

## Delivery history

Analysis includes session, device, lap, category and delivery-status filters.
Server decisions and browser delivery events are separate. STARTED and COMPLETED
mean callbacks from the browser speech engine, not proof of audible playback.
Historical sessions predating this release have no browser delivery events.

`POST /api/radio-events` accepts `{events: [...]}` with 1–50 validated events.
Each contains `eventId`, `deviceId`, `sessionUid`, `sessionLinkId`, `sessionType`,
`messageId`, `status`, `text`, `reason`, `category`, `lap` and `clientAt`.
The response contains `accepted` and `acknowledged` event IDs. Duplicate
`deviceId/eventId` pairs are idempotent; unknown session identities are not saved.
The browser retains unacknowledged events in a bounded local outbox (2,000 events)
and retries ten events every two seconds. Session auto-save must be enabled to
retain session-linked radio history.

`GET /api/sessions/:id/radio` supports `limit` (1–200), `offset`, `device`,
`status`, `category` and `lap`. It returns events, total count, devices and a report
of status/reason counts and intervals of at least 45 seconds between speech starts
per device. Server decisions remain at `/api/sessions/:id/decisions`.

## Regression and replay

`npm test` includes sanitized Spa observations from session 2, strategy transitions,
radio queue callbacks, retries, database idempotency and read-only access.
The fixture retains lap, pit and damage transitions plus neighboring observations;
forecast and incident arrays are omitted to keep it focused on these regressions.

```bash
npm run replay -- --database /path/to/copied-session.sqlite --session 2
```

Replay opens SQLite read-only and passes each saved timestamp to all three engines.
Two-second snapshots can verify tactical regressions but cannot reproduce every
packet-level event or establish what played on an earlier browser.

## Deployment

Build and validate in a separate directory, then back up `dist/`, `dist-server/`
and SQLite before switching the service. The database migration only adds the
radio event table, indexes and migration record; previous application builds can
still read their existing tables. Restore the previous builds for code rollback;
keep the migrated database to retain new history.

## V2.8: English and latency

Radio is always English. Automatic voice selection prefers an English voice marked
as local by the browser. Repeated message families rotate concise phrases while
each selected event keeps its text fixed. Spoken target laps use tenths.

The client confirms a safe speaking window for 500 ms and checks the queue every
100 ms. DEFERRED records why delivery is waiting; SUBMITTED marks the call to the
speech engine and identifies the selected voice. The history separates median
queue delay from speech startup. Old sessions without SUBMITTED cannot provide
that split. A missing start callback times out after 10 seconds; missing completion
is bounded at 45 seconds from submission.

Modern clients negotiate `raceStreamReady` and acknowledge each `raceState` frame.
The server sends at most ten frames per second with one in flight per client;
intermediate states are replaced, not buffered. Older clients receive throttled
volatile updates. UDP parsing, engine analysis and persistence retain their normal
cadence. Reload existing browser tabs to enable acknowledged streaming.

See [Brazil session review](brazil-session-5-review.md) for the measured baseline
and remaining strategy improvements.
