#!/usr/bin/env bash
# Image-only rollout for on-prem k8s (easy-kanban-pg).
# Run on k8s.private after the checkout is reset to GITHUB_SHA.
# Does not apply ConfigMaps or Secrets.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NAMESPACE="${NAMESPACE:-easy-kanban-pg}"
DEPLOYMENT="${DEPLOYMENT:-easy-kanban}"
CONTAINER="${CONTAINER:-easy-kanban}"
# Nodes pull this registry IP (see k8s/app-deployment-pg.yaml)
PULL_REGISTRY="${PULL_REGISTRY:-10.110.240.233:5000}"
IMAGE_NAME="${IMAGE_NAME:-easy-kanban}"
IMAGE_SHA="${IMAGE_SHA:-${GITHUB_SHA:?GITHUB_SHA or IMAGE_SHA is required}}"
PULL_IMAGE="${PULL_REGISTRY}/${IMAGE_NAME}:${IMAGE_SHA}"

cd "$PROJECT_ROOT"
echo "On-prem image rollout ${IMAGE_SHA} → ${NAMESPACE}/${DEPLOYMENT}"

export IMAGE_SHA
export GITHUB_SHA="${GITHUB_SHA:-$IMAGE_SHA}"
bash "${PROJECT_ROOT}/k8s/build-and-push-to-registry-app.sh"

echo "Setting image ${PULL_IMAGE} (ConfigMaps/Secrets untouched)"
kubectl -n "$NAMESPACE" set image "deployment/${DEPLOYMENT}" \
  "${CONTAINER}=${PULL_IMAGE}"
kubectl -n "$NAMESPACE" rollout status "deployment/${DEPLOYMENT}" --timeout=180s

echo "On-prem rollout complete: ${PULL_IMAGE}"
