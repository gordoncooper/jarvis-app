import { Grid, Stars } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { atmoFrag, atmoVert, earthFrag, earthVert } from "./shaders.js";

export type GlobeState = {
  live: boolean;
  streaming: boolean;
  alert: boolean;
  frozen: boolean;
};

function Earth({ live, streaming, alert, frozen }: GlobeState) {
  const group = useRef<THREE.Group>(null);
  const earthMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: earthVert,
        fragmentShader: earthFrag,
        uniforms: {
          uTime: { value: 0 },
          uAccent: { value: new THREE.Color("#5eead4") },
          uInk: { value: new THREE.Color("#e7eef4") },
          uLive: { value: live ? 1 : 0 },
          uScan: { value: 0 },
          uAlert: { value: 0 },
          uFrozen: { value: frozen ? 1 : 0 },
        },
      }),
    [],
  );
  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: atmoVert,
        fragmentShader: atmoFrag,
        uniforms: {
          uAccent: { value: new THREE.Color("#5eead4") },
          uFrozen: { value: frozen ? 1 : 0 },
          uAlert: { value: 0 },
          uLive: { value: live ? 1 : 0 },
        },
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useFrame((_, dt) => {
    const spin = frozen ? 0.015 : live ? 0.085 : 0.03;
    if (group.current) group.current.rotation.y += spin * dt;
    const eu = earthMat.uniforms;
    eu.uTime.value += dt;
    eu.uLive.value = THREE.MathUtils.damp(eu.uLive.value, live ? 1 : 0, 4, dt);
    eu.uScan.value = THREE.MathUtils.damp(eu.uScan.value, streaming ? 1 : 0, 6, dt);
    eu.uAlert.value = THREE.MathUtils.damp(eu.uAlert.value, alert ? 1 : 0, 6, dt);
    eu.uFrozen.value = THREE.MathUtils.damp(eu.uFrozen.value, frozen ? 1 : 0, 4, dt);
    const au = atmoMat.uniforms;
    au.uLive.value = eu.uLive.value;
    au.uAlert.value = eu.uAlert.value;
    au.uFrozen.value = eu.uFrozen.value;
  });

  return (
    <group ref={group} rotation={[0.18, 0.4, 0]}>
      <mesh material={earthMat}>
        <sphereGeometry args={[1.55, 96, 96]} />
      </mesh>
      <mesh material={atmoMat} scale={1.08}>
        <sphereGeometry args={[1.55, 64, 64]} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.58, 0.0035, 8, 160]} />
        <meshBasicMaterial
          color="#5eead4"
          transparent
          opacity={live ? 0.38 : 0.12}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[1.58, 0.0022, 8, 128]} />
        <meshBasicMaterial
          color="#8b9aaa"
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export function Globe(props: GlobeState) {
  return (
    <Canvas
      className="hud-globe-canvas"
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 0.42, 4.05], fov: 38, near: 0.1, far: 80 }}
      onCreated={({ gl }) => {
        gl.setClearColor("#07090b", 1);
      }}
    >
      <Stars radius={48} depth={28} count={900} factor={2.2} saturation={0} fade speed={0.25} />
      <Earth {...props} />
      <Grid
        infiniteGrid
        fadeDistance={16}
        fadeStrength={1.1}
        cellSize={0.45}
        sectionSize={2.25}
        cellColor="#1c252e"
        sectionColor="#2a6b66"
        cellThickness={0.35}
        sectionThickness={0.7}
        position={[0, -1.92, 0]}
      />
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
