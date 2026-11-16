// =============================================================================
// controller/tilt.js — steering by tilting the phone like a steering wheel.
//
// The browser's `deviceorientation` event reports how the phone is rotated as
// three angles. Two of them matter here:
//   beta   tilt front/back  (0 = flat on a table, 90 = standing upright)
//   gamma  tilt left/right  (-90..90)
//
// Using beta or gamma directly as "the steering angle" breaks down when the
// phone is held in landscape, so we do it properly:
//
//   1. From beta and gamma, compute which way is UP (against gravity) as seen
//      from the phone:  up = (-cos(beta)·sin(gamma),  sin(beta),  cos(beta)·cos(gamma))
//      where x points to the phone's right edge, y to its top edge and z out
//      of the screen.
//   2. Only look at the part of `up` that lies IN the screen (x and y). Its
//      direction is exactly "how far is the phone rolled like a steering
//      wheel":   roll = atan2(-up.x, up.y)      (clockwise = positive)
//
// This works whether the screen faces you or is leaned back, and in either
// landscape direction. "Calibrate" stores the current roll as the centre.
// =============================================================================

const DEG = Math.PI / 180;

export class TiltSteering {
  constructor() {
    /** Steering output, -1 (full left) .. +1 (full right). */
    this.value = 0;
    /** True once the sensor has delivered at least one real reading. */
    this.available = false;

    /** Tilt (degrees) that gives full steering lock. Smaller = more sensitive. */
    this.fullLockDegrees = 35;
    /** Fraction of the range around the centre that counts as "straight". */
    this.deadzone = 0.06;
    /** Smoothing time in seconds; removes sensor jitter. 0 = none. */
    this.smoothingSeconds = 0.05;

    this.roll = 0; // latest raw roll angle in degrees
    this.centre = 0; // the roll that means "straight ahead"
    this.calibrateOnNextReading = true;
    this.lastEventTime = 0;

    this.onOrientation = this.onOrientation.bind(this);
  }

  /**
   * Ask for permission (needed on iOS, and only allowed inside a tap handler)
   * and start listening. Resolves to false if permission was refused.
   */
  async start() {
    // iOS 13+ has this function; Android and desktop browsers do not.
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const answer = await DeviceOrientationEvent.requestPermission();
        if (answer !== 'granted') return false;
      } catch {
        return false;
      }
    }
    window.addEventListener('deviceorientation', this.onOrientation);
    this.#followScreenFlips();
    return true;
  }

  /**
   * If the phone is flipped to the OTHER landscape direction, the browser
   * turns the page upside down for us (the screen angle changes by 180°).
   * The roll we measure jumps by 180° too, so we move the centre along and
   * the player does not need to calibrate again.
   */
  #followScreenFlips() {
    const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;
    let lastAngle = screenAngle();
    const onChange = () => {
      const angle = screenAngle();
      if (Math.abs(angle - lastAngle) === 180) {
        this.centre += this.centre > 0 ? -180 : 180;
      }
      lastAngle = angle;
    };
    if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', onChange);
    else window.addEventListener('orientationchange', onChange); // older iOS
  }

  /** Make the current way of holding the phone mean "straight ahead". */
  calibrate() {
    this.centre = this.roll;
    this.value = 0;
  }

  onOrientation(event) {
    // Desktop browsers fire the event once with nulls: no sensor.
    if (event.beta === null || event.gamma === null) return;

    const beta = event.beta * DEG;
    const gamma = event.gamma * DEG;

    // Step 1: the "up" direction in the phone's own axes (see top of file).
    const upX = -Math.cos(beta) * Math.sin(gamma);
    const upY = Math.sin(beta);

    // If the phone lies nearly flat, "up" points out of the screen and its
    // in-screen part is tiny and noisy: keep the previous value.
    if (Math.hypot(upX, upY) < 0.25) return;

    // Step 2: roll angle, clockwise positive, in degrees.
    this.roll = Math.atan2(-upX, upY) / DEG;
    this.available = true;

    if (this.calibrateOnNextReading) {
      this.calibrateOnNextReading = false;
      this.calibrate();
    }

    // Difference to the centre, wrapped into -180..180.
    let delta = this.roll - this.centre;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    // Scale to -1..1 and apply the deadzone.
    const target = applyDeadzone(clamp(delta / this.fullLockDegrees, -1, 1), this.deadzone);

    // Smoothing: move a fraction of the way to the target, depending on how
    // much time passed since the previous reading.
    const now = performance.now();
    const dt = Math.min((now - this.lastEventTime) / 1000, 0.1);
    this.lastEventTime = now;
    const blend = this.smoothingSeconds > 0 ? 1 - Math.exp(-dt / this.smoothingSeconds) : 1;
    this.value += (target - this.value) * blend;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Values inside the deadzone become 0; the rest is stretched so the output
 * still reaches exactly ±1 (no sudden jump at the deadzone's edge).
 */
export function applyDeadzone(value, deadzone) {
  const size = Math.abs(value);
  if (size <= deadzone) return 0;
  return (Math.sign(value) * (size - deadzone)) / (1 - deadzone);
}
