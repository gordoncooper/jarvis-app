import { Stars } from "@react-three/drei";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  stageAtmoFrag,
  stageAtmoVert,
  stageEarthFrag,
  stageEarthVert,
} from "./stageEarthShaders.js";

const R = 1.6;

/** Americas-facing start: CONUS under the camera (tuned vs Blue Marble UV). */
const USA_Y = 2.05;
const USA_X = 0.18;

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

function WarmEarth() {
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
          uWarm: { value: 1 },
        },
      }),
    [day, night, spec, normal],
  );

  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: stageAtmoVert,
        fragmentShader: stageAtmoFrag,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += 0.018 * dt;
  });

  return (
    <group ref={group} rotation={[USA_X, USA_Y, 0.04]}>
      <mesh material={earthMat}>
        <sphereGeometry args={[R, 128, 128]} />
      </mesh>
      <mesh material={atmoMat} scale={1.085}>
        <sphereGeometry args={[R, 64, 64]} />
      </mesh>
    </group>
  );
}

function Scene() {
  return (
    <>
      <color attach="background" args={["#030405"]} />
      <ambientLight intensity={0.18} />
      <directionalLight position={[4, 2, 3]} intensity={0.55} color="#ffd6a8" />
      <Stars radius={90} depth={50} count={2200} factor={2.4} saturation={0} fade speed={0.12} />
      <Suspense fallback={null}>
        <WarmEarth />
      </Suspense>
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom intensity={0.28} luminanceThreshold={0.82} luminanceSmoothing={0.28} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export function StageEarth() {
  return (
    <div className="ck-stage-canvas">
      <Canvas
        dpr={[1, 1.6]}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        camera={{ position: [0, 0.28, 3.55], fov: 34, near: 0.1, far: 120 }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}

export function stageWebglOk(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
