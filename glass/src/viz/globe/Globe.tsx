import { Grid, Stars } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
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
  cloudFrag,
  cloudVert,
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
  const [day, night, spec, clouds, normal] = useLoader(THREE.TextureLoader, [
    "/globe/day.jpg",
    "/globe/night.jpg",
    "/globe/spec.jpg",
    "/globe/clouds.png",
    "/globe/normal.jpg",
  ]);
  useMemo(() => {
    for (const t of [day, night, clouds, spec, normal]) {
      t.colorSpace = t === spec || t === normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
    }
  }, [day, night, spec, clouds, normal]);
  return { day, night, spec, clouds, normal };
}

function Earth({ live, streaming, alert, frozen }: Omit<GlobeState, "systems" | "memoryFacts">) {
  const group = useRef<THREE.Group>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const { day, night, spec, clouds, normal } = useMaps();

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
  const cloudMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: cloudVert,
        fragmentShader: cloudFrag,
        uniforms: {
          tClouds: { value: clouds },
          uAccent: { value: new THREE.Color("#5eead4") },
          uLive: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [clouds],
  );

  useFrame((_, dt) => {
    const spin = frozen ? 0.012 : live ? 0.055 : 0.02;
    if (group.current) group.current.rotation.y += spin * dt;
    if (cloudsRef.current) cloudsRef.current.rotation.y += spin * dt * 1.12;
    const eu = earthMat.uniforms;
    eu.uTime.value += dt;
    eu.uLive.value = THREE.MathUtils.damp(eu.uLive.value, live ? 1 : 0, 4, dt);
    eu.uScan.value = THREE.MathUtils.damp(eu.uScan.value, streaming ? 1 : 0, 6, dt);
    eu.uAlert.value = THREE.MathUtils.damp(eu.uAlert.value, alert ? 1 : 0, 6, dt);
    eu.uFrozen.value = THREE.MathUtils.damp(eu.uFrozen.value, frozen ? 1 : 0, 4, dt);
    atmoMat.uniforms.uLive.value = eu.uLive.value;
    atmoMat.uniforms.uAlert.value = eu.uAlert.value;
    atmoMat.uniforms.uFrozen.value = eu.uFrozen.value;
    cloudMat.uniforms.uLive.value = eu.uLive.value;

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
    <group ref={group} rotation={[0.28, 1.85, 0]}>
      <mesh material={earthMat}>
        <sphereGeometry args={[R, 96, 96]} />
      </mesh>
      <mesh ref={cloudsRef} material={cloudMat}>
        <sphereGeometry args={[R * 1.015, 64, 64]} />
      </mesh>
      <mesh material={atmoMat} scale={1.07}>
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

function Stage(props: GlobeState) {
  return (
    <>
      <Stars radius={60} depth={32} count={1200} factor={2.4} saturation={0} fade speed={0.2} />
      <Suspense fallback={null}>
        <Earth
          live={props.live}
          streaming={props.streaming}
          alert={props.alert}
          frozen={props.frozen}
        />
      </Suspense>
      <SystemOrbits systems={props.systems} />
      <DataArcs live={props.live} streaming={props.streaming} />
      <RangeRings live={props.live} />
      <LimbTicks />
      <ScanRing on={props.streaming} />
      <LockReticle on={props.alert} />
      <MemoryBeads count={props.memoryFacts} />
      <Grid
        infiniteGrid
        fadeDistance={18}
        fadeStrength={1.2}
        cellSize={0.5}
        sectionSize={2.5}
        cellColor="#1c252e"
        sectionColor="#1a4a46"
        cellThickness={0.3}
        sectionThickness={0.55}
        position={[0, -2.05, 0]}
      />
    </>
  );
}

export function Globe(props: GlobeState) {
  return (
    <Canvas
      className="hud-globe-canvas"
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 0.48, 3.7], fov: 36, near: 0.1, far: 90 }}
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
