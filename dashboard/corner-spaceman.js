// Decorative slowly-spinning astronaut in the top-left corner.
// Pure visual flourish; no interactivity. Bails silently if WebGL or the
// model fail to load.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const HOST_ID    = "corner-spaceman";
const MODEL_URL  = "./assets/Astronaut.glb";
const SIZE       = 150;        // px
const SPIN_RPM   = 6;          // revolutions per minute
const RADIANS_PER_FRAME = (SPIN_RPM * 2 * Math.PI) / 60 / 60;

(async function init() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      failIfMajorPerformanceCaveat: false,
    });
  } catch (err) {
    console.warn("Corner spaceman: WebGL unavailable, hiding.");
    host.style.display = "none";
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(SIZE, SIZE, false);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 50);
  camera.position.set(0, 0.85, 2.5);
  camera.lookAt(0, 0.85, 0);

  scene.add(new THREE.AmbientLight(0xfff5e0, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(2, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc7d8ff, 0.4);
  fill.position.set(-2, 1.5, 2);
  scene.add(fill);

  let model;
  try {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) =>
      loader.load(MODEL_URL, resolve, undefined, reject)
    );
    model = gltf.scene;
    scene.add(model);
  } catch (err) {
    console.warn("Corner spaceman: model failed to load, hiding.", err);
    host.style.display = "none";
    return;
  }

  // Spin around y axis. rAF loop is cheap because the canvas is tiny (150x150).
  // Browsers throttle rAF in background tabs automatically, so we don't need
  // a manual visibility handler.
  let prev = performance.now();
  function animate(now) {
    const dt = Math.min(48, now - prev);
    prev = now;
    if (model) model.rotation.y += RADIANS_PER_FRAME * (dt / (1000 / 60));
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
})();
