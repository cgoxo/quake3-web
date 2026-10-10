# Arena: browser deathmatch on ioquake3

Free-for-all deathmatch you play from a link, on desktop or phone. Bots fill empty
rooms, and players in a room can talk over push-to-talk voice.

Live: https://35-207-211-119.sslip.io (GCP project `quake3-arena-mk1a7`, VM `q3-1`, asia-south1-a)

## How it fits together

```
browser ──HTTPS/WSS :443──► Caddy ──► lobby (Node, :3000) ──UDP 127.0.0.1──► ioq3ded (one per room)
   │                                    ├─ /api/*   rooms, maps, quick play, voice tokens
   │                                    ├─ /ws/:id  WebSocket ⇄ UDP gateway
   │                                    └─ static site, wasm engine, pk3 content
   └──WebRTC (UDP 7882 / TCP 7881)──► LiveKit (voice, one voice room per game room)
```

- **Engine**: upstream [ioquake/ioq3](https://github.com/ioquake/ioq3) at the commit in
  `engine/IOQ3_COMMIT`, plus `engine/patches/ioq3-web.patch`:
  - skips the `FIONBIO` ioctl on Emscripten, so the UDP socket opens in the browser;
  - exports `Web_Command`, `Web_CommandNow`, `Web_MouseMove`, `Web_Fire` and
    `Web_ClientState` for the touch overlay, the menu and the disconnect screen;
  - exports `ccall` and enables memory growth.
- **Networking**: the wasm client uses Emscripten's socket emulation, which carries each
  UDP datagram as one binary WebSocket message. `Module.websocket.url` points every
  socket at `/ws/<room>`. The gateway (`server/src/gateway.js`) drops Emscripten's
  10-byte port header and gives each player its own UDP socket to the room's server.
- **Rooms**: `server/src/rooms.js` starts one `ioq3ded` per room on a localhost port
  (27960–27999). Rooms are deathmatch only (`g_gametype 0`) with `bot_minplayers 4`.
  They poll status with `getstatus`. A room stops 2 minutes after its last human
  leaves; a new room gets 5 minutes for its creator to download and join. Both are
  set with `ROOM_IDLE_SECONDS` and `ROOM_START_GRACE_SECONDS`. Bots alone never keep
  a room alive.
- **Content**: OpenArena 0.8.8 (GPL). The server reads the stock pk3s. The browser
  gets a trimmed set from `content/build_content.py`:
  - a 46 MB core pack;
  - one 1–9 MB pack per map, holding only the textures that map's BSP references.

  Both are cached in the Cache API, so repeat visits start instantly.

## Maps

| Map | Notes |
| --- | --- |
| wrackdm17 | The Longest Yard (q3dm17) remake |
| q3dm6ish | Campgrounds (q3dm6) remake |
| dm4ish | Tight arena remake |
| aggressor | Fast mid-sized arena |
| oa_dm1 | OpenArena's beginner map |
| kaos2 | Vertical gothic arena |
| oa_rpg3dm2 | Large outdoor graveyard |
| am_thornish | Compact arena with jump pads |

To add a map, add it to `MAPS` in `content/build_content.py` and rerun `content/build.sh`.
The map must ship an `.aas` file, or bots will stand still.

## Controls

- **Desktop**: click to lock the mouse; WASD/arrows to move, mouse to aim and fire.
  Hold **V** to talk. **Escape** opens the menu.
- **Mobile**: landscape only, fullscreen. Left thumb is a floating joystick, and dragging
  on the right side aims. On-screen buttons:
  - FIRE, which also clicks at the cursor in OpenArena's menus;
  - JUMP and DUCK;
  - weapon ◀ ▶, TAB for scores, and ≡ for the menu;
  - TALK at top left: tap to switch your mic on or off.
- **Menu** (ours, replacing OpenArena's): Resume, name, look sensitivity, field of view,
  volume, graphics quality, invert look, mic and mute, invite link and Leave room.
  Settings are saved per browser.
- **Screen shape**: the view is clamped between 4:3 and 16:9 and centred, because
  OpenArena's HUD is a stretched 640×480 layout. On wide phones the controls sit in
  the side bars. The engine re-renders at the new size after rotating or resizing.
- **Testing**: add `?touch=1` to a room URL for the phone overlay on desktop, and
  `?debug=1` to expose `window.q3`.

## Develop locally

```sh
content/build.sh                                   # downloads OpenArena, builds build/content
docker build -f engine/Dockerfile.web --build-arg EMSDK_TAG=3.1.58-arm64 \
  --build-arg IOQ3_COMMIT=$(cat engine/IOQ3_COMMIT) -o type=local,dest=build/web-engine engine
mkdir -p web/engine && cp build/web-engine/* web/engine/
docker build -f engine/Dockerfile.server --build-arg IOQ3_COMMIT=$(cat engine/IOQ3_COMMIT) -t q3-lobby:dev .
docker run --rm -p 3000:3000 -e WEB_DIR=/web -v $PWD/web:/web:ro \
  -v $PWD/content/download/extracted/openarena-0.8.8:/data:ro -v $PWD/build/content:/content:ro q3-lobby:dev
# open http://localhost:3000
```

Use `EMSDK_TAG=3.1.58` on x86 machines.

## Deploy

```sh
deploy/provision.sh    # once: static IP, firewall (80/443, 7881/tcp, 7882/udp), e2-small VM
deploy/deploy.sh       # build wasm + content locally, ship, docker compose up (restarts rooms)
deploy/deploy-web.sh   # push only web/ changes; live rooms keep running
```

Secrets (LiveKit key and secret) are generated on the VM in `/srv/q3/secrets.env` and kept across deploys.

## Cost

e2-small, 20 GB standard disk and a static IP on the Standard network tier come to
about ₹1,800 a month. Until 2027-01-02 that comes out of the free-trial credit. A
₹2,000 monthly budget alerts at 25%, 50%, 90% and 100%.

## Licences

- Engine: ioquake3, GPLv2. Our changes are in `engine/patches/`.
- Game content: OpenArena, GPLv2.
- Quake III Arena is a trademark of id Software. No id Software data is used or hosted.
