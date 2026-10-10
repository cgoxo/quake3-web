// Player settings, kept per browser and applied to the engine as cvars.
import { isTouch } from './common.js';

const KEY = 'q3.settings';

// Render scale per graphics preset (multiplied by CSS pixels, capped by the screen's DPR).
export const QUALITY = { fast: 1, balanced: 1.25, sharp: 1.75 };

const DEFAULTS = {
  sens: 5,          // engine "sensitivity"; touch look speed scales from it
  fov: isTouch ? 100 : 90,
  volume: 0.7,
  invert: false,
  quality: isTouch ? 'balanced' : 'sharp',
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
}

export function renderScale(s) {
  return Math.max(1, Math.min(window.devicePixelRatio || 1, QUALITY[s.quality] ?? 1.25));
}

// Touch look speed in engine mouse units per CSS pixel.
export const touchLookSpeed = s => s.sens * 0.44;

// Console commands that apply everything except the render scale (that needs vid_restart).
export function settingsCommands(s) {
  return [
    `set sensitivity ${s.sens}`,
    `set cg_fov ${s.fov}`,
    `set s_volume ${s.volume}`,
    `set m_pitch ${s.invert ? -0.022 : 0.022}`,
  ];
}
