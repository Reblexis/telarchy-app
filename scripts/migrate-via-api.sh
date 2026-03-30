#!/usr/bin/env bash
# Migrates metrics from one workspace to another via the Telarchy HTTP API.
#
# Usage:
#   SERVER=https://your-server.example.com \
#   API_KEY=your-api-key \
#   SRC_WORKSPACE=default \
#   DST_WORKSPACE=your-target-workspace-id \
#   bash scripts/migrate-via-api.sh
#
# The script reads metrics from SRC_WORKSPACE and recreates them in DST_WORKSPACE.
# Metrics are created in dependency order so formulas resolve correctly.
# Markets, positions, and trades are NOT migrated (financial state is tied to agents).

set -euo pipefail

SERVER="${SERVER:?SERVER env var required (e.g. https://your-server.example.com)}"
API_KEY="${API_KEY:?API_KEY env var required}"
SRC="${SRC_WORKSPACE:-default}"
DST="${DST_WORKSPACE:?DST_WORKSPACE env var required (target workspace ID)}"

echo "Server:     $SERVER"
echo "Source:     $SRC"
echo "Target:     $DST"
echo ""

src() { curl -sf -H "X-API-Key: $API_KEY" -H "X-Workspace-Id: $SRC" "$SERVER$1"; }

echo "=== Migrating metrics ==="
METRICS=$(src /api/metrics)
echo "$METRICS" | python3 -c "
import sys, json
metrics = json.load(sys.stdin)
print(f'Found {len(metrics)} metrics')
for m in metrics:
    print(' ', m['id'], m['name'])
"

echo "$METRICS" | python3 -c "
import sys, json, subprocess

metrics = json.load(sys.stdin)
server = sys.argv[1]
key    = sys.argv[2]
dst    = sys.argv[3]

for m in metrics:
    body = {
        'name':        m['name'],
        'description': m.get('description', ''),
        'value':       m['value'],
        'formula':     m.get('formula', '0'),
    }
    if m.get('timePreference'):
        body['timePreference'] = m['timePreference']
    if m.get('marketRangeMax') is not None:
        body['marketRangeMax'] = m['marketRangeMax']

    result = subprocess.run([
        'curl', '-sf',
        '-H', f'X-API-Key: {key}',
        '-H', f'X-Workspace-Id: {dst}',
        '-H', 'Content-Type: application/json',
        '-X', 'POST',
        f'{server}/api/metrics',
        '-d', json.dumps(body)
    ], capture_output=True, text=True)

    if result.returncode == 0:
        created = json.loads(result.stdout)
        print(f'  created: {m[\"name\"]} -> {created.get(\"id\", \"?\")}')
    else:
        print(f'  FAILED:  {m[\"name\"]}: {result.stderr}')
" "$SERVER" "$API_KEY" "$DST"

echo ""
echo "Done. Metrics migrated to workspace $DST."
echo "Note: markets, positions and trades are not migrated (financial state tied to old agent economy)."
