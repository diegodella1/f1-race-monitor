"""Install an already validated build with database backups and startup checks."""
from pathlib import Path
import datetime
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

root = Path(__file__).resolve().parents[1]
stage = (root / (sys.argv[1] if len(sys.argv) > 1 else 'work/redteam-release')).resolve()
service = 'f1-race-monitor.service'
backup = root / 'work' / ('backup-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))


def systemctl(action):
    subprocess.run(['sudo', '-n', 'systemctl', action, service], check=True)


for name in ('dist', 'dist-server'):
    if not (stage / name).is_dir() or stage == root:
        raise SystemExit('Build into a separate staging directory first')
if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip():
    raise SystemExit('Commit the validated release before deploying')
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
version = json.loads((root / 'package.json').read_text())['version']
previous_private = (root / 'dist-server/access.js').exists()
backup.mkdir(parents=True)
os.chmod(backup, 0o700)
print('Backup:', backup, flush=True)
systemctl('stop')
moved = []
try:
    for database in ('f1-monitor.sqlite', 'devices.sqlite'):
        for source in (root / 'data').glob(database + '*'):
            shutil.copy2(source, backup / source.name)
    for name in ('dist', 'dist-server'):
        if (root / name).exists():
            (root / name).rename(backup / name)
            moved.append(name)
        shutil.copytree(stage / name, root / name)
    systemctl('start')
    for attempt in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3469/api/health', timeout=2) as response:
                if json.load(response)['status'] != 'ok':
                    raise RuntimeError('Health check failed')
            break
        except Exception:
            if attempt == 29:
                raise
            time.sleep(1)
    result = subprocess.check_output(['node', 'scripts/prod-smoke.mjs'], cwd=root, text=True)
    smoke = json.loads(result)
except BaseException:
    systemctl('stop')
    for name in moved:
        if (root / name).exists():
            (root / name).rename(backup / ('failed-' + name))
        (backup / name).rename(root / name)
    if previous_private:
        systemctl('start')
        print('Previous private build restored.', flush=True)
    else:
        print('Previous build restored; service stays stopped because it lacks authentication. Restrict public access before starting it.', flush=True)
    raise

manifest = {'version': version, 'commit': commit, 'backup': str(backup),
            'deployedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'smoke': smoke}
(root / 'work/deployed-release.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest), flush=True)
