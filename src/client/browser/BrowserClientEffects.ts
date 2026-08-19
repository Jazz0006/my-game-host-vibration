import { dispatchClientRealtimeEffect } from "../effects/ClientEffectDispatcher.js";
import type { ClientSessionRealtimeEventListener } from "../runtime/ClientSession.js";
import {
  playBrowserAudioCue,
  type BrowserAudioCuePlayer,
} from "./BrowserAudioCues.js";

export type BrowserRealtimeEventSource = {
  subscribeRealtimeEvents(listener: ClientSessionRealtimeEventListener): () => void;
};

export type BrowserVibrationApi = {
  vibrate?(pattern: number | number[]): boolean;
};

/**
 * Attaches browser-native effect handling to a synchronized ClientSession.
 * Unsupported browser capabilities are no-ops; they never affect game state.
 */
export function attachBrowserClientEffects(
  source: BrowserRealtimeEventSource,
  vibrationApi: BrowserVibrationApi | undefined = globalThis.navigator,
  audioCuePlayer: BrowserAudioCuePlayer = playBrowserAudioCue,
): () => void {
  return source.subscribeRealtimeEvents(event => {
    dispatchClientRealtimeEffect(event, {
      vibrate: pattern => {
        vibrationApi?.vibrate?.([...pattern]);
      },
      playAudioCue: cue => {
        audioCuePlayer(cue);
      },
    });
  });
}
