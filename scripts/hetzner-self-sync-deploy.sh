#!/usr/bin/env bash
# Reproducible deploy for the Telarchy self-sync onto the same Hetzner Cloud
# box that already runs LookPilot's KPI sync (currently 5.75.140.10, cax11
# in nbg1). Co-tenancy is intentional: both syncs are tiny daily oneshots,
# pointing at the same telarchy.com/api, and one box is cheaper than two.
#
# Idempotent: safe to re-run; overwrites the script + secrets.env in place.
#
# Prerequisites on the local machine:
#   ~/keyring/secrets/hcloud.token             (already present from LookPilot)
#   ~/keyring/secrets/telarchy-master.apikey   (Telarchy master API key)
#   ~/.ssh/lookpilot_kpi_sync_ed25519          (same SSH key as LookPilot deploy)
#
# Optional override (default: auto-derived):
#   ~/keyring/secrets/telarchy-self-sync.cohort
#       Comma-separated workspace IDs to override the auto-derived founder
#       concierge cohort. Default behaviour: cohort is auto-derived from
#       /api/workspaces filtered by createdAt in the concierge window
#       (2026-04-29 → 2026-06-03), excluding the platform owner. Use this
#       file only if the auto-derivation needs correction.
#
# Usage:
#   bash scripts/hetzner-self-sync-deploy.sh <ipv4>
# Example:
#   bash scripts/hetzner-self-sync-deploy.sh 5.75.140.10

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <hetzner-ipv4>" >&2
  exit 2
fi
HOST_IP="$1"
SSH_KEY="${HOME}/.ssh/lookpilot_kpi_sync_ed25519"
SSH="ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 root@${HOST_IP}"
SCP="scp -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TELARCHY_MASTER_KEY="$(cat "${HOME}/keyring/secrets/telarchy-master.apikey")"
COHORT_FILE="${HOME}/keyring/secrets/telarchy-self-sync.cohort"
COHORT_WORKSPACE_IDS=""
if [[ -r "${COHORT_FILE}" ]]; then
  COHORT_WORKSPACE_IDS="$(cat "${COHORT_FILE}")"
fi

echo "[1/5] bootstrap service user (node already installed by LookPilot deploy)"
${SSH} 'set -e
  command -v node >/dev/null 2>&1 || {
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates >/dev/null
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null
  }
  id -u telarchy-self-sync >/dev/null 2>&1 || \
    useradd -r -m -d /opt/telarchy-self-sync -s /usr/sbin/nologin telarchy-self-sync
  install -d -m 750 -o telarchy-self-sync -g telarchy-self-sync /opt/telarchy-self-sync
  install -d -m 750 -o root -g telarchy-self-sync /etc/telarchy-self-sync
  touch /var/log/telarchy-self-sync.log
  chown telarchy-self-sync:telarchy-self-sync /var/log/telarchy-self-sync.log'

echo "[2/5] copy script"
${SCP} \
  "${REPO_DIR}/scripts/telarchy-self-sync.js" \
  "root@${HOST_IP}:/opt/telarchy-self-sync/" >/dev/null
${SSH} 'chown telarchy-self-sync:telarchy-self-sync /opt/telarchy-self-sync/telarchy-self-sync.js'

echo "[3/5] write secrets.env (root:telarchy-self-sync 0640)"
${SSH} "cat > /etc/telarchy-self-sync/secrets.env <<EOF
TELARCHY_ADMIN_KEY=${TELARCHY_MASTER_KEY}
COHORT_WORKSPACE_IDS=${COHORT_WORKSPACE_IDS}
EOF
chmod 640 /etc/telarchy-self-sync/secrets.env
chown root:telarchy-self-sync /etc/telarchy-self-sync/secrets.env"

echo "[4/5] install systemd unit + timer"
${SSH} 'cat > /etc/systemd/system/telarchy-self-sync.service <<EOF
[Unit]
Description=Telarchy self-sync (5 platform metrics into the Telarchy workspace)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=telarchy-self-sync
Group=telarchy-self-sync
WorkingDirectory=/opt/telarchy-self-sync
EnvironmentFile=/etc/telarchy-self-sync/secrets.env
ExecStart=/usr/bin/node telarchy-self-sync.js
StandardOutput=append:/var/log/telarchy-self-sync.log
StandardError=append:/var/log/telarchy-self-sync.log
TimeoutStartSec=540
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/log
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/telarchy-self-sync.timer <<EOF
[Unit]
Description=Daily Telarchy self-sync (03:30 UTC, offset from LookPilot 03:00)

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now telarchy-self-sync.timer'

echo "[5/5] manual sync to verify"
${SSH} 'systemctl start telarchy-self-sync.service
        sleep 2
        tail -30 /var/log/telarchy-self-sync.log'

echo "next scheduled run:"
${SSH} 'systemctl list-timers telarchy-self-sync.timer'
