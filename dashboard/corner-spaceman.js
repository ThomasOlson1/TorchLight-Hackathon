// Two decorative spinning astronauts, positioned at top-left and
// bottom-right corners with 180-degree rotational symmetry: the second is
// flipped upside down and spins in the opposite direction.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = "./assets/Astronaut.glb";
const SPIN_RPM  = 6;
const RADIANS_PER_FRAME = (SPIN_RPM * 2 * Math.PI) / 60 / 60;

// Anchor each spaceman to the (variable-height) honesty strip so the
// top-left one sits flush below the bar regardless of how the bar wraps.
function strip() { return document.getElementById("honesty-strip"); }
function applyTopOffset(host) {
  const s = strip();
  if (!s) return;
  host.style.top = (s.offsetHeight + 12) + "px";
}

function createSpaceman({ hostId, gltf, flip, spinDir }) {
  const host = document.getElementById(hostId);
  if (!host) return null;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      failIfMajorPerformanceCaveat: false,
    });
  } catch {
    host.style.display = "none";
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Tighter FOV + larger distance so the astronaut fits head-to-feet
  // with breathing room above the helmet and below the boots.
  const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);
  camera.position.set(0, 0.95, 4.6);
  camera.lookAt(0, 0.95, 0);

  scene.add(new THREE.AmbientLight(0xfff5e0, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(2, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc7d8ff, 0.4);
  fill.position.set(-2, 1.5, 2);
  scene.add(fill);

  // Pivot at mid-body height so the upside-down rotation flips around the
  // visual center rather than around the feet.
  const pivot = new THREE.Group();
  pivot.position.y = 0.95;
  scene.add(pivot);

  const model = gltf.scene.clone(true);
  model.position.y = -0.95;             // re-center inside the pivot
  if (flip) model.rotation.z = Math.PI; // upside down
  pivot.add(model);

  function fitToHost() {
    const w = Math.max(1, host.clientWidth  || 220);
    const h = Math.max(1, host.clientHeight || 270);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  fitToHost();
  window.addEventListener("resize", fitToHost);

  return {
    tick(dt) {
      pivot.rotation.y += spinDir * RADIANS_PER_FRAME * (dt / (1000 / 60));
      renderer.render(scene, camera);
    },
  };
}

(async function init() {
  const topLeftHost = document.getElementById("corner-spaceman");
  const bottomRightHost = document.getElementById("corner-spaceman-2");
  [topLeftHost, bottomRightHost].forEach(h => h && applyTopOffset(h));
  // Re-anchor (top-left only; bottom-right uses bottom: in CSS) on resize +
  // after layout settles for late-loading webfonts.
  function reanchor() { if (topLeftHost) applyTopOffset(topLeftHost); }
  window.addEventListener("resize", reanchor);
  requestAnimationFrame(() => requestAnimationFrame(reanchor));

  let gltf;
  try {
    const loader = new GLTFLoader();
    gltf = await new Promise((resolve, reject) =>
      loader.load(MODEL_URL, resolve, undefined, reject)
    );
  } catch (err) {
    console.warn("Corner spaceman: model failed to load.", err);
    if (topLeftHost) topLeftHost.style.display = "none";
    if (bottomRightHost) bottomRightHost.style.display = "none";
    return;
  }

  const top    = createSpaceman({ hostId: "corner-spaceman",   gltf, flip: false, spinDir: +1 });
  const bottom = createSpaceman({ hostId: "corner-spaceman-2", gltf, flip: true,  spinDir: -1 });
  const all = [top, bottom].filter(Boolean);
  if (!all.length) return;

  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(48, now - prev);
    prev = now;
    for (const s of all) s.tick(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
