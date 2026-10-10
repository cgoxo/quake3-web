import { api, getName, setName } from './common.js';

const $ = id => document.getElementById(id);
const nameInput = $('name');
const msg = $('msg');
let maps = [];
let chosenMap = null;

nameInput.value = getName();
nameInput.addEventListener('change', () => setName(nameInput.value));

function say(text) {
  msg.textContent = text ?? '';
}

function go(room) {
  setName(nameInput.value);
  location.href = room.link ?? `/r/${room.id}`;
}

function renderMaps() {
  const list = $('arenas');
  list.replaceChildren(...maps.map(m => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'arena';
    b.setAttribute('aria-pressed', String(m.name === chosenMap));
    b.innerHTML = `<img alt="" loading="lazy"><span class="cap"><strong></strong><span></span></span>`;
    b.querySelector('img').src = m.levelshot ?? '';
    b.querySelector('strong').textContent = m.title;
    b.querySelector('.cap span').textContent = m.note;
    b.addEventListener('click', () => {
      chosenMap = m.name;
      renderMaps();
      const chosen = $('chosen');
      chosen.textContent = 'Arena: ';
      const strong = document.createElement('b');
      strong.textContent = m.title;
      chosen.append(strong);
      $('create').maxPlayers.value = String(Math.min(12, Math.max(4, m.players + (m.players % 2))));
    });
    li.append(b);
    return li;
  }));
}

function renderRooms(rooms) {
  const list = $('rooms');
  if (!rooms.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No rooms right now. Press Quick play and the bots will be waiting for you.';
    list.replaceChildren(li);
    return;
  }
  const shot = name => maps.find(m => m.name === name)?.levelshot ?? '';
  list.replaceChildren(...rooms.map(r => {
    const li = document.createElement('li');
    li.className = 'room';
    li.innerHTML = `<img alt=""><div><div class="title"></div><div class="meta"></div></div>
      <div class="count"></div><button class="btn" type="button">Join</button>`;
    li.querySelector('img').src = shot(r.map);
    li.querySelector('.title').textContent = r.mapTitle;
    li.querySelector('.meta').textContent = `Room ${r.id}, ${r.bots} bot${r.bots === 1 ? '' : 's'}`;
    li.querySelector('.count').innerHTML = `${r.humans}<small> / ${r.maxPlayers} playing</small>`;
    li.querySelector('button').addEventListener('click', () => go(r));
    return li;
  }));
}

async function refreshRooms() {
  try {
    renderRooms(await api('/api/rooms'));
  } catch {
    /* keep the last list on a transient error */
  }
}

$('quickplay').addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  say('');
  try {
    go(await api('/api/quickplay', { method: 'POST' }));
  } catch (err) {
    say(err.message);
    btn.disabled = false;
  }
});

$('create').addEventListener('submit', async e => {
  e.preventDefault();
  if (!chosenMap) {
    say('Pick an arena first.');
    $('arenas').querySelector('button')?.focus();
    return;
  }
  const f = e.currentTarget;
  const btn = $('createBtn');
  btn.disabled = true;
  say('');
  try {
    go(await api('/api/rooms', {
      method: 'POST',
      body: { map: chosenMap, maxPlayers: Number(f.maxPlayers.value), skill: Number(f.skill.value), bots: f.bots.checked },
    }));
  } catch (err) {
    say(err.message);
    btn.disabled = false;
  }
});

maps = await api('/api/maps');
renderMaps();
refreshRooms();
setInterval(refreshRooms, 5000);
