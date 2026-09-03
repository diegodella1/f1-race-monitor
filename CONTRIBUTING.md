# Contributing

Thanks for helping make F1 Race Monitor more useful on the pitwall.

## Before opening a change

1. Search existing issues and describe the racing situation the change improves.
2. Never attach raw telemetry databases or captures containing personal network information.
3. Keep recommendations deterministic and explain which telemetry fields support them.
4. Prefer fewer, timely radio calls over adding another unconditional alert.

## Local workflow

```bash
npm install
npm test
npm run check
npm run build
```

Please include or update tests for parser offsets, strategy conditions and radio cooldowns when those areas change.

## Useful bug reports

Include the platform, session type, circuit, lap, expected behaviour and observed behaviour. If a packet sample is essential, trim it to the minimum needed and remove IP addresses, profile names and unrelated session data first.
