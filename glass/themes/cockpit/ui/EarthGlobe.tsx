import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  stageAtmoFrag,
  stageAtmoVert,
  stageCloudFrag,
  stageCloudVert,
  stageEarthFrag,
  stageEarthVert,
} from "./earthGlobeShaders.js";

const R = 1.6;

/** reference/breath.jpg: the disk sits low. The lit limb clears the header
 *  and the southern hemisphere runs off the bottom of the stage. */
const FRAME_Y = -0.46;

/** Scope equirectangular, +Z of SphereGeometry is u=0.25. This yaw puts
 *  ~100°E (India left, China center, Australia low) on the camera. */
const ASIA_Y = 2.97;
const TILT_X = 0.16;

/** Sun above and behind the camera: the facing disc is night, the top limb is day. */
const SUN = new THREE.Vector3(0.05, 0.62, -0.78).normalize();

const DRAG_GAIN = 0.0042;
const TILT_LIMIT = 0.55;

function configureMaps(
  color: THREE.Texture[],
  data: THREE.Texture[],
  anisotropy: number,
) {
  for (const t of color) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.wrapS = THREE.RepeatWrapping;
  }
  for (const t of data) {
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    t.wrapS = THREE.RepeatWrapping;
  }
}

function usePlanetMaps() {
  const { gl } = useThree();
  const anisotropy = gl.capabilities.getMaxAnisotropy();
  const [day, night, spec, normal, clouds] = useLoader(THREE.TextureLoader, [
    "/globe/day.jpg",
    "/globe/night.jpg",
    "/globe/spec.jpg",
    "/globe/normal.jpg",
    "/globe/clouds.jpg",
  ]);
  useMemo(() => {
    configureMaps([day, night], [spec, normal, clouds], anisotropy);
  }, [day, night, spec, normal, clouds, anisotropy]);
  return { day, night, spec, normal, clouds };
}

type Drag = { yaw: number; pitch: number; dragging: boolean };

function NightEarth({ drag }: { drag: React.MutableRefObject<Drag> }) {
  const group = useRef<THREE.Group>(null);
  const { day, night, spec, normal, clouds } = usePlanetMaps();

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
          uLights: { value: 2.15 },
        },
      }),
    [day, night, spec, normal],
  );

  const cloudMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: stageCloudVert,
        fragmentShader: stageCloudFrag,
        uniforms: {
          tCloud: { value: clouds },
          uSunDir: { value: SUN },
        },
        transparent: true,
        depthWrite: false,
      }),
    [clouds],
  );

  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: stageAtmoVert,
        fragmentShader: stageAtmoFrag,
        uniforms: {
          uSunDir: { value: SUN },
          uCenter: { value: new THREE.Vector3(0, FRAME_Y, 0) },
          uEarthR: { value: R },
          uAtmoR: { value: R * 1.12 },
        },
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useFrame(() => {
    const d = drag.current;
    if (!group.current) return;
    group.current.rotation.y = ASIA_Y + d.yaw;
    group.current.rotation.x = TILT_X + d.pitch;
  });

  return (
    <group ref={group} rotation={[TILT_X, ASIA_Y, 0.02]}>
      <mesh material={earthMat}>
        <sphereGeometry args={[R, 128, 128]} />
      </mesh>
      <mesh material={cloudMat} scale={1.012}>
        <sphereGeometry args={[R, 96, 96]} />
      </mesh>
      <mesh material={atmoMat} scale={1.12}>
        <sphereGeometry args={[R, 80, 80]} />
      </mesh>
    </group>
  );
}

/** Drag spins the globe. The listener is on the canvas so a sideways drag
 *  does not also slide the deck. */
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
        Math.min(TILT_LIMIT, drag.current.pitch + (ev.clientY - lastY) * DRAG_GAIN * 0.55),
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
      <color attach="background" args={["#000000"]} />
      <DragSpin drag={drag} />
      <group position={[0, FRAME_Y, 0]}>
        <Suspense fallback={null}>
          <NightEarth drag={drag} />
        </Suspense>
      </group>
    </>
  );
}

export function EarthGlobe() {
  const drag = useRef<Drag>({ yaw: 0, pitch: 0, dragging: false });
  return (
    <div className="ck-breath-canvas">
      <Canvas
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        camera={{ position: [0, 0, 10.2], fov: 16, near: 0.1, far: 50 }}
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
