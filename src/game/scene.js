// =============================================================================
// scene.js — the Three.js renderer, the scene, the sky and the lights.
//
// Nothing game-specific lives here: no track, no kart. Other modules add
// their objects to `view.scene`.
// =============================================================================

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Where the sun stands in the sky.
const SUN_ELEVATION_DEG = 36;
const SUN_AZIMUTH_DEG = 215;
// Colour of the haze at the horizon; the fog fades distant things into it.
const HORIZON_COLOR = 0xc3d7e8;

export function createScene(config, canvas) {
  const g = config.graphics;

  // --- Renderer ------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Colour pipeline: lighting is computed in linear colour, then squeezed into
  // what a screen can show by ACES tone mapping, then encoded as sRGB.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // filtered, soft-edged shadows

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON_COLOR, g.fogNear, g.fogFar);

  const camera = new THREE.PerspectiveCamera(config.camera.fovDeg, 1, 0.1, 3000);

  // --- Sun direction ---------------------------------------------------------------
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEG),
    THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG),
  );

  // --- Sky: a huge box with a shader that paints a physically based sky --------------
  const sky = new Sky();
  sky.scale.setScalar(2500);
  sky.material.uniforms.turbidity.value = 4;
  sky.material.uniforms.rayleigh.value = 1.1;
  sky.material.uniforms.mieCoefficient.value = 0.004;
  sky.material.uniforms.mieDirectionalG.value = 0.82;
  sky.material.uniforms.sunPosition.value.copy(sunDirection);
  scene.add(sky);

  // Use the sky as an "environment map" too: shiny PBR materials reflect it,
  // and everything receives a little soft light from all directions.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyOnly = new THREE.Scene();
  skyOnly.add(sky.clone());
  scene.environment = pmrem.fromScene(skyOnly).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  // --- Lights -------------------------------------------------------------------------
  // Hemisphere light: bluish light from the sky above, greenish bounce light
  // from the grass below. Fills in the shadows.
  const hemisphere = new THREE.HemisphereLight(0xcfe4ff, 0x5a7a3a, 1.1);
  scene.add(hemisphere);

  // Directional light: the sun. Its shadow only covers a square around the
  // kart (moved every frame in followWithShadow), which keeps shadows sharp
  // without needing a gigantic shadow map for the whole track.
  const sun = new THREE.DirectionalLight(0xfff0dc, 4.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(g.shadowMapSize, g.shadowMapSize);
  sun.shadow.camera.left = -g.shadowRange;
  sun.shadow.camera.right = g.shadowRange;
  sun.shadow.camera.top = g.shadowRange;
  sun.shadow.camera.bottom = -g.shadowRange;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  /** Keep the sun's shadow area centred on a position (the kart). */
  function followWithShadow(position) {
    sun.target.position.copy(position);
    sun.position.copy(position).addScaledVector(sunDirection, 120);
  }

  // --- Quality ------------------------------------------------------------------------
  /** 'high' = shadows + sharp pixels; 'low' = no shadows, 1x pixels. */
  function setQuality(quality) {
    const high = quality !== 'low';
    sun.castShadow = high;
    renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
    resize();
  }

  // --- Resize -------------------------------------------------------------------------
  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  setQuality(g.quality);

  return { renderer, scene, camera, followWithShadow, setQuality };
}
