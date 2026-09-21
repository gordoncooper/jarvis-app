#!/bin/bash
# Build jarvis-orchestrator + jarvis-glass on apps-01 and import into k3s containerd.
# Required BEFORE Flux schedules the Deployments (imagePullPolicy: Never).
# Run on bastion as agent. Tag from VERSION unless JARVIS_APP_TAG is set.
# SKIP_ORCH=1 / SKIP_GLASS=1 build only the other half. Use them when a slice
# touches one image: rebuilding the other at its existing tag is a retag, and
# imagePullPolicy: Never means a reused tag silently serves whichever layers
# the node already had.
set -euo pipefail

echo "== who =="
whoami
echo "HOME=$HOME"
if [ "$(whoami)" != "agent" ]; then
  echo "FATAL: run as user agent." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/VERSION"
HOST="${1:-apps-01}"
TAG="${JARVIS_APP_TAG:-${IMAGE_GLASS_TAG:-$GIT_TAG}}"
ORCH_TAG="${IMAGE_ORCHESTRATOR_TAG:-$TAG}"
NODE_BIN="${NODE_BIN:-$HOME/.local/node-v22.14.0-linux-x64/bin}"

echo "== paths =="
echo "ROOT=$ROOT HOST=$HOST GLASS_TAG=$TAG ORCH_TAG=$ORCH_TAG THEME=${JARVIS_THEME:-<unset>}"
test -f "$ROOT/orchestrator/Dockerfile"
test -f "$ROOT/glass/Dockerfile"
test -f "$ROOT/glass/nginx.conf"

if [ "${SKIP_GLASS:-}" = "1" ]; then
  echo "== skip glass (SKIP_GLASS=1) =="
else
echo "== build glass dist on bastion =="
export PATH="$NODE_BIN:$PATH"
command -v node >/dev/null || {
  echo "FATAL: node not on PATH (expected under $NODE_BIN)." >&2
  exit 1
}
# Sourced from VERSION. No default: shipping a different theme than the one
# that was asked for is worse than refusing to build.
THEME="${JARVIS_THEME:-}"
if [ -z "$THEME" ]; then
  echo "FATAL: JARVIS_THEME unset (expected from VERSION)." >&2
  exit 1
fi
if [ ! -f "$ROOT/glass/themes/$THEME/theme.json" ]; then
  echo "FATAL: unknown theme '$THEME' — no glass/themes/$THEME/theme.json." >&2
  ls -1 "$ROOT/glass/themes" >&2
  exit 1
fi
echo "THEME=$THEME"
(
  cd "$ROOT/glass"
  if [ ! -d node_modules ]; then npm ci; fi
  # No sourcemap in the runtime image (4.4MB); local builds keep theirs.
  JARVIS_THEME="$THEME" JARVIS_APP_TAG="$TAG" JARVIS_SOURCEMAP=0 npm run build
)

fi

echo "== docker on $HOST =="
ssh -n -o BatchMode=yes "$HOST" 'command -v docker >/dev/null && command -v k3s >/dev/null'

if [ "${SKIP_ORCH:-}" != "1" ]; then
echo "== upload + build orchestrator =="
tar -C "$ROOT/orchestrator" -czf /tmp/jarvis-orch-src.tgz Dockerfile requirements.txt app
scp -o BatchMode=yes /tmp/jarvis-orch-src.tgz "$HOST:/tmp/jarvis-orch-src.tgz"
ssh -o BatchMode=yes "$HOST" "sudo env TAG=$ORCH_TAG bash -s" << 'EOF'
set -euo pipefail
rm -rf /tmp/jarvis-orch-build
mkdir -p /tmp/jarvis-orch-build
tar -C /tmp/jarvis-orch-build -xzf /tmp/jarvis-orch-src.tgz
cd /tmp/jarvis-orch-build
docker build --build-arg "JARVIS_VERSION=${TAG}" -t "jarvis-orchestrator:${TAG}" .
docker save "jarvis-orchestrator:${TAG}" | k3s ctr images import -
k3s ctr images ls | grep jarvis-orchestrator || true
rm -rf /tmp/jarvis-orch-build /tmp/jarvis-orch-src.tgz
EOF
rm -f /tmp/jarvis-orch-src.tgz
else
echo "== skip orchestrator (SKIP_ORCH=1) =="
fi

if [ "${SKIP_GLASS:-}" = "1" ]; then
echo "== skip glass image (SKIP_GLASS=1) =="
else
echo "== upload + build glass =="
tar -C "$ROOT/glass" -czf /tmp/jarvis-glass-src.tgz Dockerfile nginx.conf dist
scp -o BatchMode=yes /tmp/jarvis-glass-src.tgz "$HOST:/tmp/jarvis-glass-src.tgz"
ssh -o BatchMode=yes "$HOST" "sudo env TAG=$TAG bash -s" << 'EOF'
set -euo pipefail
rm -rf /tmp/jarvis-glass-build
mkdir -p /tmp/jarvis-glass-build
tar -C /tmp/jarvis-glass-build -xzf /tmp/jarvis-glass-src.tgz
cd /tmp/jarvis-glass-build
docker build -t "jarvis-glass:${TAG}" .
docker save "jarvis-glass:${TAG}" | k3s ctr images import -
k3s ctr images ls | grep jarvis-glass || true
rm -rf /tmp/jarvis-glass-build /tmp/jarvis-glass-src.tgz
EOF
rm -f /tmp/jarvis-glass-src.tgz
fi

echo "OK  docker.io/library/jarvis-orchestrator:${ORCH_TAG}"
if [ "${SKIP_GLASS:-}" != "1" ]; then echo "OK  docker.io/library/jarvis-glass:${TAG}"; fi
echo "Flux: clusters/jarvis/apps/jarvis-orchestrator.yaml + jarvis-glass.yaml"
echo "Secret (once): kubectl -n apps create secret generic jarvis-orchestrator --from-file=LITELLM_API_KEY=\$HOME/.litellm-master.key"
echo "Cutover: after Flux is healthy, scale jarvis-core to 0 and delete its Ingress."
