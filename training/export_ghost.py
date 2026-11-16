"""export_ghost.py — let the trained AI drive, and save its best lap as a ghost.

    training/.venv/bin/python training/export_ghost.py

Loads training/runs/default/best_model.zip, drives a few laps from the real
starting grid, and writes the fastest one to ghosts/ai.json — the file the
game loads as the "AI" ghost. The game itself never runs the neural network;
it only replays this recording.
"""

import argparse
from pathlib import Path

from stable_baselines3 import PPO

from kart_env import KartEnv, PROJECT_ROOT

TRAINING_DIR = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description="Export the AI's best lap as a ghost file.")
    parser.add_argument("--model", default=str(TRAINING_DIR / "runs" / "default" / "best_model.zip"))
    parser.add_argument("--out", default=str(PROJECT_ROOT / "ghosts" / "ai.json"))
    parser.add_argument("--laps", type=int, default=4, help="laps to drive; the fastest is kept")
    parser.add_argument("--name", default="AI driver (PPO)")
    args = parser.parse_args()

    model = PPO.load(args.model, device="cpu")
    env = KartEnv(mode="eval", laps=args.laps)

    obs, _ = env.reset()
    lap_times, done = [], False
    while not done:
        action, _ = model.predict(obs, deterministic=True)
        obs, _, terminated, truncated, info = env.step(action)
        if "lap_time" in info:
            lap_times.append(info["lap_time"])
            print(f"lap {len(lap_times)}: {info['lap_time']:.3f} s")
        done = terminated or truncated

    if not lap_times:
        env.close()
        raise SystemExit("The AI did not complete a lap. Train longer, then try again.")

    result = env.export_ghost(args.out, args.name)
    env.close()
    print(f"Saved the {result['lapTime']:.3f} s lap ({result['samples']} samples) to {args.out}")


if __name__ == "__main__":
    main()
