#!/usr/bin/env bash
# drenlia-runner: reset the k8s.private checkout to GITHUB_SHA and run the image rollout.
# See docs/DEPLOYMENT.md in agila-admin (agila section).
set -euo pipefail

REMOTE="${K8S_SSH:-daniel@k8s.private.drenlia.com}"
DEST="${K8S_REMOTE_DIR:-/home/daniel/easy-kanban}"
SHA="${GITHUB_SHA:?GITHUB_SHA is required}"

echo "On-prem deploy ${SHA} → ${REMOTE}:${DEST}"

ssh -o BatchMode=yes "$REMOTE" bash -s <<EOF
set -euo pipefail
cd ${DEST}
# Non-interactive: no GitHub SSH key on this hop (same as scripts/deploy-demo.sh)
git remote set-url origin https://github.com/drenlia-inc/agila.git
git fetch origin ${SHA}
git reset --hard ${SHA}
export GITHUB_SHA=${SHA}
export IMAGE_SHA=${SHA}
bash scripts/deploy-k8s-onprem.sh
EOF

echo "On-prem deploy complete (${SHA})"
