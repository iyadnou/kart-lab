// =============================================================================
// controller/screen.js — make the phone behave like a game controller:
// fullscreen, landscape, screen always on, no accidental zooming.
//
// Phones differ a lot here. Every feature is optional and wrapped so that a
// missing one never breaks the rest:
//   Fullscreen API     Android: yes.  iPhone: no (Safari does not offer it;
//                      "Add to Home Screen" gives a fullscreen app instead).
//   Orientation lock   Android (in fullscreen): yes.  iPhone: no — which is
//                      why the layout also rotates itself with CSS.
//   Wake Lock          Android: yes.  iPhone: iOS 16.4 and newer.
// =============================================================================

/** Call from inside a tap handler (browsers require a user gesture). */
export async function enterControllerMode() {
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  } catch {
    // Not allowed or not supported: carry on windowed.
  }
  try {
    await screen.orientation?.lock?.('landscape');
  } catch {
    // Only works in fullscreen on some browsers; the CSS fallback covers us.
  }
  keepScreenOn();
}

let wakeLock = null;

/** Ask the system not to dim or lock the screen while the page is visible. */
async function keepScreenOn() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // Refused (e.g. low battery mode): nothing we can do.
  }
}

// The system drops the wake lock whenever the page is hidden (app switch,
// screen off). Take it again when the page comes back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock !== null) keepScreenOn();
});

/** Block the browser gestures that would get in the way of playing. */
export function blockBrowserGestures() {
  // iOS Safari: pinch zoom.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (event) => event.preventDefault());
  }
  // Double-tap zoom and scrolling. { passive: false } is required to be
  // allowed to call preventDefault() on touch events.
  document.addEventListener(
    'touchmove',
    (event) => {
      // Let native controls (the settings slider) work normally.
      if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener('dblclick', (event) => event.preventDefault());
}
