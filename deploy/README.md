# Deployment on Diego's server

- Public URL: https://f12025.diegodella.ar
- HTTP origin: http://127.0.0.1:3469
- LAN dashboard: http://192.168.1.14:3469
- Game telemetry: 192.168.1.14, UDP port 20777
- Service: `f1-race-monitor.service`
- Persistent sessions and settings: `data/f1-monitor.sqlite`

The existing Cloudflare tunnel routes the public hostname to port 3469,
including Socket.IO. The game sends UDP directly over the local network.

## Update

Run `npm ci`, `npm run check`, `npm test`, and `npm run build` before
`sudo systemctl restart f1-race-monitor.service`.
Keep a copy of the previous `dist/` and `dist-server/` before rebuilding for rollback.
Back up SQLite while the service is stopped, or use SQLite's online backup API.

## Verify

```bash
systemctl status f1-race-monitor.service
curl --fail http://127.0.0.1:3469/api/state
curl --fail https://f12025.diegodella.ar/api/state
journalctl -u f1-race-monitor.service -n 30 --no-pager
```

Also open `/analysis`, verify that radio history loads, and check a browser's
Socket.IO connection. `WAITING` is healthy when the game is not sending telemetry.
Refresh existing browser tabs after deployment to load the new radio and stream
protocol. Test audio with a user gesture and an available English voice.

## Release rollback

Stop the service, restore the previous `dist/` and `dist-server/`, then start the
service and repeat the checks above. Keep the current database: the 2.7 migration
adds radio tables and indexes without removing existing session tables, and 2.8
requires no additional schema migration. Reverting application code does not
require reverting the database or removing the tunnel route.

Retain the database backup for recovery. Restoring it would discard sessions
recorded since that backup, so only do that when database recovery is intended.
Build backups belong under ignored `work/`; never commit databases or artifacts.

## Repository and service configuration

The tracked [systemd unit](f1-race-monitor.service) is specific to this host.
Adjust its user, paths and ports before using it elsewhere. After changing an
installed unit, run `sudo systemctl daemon-reload` before restarting the service.
Normal application releases need only a service restart after build replacement.

GitHub CI validates tests, types and build on `main` and pull requests. It does
not deploy to this server automatically. Publishing source and deploying builds
are separate steps; record the deployed commit after successful verification.
