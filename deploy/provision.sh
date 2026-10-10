#!/usr/bin/env bash
# One-time GCP setup: static IP, firewall, VM. Safe to re-run (skips what exists).
set -euo pipefail
PROJECT=${PROJECT:-quake3-arena-mk1a7}
REGION=${REGION:-asia-south1}
ZONE=${ZONE:-asia-south1-a}
VM=${VM:-q3-1}
cd "$(dirname "$0")"
g() { gcloud --project "$PROJECT" "$@"; }

g services enable compute.googleapis.com
g compute addresses describe q3-ip --region "$REGION" >/dev/null 2>&1 ||
  g compute addresses create q3-ip --region "$REGION" --network-tier STANDARD
g compute firewall-rules describe q3-web >/dev/null 2>&1 ||
  g compute firewall-rules create q3-web --allow tcp:80,tcp:443 --target-tags q3 --description "HTTPS site, API and game WebSockets"
g compute firewall-rules describe q3-voice >/dev/null 2>&1 ||
  g compute firewall-rules create q3-voice --allow tcp:7881,udp:7882 --target-tags q3 --description "LiveKit voice media"
g compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1 ||
  g compute instances create "$VM" --zone "$ZONE" \
    --machine-type e2-small \
    --image-family debian-12 --image-project debian-cloud \
    --boot-disk-size 20GB --boot-disk-type pd-standard \
    --network-tier STANDARD --address q3-ip --tags q3 \
    --metadata-from-file startup-script=vm-startup.sh
IP=$(g compute addresses describe q3-ip --region "$REGION" --format 'value(address)')
echo "VM $VM ready at $IP -> https://${IP//./-}.sslip.io"
