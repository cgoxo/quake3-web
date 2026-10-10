import { api, getName, setName, cleanName, isTouch } from './common.js';
import { loadAssets } from './assets.js';
import { setupTouch } from './touch.js';
import { joinVoice } from './voice.js';
import { setupMenu } from './menu.js';
import { loadSettings, renderScale, settingsCommands, touchLookSpeed } from './settings.js';
import { gameBox, applyBox, watchSize, isPortrait, fullscreenSupported, isFullscreen, enterFullscreen } from './view.js';

const $ = id => document.getElementById(id);
const roomId = location.pathname.split('/').filter(Boolean).pop();
const inviteUrl = `${location.origin}/r/${roomId}`;
const msg = text => { $('msg').textContent = text ?? ''; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The engine "connects" to this placeholder address; Emscripten's socket layer
// routes every datagram over our WebSocket instead, so the IP is never used.
// A private address also makes the engine treat the link as LAN (no rate cap).
const FAKE_SERVER = '10.13.37.1:27960';
const CA_DISCONNECTED = 1;
const CA_CONNECTED = 5;
const CA_ACTIVE = 8;

const settings = loadSettings();
let playing = false;
let menu = null;

$('name').value = getName();
if (isTouch) $('micLabel').textContent = 'Voice chat (tap TALK to switch your mic on)';
applyBox(gameBox(1));

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl);
    return true;
  } catch {
    prompt('Copy this link', inviteUrl);
    return false;
  }
}
async function shareInvite() {
  if (navigator.share && isTouch) {
    try { await navigator.share({ title: 'Join my deathmatch', url: inviteUrl }); } catch { /* cancelled */ }
    return false;
  }
  return copyInvite();
}
$('invite').addEventListener('click', async e => { if (await shareInvite()) e.target.textContent = 'Link copied'; });
$('hudInvite').addEventListener('click', async e => { if (await shareInvite()) e.target.textContent = 'Copied'; });

// ----- keyboard: Escape opens our menu instead of OpenArena's -----
// Registered before the engine loads so these capture-phase listeners run first.
for (const type of ['keydown', 'keyup', 'keypress']) {
  window.addEventListener(type, e => {
    if (!playing) return;
    if (menu?.isOpen) {
      // Keys belong to the menu (typing a name, arrow keys on sliders), not the game.
      e.stopImmediatePropagation();
      if (type === 'keydown' && e.key === 'Escape') menu.close();
      return;
    }
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (type === 'keydown') menu?.open();
    }
  }, true);
}

