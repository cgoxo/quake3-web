// Touch overlay: floating joystick on the left, drag-to-look on the right, action buttons.
// Everything is sent to the engine as console commands (+forward, +attack, ...) so it
// works whatever the player's key bindings are.
const DEAD = 0.28;      // joystick dead zone, fraction of radius
const RADIUS = 60;
const LOOK_SENS = 2.2;  // engine mouse units per CSS pixel

export function setupTouch({ cmd, mouseMove, onTalk }) {
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
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        updateStick(t.clientX, t.clientY);
      } else if (looks.has(t.identifier)) {
        const last = looks.get(t.identifier);
        const dx = Math.round((t.clientX - last.x) * LOOK_SENS);
        const dy = Math.round((t.clientY - last.y) * LOOK_SENS);
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

  // ----- buttons -----
  // A held button also works as a look surface: drag your thumb off FIRE to aim while shooting.
  for (const btn of document.querySelectorAll('.touch [data-hold], .touch [data-tap]')) {
    const hold = btn.dataset.hold;
    const tap = btn.dataset.tap;
    btn.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('held');
      if (hold) cmd(hold);
      if (tap) cmd(tap);
      for (const t of e.changedTouches) looks.set(t.identifier, { x: t.clientX, y: t.clientY });
    }, { passive: false });
    const up = e => {
      btn.classList.remove('held');
      if (hold) cmd(hold.replace('+', '-'));
      for (const t of e.changedTouches) looks.delete(t.identifier);
    };
    btn.addEventListener('touchend', up);
    btn.addEventListener('touchcancel', up);
  }

  const talk = document.getElementById('talkBtn');
  talk.addEventListener('touchstart', e => {
    e.preventDefault();
    talk.classList.add('held');
    onTalk(true);
  }, { passive: false });
  const talkUp = () => {
    talk.classList.remove('held');
    onTalk(false);
  };
  talk.addEventListener('touchend', talkUp);
  talk.addEventListener('touchcancel', talkUp);
}
