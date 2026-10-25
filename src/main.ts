import { startApp } from './packages/app';
import { createBrowserCoach } from './packages/coach';
import { createDeviceMotionSource } from './packages/sensors';
import { createLocalStore } from './packages/store';

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Missing app root');
if (!window.location.hash) window.location.hash = '#/permission';

const unmount = startApp(root, {
  source: createDeviceMotionSource(),
  store: createLocalStore(),
  makeCoach: () => createBrowserCoach(),
  now: () => new Date(),
  device: navigator.userAgent,
  newId: () => crypto.randomUUID(),
});

window.addEventListener('pagehide', (event) => {
  // A persisted page may come back from the back/forward cache, so keep it intact.
  if (!event.persisted) unmount();
});
