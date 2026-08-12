#!/usr/bin/env bash
# Deploy Agila demo on web01 (GitHub Actions → drenlia-runner).
# Host path stays /home/demo/projects/demo/easy-kanban until reset.sh + cron are updated.
set -euo pipefail

REMOTE="${DEPLOY_SSH_HOST:-daniel@web01.drenlia.com}"
DEST="${DEPLOY_REMOTE_DIR:-/home/demo/projects/demo/easy-kanban}"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"

echo "Deploying demo ${SHA} → ${REMOTE}:${DEST}"

ssh -o BatchMode=yes "$REMOTE" bash -s <<EOF
set -euo pipefail
cd ${DEST}

git remote set-url origin https://github.com/Drenlia-Inc/agila.git
git fetch origin main
git checkout main
git reset --hard origin/main
echo "${SHA}" > .deploy-sha

# Bind-mounted app; rebuild image + restart. Do not down volumes (demo DB / attachments).
docker compose up -d --build
docker compose ps

echo "=== ready ==="
ok=0
for i in \$(seq 1 90); do
  if curl -sf http://127.0.0.1:3222/ready >/dev/null; then
    curl -sf http://127.0.0.1:3222/ready
    echo
    ok=1
    break
  fi
  sleep 2
done
if [ "\$ok" != 1 ]; then
  echo "demo /ready check failed" >&2
  docker compose logs --tail 80 agila-app >&2 || true
  exit 1
fi
EOF

echo "Demo deploy complete (${SHA})"
