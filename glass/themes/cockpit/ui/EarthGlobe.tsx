import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  stageAtmoFrag,
  stageAtmoVert,
  stageCloudFrag,
  stageCloudVert,
  stageEarthFrag,
  stageEarthVert,
} from "./earthGlobeShaders.js";

const R = 1;
const FOV = 32;
/** Black margin above and below the teal limb, not the crust. */
const MARGIN = 0.2;
const LIMB = 1.065;
const DIST = (R * LIMB) / ((1 - 2 * MARGIN) * Math.tan((FOV * Math.PI) / 180 / 2));
/** Zoom stays outside the atmosphere. The default is DIST, not a crust dive. */
const MIN_DIST = 3.8;
const MAX_DIST = 7.4;

/** Scope equirectangular: Americas sit just west of u=0.25, which is the
 *  +Z face of SphereGeometry. A few degrees of yaw centers CONUS. */
const AMERICAS_Y = 0.06;

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

function SparseStars() {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) {
      const r = 28 + Math.random() * 18;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  return (
    <points geometry={geom}>
      <pointsMaterial
        color="#c5d0d8"
        size={0.055}
        sizeAttenuation
        depthWrite={false}
        transparent
        opacity={0.45}
      />
    </points>
  );
}

function NightMarble() {
  const { camera } = useThree();
  const { day, night, spec, normal, clouds } = usePlanetMaps();
  const sun = useRef(new THREE.Vector3(0, 0.05, -1));

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
          uSunDir: { value: sun.current.clone() },
          uLights: { value: 2.0 },
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
          uSunDir: { value: sun.current.clone() },
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
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useFrame(() => {
    // Sun sits behind the planet, a little off-axis, and follows the camera
    // so orbiting shows another continent still at night.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    sun.current.copy(camera.position).normalize().negate();
    sun.current.addScaledVector(right, 0.22);
    sun.current.addScaledVector(up, 0.06);
    sun.current.normalize();
    earthMat.uniforms.uSunDir.value.copy(sun.current);
    cloudMat.uniforms.uSunDir.value.copy(sun.current);
  });

  return (
    <group rotation={[0.12, AMERICAS_Y, 0]}>
      <mesh material={earthMat}>
        <sphereGeometry args={[R, 128, 128]} />
      </mesh>
      <mesh material={cloudMat} scale={1.008}>
        <sphereGeometry args={[R, 96, 96]} />
      </mesh>
      <mesh material={atmoMat} scale={1.065}>
        <sphereGeometry args={[R, 96, 96]} />
      </mesh>
    </group>
  );
}

function Scene() {
  return (
    <>
      <color attach="background" args={["#000000"]} />
      <SparseStars />
      <Suspense fallback={null}>
        <NightMarble />
      </Suspense>
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.45}
        zoomSpeed={0.35}
        minDistance={MIN_DIST}
        maxDistance={MAX_DIST}
        minPolarAngle={Math.PI / 2 - 0.65}
        maxPolarAngle={Math.PI / 2 + 0.45}
      />
    </>
  );
}

export function EarthGlobe() {
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
        camera={{ position: [0, 0, DIST], fov: FOV, near: 0.08, far: 80 }}
      >
        <Scene />
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
