#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY_PREFIX="${REGISTRY_PREFIX:-ccr.ccs.tencentyun.com/imags}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null || printf 'local')}"
PLATFORM="${PLATFORM:-linux/amd64}"
ADMIN_API_URL="${ADMIN_API_URL:-http://127.0.0.1:8787}"
BUILDER="${BUILDER:-dsh-amd64}"

admin_image="${REGISTRY_PREFIX}/admin"
backend_image="${REGISTRY_PREFIX}/backend"

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker is required\n' >&2
  exit 1
fi
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER" --use >/dev/null
else
  docker buildx use "$BUILDER"
fi

echo "Building and pushing ${admin_image}:${IMAGE_TAG} and ${backend_image}:${IMAGE_TAG} for ${PLATFORM}"
docker buildx build \
  --platform "$PLATFORM" \
  --file "$ROOT_DIR/infra/enterprise/docker/admin.Dockerfile" \
  --build-arg "NEXT_PUBLIC_ENTERPRISE_API_URL=${ADMIN_API_URL}" \
  --tag "${admin_image}:${IMAGE_TAG}" \
  --tag "${admin_image}:latest" \
  --push \
  "$ROOT_DIR"

docker buildx build \
  --platform "$PLATFORM" \
  --file "$ROOT_DIR/infra/enterprise/docker/api.Dockerfile" \
  --tag "${backend_image}:${IMAGE_TAG}" \
  --tag "${backend_image}:latest" \
  --push \
  "$ROOT_DIR"

echo "Pushed ${admin_image}:${IMAGE_TAG}"
echo "Pushed ${backend_image}:${IMAGE_TAG}"
