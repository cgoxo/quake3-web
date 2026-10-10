// Touch overlay: floating joystick on the left, drag-to-look on the right, action buttons.
// Movement goes to the engine as console commands (+forward, ...) so it works whatever
// the player's key bindings are. FIRE goes through Web_Fire, which also clicks in menus.
const DEAD = 0.28;      // joystick dead zone, fraction of radius
const RADIUS = 60;

export function setupTouch({ cmd, mouseMove, fire, lookSpeed, onTalkToggle, onMenu }) {
  const stick = document.getElementById('stick');
  const knob = stick.querySelector('.knob');
  const moveZone = document.getElementById('moveZone');
  const lookZone = document.getElementById('lookZone');

  // ----- joystick -----
  let stickId = null;
  let origin = null;
  const held = { forward: false, back: false, moveleft: false, moveright: false };

  const setHeld = (name, on) => {
    if (held[name] === on) return;
    held[name] = on;
    cmd(`${on ? '+' : '-'}${name}`);
  };

  const updateStick = (x, y) => {
    let dx = x - origin.x;
    let dy = y - origin.y;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / RADIUS;
    const ny = dy / RADIUS;
    setHeld('forward', ny < -DEAD);
    setHeld('back', ny > DEAD);
    setHeld('moveleft', nx < -DEAD);
    setHeld('moveright', nx > DEAD);
  };

  const releaseStick = () => {
    stickId = null;
    stick.style.display = 'none';
    knob.style.transform = '';
    for (const k of Object.keys(held)) setHeld(k, false);
  };

  moveZone.addEventListener('touchstart', e => {
    e.preventDefault();
    if (stickId !== null) return;
    const t = e.changedTouches[0];
    stickId = t.identifier;
    origin = { x: t.clientX, y: t.clientY };
    stick.style.left = `${t.clientX}px`;
    stick.style.top = `${t.clientY}px`;
    stick.style.display = 'block';
  }, { passive: false });

  // ----- look -----
  const looks = new Map(); // touch id -> last position

  lookZone.addEventListener('touchstart', e => {
    e.preventDefault();
    for (const t of e.changedTouches) looks.set(t.identifier, { x: t.clientX, y: t.clientY });
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    const speed = lookSpeed();
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        updateStick(t.clientX, t.clientY);
      } else if (looks.has(t.identifier)) {
        const last = looks.get(t.identifier);
        const dx = Math.round((t.clientX - last.x) * speed);
        const dy = Math.round((t.clientY - last.y) * speed);
        if (dx || dy) mouseMove(dx, dy);
        looks.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
  }, { passive: true });

  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) releaseStick();
      looks.delete(t.identifier);
    }
  };
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);

  // ----- hold / tap buttons -----
  // A held button also works as a look surface: drag your thumb off FIRE to aim while shooting.
  const heldButtons = new Set();
  const press = (btn, down) => {
    const { hold, tap, action } = btn.dataset;
    btn.classList.toggle('held', down);
    if (action === 'fire') fire(down);
    else if (hold) cmd(down ? hold : hold.replace('+', '-'));
    else if (tap && down) cmd(tap);
    down ? heldButtons.add(btn) : heldButtons.delete(btn);
  };
  for (const btn of document.querySelectorAll('.touch [data-hold], .touch [data-tap], .touch [data-action="fire"]')) {
    btn.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      press(btn, true);
      for (const t of e.changedTouches) looks.set(t.identifier, { x: t.clientX, y: t.clientY });
    }, { passive: false });
    const up = e => {
      if (heldButtons.has(btn)) press(btn, false);
      for (const t of e.changedTouches) looks.delete(t.identifier);
    };
    btn.addEventListener('touchend', up);
    btn.addEventListener('touchcancel', up);
  }

  // ----- talk (tap to toggle) and menu -----
  const tapOnly = (el, fn) => el.addEventListener('touchstart', e => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  }, { passive: false });
  tapOnly(document.getElementById('talkBtn'), onTalkToggle);
  tapOnly(document.getElementById('menuBtn'), onMenu);

  return {
    // Let go of everything, e.g. when a menu opens over the game.
    releaseAll() {
      releaseStick();
      looks.clear();
      for (const btn of [...heldButtons]) press(btn, false);
    },
  };
}
