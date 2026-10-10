// Canvas sizing and fullscreen.
//
// OpenArena draws its HUD on a virtual 640x480 screen stretched to the window,
// so very wide windows (phones in landscape are ~20:9) make it look smeared.
// We clamp the game view between 4:3 and 16:9 and centre it; the black bars
// hold the touch controls. The engine renders at the box's real pixel size and
// is told the new size (vid_restart) when the box changes shape.
const MAX_ASPECT = 16 / 9;
const MIN_ASPECT = 4 / 3;

export function gameBox(scale) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let w = vw;
  let h = vh;
  if (w / h > MAX_ASPECT) w = Math.round(h * MAX_ASPECT);
  if (w / h < MIN_ASPECT) h = Math.round(w / MIN_ASPECT);
  return { cssW: w, cssH: h, w: Math.round(w * scale), h: Math.round(h * scale) };
}

export function applyBox(box) {
  const root = document.documentElement.style;
  root.setProperty('--game-w', `${box.cssW}px`);
  root.setProperty('--game-h', `${box.cssH}px`);
}

// Calls onChange(box) when the window settles at a new size.
export function watchSize(getScale, onChange) {
  let timer = null;
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const box = gameBox(getScale());
      applyBox(box);
      onChange(box);
    }, 350);
  };
  window.addEventListener('resize', check);
  screen.orientation?.addEventListener?.('change', check);
  return check;
}

export const isPortrait = () => window.innerHeight > window.innerWidth;

export const fullscreenSupported = () => !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;

export const isFullscreen = () => !!document.fullscreenElement;

// Must be called from a user gesture. Never throws; resolves when done or failed.
export function enterFullscreen() {
  if (!fullscreenSupported()) return Promise.resolve(false);
  const req = isFullscreen() ? Promise.resolve() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  return Promise.resolve(req)
    .then(() => screen.orientation?.lock?.('landscape'))
    .then(() => true, () => isFullscreen());
}
