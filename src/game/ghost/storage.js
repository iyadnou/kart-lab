// =============================================================================
// ghost/storage.js — loading and saving ghost files.
//
// A web page cannot write files on your disk by itself, so the game asks its
// own server (server/ghosts.js) to do it. The files live in the project's
// ghosts/ folder:
//   ghosts/player.json   your best recorded lap (written by the game)
//   ghosts/ai.json       the AI driver's lap    (written by training/)
// =============================================================================

import { validateGhost } from './recording.js';

/**
 * Load a ghost by name ('player' or 'ai').
 * Resolves to the recording, or null if there is none (or it is unusable).
 */
export async function loadGhost(name) {
  try {
    const response = await fetch(`/api/ghosts/${name}`, { cache: 'no-store' });
    if (response.status !== 200) return null; // 204 = no such ghost yet
    const ghost = await response.json();
    const problem = validateGhost(ghost);
    if (problem) {
      console.warn(`Ignoring ghost "${name}": ${problem}`);
      return null;
    }
    return ghost;
  } catch (error) {
    console.warn(`Could not load ghost "${name}":`, error);
    return null;
  }
}

/** Save a recording as ghosts/<name>.json on the server. Resolves to true on success. */
export async function saveGhost(name, ghost) {
  try {
    const response = await fetch(`/api/ghosts/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghost),
    });
    return response.ok;
  } catch (error) {
    console.warn(`Could not save ghost "${name}":`, error);
    return false;
  }
}

/** Offer a recording as a file download (to keep or share a lap). */
export function downloadGhost(ghost, filename = 'ghost.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(ghost)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
