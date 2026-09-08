# Deployment on Diego's server

- HTTPS dashboard: https://f12025.diegodella.ar
- Internal HTTP origin: http://127.0.0.1:3469
- Game telemetry: 192.168.1.14, UDP port 20777
- Service: `f1-race-monitor.service`
- Sessions/settings: `data/f1-monitor.sqlite`
- Paired devices: `data/devices.sqlite`

The Cloudflare tunnel routes HTTPS and WebSocket traffic to loopback port 3469.
Set `APP_ORIGIN` to the exact external HTTPS origin (the hostname above is the
default). LAN HTTP cannot authenticate; open the HTTPS dashboard on every device.
Game UDP continues directly over the LAN.

## Update

Run `npm ci`, `npm run check` and `npm test`. Compile separately while production
continues serving the previous complete build:

```bash
node node_modules/typescript/bin/tsc -p server/tsconfig.json --outDir work/redteam-release/dist-server
node node_modules/vite/bin/vite.js build --outDir work/redteam-release/dist
npx playwright install chromium
E2E_BUILD_DIR=work/redteam-release npm run e2e
```

Run the isolated soak with `node scripts/run-redteam-soak.mjs` for substantial
capture, stream or persistence changes. Review the result before deploying.

The release script preserves both previous builds, stops the service, backs up
both SQLite databases and sidecar files, then installs the staged artifacts:

```bash
python3 scripts/deploy_release.py work/redteam-release
```

It requires permission to stop/start the service through `sudo -n systemctl`.
Startup checks include loopback health, rejection of unauthenticated API access
and an authenticated operations request. Failure restores the previous builds. If those builds predate authentication,
the service remains stopped until public access is restricted.
It records the source commit and backup path in `work/deployed-release.json`.

## Verify and pair

```bash
systemctl is-active f1-race-monitor.service
curl --fail http://127.0.0.1:3469/api/health
curl --silent --output /dev/null --write-out '%{http_code}\n' https://f12025.diegodella.ar/api/state
npm run pair
```

The public state request must return **401**. Open the generated one-time link on
the tablet within ten minutes and name the device. Refresh old tabs after release.
Verify live connection, Analysis history and Settings → Paired devices. `WAITING`
is healthy when the game is not sending telemetry. Revocation must close that
device's active connection.

Test a local English voice with a user gesture. Driving mode requests a wake
lock; actual sound and screen behavior must be checked on the Android device.
Browser callbacks and automated viewport tests do not establish audible playback.

## Rollback and recovery

Restore previous `dist/` and `dist-server/` while the service is stopped, then
restart and verify. Keep current databases to retain new history and pairings.
A deliberate downgrade from 3.0 to 2.x removes application authentication:
restrict public access before such a rollback.

Restore database backups only for database recovery: doing so discards subsequent
sessions and device changes. Never commit databases, pairing links or build
artifacts. Backups and validation artifacts belong under ignored `work/`.

The tracked [systemd unit](f1-race-monitor.service) is specific to this host.
Changing its installed configuration requires `sudo systemctl daemon-reload`;
ordinary build releases require only a restart. GitHub CI runs tests, type checks,
build and phone/tablet browser tests. Source publication does not deploy the app.
