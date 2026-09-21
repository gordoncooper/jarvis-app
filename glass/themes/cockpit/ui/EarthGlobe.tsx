import { Stars } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  stageAtmoFrag,
  stageAtmoVert,
  stageEarthFrag,
  stageEarthVert,
} from "./earthGlobeShaders.js";

const R = 1.6;

/** Americas-facing start: CONUS under the camera (Blue Marble UV, +Y west). */
const USA_Y = 5.87;
const USA_X = 0.28;

/** Fixed cinematic sun, slightly behind and up-left of the camera, so the disc
 *  facing the operator is always night with a dawn crescent on the limb. This
 *  is art direction on a backdrop, not a cluster reading: COCKPIT.md asks for a
 *  night Earth unconditionally, and the real UTC lives in the HUD. */
const SUN = new THREE.Vector3(-0.26, 0.40, -0.90).normalize();

const IDLE_SPIN = 0.0075; // rad/s — one turn every ~14 minutes
const DRAG_GAIN = 0.0042;
const TILT_LIMIT = 0.65;

function useMaps() {
  const [day, night, spec, normal] = useLoader(THREE.TextureLoader, [
    "/globe/day.jpg",
    "/globe/night.jpg",
    "/globe/spec.jpg",
    "/globe/normal.jpg",
  ]);
  useMemo(() => {
    for (const t of [day, night]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
    }
    for (const t of [spec, normal]) {
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 8;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
    }
  }, [day, night, spec, normal]);
  return { day, night, spec, normal };
}

type Drag = { yaw: number; pitch: number; spin: number; dragging: boolean };

function NightEarth({ drag }: { drag: React.MutableRefObject<Drag> }) {
  const group = useRef<THREE.Group>(null);
  const { day, night, spec, normal } = useMaps();

  const earthMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: stageEarthVert,
        fragmentShader: stageEarthFrag,
        uniforms: {
          tDay: { value: day },
          tNight: { value: night },
          tSpec: { value: spec },
          tNormal: { value: normal },
          uSunDir: { value: SUN },
          uLights: { value: 3.0 },
        },
      }),
    [day, night, spec, normal],
  );

  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: stageAtmoVert,
        fragmentShader: stageAtmoFrag,
        uniforms: { uSunDir: { value: SUN } },
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useFrame((_, dt) => {
    const d = drag.current;
    if (!d.dragging) d.spin += IDLE_SPIN * Math.min(dt, 0.1);
    if (group.current) {
      group.current.rotation.y = USA_Y + d.spin + d.yaw;
      group.current.rotation.x = USA_X + d.pitch;
    }
  });

  return (
    <group ref={group} rotation={[USA_X, USA_Y, 0.04]}>
      <mesh material={earthMat}>
        <sphereGeometry args={[R, 128, 128]} />
      </mesh>
      <mesh material={atmoMat} scale={1.022}>
        <sphereGeometry args={[R, 64, 64]} />
      </mesh>
    </group>
  );
}

/** Drag to spin (COCKPIT.md §4). Bound on the canvas element so the deck's
 *  swipe handler never sees the gesture and slides to CMD mid-drag. */
function DragSpin({ drag }: { drag: React.MutableRefObject<Drag> }) {
  const { gl } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    let id: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const down = (ev: PointerEvent) => {
      id = ev.pointerId;
      lastX = ev.clientX;
      lastY = ev.clientY;
      drag.current.dragging = true;
      el.setPointerCapture(ev.pointerId);
      ev.stopPropagation();
    };
    const move = (ev: PointerEvent) => {
      if (id !== ev.pointerId) return;
      drag.current.yaw += (ev.clientX - lastX) * DRAG_GAIN;
      drag.current.pitch = Math.max(
        -TILT_LIMIT,
        Math.min(TILT_LIMIT, drag.current.pitch + (ev.clientY - lastY) * DRAG_GAIN * 0.6),
      );
      lastX = ev.clientX;
      lastY = ev.clientY;
      ev.stopPropagation();
    };
    const up = (ev: PointerEvent) => {
      if (id !== ev.pointerId) return;
      id = null;
      drag.current.dragging = false;
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      ev.stopPropagation();
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [gl, drag]);

  return null;
}

function Scene({ drag }: { drag: React.MutableRefObject<Drag> }) {
  return (
    <>
      <color attach="background" args={["#02040a"]} />
      <Stars radius={60} depth={40} count={3200} factor={1.4} saturation={0} fade speed={0.06} />
      <DragSpin drag={drag} />
      {/* Framing group: the reference sits the globe low so the lit limb clears
          the top chrome and the southern hemisphere runs off the bottom edge. */}
      <group position={[0, -0.35, 0]}>
        <Suspense fallback={null}>
          <NightEarth drag={drag} />
        </Suspense>
      </group>
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom intensity={0.42} luminanceThreshold={0.5} luminanceSmoothing={0.6} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export function EarthGlobe() {
  const drag = useRef<Drag>({ yaw: 0, pitch: 0, spin: 0, dragging: false });
  return (
    <div className="ck-breath-canvas">
      <Canvas
        dpr={[1, 1.6]}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        camera={{ position: [0, 0, 10.4], fov: 16, near: 0.1, far: 200 }}
      >
        <Scene drag={drag} />
      </Canvas>
    </div>
  );
}

export function earthWebglOk(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
