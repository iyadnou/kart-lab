"""train.py — teach a neural network to drive the kart, with PPO.

    training/.venv/bin/python training/train.py --timesteps 2000000

PPO ("Proximal Policy Optimization") in one paragraph: several copies of the
game run in parallel. A neural network (the "policy") looks at each kart's
observation and picks steering/gas/brake, at first almost randomly. After a
few thousand steps the algorithm looks back: actions that led to more reward
than expected are made a bit more likely, the others a bit less. Repeat a few
hundred times and the network drives.

During training this script regularly lets the current network drive timed
laps from the real starting grid ("evaluation") and logs the lap times. The
network that drove the fastest lap so far is saved as best_model.zip.
"""

import argparse
import csv
import time
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env import SubprocVecEnv

from kart_env import KartEnv

TRAINING_DIR = Path(__file__).resolve().parent


class LapTimeEvaluation(BaseCallback):
    """Every `every` training steps: drive timed laps and log the result."""

    def __init__(self, run_dir: Path, every: int):
        super().__init__()
        self.run_dir = run_dir
        self.every = every
        self.next_evaluation = every
        self.best_lap = float("inf")
        self.env = KartEnv(mode="eval", laps=3)
        self.log_path = run_dir / "laps.csv"
        with open(self.log_path, "w", newline="") as f:
            csv.writer(f).writerow(["timesteps", "minutes", "laps_completed", "best_lap_s", "lap_times_s", "reward"])
        self.start = time.time()

    def _on_step(self) -> bool:
        if self.num_timesteps < self.next_evaluation:
            return True
        self.next_evaluation += self.every

        # One episode from the starting grid. deterministic=True means "always
        # take the action you think is best" (no exploration noise).
        obs, _ = self.env.reset()
        lap_times, total_reward, done = [], 0.0, False
        while not done:
            action, _ = self.model.predict(obs, deterministic=True)
            obs, reward, terminated, truncated, info = self.env.step(action)
            total_reward += reward
            if "lap_time" in info:
                lap_times.append(info["lap_time"])
            done = terminated or truncated

        best = min(lap_times) if lap_times else None
        minutes = (time.time() - self.start) / 60
        with open(self.log_path, "a", newline="") as f:
            csv.writer(f).writerow([
                self.num_timesteps, f"{minutes:.1f}", len(lap_times),
                f"{best:.3f}" if best else "", " ".join(f"{t:.2f}" for t in lap_times), f"{total_reward:.0f}",
            ])
        laps_text = ", ".join(f"{t:.2f}s" for t in lap_times) if lap_times else "no lap finished"
        print(f"[eval] {self.num_timesteps:>9,} steps  {minutes:5.1f} min  laps: {laps_text}", flush=True)

        if best is not None and best < self.best_lap:
            self.best_lap = best
            self.model.save(self.run_dir / "best_model")
            # The env still holds that lap's recording: keep it as a ghost too.
            self.env.export_ghost(self.run_dir / "best_ghost.json")
            print(f"[eval] new best lap {best:.3f}s -> saved best_model.zip and best_ghost.json", flush=True)
        return True

    def _on_training_end(self) -> None:
        self.env.close()


def main():
    parser = argparse.ArgumentParser(description="Train the AI kart driver with PPO.")
    parser.add_argument("--timesteps", type=int, default=2_000_000, help="total environment steps")
    parser.add_argument("--envs", type=int, default=8, help="parallel copies of the game")
    parser.add_argument("--name", default="default", help="results go to training/runs/<name>/")
    parser.add_argument("--eval-every", type=int, default=50_000, help="steps between timed evaluations")
    parser.add_argument("--resume", default=None, help="continue from a saved model (.zip)")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    run_dir = TRAINING_DIR / "runs" / args.name
    run_dir.mkdir(parents=True, exist_ok=True)

    # Each env is its own Python process with its own Node child.
    env = SubprocVecEnv([lambda: KartEnv(mode="train") for _ in range(args.envs)])
    env.seed(args.seed)

    if args.resume:
        model = PPO.load(args.resume, env=env, device="cpu")
    else:
        model = PPO(
            "MlpPolicy",  # a plain fully connected network
            env,
            device="cpu",  # the network is tiny; a GPU would not help
            seed=args.seed,
            n_steps=1024,  # steps per env before each learning update
            batch_size=512,
            n_epochs=10,
            learning_rate=3e-4,
            gamma=0.995,  # how far ahead rewards matter (~10 s at 20 decisions/s)
            gae_lambda=0.95,
            ent_coef=0.002,  # a small bonus for staying curious
            policy_kwargs=dict(net_arch=[128, 128], log_std_init=-0.7),
            verbose=0,
        )

    print(f"Training for {args.timesteps:,} steps with {args.envs} envs. Results: {run_dir}", flush=True)
    callback = LapTimeEvaluation(run_dir, args.eval_every)
    model.learn(total_timesteps=args.timesteps, callback=callback, reset_num_timesteps=not args.resume)
    model.save(run_dir / "final_model")
    env.close()
    best = f"{callback.best_lap:.3f}s" if callback.best_lap < float("inf") else "none"
    print(f"Done. Best evaluated lap: {best}. Now run export_ghost.py to put it in the game.", flush=True)


if __name__ == "__main__":
    main()
