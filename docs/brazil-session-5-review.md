# Brazil: session 5 review

The final stored sample is lap 25/25, P1, 10.427 seconds ahead of Verstappen.
Best lap: 1:14.263. The session has no confirmed chequered-flag summary, so these
are the final telemetry readings rather than an independently confirmed result.

## Driving and strategy observations

- Four contact events were announced on laps 3, 4, 6 and 7. The final sample has
  no recorded structural damage. The early stint involved a close Verstappen battle.
- Stop entered on lap 13, exited on lap 14. Pit lane duration: 21.204 seconds.
  Immediate rejoin prediction was P6–P8; reported exit was P1. Net pit loss remains
  unknown because the reference was not comparable.
- On softs, laps 16 and 17 were 1:14.282 and 1:14.263. The rear gap increased from
  3.320 seconds at the end of lap 14 to 10.427 in the final sample.
- Final soft wear was 46%. The model estimated about 0.168 seconds/lap of
  degradation; traffic, fuel, damage and driving variation are not isolated by
  that estimate. Late laps were around 1:15 rather than the early 1:14 pace.

## Audio evidence before the fix

One recorded device selected 25 messages: 21 started, 20 completed, four expired
and one was interrupted by a critical message. The browser logs contain English
speech. Median selection-to-start delay was 1.69 seconds; maximum was 5.458 seconds.
Completed utterances lasted 5.06–7.51 seconds. Balances repeatedly used the same
“RACE STATUS” introduction and full three-decimal target times.

The selected pit-exit message expired before playback. The mandatory box call
exists in the server decision log without corresponding browser delivery evidence.
Absence from the log alone does not prove what the user heard.

Median packet rate between consecutive saved samples was 175/s. Median serialized
state size was 42,436 bytes. Publishing every parsed packet implied roughly
7.4 MB/s of application payload per client before framing/compression. This is an
estimate from saved state, not a measured network transfer rate.

Some client events refer to substantially older server events. Comparing those
timestamps mixes two clocks and transport/flush delay; it cannot establish exact
one-way network latency. The per-packet full-state broadcast is a concrete source
of avoidable bandwidth and buffering.

## Changes in this release

- English-only radio. Automatic voice selection prefers a local English voice;
  an explicitly selected English voice still takes precedence.
- Short rotating English templates for balances, contacts, temperatures, battle
  modes and push. Facts stay frozen for each event. Spoken targets use tenths.
- Dashboard streaming capped at 10 Hz, one acknowledged frame in flight per
  modern client. Slow clients receive the newest state after acknowledging,
  rather than a backlog. Legacy clients receive throttled volatile updates.
- Safe-speaking confirmation reduced to 500 ms; queue polling to 100 ms.
  Local spacing is 3 seconds for action, 6 for opportunity and 15 for information;
  server selection still enforces its ordinary-message budget and spacing.
- New DEFERRED and SUBMITTED logs separate queue waits from speech-engine startup.
  Startup/completion watchdogs recover from missing browser callbacks.

## Recommended next improvements

1. Stabilize thermal mode changes with sustained evidence and separate enter/exit
   thresholds. The mode log repeatedly alternates MANAGE with ATTACK/DEFEND; brief
   surface-temperature excursions should not constantly rewrite the tactical plan.
2. Revisit simultaneous-stop projections. Validate field timing and which rivals
   are already stopping before assigning high confidence to a rejoin range.
3. Validate end-of-race packet handling with a recording that includes the finish
   and classification. Do not infer a win solely from the last lap counter.
4. Add factual stint feedback: whether the gap is growing, whether a push phase
   achieved its aim, and whether a comparable clean lap met the target. Avoid
   attributing a lap-time change to tyres alone.

Measure the next real race with the new queue/submission/start timestamps before
claiming a specific improvement in audible latency.
