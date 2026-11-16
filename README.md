# Kart Lab

A small 3D kart driving game made for learning. One kart, one circuit, a lap timer — and your phone is the steering wheel.

- **Three.js** draws it, **Rapier** simulates it (a real ray-cast vehicle: suspension, tyre grip, weight transfer)
- The **phone controller** talks to the game over a WebSocket on your home Wi-Fi
- Everything is generated in code: track, scenery, kart, textures. No asset files, no CDNs, works offline.

New to the code? Read [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) first.

## Install

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
```

## Run

```bash
npm run dev
```

The terminal prints two addresses:

```
Game (open on this Mac):    https://localhost:5173/
Controller (open on phone): https://192.168.x.x:5173/controller
```

Open the **game** address in Chrome or Safari on the Mac. The browser warns that the connection is "not private" — that is expected (see [Why the certificate warning?](#why-the-certificate-warning)). Click **Advanced → Proceed** (Chrome) or **Show Details → visit this website** (Safari).

You can drive straight away with the keyboard, or connect a phone.

## Connect your phone

1. Put the phone on the **same Wi-Fi** as the Mac.
2. **Scan the QR code** shown on the game screen with the phone's camera (or type the controller address).
3. **Accept the certificate warning** on the phone too:
   - iPhone (Safari): *Show Details* → *visit this website* → *Visit Website*
   - Android (Chrome): *Advanced* → *Proceed to … (unsafe)*
4. Hold the phone sideways and tap **Tap to start**. On iPhone, allow *Motion & Orientation Access* when asked.
5. The game screen now says **Press GAS to start**.

### Phone controls

| Control | What it does |
| --- | --- |
| Tilt the phone like a steering wheel | Steer |
| **GAS** (right thumb) | Accelerate |
| **BRAKE** (left thumb) | Brake; keep holding when stopped to reverse |
| **HANDBRAKE** | Loosens the rear tyres so the kart slides. Hold it with GAS for a drift |
| **RESET KART** | Back to the last checkpoint |
| **Calibrate** | The way you hold the phone right now becomes "straight ahead" |
| **Settings** | Steering sensitivity; switch between tilt and an on-screen slider |

If the phone has no tilt sensor (or you deny permission) the controller switches to the slider automatically. On Android the phone gives a short buzz when you hit a wall.

### If the phone will not connect

- Both devices really on the same Wi-Fi? Guest networks often block devices from seeing each other.
- macOS may ask whether *node* may accept incoming connections — choose **Allow**.
- A VPN on either device can get in the way.
- Screen went dark or you switched apps? The game shows "Controller disconnected" and the kart coasts; just return to the page.
- iPhone asked for motion access and you tapped *Cancel*? Close the tab, reopen the address, and allow it.
- Port 5173 in use? Run `PORT=5180 npm run dev`.

## Keyboard controls

| Key | What it does |
| --- | --- |
| Arrow keys / WASD | Steer, accelerate, brake / reverse |
| Space | Handbrake |
| R | Reset kart to the last checkpoint |
| G | Show / hide the tuning panel |
| C | Show / hide the physics debug view (what the physics engine "sees") |

There is also a **Quality: High / Low** button at the bottom left. Low turns off shadows and renders fewer pixels, for slower machines.

## Tuning the physics

Every tuning value lives in one file: [src/game/config.js](src/game/config.js). Each value has a comment saying what it does.

The fast way to experiment:

1. Press **G** in the game. Every kart, camera and effect value has a slider. (Track dimensions and wall friction are only read at start-up; change those in the file and reload.)
2. Drag sliders while you drive — changes apply immediately.
3. Happy? Click **Copy config as JSON** and paste the values you changed back into `config.js` to keep them. (The panel does not save by itself; a page reload restores the file's values.)

Good first experiments:

| Try this | Where | What you will feel |
| --- | --- | --- |
| Slippery tyres | `tires.frictionSlipFront/Rear` → 0.8 | The kart washes wide in every corner |
| Loose rear end | make `frictionSlipRear` smaller than `frictionSlipFront` | Oversteer: the back steps out by itself |
| Soft suspension | `suspension.stiffness` → 30 | Lots of lean and dive, a bit boat-like |
| No body roll | `chassis.bodyRoll` → 0 | Flat cornering, less weight transfer |
| Wilder drifts | `handbrake.rearGripFactor` → 0.5 | The handbrake spins you much more easily |
| Moon mode | `gravity` → 5 | Floaty, almost no grip |

After bigger changes run the headless check. A simple robot driver does two laps without any graphics and prints lap time, top speed and wall hits; it also checks the track's shape:

```bash
npm run sim
```

To change the **circuit**, edit the control points in [src/game/track/layout.js](src/game/track/layout.js) and reload the page.

## Other commands

```bash
npm run build   # bundle the game into dist/
npm start       # serve dist/ (same server, without Vite's dev features)
```

## Project layout

```
server/                 The one Node process: HTTPS, pages, WebSocket relay
  index.js              start here
  relay.js              forwards messages between phone and game
  certificate.js        makes the self-signed HTTPS certificate
  network.js            finds the Mac's Wi-Fi address

index.html              the game page
controller/index.html   the phone page

src/game/               the game (runs in the Mac's browser)
  main.js               start here: creates and connects all modules
  config.js             ALL tuning values
  loop.js               fixed-timestep game loop with render interpolation
  physics.js            Rapier world, static colliders, ray casts
  vehicle.js            the kart's physics (ray-cast vehicle)
  kartModel.js          what the kart looks like
  camera.js             chase camera
  effects.js            smoke, dust, skid marks
  laps.js               checkpoints, lap counting, best lap
  hud.js / hud.css      speed, times, QR code, start screen
  scene.js              renderer, sky, lights, shadows, fog
  tuningPanel.js        the lil-gui panel (G)
  debugView.js          physics wireframe (C)
  audio.js              empty stub, ready for sound later
  input/                keyboard + phone input, merged into one
  track/                the circuit: layout -> path -> geometry -> meshes/colliders/scenery

src/controller/         the phone page
  main.js               start here: reads controls, sends 60 messages/s
  tilt.js               tilt sensor -> steering value
  buttons.js            multi-touch buttons and the fallback slider
  connection.js         WebSocket with auto-reconnect
  screen.js             fullscreen, wake lock, gesture blocking

tools/sim-test.js       headless physics test (npm run sim)
docs/HOW_IT_WORKS.md    the guided tour
```

## Why the certificate warning?

iPhones only let a web page read the tilt sensors if the page was loaded over HTTPS. HTTPS needs a certificate, and a certificate that browsers trust without asking can only be issued for a public domain name — not for an address like `192.168.1.23` on your home network. So the server creates its own ("self-signed") certificate the first time it runs and stores it in `.cert/`. The browser cannot verify who made it, hence the warning. On your own Wi-Fi, for your own game, accepting it is fine.

## Out of scope (for now)

No opponents, items, multiplayer, sound or menus. The code is laid out so these can be added: `Vehicle` has no rendering or input code in it (the robot in `tools/sim-test.js` already drives one), `audio.js` is a stub that the game already calls at the right moments, and the input layer merges any number of sources.

Everything in this project — track, kart, driver, name — is original.
