# Contributing

Thanks for helping make F1 Race Monitor more useful on the pitwall.

## Before opening a change

1. Search existing issues and describe the racing situation the change improves.
2. Never attach raw telemetry databases or captures containing personal network information.
3. Keep recommendations deterministic and explain which telemetry fields support them.
4. Prefer fewer, timely radio calls over adding another unconditional alert.

## Local workflow

```bash
npm ci
npm test
npm run check
npm run build
```

Use Node.js 22 or newer. CI runs the same test, type-check and build commands.

Include regression tests for changed parser offsets, strategy conditions, radio scheduling, delivery retries or stream backpressure. Radio remains English-only; phrase variation must preserve telemetry facts and keep selected event text stable. Test queue timing with deterministic clocks and callback events.

Use `npm run replay -- --database /path/to/copied-session.sqlite --session 2` for read-only replay. Never commit a session database. Keep regression fixtures small and remove network addresses and personal identifiers. Update README, CHANGELOG and behavior documentation when a release changes observable behavior.

## Useful bug reports

Include the platform, session type, circuit, lap, expected behaviour and observed behaviour. If a packet sample is essential, trim it to the minimum needed and remove IP addresses, profile names and unrelated session data first.
