#!/usr/bin/env bash
# Free disk on the build host (k8s.private / corp) without dropping the
# previous :latest (layer cache + N-1 extract already ran).
#
# Removes: stopped containers, dangling images, unused build cache,
# and easy-kanban tags that are not :latest (old GITHUB_SHA pins).
# Does not: prune volumes, or delete unrelated images (e.g. agila-admin on corp).
set -euo pipefail

echo "🧹 Docker tidy (keep easy-kanban:latest for cache)"

docker container prune -f >/dev/null || true
docker image prune -f >/dev/null || true

# Untag old SHA pins. Layers stay if :latest still points at them.
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  case "$ref" in
    *:latest) continue ;;
    *':<none>') continue ;;
  esac
  echo "   rmi $ref"
  docker rmi "$ref" >/dev/null 2>&1 || true
done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '(^|/)easy-kanban:' || true)

# Unused BuildKit cache only (not --all — that wipes cache for this build).
docker builder prune -f >/dev/null 2>&1 || true

echo "   $(docker system df 2>/dev/null | tail -n +1 || true)"
echo "✅ Docker tidy done"
