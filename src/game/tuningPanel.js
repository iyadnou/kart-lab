// =============================================================================
// tuningPanel.js — the live tuning panel (press G), built with lil-gui.
//
// It walks through the CONFIG object and creates a slider for every number
// and a checkbox for every boolean, so new config values show up here
// automatically. Sliders edit CONFIG directly; most code reads CONFIG every
// step, so changes are felt immediately.
// =============================================================================

import GUI from 'lil-gui';

// Sections of CONFIG that can be changed while driving, in display order.
// (`track` is missing on purpose: the track is generated once at start-up.)
const LIVE_SECTIONS = ['engine', 'steering', 'tires', 'handbrake', 'suspension', 'stability', 'chassis', 'wheels', 'surfaces', 'camera', 'effects', 'audio', 'ghost'];

// Slider ranges where the automatic guess (0 .. 3x the default) is not good.
const RANGES = {
  'chassis.centerOfMassY': [-0.4, 0.2],
  'chassis.restitution': [0, 1],
  'chassis.friction': [0, 1],
  'tires.sideFrictionStiffness': [0, 1],
  'handbrake.rearGripFactor': [0, 1],
  'engine.brakeFrontBias': [0, 1],
  'wheels.mountY': [-0.2, 0.2],
  'wheels.rearZ': [-1.2, 0],
  'stability.fallResetY': [-100, 0],
  'surfaces.asphalt.grip': [0, 2],
  'surfaces.asphalt.drag': [0, 100],
  'surfaces.grass.grip': [0, 2],
  'audio.masterVolume': [0, 1],
  'audio.engineVolume': [0, 2],
  'audio.skidVolume': [0, 2],
  'audio.effectsVolume': [0, 2],
  'ghost.opacity': [0.05, 1],
};

/**
 * @param {object} config  the CONFIG object (edited in place)
 * @param {object} actions
 * @param {() => void} actions.onChange       called after any value changed
 * @param {() => void} actions.resetKart
 * @param {(quality: string) => void} actions.setQuality
 * @param {(gravity: number) => void} actions.setGravity
 * @param {() => void} actions.downloadGhost
 */
export function createTuningPanel(config, actions) {
  const gui = new GUI({ title: 'Tuning (G to hide)', width: 320 });
  // A deep copy of the starting values, for the "restore defaults" button.
  const defaults = structuredClone(config);

  // --- Buttons ---------------------------------------------------------------------
  const buttons = {
    'Reset kart (R)': () => actions.resetKart(),
    'Copy config as JSON': async () => {
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    },
    'Download my ghost': () => actions.downloadGhost(),
    'Restore defaults': () => {
      restore(config, defaults);
      // Refresh every slider to show the restored values.
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      actions.setGravity(config.physics.gravity);
      actions.onChange();
    },
  };
  for (const name of Object.keys(buttons)) gui.add(buttons, name);

  // --- A few controls that need special handling ------------------------------------
  gui.add(config.graphics, 'quality', ['high', 'low']).name('quality').onChange(actions.setQuality);
  gui.add(config.physics, 'gravity', 5, 30, 0.1).onChange(actions.setGravity);

  // --- Everything else, generated ------------------------------------------------------
  for (const section of LIVE_SECTIONS) {
    const folder = gui.addFolder(section);
    addControls(folder, config[section], section, actions.onChange);
    folder.close();
  }
  gui.folders[0].open(); // engine
  gui.folders[1].open(); // steering

  gui.hide(); // hidden until G is pressed
  return {
    gui,
    toggle() {
      gui.show(gui._hidden);
    },
  };
}

/** Recursively add a control for each value in `object`. */
function addControls(folder, object, path, onChange) {
  for (const [key, value] of Object.entries(object)) {
    const fullPath = `${path}.${key}`;
    if (typeof value === 'number') {
      const [min, max] = RANGES[fullPath] ?? guessRange(value);
      folder.add(object, key, min, max).onChange(onChange);
    } else if (typeof value === 'boolean') {
      folder.add(object, key).onChange(onChange);
    } else if (typeof value === 'object' && value !== null) {
      addControls(folder.addFolder(key), value, fullPath, onChange); // e.g. surfaces.grass
    }
  }
}

/** A sensible slider range around a default value. */
function guessRange(value) {
  if (value === 0) return [-1, 1];
  return value > 0 ? [0, value * 3] : [value * 3, 0];
}

/** Copy all values from `source` back into `target`, keeping `target`'s objects. */
function restore(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'object' && value !== null) restore(target[key], value);
    else target[key] = value;
  }
}
