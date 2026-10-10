#!/usr/bin/env bash
# Build the browser bits locally, ship everything to the VM, (re)start the stack.
set -euo pipefail
PROJECT=${PROJECT:-quake3-arena-mk1a7}
REGION=${REGION:-asia-south1}
ZONE=${ZONE:-asia-south1-a}
VM=${VM:-q3-1}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
g() { gcloud --project "$PROJECT" "$@"; }

# 1. wasm client (Docker) and trimmed content. CI passes SKIP_ENGINE_BUILD=1 with a prebuilt client.
EMSDK_TAG=3.1.58
[ "$(uname -m)" = arm64 ] || [ "$(uname -m)" = aarch64 ] && EMSDK_TAG=3.1.58-arm64
if [ -z "${SKIP_ENGINE_BUILD:-}" ] && { [ ! -f build/web-engine/ioquake3.wasm ] || [ engine/patches/ioq3-web.patch -nt build/web-engine/ioquake3.wasm ]; }; then
  docker build -f engine/Dockerfile.web --build-arg EMSDK_TAG="$EMSDK_TAG" \
    --build-arg IOQ3_COMMIT="$(cat engine/IOQ3_COMMIT)" -o type=local,dest=build/web-engine engine
fi
[ -f build/content/manifest.json ] || content/build.sh
mkdir -p web/engine && cp build/web-engine/* web/engine/

# 2. ship
IP=$(g compute addresses describe q3-ip --region "$REGION" --format 'value(address)')
DOMAIN="${IP//./-}.sslip.io"
STAGE=$(mktemp -d)
export COPYFILE_DISABLE=1  # no macOS ._ files in tarballs
tar --no-xattrs -czf "$STAGE/app.tgz" --exclude node_modules deploy engine server web
tar --no-xattrs -czf "$STAGE/content.tgz" -C build content
g compute scp --quiet --zone "$ZONE" "$STAGE/app.tgz" "$STAGE/content.tgz" "$VM:/tmp/"
rm -rf "$STAGE"

# 3. install and start
g compute ssh "$VM" --quiet --zone "$ZONE" --command "sudo bash -s" <<REMOTE
set -euo pipefail
until [ -f /srv/q3/.ready ]; do echo "waiting for VM startup script..."; sleep 10; done
mkdir -p /srv/q3/app && cd /srv/q3/app
rm -rf deploy engine server web && tar -xzf /tmp/app.tgz
mkdir -p /srv/q3/content && find /srv/q3/content -mindepth 1 -delete && tar -xzf /tmp/content.tgz -C /srv/q3
mkdir -p /srv/q3/web && find /srv/q3/web -mindepth 1 -delete && cp -r web/. /srv/q3/web/  # in place: keeps the bind mount valid
cd deploy
# Secrets live outside the app dir so redeploys keep the same LiveKit keys.
if [ ! -f /srv/q3/secrets.env ]; then
  echo "LK_API_KEY=lk\$(openssl rand -hex 6)" > /srv/q3/secrets.env
  echo "LK_API_SECRET=\$(openssl rand -hex 24)" >> /srv/q3/secrets.env
  chmod 600 /srv/q3/secrets.env
fi
{ cat /srv/q3/secrets.env; echo "DOMAIN=$DOMAIN"; echo "IOQ3_COMMIT=$(cat engine/IOQ3_COMMIT)"; } > .env
set -a; . ./.env; set +a
envsubst < livekit.yaml.tmpl > livekit.yaml
docker compose up -d --build
docker compose up -d --force-recreate lobby  # compose sometimes keeps the old container after a rebuild
# Bind-mounted config changes aren't detected by compose; restart to pick them up.
docker compose restart livekit caddy
docker compose ps
REMOTE
echo "Deployed: https://$DOMAIN"
