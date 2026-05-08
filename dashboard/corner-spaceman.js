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
  // Camera framing aims for ~0.35m of clearance above the helmet so the
  // backpack / antenna / shoulder cuffs don't clip when the model spins.
  // Vertical extent ~2.5m at distance 5.4m with FOV 26.
  const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);
  camera.position.set(0, 1.05, 5.4);
  camera.lookAt(0, 1.05, 0);

  scene.add(new THREE.AmbientLight(0xfff5e0, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(2, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc7d8ff, 0.4);
  fill.position.set(-2, 1.5, 2);
  scene.add(fill);

  // The astronaut's local origin is at its FEET (y=0, head ~y=1.8). To
  // flip around the visual mid-body we use a two-group rig:
  //
  //   pivot  (sits at world y=0.95, owns the y-spin)
  //     └── centerer  (owns the z-flip; its origin = mid-body of the model)
  //           └── model  (offset y=-0.9 so feet/head straddle the centerer origin)
  //
  // Without this rig, model.rotation.z = PI would swing the head down to
  // y=-1.8 (well below the camera frame) and we'd see only the boots.
  const pivot = new THREE.Group();
  pivot.position.y = 1.05;
  scene.add(pivot);

  const centerer = new THREE.Group();
  if (flip) centerer.rotation.z = Math.PI;
  pivot.add(centerer);

  const model = gltf.scene.clone(true);
  model.position.y = -0.9;              // mid-body to centerer origin
  centerer.add(model);

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
  // Top-left only: anchor to the (variable-height) honesty strip's
  // bottom edge. The bottom-right host stays anchored via CSS
  // (bottom + right), so we must NOT set its `top`.
  if (topLeftHost) applyTopOffset(topLeftHost);
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
