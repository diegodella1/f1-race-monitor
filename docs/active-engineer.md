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

## Race control notices

Player penalties and warnings have their own delivery channel, independent of
the primary tactical message and its two secondary candidates. `raceControl`
stores normalized events and a flashback generation; `engineer.control` exposes
the notices for the current session. Both fields are optional for old snapshots.
The existing penalty-seconds and warning counters remain authoritative totals.

The parser reads player `PENA` events, including sanction and infringement codes.
Counter increases provide a fallback when an event packet is missing. A one-second
grace period allows a counter notice to acquire the event's details; matching
uses kind, amount and a two-second session-time window in either arrival order.
An aggregate counter increase remains an aggregate notice when individual events
arrive later. Unknown codes receive factual generic copy. The counters cannot
establish the original infringement or the threshold for another sanction.

The browser retains these notices beyond the ordinary 30-second event lifetime.
Critical safety takes precedence, followed by penalties, warnings and ordinary
calls. Control notices bypass the ordinary lap budget and wait for speech already
in progress. A safety interruption requeues the notice. Pausing retains it;
session changes, flashbacks and reversals invalidate it. Drive-through and stop-go
service events clear the matching sanction. At the finish, queued penalties use
closing copy and queued warnings are discarded. Speech errors remain visible in
the delivery history; they are not recorded as completed playback.

Enabling radio announces current totals and any known non-time sanctions instead
of replaying the event history. Race Control keeps the totals visible separately
from recent incidents. Server `EMITTED` records for this channel mean published
to the device queue, not spoken; browser delivery records remain the evidence for
submission, startup, completion, waiting and cancellation.

The Bahrain regression uses sanitized observations from session 9: a two-second
penalty in lap one was hidden behind contact calls. It verifies one simulated
browser completion while those recorded contacts remain present. Replay now lists
control notices alongside tactical messages. No database migration is required.

Protocol reference: [EA's UDP specification and appendices](https://forums.ea.com/blog/f1-games-game-info-hub-en/ea-sports%E2%84%A2-f1%C2%AE25-2026-season-pack-udp-specification/12187347).

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

## Weather strategy

Optional `strategy.weather` and `engineer.weather` fields expose the assessment
and its independent radio notices. Older snapshots remain readable without a
database migration. The live panel shows conditions, forecast, confidence and the
reason for maintaining tyres, preparing a change or calling boxes.

Meaningful dry/light-rain/heavy-rain changes require ten seconds of confirmation;
cloud changes remain silent. SESSION data older than seven seconds invalidates
weather advice. Rain forecasts within fifteen minutes require at least 60 percent
probability for a voice notice, including time and probability. A new notice is
issued when the forecast enters the five-minute window. Forecasts never order a
stop on their own. Rain percentage is probability, not track wetness; after rain
stops, the surface may still be wet.

Weather stops recommend a tyre family (slicks, intermediates or full wets).
Two rivals must each show an improvement greater than the larger of one second
and one percent of the player's lap time. Compare relative pace over three laps
before their change and two afterward, pairing laps ending within thirty seconds.
Exclude partial, invalid, pit, warm-up, contact, neutralized and stale laps. The
estimated remaining gain must recover pit loss plus a two-second margin; an
opposing forecast shortens the horizon. Neutralization cancels the weather stop.
Transitions suspend old pace targets, corner references and ordinary undercut,
overcut and cover advice. Rain alone does not satisfy the dry-compound rule;
actual use of wet tyres does.

Safety calls precede penalties, warnings, actionable weather and ordinary calls.
Descriptive weather notices expire after sixty seconds. A box notice stays queued
while justified and is revalidated before speech; changing tyres, stale data,
pause, flashback, session changes or finishing invalidate it. Emission and
resolution reasons appear in decision history; browser delivery uses the existing
radio history.

Synthetic regressions cover wetting, drying, insufficient evidence, short races,
forecast withdrawal, radio competition and resets. Recorded sessions available
during implementation were dry/cloudy, so real wet-race calibration remains
pending. Packet fields follow the EA 2026 SESSION/LAP layout; forecast accuracy
is read separately from rain probability.

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
