# How Kart Lab works

A guided tour for someone reading this code for the first time. Each section says which file to open next to it.

1. [The big picture](#1-the-big-picture)
2. [The game loop](#2-the-game-loop)
3. [How the kart drives: the ray-cast vehicle](#3-how-the-kart-drives-the-ray-cast-vehicle)
4. [How the track is generated](#4-how-the-track-is-generated)
5. [How phone input reaches the game](#5-how-phone-input-reaches-the-game)
6. [Camera, effects and HUD](#6-camera-effects-and-hud)
7. [Where to add things](#7-where-to-add-things)

---

## 1. The big picture

There are three programs:

```
   PHONE (browser)                 MAC (Node.js)                  MAC (browser)
 ┌──────────────────┐          ┌──────────────────┐          ┌──────────────────────┐
 │ controller page  │  input   │     server       │  input   │      game page       │
 │                  │ ───────► │                  │ ───────► │                      │
 │ tilt + buttons   │ 60x/sec  │ relay (WebSocket)│          │ physics + 3D drawing │
 │                  │ ◄─────── │                  │ ◄─────── │                      │
 └──────────────────┘  rumble  └──────────────────┘  rumble  └──────────────────────┘
        src/controller/              server/                       src/game/
```

- The **server** hands out the two web pages and passes messages between them. It knows nothing about karts.
- The **game page** does all the real work: it simulates the physics and draws the picture.
- The **controller page** only reads the phone's sensors and buttons and reports them.

Inside the game page, two libraries do the heavy lifting, and it helps to keep them apart in your head:

| | Rapier (physics) | Three.js (graphics) |
| --- | --- | --- |
| Knows about | invisible shapes, masses, forces, collisions | visible meshes, materials, lights, the camera |
| Answers | "where is everything now?" | "what does that look like from here?" |

The physics world is the truth. The graphics just copy positions out of it every frame. You can see the physics world on its own by pressing **C** in the game.

`src/game/main.js` creates every module and wires them together. It is short on purpose; read it top to bottom once and you know where everything lives.

**A convention used everywhere:** +Y is up. In the kart's own space +Z is forward and +X is left.

---

## 2. The game loop

*File: `src/game/loop.js`, plus `step()` and `render()` in `main.js`.*

A game is a loop: read input → advance the world a tiny bit → draw → repeat.

The tricky part is "a tiny bit". The browser calls us whenever the screen is ready for a new picture: 60 times a second on most screens, 120 on others, irregularly when the machine is busy. If the physics advanced by "whatever time has passed", the kart would handle slightly differently on every computer, and a long hiccup could make it tunnel through a wall.

So the physics always advances in **fixed steps of exactly 1/60 s**:

```js
accumulator += timeSinceLastFrame;
while (accumulator >= timestep) {
  step(timestep);          // one physics step
  accumulator -= timestep;
}
render(accumulator / timestep);   // <- "alpha"
```

Picture a bucket collecting real time. Whenever it holds a full step's worth, one physics step runs and that time is scooped out. On a 120 Hz screen some frames run no physics step at all; after a hiccup one frame runs several.

What stays in the bucket is less than one step. Divided by the step size it is a number between 0 and 1 called **alpha**: how far the present moment lies between the last two physics states. The kart is drawn at that in-between position:

```js
// kartModel.js
this.group.position.lerpVectors(vehicle.prevPosition, vehicle.position, alpha);
this.group.quaternion.slerpQuaternions(vehicle.prevQuaternion, vehicle.quaternion, alpha);
```

This is **render interpolation**. Without it the kart would visibly stutter on any screen that does not refresh at exactly 60 Hz.

One physics step (`step()` in `main.js`) does this, in order:

1. `input.read()` — what does the driver want?
2. `vehicle.preStep()` — turn that into wheel commands and forces
3. `physics.step()` — Rapier moves everything and resolves collisions
4. `vehicle.postStep()` — read back speed, which wheels slide, what they touch
5. `laps.update()`, `effects.step()` — game rules and effects
6. rescue the kart if it is upside down or fell off the world

One rendered frame (`render()`) copies the physics state onto the kart model, moves the camera, updates the HUD and draws.

---

## 3. How the kart drives: the ray-cast vehicle

*Files: `src/game/vehicle.js` and `src/game/config.js`.*

### The trick

The kart you see has four wheels. The kart the physics engine simulates has **none**. It is a single box floating above the road.

Simulating real wheels (four spinning cylinders on joints) is slow and jittery. Almost every driving game uses this trick instead. From each of the four wheel positions, a **ray** is shot straight down:

```
              ┌───────────────────────┐
              │      chassis box      │   <- the only rigid body
              └──┬─────────────────┬──┘
                 │ ray             │ ray
                 │                 │        each ray = one suspension
                 ▼                 ▼
        ─────────●─────────────────●──────────  road
            contact point     contact point
```

Where a ray hits the road, the vehicle controller (Rapier's `DynamicRayCastVehicleController`) applies two kinds of force to the box at that point:

**1. Suspension — a spring and a damper.**
The ray's length tells how far the "spring" is squashed. The shorter the ray, the harder it pushes the box up (`suspension.stiffness`). A damper resists fast movement so the kart does not bounce forever (`dampingCompression`, `dampingRelaxation`). Four of these hold the box up, and the box really does bob, pitch and lean on them.

**2. Tyre friction.**
At each contact point the controller looks at how the box is moving over the ground and splits that into two directions:
- *Sideways* (along the axle): a tyre resists sliding sideways, so the controller pushes back to cancel that motion. This is what makes the kart go where the wheels point — it is the whole reason steering works.
- *Forwards* (rolling direction): here it applies whatever we ask for — engine force or brake.

But a tyre has a limit:

```
maximum friction force  =  load on that wheel  ×  frictionSlip
```

Ask for more than that and the tyre **slides**. That one rule produces most of what makes driving interesting:

- Corner too fast → the sideways force needed exceeds the limit → the kart runs wide.
- **Weight transfer:** "load on that wheel" is the suspension force, and it changes all the time. Brake and the nose dives: the front springs compress, the front tyres get more load and more grip, the rear tyres less. Corner and the outside wheels load up.
- Grass simply multiplies the limit by 0.55 (`surfaces.grass.grip`).
- The handbrake multiplies the *rear* limit by `handbrake.rearGripFactor`: the rear lets go first, the back swings out — a drift.

The visible wheels (`kartModel.js`) are decoration. Each frame they are placed at the end of their ray (so they move with the suspension), turned by the steering angle, and spun according to distance travelled.

### What our code adds each step

`preStep()` in `vehicle.js` runs before every physics step:

| Part | What it does |
| --- | --- |
| `#updateSteering` | Chooses the front wheel angle. **Speed-sensitive:** up to ~30° when crawling, ~4° at top speed, otherwise a twitch at 90 km/h would spin you. The angle also moves at a limited rate; wheels cannot snap. |
| `#updateEngineAndBrakes` | Engine force on the two rear wheels. It fades to zero as you approach `topSpeedKmh` — that fade *is* the top speed limit. Handles brake vs. reverse, gentle engine braking when you lift off, and a parking brake when you stand still. |
| `#updateTyreGrip` | Sets each wheel's `frictionSlip` from the surface under it and the handbrake. |
| `#applyExtraForces` | Air drag; grass drag; **downforce** (pushes the kart down at speed: more load, more grip); **anti-roll bars** (when one side's spring is squashed more than the other, push back — resists leaning without making the ride stiff). |
| `controller.updateVehicle()` | Rapier casts the rays and applies suspension and tyre forces. |
| `#applyBodyRoll` | See below. |

### Body roll

Tyre forces act at ground level; the centre of mass is higher. In a corner that off-centre push makes a real car lean outwards. Rapier's controller applies only about a tenth of that effect by default (a deliberate simplification that makes vehicles nearly impossible to flip). `#applyBodyRoll` adds the rest back as a torque: *sideways tyre force × height of the centre of mass*. Set `chassis.bodyRoll` to 0 in the tuning panel to feel the difference.

What stops the kart from rolling over, then? A low centre of mass (`chassis.centerOfMassY`), the anti-roll bars, downforce — and if it happens anyway, `main.js` puts the kart back on its wheels after 2 seconds upside down.

### How a wheel knows it is on grass

Every collider is registered with a small "userData" object, for example `{ surface: 'grass' }` (see `setUserData` in `physics.js`). After each step `postStep()` asks the controller which collider each wheel's ray hit (`wheelGroundObject(i)`) and looks up that object. The road, the grass verges and the terrain are separate colliders with different tags, so a kart with two wheels on the grass really has two grippy and two slippery wheels.

### Honest about what is simplified

It is a simulation, tuned to be fun rather than accurate:

- Gravity is 14 m/s² instead of 9.81. The kart feels more planted.
- Tyres grip well beyond real rubber.
- There is no engine, gearbox or wheel spin model; "engine force" is simply a push at the rear contact points.

All of it is in `config.js` if you would like it more realistic.

---

## 4. How the track is generated

*Files: `src/game/track/` — read them in this order: `layout.js`, `path.js`, `geometry.js`, then `meshes.js`, `colliders.js`, `scenery.js`.*

There are no track model files. The circuit is computed when the page loads, in a pipeline:

```
layout.js        ~40 control points  [x, y, z, bank]
    │
    ▼
path.js          a smooth closed curve through them, cut into ~630 "samples",
    │            one every 1.5 m
    ▼
geometry.js      plain number arrays: road, verges, curbs, walls, terrain
    │
    ├──► meshes.js     -> Three.js meshes   (what you see)
    ├──► colliders.js  -> Rapier colliders  (what you hit)
    └──► scenery.js    -> trees, rocks, tire stacks, fences, start gantry
```

### Step 1: control points → smooth curve

`layout.js` lists points the road should pass through. Corners are described with a small `arc()` helper so they come out as clean circles. Three.js's `CatmullRomCurve3` then draws a smooth closed curve through all the points in order. Catmull-Rom is a kind of spline that goes exactly *through* its points, which makes it easy to design with.

### Step 2: curve → samples

`path.js` walks along the curve and, every 1.5 m, records a **sample**: a small coordinate frame standing on the road.

```
        up
        │   forward (direction of travel)
        │  ╱
        │ ╱
        ●────── right (across the road)
     position
```

- `forward` is the curve's tangent.
- `right` is perpendicular to `forward` and to "world up" (a cross product).
- **Banking:** `right` is then tilted by the sample's bank angle, so one edge of the road ends up higher. That is all a banked turn is.
- `up` is perpendicular to both — the road's surface normal.

Each sample also stores its distance from the start line and its **curvature** (how quickly the heading changes; 1 ÷ corner radius).

Everything after this point only uses the samples.

### Step 3: samples → geometry

The basic building block in `geometry.js` is a **strip**: take two points at each sample (say, the left and right road edge), and join neighbouring samples with two triangles.

```
   sample i+1     a1 ─────── b1
                   │ ╲       │
                   │   ╲     │        2 triangles per segment
                   │     ╲   │
   sample i       a0 ─────── b0
               left edge   right edge
```

Almost everything is a strip with different edge positions:

| Part | Edges (metres from the centre line) |
| --- | --- |
| Road | −6 … +6 |
| Grass verges | −11 … −6 and +6 … +11 |
| Curbs | the outer metre of the road, slightly raised, red/white — only where the curvature is high |
| Start line | one segment long, with a checker texture |
| Walls | vertical strips at ±11 |

The **terrain** is different: a regular grid of points, each lifted to a height given by `heightAt(x, z)`. Close to the track that function returns the track's own height (slightly lower, so grass never pokes through the asphalt). Further away it blends into rolling hills that rise towards the horizon.

### Step 4: the same arrays, used twice

`geometry.js` produces plain arrays of numbers, not Three.js or Rapier objects. That is deliberate:

- `meshes.js` wraps them in `THREE.BufferGeometry` and adds materials. Textures (asphalt with lane markings, grass, checkers) are painted in code on a `<canvas>`.
- `colliders.js` gives the *same* arrays to Rapier as triangle-mesh colliders, tagged `asphalt` or `grass`.

So what you see and what you collide with cannot drift apart. Walls are the one exception: visually they are strips, physically a chain of thick boxes with zero friction, which is more robust at speed and lets you slide along them.

### Checkpoints and laps

*File: `src/game/laps.js`.*

Sixteen invisible gates are spread evenly around the lap; gate 0 is the start line. Each step the tracker asks the path "which sample is the kart nearest to?". That index rises as you drive forward; when it passes a gate's index, the gate is passed. Gates only count in order, and the lap only counts when you cross gate 0 after all the others — so reversing over the line, or turning round, gains nothing.

The nearest-sample search only looks near the previous answer. That is fast, and it also means the answer cannot jump across to another part of the track that happens to be close by.

The last gate you passed is where **R** / RESET KART puts you. The best lap is stored in the browser's `localStorage`.

---

## 5. How phone input reaches the game

Follow one tilt of the phone all the way to the front wheels:

```
 phone sensor ─► tilt.js ─► controller/main.js ─► WebSocket ─► server/relay.js
                                                                     │
 front wheels ◄─ vehicle.js ◄─ input/index.js ◄─ input/remote.js ◄───┘
```

**1. Sensor → steering value** (`src/controller/tilt.js`)
The browser's `deviceorientation` event reports the phone's rotation as angles. From two of them (`beta`, `gamma`) we compute which way is "up" as seen from the phone, and look only at the part of that direction lying in the plane of the screen. Its angle is how far the phone is rolled, like a steering wheel. This works whether the screen faces you or leans back. Then:
- subtract the calibrated centre (the **Calibrate** button stores the current roll),
- divide by the full-lock angle (the sensitivity setting) to get −1…+1,
- apply a small **deadzone** so tiny wobbles count as straight,
- **smooth** it a little to remove sensor jitter.

iPhones require the page to ask permission for the sensor, and only in response to a tap. That is the reason for the "Tap to start" button.

**2. Buttons** (`src/controller/buttons.js`)
Pointer Events give every finger its own id, so GAS and HANDBRAKE can be held together.

**3. Sending** (`src/controller/main.js`)
About 60 times a second the page sends one small JSON message:

```json
{ "type": "input", "steer": 0.31, "throttle": 1, "brake": 0, "handbrake": false, "reset": false }
```

**4. The relay** (`server/relay.js`)
Both pages hold a WebSocket to the server: the phone as `role=controller`, the game as `role=game`. The relay forwards every controller message to every game, unread and unchanged. A WebSocket is a connection that stays open, so a message costs a few bytes and arrives in about a millisecond on Wi-Fi — which is why it works for a game where ordinary web requests would not.

Why a relay at all? Browsers cannot connect directly to each other in a simple way, but both can connect to a server.

**5. Receiving** (`src/game/input/remote.js`)
The game stores the latest message and clamps every number into its legal range (never trust data from a network). It also notes *when* the message came. **If nothing arrives for 500 ms, all phone inputs become zero** and the HUD shows "Controller disconnected". Without this rule, a phone that fell asleep with GAS held would leave the kart accelerating forever.

**6. Merging** (`src/game/input/index.js`)
Keyboard and phone are combined into one object with the same shape. The rest of the game never knows which device is driving.

**7. Driving** (`src/game/vehicle.js`)
`preStep(input)` turns `steer` into a wheel angle and `throttle` into engine force, as described in section 3.

**The other direction:** when the kart hits a wall, the game sends `{ "type": "rumble", "ms": 60 }` through the same relay and the phone calls `navigator.vibrate()` (Android only; iPhones do not support it).

**The QR code:** the server knows the Mac's Wi-Fi address and tells the game page, which draws it as a QR code with the `qrcode` package.

---

## 6. Camera, effects and HUD

**Chase camera** (`camera.js`). The ideal spot is behind and above the kart. The camera does not jump there; it follows with *springs* (`smoothDamp` in `mathUtils.js`), so it lags slightly. The direction it sits in lags more than its position, which is why you see the kart's side a little in turns. Each frame a ray is cast from the kart to the camera; if a wall or hill is in the way, the camera moves in front of it. The field of view widens with speed, a cheap and effective way to make 90 km/h feel fast.

**Effects** (`effects.js`). Smoke and dust are a *pool* of 700 particles drawn as one object; a dead particle's slot is reused for the next one, so nothing is created or destroyed while you drive. Skid marks are a ribbon of quads laid down behind sliding wheels, in a ring buffer: when all are used, the oldest are overwritten. Both are fed from the per-wheel `sliding` and `surface` values that `vehicle.postStep()` computes.

**Lighting** (`scene.js`). A hemisphere light for soft sky/ground light, and one directional "sun" that casts shadows. The shadow only covers a square around the kart and moves with it — sharp shadows without a huge shadow map.

**HUD** (`hud.js`, `index.html`). Ordinary HTML on top of the 3D canvas. `hud.js` only fills in text and shows or hides elements.

---

## 7. Where to add things

| You want to add | Where it goes |
| --- | --- |
| **Sound** | `audio.js` is an empty class whose methods the game already calls (`update(vehicle)` every frame; `play('bump')`, `play('lap')`). Fill it in with the Web Audio API. |
| **AI opponents** | `Vehicle` contains no rendering and no input code — you hand it an input object each step. `robotDriver()` in `tools/sim-test.js` is a tiny working AI: aim at a point ahead on the centre line, slow down for curvature. Create more `Vehicle` + `KartModel` pairs and feed them. |
| **A gamepad** | Add a source next to `keyboard.js` and merge it in `input/index.js`. |
| **Items, boosts** | Read the kart's position against the track with `path.nearestIndex()`, like `laps.js` does; apply effects by temporarily changing values the vehicle reads from the config. |
| **Another circuit** | Change the points in `track/layout.js`; run `npm run sim` to check corner radii and that the robot can still finish a lap. |
| **A new surface** (ice, sand) | Add it to `surfaces` in `config.js` and tag a collider with it in `track/colliders.js`. |
