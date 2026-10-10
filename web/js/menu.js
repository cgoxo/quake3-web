// In-game menu (replaces OpenArena's): resume, settings, voice, invite, leave.
import { cleanName, setName } from './common.js';
import { saveSettings } from './settings.js';

const $ = id => document.getElementById(id);

export function setupMenu({ settings, onSettings, onName, onOpen, onClose, onInvite, voice }) {
  const menu = $('menu');
  const fields = {
    sens: [$('setSens'), $('sensOut'), v => Number(v).toFixed(1)],
    fov: [$('setFov'), $('fovOut'), v => `${v}°`],
    volume: [$('setVol'), $('volOut'), v => `${Math.round(v * 100)}%`],
  };

  const fill = () => {
    for (const [key, [input, out, fmt]] of Object.entries(fields)) {
      input.value = settings[key];
      out.textContent = fmt(settings[key]);
    }
    $('setQuality').value = settings.quality;
    $('setInvert').checked = settings.invert;
  };

  const changed = key => {
    saveSettings(settings);
    onSettings(key);
  };

  for (const [key, [input, out, fmt]] of Object.entries(fields)) {
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      out.textContent = fmt(settings[key]);
      changed(key);
    });
  }
  $('setQuality').addEventListener('change', e => { settings.quality = e.target.value; changed('quality'); });
  $('setInvert').addEventListener('change', e => { settings.invert = e.target.checked; changed('invert'); });
  $('setName').addEventListener('change', e => {
    const name = setName(cleanName(e.target.value));
    e.target.value = name;
    onName(name);
  });

  let open = false;
  const show = () => {
    if (open) return;
    open = true;
    fill();
    menu.hidden = false;
    document.body.classList.add('menu-open');
    onOpen();
    $('resume').focus({ preventScroll: true });
  };
  const hide = () => {
    if (!open) return;
    open = false;
    menu.hidden = true;
    document.body.classList.remove('menu-open');
    onClose();
  };

  $('resume').addEventListener('click', hide);
  $('menuInvite').addEventListener('click', async e => {
    if (await onInvite()) e.target.textContent = 'Link copied';
  });
  $('leave').addEventListener('click', () => { location.href = '/'; });
  menu.addEventListener('click', e => { if (e.target === menu) hide(); });

  // ----- voice controls -----
  const micBtn = $('micToggle');
  const muteBtn = $('muteOthers');
  const syncVoice = () => {
    const v = voice();
    $('voiceRow').hidden = !v;
    if (!v) return;
    micBtn.textContent = v.talking ? 'Turn mic off' : 'Turn mic on';
    muteBtn.textContent = v.othersMuted ? 'Unmute others' : 'Mute others';
  };
  micBtn.addEventListener('click', async () => { await voice()?.talk(!voice().talking); syncVoice(); });
  muteBtn.addEventListener('click', () => { voice()?.muteOthers(!voice().othersMuted); syncVoice(); });

  return {
    open: () => { $('setName').value = $('name').value; syncVoice(); show(); },
    close: hide,
    get isOpen() { return open; },
  };
}
