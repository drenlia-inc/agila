#!/usr/bin/env bash
# drenlia-runner: reset the corp checkout to GITHUB_SHA and run the EKS image rollout.
# Runner has no AWS credentials; corp does.
set -euo pipefail

REMOTE="${CORP_SSH:-daniel@corp.private.drenlia.com}"
DEST="${CORP_REMOTE_DIR:-/data/server-setup/terraform/easy-kanban}"
SHA="${GITHUB_SHA:?GITHUB_SHA is required}"

echo "EKS deploy ${SHA} → ${REMOTE}:${DEST}"

ssh -o BatchMode=yes "$REMOTE" bash -s <<EOF
set -euo pipefail
cd ${DEST}
git fetch origin
git reset --hard ${SHA}
export GITHUB_SHA=${SHA}
export IMAGE_SHA=${SHA}
bash scripts/deploy-eks.sh
EOF

echo "EKS deploy complete (${SHA})"
