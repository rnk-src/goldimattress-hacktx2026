import type { Cue } from '../../domain';

export interface Coach {
  play(cue: Cue): void;
  keepAwake(on: boolean): Promise<void>;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export interface CoachEnv {
  audio: () => AudioContext;
  speech?: SpeechSynthesis;
  wakeLock?: WakeLock;
  doc?: Document;
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

export function createBrowserCoach(env?: CoachEnv): Coach {
  const audio = env?.audio();
  let muted = false;
  let keepAwakeRequested = false;
  let wakeSentinel: WakeLockSentinel | null = null;

  const acquireWakeLock = async () => {
    if (!keepAwakeRequested || !env?.wakeLock || (wakeSentinel && !wakeSentinel.released)) return;
    try {
      wakeSentinel = await env.wakeLock.request('screen');
    } catch {
      wakeSentinel = null;
    }
  };
  const onVisibilityChange = () => {
    if (env?.doc?.visibilityState === 'visible') void acquireWakeLock();
  };
  env?.doc?.addEventListener('visibilitychange', onVisibilityChange);

  return {
    play(cue) {
      if (muted) return;
      if (env?.speech) {
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
      env?.doc?.removeEventListener('visibilitychange', onVisibilityChange);
      const held = wakeSentinel;
      wakeSentinel = null;
      void held?.release();
    },
  };
}
