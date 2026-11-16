"""kart_env.py — the kart game as a Gymnasium environment.

Gymnasium is the standard Python interface for reinforcement learning:
an environment has reset() and step(action), and training libraries such as
Stable-Baselines3 can use anything that follows it.

The physics is NOT reimplemented in Python. This class starts the real game
physics as a Node.js child process (env-server.js) and exchanges one line of
JSON per call. See env-server.js for the messages.
"""

import json
import subprocess
from pathlib import Path

import gymnasium as gym
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class KartEnv(gym.Env):
    """mode='train': random starts, 60 s episodes.  mode='eval': real start, timed laps."""

    metadata = {"render_modes": []}

    def __init__(self, mode: str = "train", laps: int = 3):
        super().__init__()
        self.mode = mode
        self.laps = laps

        # Start the game physics. cwd = project root so Node finds node_modules.
        self.process = subprocess.Popen(
            ["node", "training/env-server.js"],
            cwd=PROJECT_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,  # line buffered
        )
        size = self._ask({"cmd": "spec"})["observation_size"]

        # What the agent sees: `size` numbers, roughly within -1..1.
        self.observation_space = gym.spaces.Box(-10.0, 10.0, shape=(size,), dtype=np.float32)
        # What the agent does: [steer, gas, brake], each -1..1 (see kart-env.js).
        self.action_space = gym.spaces.Box(-1.0, 1.0, shape=(3,), dtype=np.float32)

    def _ask(self, message: dict) -> dict:
        """Send one JSON line to Node and read the one-line answer."""
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("the Node environment process stopped unexpectedly")
        reply = json.loads(line)
        if "error" in reply:
            raise RuntimeError(reply["error"])
        return reply

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        # Every episode gets its own random seed, drawn from this env's random
        # generator. (Without this, parallel envs would all pick the same
        # "random" starting spots.)
        episode_seed = int(self.np_random.integers(2**31 - 1))
        reply = self._ask({"cmd": "reset", "mode": self.mode, "seed": episode_seed, "laps": self.laps})
        return np.asarray(reply["obs"], dtype=np.float32), {}

    def step(self, action):
        reply = self._ask({"cmd": "step", "action": [float(a) for a in action]})
        return (
            np.asarray(reply["obs"], dtype=np.float32),
            float(reply["reward"]),
            bool(reply["terminated"]),
            bool(reply["truncated"]),
            reply["info"],
        )

    def export_ghost(self, path: str, name: str | None = None) -> dict:
        """Save the fastest lap of the current eval episode as a ghost file."""
        return self._ask({"cmd": "export", "path": str(path), "name": name})

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            self.process.wait(timeout=5)
