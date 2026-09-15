#!/usr/bin/env bash
# Image-only EKS rollout for the tenant platform (ns agila, deployment easy-kanban).
# Run on corp.private (IAM + kubectl --context drenlia-eks). Does not apply ConfigMaps or Secrets.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ECR_REGISTRY="${ECR_REGISTRY:-336644450495.dkr.ecr.ca-central-1.amazonaws.com}"
IMAGE_NAME="${IMAGE_NAME:-easy-kanban}"
IMAGE="${IMAGE:-${ECR_REGISTRY}/${IMAGE_NAME}}"
IMAGE_SHA="${IMAGE_SHA:-${GITHUB_SHA:?GITHUB_SHA or IMAGE_SHA is required}}"
AWS_REGION="${AWS_REGION:-ca-central-1}"
KUBECTL_CONTEXT="${KUBECTL_CONTEXT:-drenlia-eks}"
NAMESPACE="${NAMESPACE:-agila}"
DEPLOYMENT="${DEPLOYMENT:-easy-kanban}"
CONTAINER="${CONTAINER:-easy-kanban}"

cd "$PROJECT_ROOT"
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo "${IMAGE_SHA:0:7}")"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
BUILD_TIME="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

echo "EKS image rollout ${IMAGE}:${IMAGE_SHA} → ${NAMESPACE}/${DEPLOYMENT}"

bash "${PROJECT_ROOT}/scripts/prepare-prev-assets.sh" "${IMAGE}:latest" || true
# Also try the local latest tag used on corp
if docker image inspect easy-kanban:latest >/dev/null 2>&1; then
  bash "${PROJECT_ROOT}/scripts/prepare-prev-assets.sh" easy-kanban:latest || true
fi

bash "${PROJECT_ROOT}/scripts/docker-tidy-before-build.sh" || true

docker build -f Dockerfile.prod \
  -t "${IMAGE}:${IMAGE_SHA}" \
  -t "${IMAGE}:latest" \
  -t easy-kanban:latest \
  --build-arg GIT_COMMIT="${GIT_COMMIT}" \
  --build-arg GIT_BRANCH="${GIT_BRANCH}" \
  --build-arg BUILD_TIME="${BUILD_TIME}" \
  --build-arg MULTI_TENANT=true \
  .

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker push "${IMAGE}:${IMAGE_SHA}"
docker push "${IMAGE}:latest"

echo "Setting image ${IMAGE}:${IMAGE_SHA} (ConfigMaps/Secrets untouched)"
kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" set image "deployment/${DEPLOYMENT}" \
  "${CONTAINER}=${IMAGE}:${IMAGE_SHA}"
kubectl --context "$KUBECTL_CONTEXT" -n "$NAMESPACE" rollout status "deployment/${DEPLOYMENT}" \
  --timeout=180s

echo "EKS rollout complete: ${IMAGE}:${IMAGE_SHA}"
