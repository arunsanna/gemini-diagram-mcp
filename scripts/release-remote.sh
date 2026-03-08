#!/usr/bin/env bash
set -euo pipefail

FORGE_HOST="${FORGE_HOST:-forge}"
NAMESPACE="${NAMESPACE:-llm-infra}"
APP_NAME="${APP_NAME:-gemini-diagram-mcp}"
IMAGE_REPO="${IMAGE_REPO:-registry.arunlabs.com/${APP_NAME}}"
TAG="${TAG:-$(date -u +%Y%m%d%H%M%S)}"
REMOTE_DIR="${REMOTE_DIR:-}"
KUSTOMIZE_DIR="deploy/k8s/overlays/forge"

if [[ -z "$REMOTE_DIR" ]]; then
  REMOTE_HOME="$(ssh "$FORGE_HOST" 'printf "%s" "$HOME"')"
  REMOTE_DIR="${REMOTE_HOME}/${APP_NAME}-build"
fi

if [[ ! -f "Dockerfile" || ! -f "${KUSTOMIZE_DIR}/kustomization.yaml" ]]; then
  echo "Run this script from the gemini-diagram-mcp repo root." >&2
  exit 1
fi

echo "[1/5] Syncing repo to ${FORGE_HOST}:${REMOTE_DIR}"
rsync -az --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'data/' \
  --exclude '.DS_Store' \
  ./ "${FORGE_HOST}:${REMOTE_DIR}/"

echo "[2/5] Building and pushing ${IMAGE_REPO}:${TAG} on ${FORGE_HOST}"
DIGEST="$(
  ssh "$FORGE_HOST" bash -s -- "$REMOTE_DIR" "$IMAGE_REPO" "$TAG" <<'EOF'
set -euo pipefail
REMOTE_DIR="$1"
IMAGE_REPO="$2"
TAG="$3"
IMAGE="${IMAGE_REPO}:${TAG}"
cd "$REMOTE_DIR"
docker build -t "$IMAGE" .
docker push "$IMAGE" >&2
docker image inspect "$IMAGE" --format '{{index .RepoDigests 0}}'
EOF
)"

if [[ "$DIGEST" != "${IMAGE_REPO}@sha256:"* ]]; then
  echo "Unexpected digest from remote build: $DIGEST" >&2
  exit 1
fi

echo "[3/5] Applying Forge overlay"
kubectl apply -k "${KUSTOMIZE_DIR}"

echo "[4/5] Pinning deployment to ${DIGEST}"
kubectl -n "$NAMESPACE" patch deployment "$APP_NAME" --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"Always"}]'
kubectl -n "$NAMESPACE" set image deployment/"$APP_NAME" "$APP_NAME"="$DIGEST"
kubectl -n "$NAMESPACE" rollout status deployment/"$APP_NAME" --timeout=300s

echo "[5/5] Verifying running image"
kubectl -n "$NAMESPACE" get pods -l app.kubernetes.io/name="$APP_NAME" \
  -o custom-columns=NAME:.metadata.name,IMAGE:.spec.containers[0].image,IMAGEID:.status.containerStatuses[0].imageID --no-headers

echo "Remote release complete: ${DIGEST}"
