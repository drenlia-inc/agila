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

git remote set-url origin https://github.com/drenlia-inc/agila.git
git fetch origin main
git checkout main
git reset --hard origin/main
echo "${SHA}" > .deploy-sha

# version.json is generated inside the image, where .git is unavailable, so resolve
# the commit here and hand it to the build. Passed on the CLI as well as exported,
# because the compose file this host resolves to may not declare the args itself.
export GIT_COMMIT="\$(git rev-parse --short HEAD)"
export GIT_BRANCH="\$(git rev-parse --abbrev-ref HEAD)"
export BUILD_TIME="\$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Building \${GIT_BRANCH}@\${GIT_COMMIT} (\${BUILD_TIME})"

# Bind-mounted app; rebuild image + restart. Do not down volumes (demo DB / attachments).
docker compose build \
  --build-arg GIT_COMMIT="\${GIT_COMMIT}" \
  --build-arg GIT_BRANCH="\${GIT_BRANCH}" \
  --build-arg BUILD_TIME="\${BUILD_TIME}"
docker compose up -d
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
