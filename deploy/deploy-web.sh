#!/usr/bin/env bash
# Push only the static site (web/) without restarting the lobby, so live rooms survive.
set -euo pipefail
PROJECT=${PROJECT:-quake3-arena-mk1a7}
ZONE=${ZONE:-asia-south1-a}
VM=${VM:-q3-1}
cd "$(dirname "$0")/.."
export COPYFILE_DISABLE=1
mkdir -p web/engine && cp build/web-engine/* web/engine/
tar --no-xattrs -czf /tmp/q3web.tgz web
gcloud --project "$PROJECT" compute scp --quiet --zone "$ZONE" /tmp/q3web.tgz "$VM:/tmp/"
gcloud --project "$PROJECT" compute ssh "$VM" --quiet --zone "$ZONE" \
  --command "sudo bash -c 'cd /tmp && rm -rf web && tar -xzf q3web.tgz && mkdir -p /srv/q3/web && find /srv/q3/web -mindepth 1 -delete && cp -r web/. /srv/q3/web/'"
rm /tmp/q3web.tgz
echo "Web updated"
