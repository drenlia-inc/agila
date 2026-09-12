#!/usr/bin/env bash
# Copy hashed /assets from a previous app image into docker-prev-assets/
# so Dockerfile.prod can merge them (N-1 files, no overwrite of new hashes).
#
# Usage: scripts/prepare-prev-assets.sh [image]
# Default image: easy-kanban:latest (local tag used by k8s/build-and-push-to-registry-app.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="${PROJECT_ROOT}/docker-prev-assets"
IMAGE="${1:-easy-kanban:latest}"

mkdir -p "$DEST"
# Keep the directory valid for Docker COPY even when empty
find "$DEST" -type f ! -name '.gitkeep' -delete 2>/dev/null || true

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "ℹ️  No previous image ${IMAGE} — new pods will only have this build's assets"
  exit 0
fi

cid="$(docker create "$IMAGE")"
cleanup() { docker rm -f "$cid" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if docker cp "${cid}:/app/dist/assets/." "$DEST/" 2>/dev/null; then
  count="$(find "$DEST" -type f ! -name '.gitkeep' | wc -l | tr -d ' ')"
  echo "✅ Copied ${count} previous hashed asset(s) from ${IMAGE}"
else
  echo "ℹ️  ${IMAGE} has no /app/dist/assets — skipping N-1 merge"
fi
