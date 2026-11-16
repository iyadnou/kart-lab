// =============================================================================
// controller/buttons.js — touch buttons that work with several fingers.
//
// We use Pointer Events: every finger is a "pointer" with its own id, and
// each element receives the events of the fingers that touched it. So GAS and
// BRAKE can be held at the same time, independently.
// =============================================================================

/**
 * Turn an element into a hold-button.
 * @param {HTMLElement} element
 * @returns {{pressed: boolean}}  read `.pressed` at any time
 */
export function createHoldButton(element) {
  const state = { pressed: false };
  const fingers = new Set(); // ids of the pointers currently holding this button

  const refresh = () => {
    state.pressed = fingers.size > 0;
    element.classList.toggle('pressed', state.pressed);
  };

  element.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    fingers.add(event.pointerId);
    // "Capture" = keep sending this finger's events to this element even if
    // the finger slides off it. Otherwise we could miss the release.
    element.setPointerCapture?.(event.pointerId);
    refresh();
  });

  const release = (event) => {
    fingers.delete(event.pointerId);
    refresh();
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release); // e.g. a system gesture took over
  element.addEventListener('lostpointercapture', release);

  // Long-pressing must not open a context menu.
  element.addEventListener('contextmenu', (event) => event.preventDefault());

  return state;
}

/**
 * The fallback steering slider: drag the knob left/right, it springs back to
 * the centre when released.
 * @returns {{value: number}}  -1..1
 */
export function createSlider(element, knob) {
  const state = { value: 0 };
  let activePointer = null;

  const setValue = (value) => {
    state.value = Math.min(Math.max(value, -1), 1);
    // Move the knob: 0 -> centre, ±1 -> the ends (minus the knob's own size).
    const travel = (element.clientWidth - knob.offsetWidth) / 2;
    knob.style.transform = `translateX(${state.value * travel}px)`;
  };

  const update = (event) => {
    const rect = element.getBoundingClientRect();
    // When the page is CSS-rotated for portrait phones (see style.css), the
    // slider runs down the screen, so we must measure along Y instead of X.
    const rotated = window.matchMedia('(orientation: portrait)').matches;
    const t = rotated ? (event.clientY - rect.top) / rect.height : (event.clientX - rect.left) / rect.width;
    setValue(t * 2 - 1);
  };

  element.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activePointer = event.pointerId;
    element.setPointerCapture?.(event.pointerId);
    update(event);
  });
  element.addEventListener('pointermove', (event) => {
    if (event.pointerId === activePointer) update(event);
  });
  const release = (event) => {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    setValue(0);
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);

  return state;
}
