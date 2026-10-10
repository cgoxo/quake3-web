#!/usr/bin/env bash
# Push only the static site (web/) without restarting the lobby, so live rooms survive.
set -euo pipefail
PROJECT=${PROJECT:-quake3-arena-mk1a7}
ZONE=${ZONE:-asia-south1-a}
VM=${VM:-q3-1}
cd "$(dirname "$0")/.."
export COPYFILE_DISABLE=1
mkdir -p web/engine && cp build/web-engine/* web/engine/
LOCAL=$(mktemp -d)
# Unique names: /tmp on the VM is shared by every user that deploys (you, CI).
RTMP="/tmp/q3web-$(whoami)-$$"
tar --no-xattrs -czf "$LOCAL/web.tgz" web
gcloud --project "$PROJECT" compute scp --quiet --zone "$ZONE" "$LOCAL/web.tgz" "$VM:$RTMP.tgz"
gcloud --project "$PROJECT" compute ssh "$VM" --quiet --zone "$ZONE" \
  --command "sudo bash -c 'set -e; mkdir -p $RTMP && tar -xzf $RTMP.tgz -C $RTMP && mkdir -p /srv/q3/web && find /srv/q3/web -mindepth 1 -delete && cp -r $RTMP/web/. /srv/q3/web/ && rm -rf $RTMP $RTMP.tgz'"
rm -rf "$LOCAL"
echo "Web updated"
