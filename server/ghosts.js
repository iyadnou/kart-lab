// =============================================================================
// server/ghosts.js — reads and writes ghost files for the game.
//
// A web page is not allowed to touch files on your disk, but this server is.
// So the game talks to two small web addresses:
//
//   GET  /api/ghosts/player   -> sends ghosts/player.json  (empty 204 reply if none yet)
//   GET  /api/ghosts/ai       -> sends ghosts/ai.json
//   PUT  /api/ghosts/player   -> saves the request body as ghosts/player.json
//
// Only these two names exist, and only the player's ghost can be written
// (the AI ghost is produced by training/export_ghost.py). Fixed names mean
// a request can never read or write any other file.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

const READABLE = new Set(['player', 'ai']);
const WRITABLE = new Set(['player']);
const MAX_BYTES = 3_000_000; // a one-minute lap is roughly 0.1 MB

/**
 * Try to handle a request. Returns true if it was a ghost request (and has
 * been answered), false if the caller should handle it.
 *
 * @param {string} directory  the ghosts/ folder
 */
export function handleGhostRequest(directory, req, res) {
  const match = /^\/api\/ghosts\/([a-z]+)$/.exec(new URL(req.url, 'https://localhost').pathname);
  if (!match) return false;
  const name = match[1];
  const file = path.join(directory, `${name}.json`);

  if (req.method === 'GET' && READABLE.has(name)) {
    if (!fs.existsSync(file)) {
      // 204 = "fine, but nothing to send". (A 404 would work too, but it
      // shows up as a red error in the browser console on every first run.)
      res.writeHead(204).end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    }
    return true;
  }

  if (req.method === 'PUT' && WRITABLE.has(name)) {
    // The body arrives in chunks; collect them, but refuse absurd sizes.
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        res.writeHead(413).end('Too large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      try {
        // Only store it if it at least looks like a ghost.
        const ghost = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (ghost.format !== 'kart-lab-ghost' || !Array.isArray(ghost.samples)) throw new Error('not a ghost');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(ghost));
        console.log(`  [ghosts] saved ${name}.json (${ghost.lapTime} s lap)`);
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end('Not a valid ghost file');
      }
    });
    return true;
  }

  res.writeHead(405).end('Not allowed');
  return true;
}
