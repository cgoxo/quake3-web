// Push-to-talk voice chat over LiveKit (WebRTC), one voice room per game room.
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

  room.on(RoomEvent.TrackSubscribed, track => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      el.dataset.voice = '1';
      document.body.append(el);
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(el => el.remove()));
  room.on(RoomEvent.ActiveSpeakersChanged, speakers => {
    const others = speakers.filter(s => s !== room.localParticipant).map(s => s.name || s.identity.split('#')[0]);
    chip.classList.toggle('speaking', others.length > 0);
    chip.textContent = others.length ? `Speaking: ${others.join(', ')}` : `Voice: ${room.remoteParticipants.size + 1} in room`;
  });
  room.on(RoomEvent.ParticipantConnected, () => { chip.textContent = `Voice: ${room.remoteParticipants.size + 1} in room`; });
  room.on(RoomEvent.ParticipantDisconnected, () => { chip.textContent = `Voice: ${room.remoteParticipants.size + 1} in room`; });

  await room.connect(creds.url, creds.token);
  await room.startAudio();
  chip.hidden = false;
  chip.textContent = `Voice: ${room.remoteParticipants.size + 1} in room`;

  let micFailed = false;
  return {
    async talk(on) {
      if (micFailed) return;
      try {
        await room.localParticipant.setMicrophoneEnabled(on);
        chip.classList.toggle('live', on);
        chip.textContent = on ? 'Talking' : `Voice: ${room.remoteParticipants.size + 1} in room`;
      } catch {
        micFailed = true;
        chip.textContent = 'Mic blocked: listening only';
      }
    },
    leave: () => room.disconnect(),
  };
}
