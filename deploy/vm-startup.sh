#!/bin/bash
# GCE startup script: installs Docker, adds swap (e2-small has 2 GB), fetches OpenArena data.
set -euo pipefail
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
mkdir -p /srv/q3
if [ ! -d /srv/q3/openarena/baseoa ]; then
  apt-get install -y unzip gettext-base
  curl -fsSL -o /tmp/oa.zip https://download.tuxfamily.org/openarena/rel/088/openarena-0.8.8.zip
  unzip -q /tmp/oa.zip -d /tmp/oa
  mkdir -p /srv/q3/openarena
  mv /tmp/oa/openarena-0.8.8/baseoa /srv/q3/openarena/
  # The zip ships owner-only dirs; the lobby container runs as uid 1000.
  chmod -R a+rX /srv/q3/openarena
  rm -rf /tmp/oa /tmp/oa.zip
fi
touch /srv/q3/.ready
