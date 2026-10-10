import { api, getName, setName, cleanName, isTouch } from './common.js';
import { loadAssets } from './assets.js';
import { setupTouch } from './touch.js';
import { joinVoice } from './voice.js';

const $ = id => document.getElementById(id);
const roomId = location.pathname.split('/').filter(Boolean).pop();
const inviteUrl = `${location.origin}/r/${roomId}`;
const msg = text => { $('msg').textContent = text ?? ''; };

// The engine "connects" to this placeholder address; Emscripten's socket layer
// routes every datagram over our WebSocket instead, so the IP is never used.
// A private address also makes the engine treat the link as LAN (no rate cap).
const FAKE_SERVER = '10.13.37.1:27960';

$('name').value = getName();

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl);
    return true;
  } catch {
    prompt('Copy this link', inviteUrl);
    return false;
  }
}
$('invite').addEventListener('click', async () => {
  if (navigator.share && isTouch) {
    navigator.share({ title: 'Join my deathmatch', url: inviteUrl }).catch(() => {});
  } else if (await copyInvite()) {
    $('invite').textContent = 'Link copied';
  }
});
$('hudInvite').addEventListener('click', async () => {
  if (await copyInvite()) $('hudInvite').textContent = 'Copied';
});

// ----- room + assets -----
let room;
try {
  room = await api(`/api/rooms/${roomId}`);
} catch (err) {
  $('mapTitle').textContent = 'Room not found';
  $('roomInfo').textContent = 'This room has closed. Rooms shut down a couple of minutes after the last player leaves.';
  $('progress').textContent = '';
  $('play').textContent = 'Back to rooms';
  $('play').disabled = false;
  $('play').addEventListener('click', () => { location.href = '/'; });
  throw err;
}

$('mapTitle').textContent = room.mapTitle;
$('roomInfo').textContent = `${room.humans} playing, ${room.bots} bot${room.bots === 1 ? '' : 's'}, up to ${room.maxPlayers} players. Room ${room.id}.`;
document.title = `${room.mapTitle} · Arena`;

const manifest = await api('/api/manifest');
const files = [...manifest.core, manifest.maps[room.map]];
const assetsPromise = loadAssets(files, (done, total) => {
  const pct = total ? Math.min(100, (done / total) * 100) : 100;
  $('bar').style.width = `${pct}%`;
  $('progress').textContent = done >= total
    ? 'Ready'
    : `Downloading arena: ${(done / 1e6).toFixed(1)} of ${(total / 1e6).toFixed(1)} MB`;
});
assetsPromise.then(() => {
  $('play').disabled = false;
}, err => {
  msg(`${err.message}. Check your connection and reload.`);
});

// ----- start -----
let started = false;
$('play').addEventListener('click', async () => {
  if (started) return;
  started = true;
  const name = setName(cleanName($('name').value));
  const wantMic = $('mic').checked;

  // These need the click's user gesture. Don't await them: some browsers never
  // settle the promise (or reject late), and the game should start regardless.
  if (isTouch) {
    Promise.resolve(document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }))
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => { /* iOS has no fullscreen API; the rotate prompt covers portrait */ });
  }

  const assets = await assetsPromise;
  $('gate').hidden = true;
  $('hud').hidden = false;
  document.body.classList.add('playing');
  if (isTouch) document.body.classList.add('touch-on');

  let engine;
  try {
    engine = await startEngine(assets, name);
  } catch (err) {
    console.error(err);
    $('gate').hidden = false;
    msg(`The game failed to start: ${err.message ?? err}. Reload to try again.`);
    return;
  }

  const cmd = text => engine.ccall('Web_Command', null, ['string'], [text]);
  const mouseMove = (dx, dy) => engine._Web_MouseMove(dx, dy);
  // Tell the server we're leaving so we don't linger as a ghost until timeout.
  window.addEventListener('pagehide', () => {
    try { engine.ccall('Web_CommandNow', null, ['string'], ['disconnect']); } catch { /* engine already gone */ }
  });

  let voice = null;
  const talk = on => voice?.talk(on);
  if (isTouch) setupTouch({ cmd, mouseMove, onTalk: talk });

  if (wantMic) {
    joinVoice(roomId, name, $('voiceChip')).then(v => {
      voice = v;
      if (v) $('talkBtn').hidden = false;
    }).catch(err => {
      console.warn('voice unavailable', err);
      $('voiceChip').hidden = false;
      $('voiceChip').textContent = 'Voice unavailable';
    });
  }
  // Push-to-talk on V. V is unbound in the engine at startup so it doesn't double as a game key.
  window.addEventListener('keydown', e => { if (e.code === 'KeyV' && !e.repeat) talk(true); });
  window.addEventListener('keyup', e => { if (e.code === 'KeyV') talk(false); });
});

async function startEngine(assets, name) {
  // Render at the window's size (capped DPR so phones don't render 3x pixels).
  const dpr = Math.min(window.devicePixelRatio || 1, isTouch ? 1 : 1.5);
  const width = Math.round(window.innerWidth * dpr);
  const height = Math.round(window.innerHeight * dpr);
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${roomId}`;
  const mobile = isTouch
    ? '+set r_picmip 1 +set r_dynamiclight 0 +set cg_shadows 0 +set r_flares 0 +set cg_simpleItems 1 +set cg_marks 0'
    : '';
  const args = `
    +set com_basegame baseoa
    +set fs_game ""
    +set sv_pure 0
    +set net_enabled 1
    +set r_fullscreen 0
    +set r_mode -1
    +set r_customwidth ${width}
    +set r_customheight ${height}
    +set cl_motd 0
    +set cl_allowDownload 0
    +set com_introplayed 1
    +set cl_renderer opengl2
    +set name "${name}"
    +set in_joystick 0
    +set cg_drawFPS 0
    ${mobile}
    +unbind v
    +connect ${FAKE_SERVER}
  `;

  const { default: ioquake3 } = await import('/engine/ioquake3.js');
  return ioquake3({
    canvas: $('canvas'),
    arguments: args.trim().split(/\s+/),
    locateFile: f => `/engine/${f}`,
    // Emscripten's UDP-over-WebSocket: every socket goes to this room's gateway.
    websocket: { url: wsUrl, subprotocol: 'binary' },
    print: t => console.log(t),
    printErr: t => console.warn(t),
    preRun: [module => {
      for (const { file, data } of assets) {
        const dir = `/${file.slice(0, file.lastIndexOf('/'))}`;
        module.FS.mkdirTree(dir);
        module.FS.writeFile(`/${file}`, data);
      }
    }],
    onExit: () => { location.href = '/'; },
  });
}
