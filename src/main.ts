import { startApp } from './packages/app';
import { createBrowserCoach } from './packages/coach';
import { createDeviceMotionSource } from './packages/sensors';

type MotionEventConstructor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

type AudioContextConstructor = new () => AudioContext;

const motionEvent = window.DeviceMotionEvent as MotionEventConstructor | undefined;
const source = motionEvent
  ? createDeviceMotionSource({
      target: window,
      ...(motionEvent.requestPermission
        ? { requestPermission: () => motionEvent.requestPermission!.call(motionEvent) }
        : {}),
    })
  : createDeviceMotionSource();

const makeCoach = () => {
  const browserWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const Audio = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
  if (!Audio) return createBrowserCoach();
  return createBrowserCoach({
    audio: () => new Audio(),
    ...('speechSynthesis' in window ? { speech: window.speechSynthesis } : {}),
    ...('wakeLock' in navigator ? { wakeLock: navigator.wakeLock } : {}),
    doc: document,
  });
};

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Missing app root');
if (!window.location.hash) window.location.hash = '#/permission';

const unmount = startApp(root, {
  source,
  makeCoach,
  now: () => new Date(),
  device: navigator.userAgent,
});

window.addEventListener('pagehide', (event) => {
  // A persisted page may come back from the back/forward cache, so keep it intact.
  if (!event.persisted) unmount();
});
