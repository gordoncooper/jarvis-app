import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildStarGeometry, type StarFrame } from "./starfield.ts";

/** Must match the camera and disc in EarthGlobe.tsx. Camera on +z, looking −z. */
const frame: StarFrame = {
  camZ: 10.2,
  fovDeg: 16,
  earthY: -0.46,
  limbR: 1.6 * 1.06,
  far: 50,
};

test("stars sit in the background, outside the limb", () => {
  const geo = buildStarGeometry(frame);
  const pos = geo.getAttribute("position");
  assert.equal(pos.count, 110);
  const cam = new THREE.Vector3(0, 0, frame.camZ);
  const earth = new THREE.Vector3(0, frame.earthY, 0);
  const toEarth = earth.clone().sub(cam).normalize();
  const limbAng = Math.atan2(frame.limbR, cam.distanceTo(earth));
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const dist = p.distanceTo(cam);
    assert.ok(dist > 12 && dist < frame.far - 1, `star ${i} dist ${dist}`);
    assert.ok(p.z < earth.z, `star ${i} is not behind the disc`);
    const ang = Math.acos(THREE.MathUtils.clamp(p.clone().sub(cam).normalize().dot(toEarth), -1, 1));
    assert.ok(ang > limbAng, `star ${i} falls inside the limb`);
  }
  geo.dispose();
});
