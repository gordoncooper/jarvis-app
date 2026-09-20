import { Grid, Stars } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  DataArcs,
  Graticule,
  LimbTicks,
  LockReticle,
  MemoryBeads,
  RangeRings,
  ScanRing,
  SystemOrbits,
} from "./features.js";
import { geo, type SysFlags } from "./geo.js";
import {
  atmoFrag,
  atmoVert,
  earthFrag,
  earthVert,
} from "./shaders.js";

export type GlobeState = {
  live: boolean;
  streaming: boolean;
  alert: boolean;
  frozen: boolean;
  systems: SysFlags;
  memoryFacts: number;
};

const R = 1.55;

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

function Earth({ live, streaming, alert, frozen }: Omit<GlobeState, "systems" | "memoryFacts">) {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const { day, night, spec, normal } = useMaps();

  const earthMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: earthVert,
        fragmentShader: earthFrag,
        uniforms: {
          tDay: { value: day },
          tNight: { value: night },
          tSpec: { value: spec },
          tNormal: { value: normal },
          uTime: { value: 0 },
          uAccent: { value: new THREE.Color("#5eead4") },
          uLive: { value: 1 },
          uScan: { value: 0 },
          uAlert: { value: 0 },
          uFrozen: { value: 0 },
        },
      }),
    [day, night, spec, normal],
  );
  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: atmoVert,
        fragmentShader: atmoFrag,
        uniforms: {
          uAccent: { value: new THREE.Color("#5eead4") },
          uFrozen: { value: 0 },
          uAlert: { value: 0 },
          uLive: { value: 1 },
        },
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useFrame((_, dt) => {
    const spin = frozen ? 0.012 : live ? 0.055 : 0.02;
    if (group.current) group.current.rotation.y += spin * dt;
    const eu = earthMat.uniforms;
    eu.uTime.value += dt;
    eu.uLive.value = THREE.MathUtils.damp(eu.uLive.value, live ? 1 : 0, 4, dt);
    eu.uScan.value = THREE.MathUtils.damp(eu.uScan.value, streaming ? 1 : 0, 6, dt);
    eu.uAlert.value = THREE.MathUtils.damp(eu.uAlert.value, alert ? 1 : 0, 6, dt);
    eu.uFrozen.value = THREE.MathUtils.damp(eu.uFrozen.value, frozen ? 1 : 0, 4, dt);
    atmoMat.uniforms.uLive.value = eu.uLive.value;
    atmoMat.uniforms.uAlert.value = eu.uAlert.value;
    atmoMat.uniforms.uFrozen.value = eu.uFrozen.value;

    if (group.current) {
      const local = camera.position.clone();
      group.current.worldToLocal(local).normalize();
      geo.lat = (Math.asin(THREE.MathUtils.clamp(local.y, -1, 1)) * 180) / Math.PI;
      geo.lon = (Math.atan2(local.z, -local.x) * 180) / Math.PI;
      geo.hdg = ((group.current.rotation.y * 180) / Math.PI + 360) % 360;
    }
    geo.mode = alert ? "LOCK" : streaming ? "SCAN" : frozen ? "HOLD" : live ? "LIVE" : "WAIT";
  });

  return (
    <group ref={group} rotation={[0.32, 0.55, 0]}>
      <mesh material={earthMat}>
        <sphereGeometry args={[R, 96, 96]} />
      </mesh>
      <mesh material={atmoMat} scale={1.09}>
        <sphereGeometry args={[R, 64, 64]} />
      </mesh>
      <Graticule />
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[R + 0.012, 0.004, 8, 160]} />
        <meshBasicMaterial color="#5eead4" transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </group>
  );
}

function ContactShadow() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float a = smoothstep(1.0, 0.1, d) * 0.58;
            gl_FragColor = vec4(0.0, 0.0, 0.0, a);
          }
        `,
      }),
    [],
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.04, 0]} material={mat}>
      <planeGeometry args={[5.4, 5.4]} />
    </mesh>
  );
}

function Stage(props: GlobeState) {
  return (
    <>
      <Stars radius={70} depth={40} count={1600} factor={2.1} saturation={0} fade speed={0.18} />
      <Suspense fallback={null}>
        <Earth
          live={props.live}
          streaming={props.streaming}
          alert={props.alert}
          frozen={props.frozen}
        />
      </Suspense>
      <ContactShadow />
      <SystemOrbits systems={props.systems} />
      <DataArcs live={props.live} streaming={props.streaming} />
      <RangeRings live={props.live} />
      <LimbTicks />
      <ScanRing on={props.streaming} />
      <LockReticle on={props.alert} />
      <MemoryBeads count={props.memoryFacts} />
      <Grid
        infiniteGrid
        fadeDistance={20}
        fadeStrength={1.35}
        cellSize={0.5}
        sectionSize={2.5}
        cellColor="#1c252e"
        sectionColor="#1a4a46"
        cellThickness={0.28}
        sectionThickness={0.5}
        position={[0, -2.05, 0]}
      />
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom
          intensity={0.22}
          luminanceThreshold={0.88}
          luminanceSmoothing={0.22}
          mipmapBlur
          radius={0.45}
        />
        <Vignette eskil={false} offset={0.42} darkness={0.52} />
      </EffectComposer>
    </>
  );
}

export function Globe(props: GlobeState) {
  return (
    <Canvas
      className="hud-globe-canvas"
      dpr={[1, 1.5]}
      gl={{
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.82,
      }}
      camera={{ position: [0, 0.72, 5.2], fov: 32, near: 0.1, far: 90 }}
      onCreated={({ gl }) => {
        gl.setClearColor("#07090b", 1);
      }}
    >
      <Stage {...props} />
    </Canvas>
  );
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
