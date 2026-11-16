// =============================================================================
// training/env-server.js — lets Python drive the kart.
//
// The training code is Python (Stable-Baselines3), the game is JavaScript.
// This small program is the bridge: Python starts it as a child process and
// they talk in lines of JSON over stdin/stdout:
//
//   Python sends                              this program answers
//   {"cmd":"spec"}                            {"observation_size":32}
//   {"cmd":"reset","mode":"train","seed":1}   {"obs":[...]}
//   {"cmd":"step","action":[0.1,1,-1]}        {"obs":[...],"reward":0.1,
//                                              "terminated":false,"truncated":false,"info":{}}
//   {"cmd":"export","path":"ghosts/ai.json"}  {"ok":true,"lapTime":41.2}
//
// kart_env.py is the Python side of this conversation.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { KartEnv, OBSERVATION_SIZE } from './kart-env.js';

const env = await KartEnv.create();

function handle(message) {
  switch (message.cmd) {
    case 'spec':
      return { observation_size: OBSERVATION_SIZE };
    case 'reset':
      return { obs: env.reset(message) };
    case 'step':
      return env.step(message.action);
    case 'export': {
      // Save the fastest lap of the current eval episode as a ghost file.
      if (!env.bestGhost) return { ok: false, error: 'no completed lap to export' };
      const ghost = { ...env.bestGhost, name: message.name ?? env.bestGhost.name };
      fs.mkdirSync(path.dirname(message.path), { recursive: true });
      fs.writeFileSync(message.path, JSON.stringify(ghost));
      return { ok: true, lapTime: ghost.lapTime, samples: ghost.samples.length };
    }
    default:
      return { error: `unknown command ${message.cmd}` };
  }
}

// One JSON object per line in, one per line out.
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let reply;
  try {
    reply = handle(JSON.parse(line));
  } catch (error) {
    reply = { error: String(error) };
  }
  process.stdout.write(JSON.stringify(reply) + '\n');
});
lines.on('close', () => process.exit(0));
