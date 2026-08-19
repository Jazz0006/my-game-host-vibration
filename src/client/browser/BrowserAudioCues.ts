import {
  CLIENT_AUDIO_CUE_NIGHT_COMPLETE,
  type ClientAudioCue,
} from "../../protocol/client/ClientEffects.js";

export type BrowserAudioCuePlayer = (cue: ClientAudioCue) => void;

/**
 * Browser-only rendering for semantic audio cues. The protocol carries only the
 * cue meaning; Web Audio details stay at this platform boundary so future
 * native / Mini Program clients can choose their own sound implementation.
 */
export const playBrowserAudioCue: BrowserAudioCuePlayer = cue => {
  if (cue !== CLIENT_AUDIO_CUE_NIGHT_COMPLETE) return;
  if (typeof globalThis.AudioContext !== "function") return;

  try {
    const ctx = new AudioContext();
    const notes = [880, 1108, 1318, 880];
    let time = ctx.currentTime;

    for (const frequency of notes) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.25, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
      oscillator.start(time);
      oscillator.stop(time + 0.4);
      time += 0.35;
    }
  } catch {
    // Browser audio is an optional effect. Playback failure must not escape
    // into the synchronized session or affect authoritative game state.
  }
};
