import * as THREE from "three";

export type StarFrame = {
  /** Camera sits on +z and looks down −z. Screen right is +x, screen up is +y. */
  camZ: number;
  fovDeg: number;
  /** Disc center. The globe is shifted down; the camera still looks at the origin. */
  earthY: number;
  /** Radius past the atmosphere, so a star is not painted into the limb. */
  limbR: number;
  far: number;
};

const COUNT = 88;
/** Wide enough that a wall display still has stars in the side margins. */
const COVER_ASPECT = 2.2;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** World positions plus per-star phase, pixel size, twinkle rate, brightness, warmth.
 *  Every point is inside the camera frustum, behind the disc, and outside the limb. */
export function buildStarGeometry(frame: StarFrame, seed = 0x51a2c): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const cam = new THREE.Vector3(0, 0, frame.camZ);
  const earth = new THREE.Vector3(0, frame.earthY, 0);
  const toEarth = earth.clone().sub(cam).normalize();
  const limbAng = Math.atan2(frame.limbR, cam.distanceTo(earth));
  const fov = THREE.MathUtils.degToRad(frame.fovDeg);

  const positions = new Float32Array(COUNT * 3);
  const phase = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);
  const gain = new Float32Array(COUNT);
  const bright = new Float32Array(COUNT);
  const warm = new Float32Array(COUNT);

  let i = 0;
  let guard = 0;
  while (i < COUNT && guard < 20000) {
    guard++;
    // Just behind the disc. Points shoved at the far plane fail the depth test.
    const dist = 13 + rand() * 9;
    if (dist >= frame.far - 2) continue;
    const halfH = Math.tan(fov / 2) * dist;
    const halfW = halfH * COVER_ASPECT;
    const x = (rand() * 2 - 1) * halfW * 0.94;
    const y = (rand() * 2 - 1) * halfH * 0.94;
    const point = new THREE.Vector3(x, y, frame.camZ - dist);
    const dir = point.clone().sub(cam).normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(toEarth), -1, 1));
    if (ang < limbAng * 1.15) continue;

    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
    phase[i] = rand() * Math.PI * 2;
    const roll = rand();
    size[i] = roll > 0.9 ? 1.55 + rand() * 0.4 : 1.05 + rand() * 0.3;
    gain[i] = 0.45 + rand() * 1.15;
    bright[i] = roll > 0.9 ? 1.15 + rand() * 0.35 : 0.72 + rand() * 0.32;
    warm[i] = rand() > 0.88 ? 0.45 + rand() * 0.4 : rand() * 0.06;
    i++;
  }
  if (i < COUNT) throw new Error(`starfield placed ${i} of ${COUNT}`);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aGain", new THREE.BufferAttribute(gain, 1));
  geo.setAttribute("aBright", new THREE.BufferAttribute(bright, 1));
  geo.setAttribute("aWarm", new THREE.BufferAttribute(warm, 1));
  geo.computeBoundingSphere();
  return geo;
}
