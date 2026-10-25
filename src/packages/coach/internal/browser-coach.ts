import type { Cue } from '../../domain';

export interface Coach {
  play(cue: Cue): void;
  keepAwake(on: boolean): Promise<void>;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export interface CoachEnv {
  audio?: () => AudioContext;
  speech?: SpeechSynthesis;
  wakeLock?: WakeLock;
  doc?: Document;
}

/** Whatever the browser offers; each part is left out where the browser lacks it. */
function detectBrowserEnv(): CoachEnv {
  const w = window as typeof window & { webkitAudioContext?: new () => AudioContext };
  const Audio = w.AudioContext ?? w.webkitAudioContext;
  return {
    ...(Audio ? { audio: () => new Audio() } : {}),
    ...(w.speechSynthesis ? { speech: w.speechSynthesis } : {}),
    ...(navigator.wakeLock ? { wakeLock: navigator.wakeLock } : {}),
    doc: document,
  };
}

function scheduleTone(audio: AudioContext, frequency: number, startsAt: number, duration: number) {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.setValueAtTime(frequency, startsAt);
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(0.22, startsAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration);
}

function scheduleBeep(audio: AudioContext, pattern: NonNullable<Cue['beep']>) {
  const startsAt = audio.currentTime;
  switch (pattern) {
    case 'ready':
      scheduleTone(audio, 880, startsAt, 0.12);
      break;
    case 'captured':
      scheduleTone(audio, 660, startsAt, 0.14);
      break;
    case 'accepted':
      scheduleTone(audio, 740, startsAt, 0.1);
      scheduleTone(audio, 988, startsAt + 0.14, 0.14);
      break;
    case 'rejected':
      scheduleTone(audio, 330, startsAt, 0.16);
      scheduleTone(audio, 260, startsAt + 0.18, 0.22);
      break;
  }
}

export function createBrowserCoach(injected?: CoachEnv): Coach {
  const env = injected ?? detectBrowserEnv();
  const audio = env.audio?.();
  let muted = false;
  let keepAwakeRequested = false;
  let wakeSentinel: WakeLockSentinel | null = null;
  let acquiring = false;

  const acquireWakeLock = async () => {
    if (!keepAwakeRequested || !env.wakeLock || acquiring || (wakeSentinel && !wakeSentinel.released)) return;
    acquiring = true;
    try {
      const sentinel = await env.wakeLock.request('screen');
      // Capture may have ended while the request was pending.
      if (keepAwakeRequested) wakeSentinel = sentinel;
      else void sentinel.release();
    } catch {
      wakeSentinel = null;
    } finally {
      acquiring = false;
    }
  };
  const onVisibilityChange = () => {
    if (env.doc?.visibilityState === 'visible') void acquireWakeLock();
  };
  env.doc?.addEventListener('visibilitychange', onVisibilityChange);

  return {
    play(cue) {
      if (muted) return;
      if (env.speech) {
        const utterance =
          typeof globalThis.SpeechSynthesisUtterance === 'function'
            ? new SpeechSynthesisUtterance(cue.text)
            : ({ text: cue.text } as SpeechSynthesisUtterance);
        env.speech.speak(utterance);
      }
      if (audio && cue.beep) scheduleBeep(audio, cue.beep);
    },
    async keepAwake(on) {
      keepAwakeRequested = on;
      if (on) {
        await acquireWakeLock();
        return;
      }
      const held = wakeSentinel;
      wakeSentinel = null;
      await held?.release();
    },
    setMuted(value) {
      muted = value;
    },
    dispose() {
      keepAwakeRequested = false;
      env.doc?.removeEventListener('visibilitychange', onVisibilityChange);
      const held = wakeSentinel;
      wakeSentinel = null;
      void held?.release();
      env.speech?.cancel();
      void audio?.close();
    },
  };
}