// ----- fullscreen and rotation (phones) -----
const fsPrompt = $('fsPrompt');
const syncFullscreenPrompt = () => {
  const lost = isTouch && playing && fullscreenSupported() && !isFullscreen() && !isPortrait();
  fsPrompt.hidden = !lost;
};
fsPrompt.addEventListener('click', () => enterFullscreen().then(syncFullscreenPrompt));
$('rotateFs').hidden = !fullscreenSupported();
$('rotateFs').addEventListener('click', () => enterFullscreen().then(syncFullscreenPrompt));
document.addEventListener('fullscreenchange', syncFullscreenPrompt);
window.addEventListener('resize', syncFullscreenPrompt);

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
$('menuTitle').textContent = room.mapTitle;
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
  $('name').value = name;
  const wantMic = $('mic').checked;

  // Needs this click's user gesture, so start it before any await.
  const fsDone = isTouch ? enterFullscreen() : Promise.resolve(false);

  const assets = await assetsPromise;
  $('gate').hidden = true;
  $('hud').hidden = false;
  playing = true;
  document.body.classList.add('playing');
  if (isTouch) document.body.classList.add('touch-on');

  // Let fullscreen and rotation settle so the engine starts at the final size.
  await Promise.race([fsDone, sleep(900)]);
  await sleep(150);
  let box = gameBox(renderScale(settings));
  applyBox(box);

  let engine;
  try {
    engine = await startEngine(assets, name, box);
  } catch (err) {
    console.error(err);
    playing = false;
    $('gate').hidden = false;
    msg(`The game failed to start: ${err.message ?? err}. Reload to try again.`);
    return;
  }

  const cmd = text => engine.ccall('Web_Command', null, ['string'], [text]);
  if (new URLSearchParams(location.search).has('debug')) window.q3 = { engine, cmd };
  const now = text => engine.ccall('Web_CommandNow', null, ['string'], [text]);

  // Tell the server we're leaving so we don't linger as a ghost until timeout.
  window.addEventListener('pagehide', () => {
    try { now('disconnect'); } catch { /* engine already gone */ }
  });

  // Re-render at the new size when the view changes shape (rotation, fullscreen,
  // window resize). Small changes that keep the aspect ratio are left to CSS.
  const resizeTo = (next, force = false) => {
    if (isPortrait() && isTouch) return; // the rotate prompt is showing
    const aspectChange = Math.abs(next.w / next.h - box.w / box.h) / (box.w / box.h);
    const sizeChange = Math.abs(next.w - box.w) / box.w;
    if (!force && aspectChange < 0.03 && sizeChange < 0.15) return;
    box = next;
    cmd(`set r_customwidth ${box.w}; set r_customheight ${box.h}; vid_restart`);
  };
  const checkSize = watchSize(() => renderScale(settings), next => resizeTo(next));
  checkSize();

  // ----- voice -----
  let voice = null;
  const syncTalkBtn = () => {
    const on = !!voice?.talking;
    $('talkBtn').classList.toggle('held', on);
    $('talkBtn').textContent = on ? 'MIC ON' : 'TALK';
  };
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
  // Desktop: hold V to talk (V is unbound in the engine).
  window.addEventListener('keydown', e => { if (e.code === 'KeyV' && !e.repeat && !menu.isOpen) voice?.talk(true); });
  window.addEventListener('keyup', e => { if (e.code === 'KeyV') voice?.talk(false); });

  // ----- touch -----
  let touch = null;
  if (isTouch) {
    touch = setupTouch({
      cmd,
      mouseMove: (dx, dy) => engine._Web_MouseMove(dx, dy),
      fire: down => engine._Web_Fire(down ? 1 : 0),
      lookSpeed: () => touchLookSpeed(settings),
      onTalkToggle: async () => { await voice?.talk(!voice.talking); syncTalkBtn(); },
      onMenu: () => menu.open(),
    });
  }

  // ----- menu -----
  let qualityChanged = false;
  menu = setupMenu({
    settings,
    voice: () => voice,
    onSettings: key => {
      if (key === 'quality') qualityChanged = true;
      else for (const c of settingsCommands(settings)) cmd(c);
    },
    onName: n => cmd(`set name "${n}"`),
    onInvite: shareInvite,
    onOpen: () => {
      touch?.releaseAll();
      cmd('-attack');
      if (!isTouch) document.exitPointerLock?.();
    },
    onClose: () => {
      syncTalkBtn();
      if (qualityChanged) {
        qualityChanged = false;
        resizeTo(gameBox(renderScale(settings)), true);
      }
      if (!isTouch) $('canvas').requestPointerLock?.();
    },
  });

  // Desktop: losing pointer lock (Escape is handled by the browser itself) opens the menu.
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && playing && !isTouch && !menu.isOpen && $('lost').hidden) menu.open();
  });

  // ----- connection watch -----
  let wasConnected = false;
  const watch = setInterval(() => {
    let state;
    try { state = engine._Web_ClientState(); } catch { state = CA_DISCONNECTED; }
    if (state >= CA_CONNECTED) wasConnected = true;
    if (wasConnected && state <= CA_DISCONNECTED) {
      clearInterval(watch);
      showLost();
    }
  }, 1000);
  engine.__onExit = () => { clearInterval(watch); showLost(); };
});

async function showLost() {
  playing = false;
  menu?.close();
  document.exitPointerLock?.();
  document.body.classList.remove('touch-on');
  $('lost').hidden = false;
  try {
    await api(`/api/rooms/${roomId}`);
  } catch (err) {
    if (err.status !== 404) return; // network trouble: Rejoin may still work
    $('lostInfo').textContent = 'This room has closed.';
    $('rejoin').hidden = true;
  }
}
$('rejoin').addEventListener('click', () => location.reload());

async function startEngine(assets, name, box) {
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${roomId}`;
  const mobile = isTouch
    ? '+set r_picmip 1 +set r_dynamiclight 0 +set cg_shadows 0 +set r_flares 0 +set cg_simpleItems 1 +set cg_marks 0'
    : '';
  const prefs = settingsCommands(settings).map(c => `+${c}`).join(' ');
  const args = `
    +set com_basegame baseoa
    +set fs_game ""
    +set sv_pure 0
    +set net_enabled 1
    +set r_fullscreen 0
    +set r_mode -1
    +set r_customwidth ${box.w}
    +set r_customheight ${box.h}
    +set cl_motd 0
    +set cl_allowDownload 0
    +set cl_renderer opengl2
    +set name "${name}"
    +set in_joystick 0
    +set cg_drawFPS 0
    ${mobile}
    ${prefs}
    +unbind v
    +connect ${FAKE_SERVER}
  `;

  const { default: ioquake3 } = await import('/engine/ioquake3.js');
  const module = await ioquake3({
    canvas: $('canvas'),
    arguments: args.trim().split(/\s+/),
    locateFile: f => `/engine/${f}`,
    // Emscripten's UDP-over-WebSocket: every socket goes to this room's gateway.
    websocket: { url: wsUrl, subprotocol: 'binary' },
    print: t => console.log(t),
    printErr: t => console.warn(t),
    preRun: [m => {
      for (const { file, data } of assets) {
        const dir = `/${file.slice(0, file.lastIndexOf('/'))}`;
        m.FS.mkdirTree(dir);
        m.FS.writeFile(`/${file}`, data);
      }
    }],
    onExit: () => module?.__onExit?.(),
  });
  return module;
}
