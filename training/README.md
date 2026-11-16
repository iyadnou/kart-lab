# Training the AI driver

This folder teaches a neural network to drive the kart, then saves its best lap as a **ghost file** the game can replay.

The important idea: **the AI never runs inside the game.** Training happens here, offline. The only thing that reaches the game is a recording of one lap (`ghosts/ai.json`), in exactly the same format as your own ghost. The game just replays it.

```
 training (this folder, offline)                       the game
┌─────────────────────────────────────────┐          ┌───────────────────────┐
│ train.py ── PPO learns to drive         │          │                       │
│     │                                   │          │  loads ghosts/ai.json │
│     ▼                                   │  ghost   │  and replays it as    │
│ best_model.zip                          │  file    │  the pink ghost       │
│     │                                   │ ───────► │                       │
│ export_ghost.py ── drives its best lap  │          │  shows "AI 0:37.xxx"  │
└─────────────────────────────────────────┘          └───────────────────────┘
```

## Quick start

From the project folder:

```bash
# 1. One-time setup: a private Python environment with the two libraries
python3.11 -m venv training/.venv
training/.venv/bin/pip install -r training/requirements.txt

# 2. Train (about 9 minutes on an M2 MacBook for 3 million steps)
training/.venv/bin/python training/train.py --timesteps 3000000

# 3. Put the AI's best lap into the game
training/.venv/bin/python training/export_ghost.py

# 4. Reload the game page. The pink ghost and the "AI" time are now the new lap.
```

You need Python 3.10 or newer and Node.js (already installed for the game). Any `python3` of that version works in step 1.

## What you see while it trains

Every 50,000 steps the current network drives three timed laps from the real starting grid, without any randomness:

```
[eval]    50,000 steps    0.2 min  laps: no lap finished
[eval]   100,000 steps    0.3 min  laps: 44.73s
[eval]   400,000 steps    1.1 min  laps: 39.70s, 38.30s, 38.33s
[eval] new best lap 38.300s -> saved best_model.zip and best_ghost.json
```

- "no lap finished" early on is normal. At first the network steers at random.
- The first lap of each line is slower because it begins from a standing start.
- Lap times wobble up and down between evaluations. That is normal for PPO; only the best one is kept.

Results go to `training/runs/default/`:

| File | What it is |
| --- | --- |
| `laps.csv` | The lap-time log, one row per evaluation. Open it in a spreadsheet to plot learning progress |
| `best_model.zip` | The network that drove the fastest lap so far |
| `best_ghost.json` | That fastest lap, already as a ghost file |
| `final_model.zip` | The network at the very end (not necessarily the best) |

## Retraining

Retrain whenever you change something the AI's driving depends on: the track layout, or the kart's physics in `src/game/config.js`. An old ghost on a new track would drive through the scenery, so the game ignores AI ghosts whose track length does not match.

Useful options:

```bash
# A separate experiment that does not overwrite the default one
training/.venv/bin/python training/train.py --name experiment1 --timesteps 5000000

# Continue training an existing network
training/.venv/bin/python training/train.py --resume training/runs/default/best_model.zip --timesteps 2000000

# Export from a specific run
training/.venv/bin/python training/export_ghost.py --model training/runs/experiment1/best_model.zip
```

`--envs 8` sets how many copies of the game run in parallel; use about as many as your computer has CPU cores.

## How it works

### The files

| File | Language | Job |
| --- | --- | --- |
| `kart-env.js` | JavaScript | The game as a learning environment: observations, rewards, when an episode ends |
| `env-server.js` | JavaScript | Lets Python talk to it: one line of JSON in, one line out |
| `kart_env.py` | Python | Wraps that conversation in the standard Gymnasium interface |
| `train.py` | Python | PPO training (Stable-Baselines3) and the timed evaluations |
| `export_ghost.py` | Python | Drives the best network and writes `ghosts/ai.json` |

### Why the physics is not rewritten in Python

`kart-env.js` imports the game's own `Vehicle`, track and colliders, so the AI trains on exactly the physics you drive. A Python copy of the physics would always be slightly different, and a lap that works in the copy might crash in the real game. The price is the small JSON bridge between the two languages.

### What the AI sees (32 numbers)

| Numbers | Meaning |
| --- | --- |
| 8 | Its own motion: speed, sideways slide, turning rate, heading relative to the track, position across the track, current steering angle, wheels on grass |
| 9 | Distance to the walls along 9 rays fanned out to the front and sides |
| 15 | The road ahead: 5 points on the centre line at 8, 16, 28, 42 and 60 m (where each is relative to the kart, and how sharply the track bends there) |

### What it controls (3 numbers, 20 times per second)

Steering, gas and brake. No handbrake.

### What it is rewarded for

| Event | Reward |
| --- | --- |
| Each metre of progress along the track | +0.1 |
| Each decision step | −0.02 (so faster is better) |
| Wheels on grass | up to −0.05 per step |
| Hitting a wall | −1 |
| Completing a lap's distance | +10, plus 1 for every second under 60 |
| Getting stuck, flipping, or driving the wrong way | −10, and the episode ends |

The network is never told *how* to drive. Braking before the hairpin, using the full width of the road and so on are all things it finds out because they earn more reward.

### Training episodes vs. evaluation

- **Training:** each episode starts at a random spot on the track, slightly off-centre, at a random speed, and lasts up to 60 seconds. This way the network practises every corner equally instead of crashing at the first one for hours.
- **Evaluation / export:** the kart starts on the real grid at rest, laps are timed by the game's own lap tracker, and the fastest lap is recorded with the game's own ghost recorder.

## Things to try

All in `kart-env.js` unless noted:

- Change the `REWARD` numbers. What happens with no grass penalty? With a much bigger wall penalty?
- Remove the wall rays from the observation. Can it still learn from the look-ahead points alone?
- Train on a different track (`src/game/track/layout.js`), then check whether a network trained on the old track can drive the new one.
- Make the network bigger or smaller: `net_arch` in `train.py`.

## Limits worth knowing

- The AI is a **time-trial ghost**, not an opponent. It cannot see you or react to you.
- It learned this track only. It is not a general driver.
- Results vary a little from run to run; a different `--seed` gives a slightly different driver.
