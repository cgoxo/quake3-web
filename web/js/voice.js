// Voice chat over LiveKit (WebRTC), one voice room per game room.
// Desktop: hold V to talk. Phones: tap TALK to switch the mic on or off.
import { api } from './common.js';

const LIVEKIT_URL = 'https://cdn.jsdelivr.net/npm/livekit-client@2.15.8/dist/livekit-client.esm.mjs';

export async function joinVoice(roomId, name, chip) {
  let creds;
  try {
    creds = await api(`/api/rooms/${roomId}/voice-token`, { method: 'POST', body: { name } });
  } catch (err) {
    if (err.status === 501) return null; // voice not configured on this server
    throw err;
  }
  const { Room, RoomEvent, Track } = await import(LIVEKIT_URL);
  const room = new Room({
    adaptiveStream: false,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const audioEls = new Set();
  let othersMuted = false;
  let talking = false;
  let micFailed = false;

  const idle = () => `Voice: ${room.remoteParticipants.size + 1} in room`;
  const refresh = (speakers = []) => {
    const others = speakers.filter(s => s !== room.localParticipant).map(s => s.name || s.identity.split('#')[0]);
    chip.classList.toggle('speaking', others.length > 0 && !othersMuted);
    chip.classList.toggle('live', talking);
    if (micFailed) chip.textContent = 'Mic blocked: listening only';
    else if (talking) chip.textContent = 'Mic on';
    else if (others.length && !othersMuted) chip.textContent = `Speaking: ${others.join(', ')}`;
    else chip.textContent = idle();
  };

  room.on(RoomEvent.TrackSubscribed, track => {
    if (track.kind !== Track.Kind.Audio) return;
    const el = track.attach();
    el.muted = othersMuted;
    audioEls.add(el);
    document.body.append(el);
  });
  room.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(el => { audioEls.delete(el); el.remove(); }));
  room.on(RoomEvent.ActiveSpeakersChanged, refresh);
  room.on(RoomEvent.ParticipantConnected, () => refresh());
  room.on(RoomEvent.ParticipantDisconnected, () => refresh());

  await room.connect(creds.url, creds.token);
  await room.startAudio();
  chip.hidden = false;
  refresh();

  return {
    get talking() { return talking; },
    get othersMuted() { return othersMuted; },
    async talk(on) {
      if (micFailed || on === talking) return talking;
      try {
        await room.localParticipant.setMicrophoneEnabled(on);
        talking = on;
      } catch {
        micFailed = true;
        talking = false;
      }
      refresh();
      return talking;
    },
    muteOthers(on) {
      othersMuted = on;
      for (const el of audioEls) el.muted = on;
      refresh();
    },
    leave: () => room.disconnect(),
  };
}
