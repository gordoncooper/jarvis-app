import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { type SysFlags, latLonToVec } from "./geo.js";

const R = 1.55;

function graticuleGeom(radius: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const push = (a: [number, number, number], b: [number, number, number]) => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  };
  for (let lat = -75; lat <= 75; lat += 15) {
    for (let lon = -180; lon < 180; lon += 4) {
      push(latLonToVec(lat, lon, radius), latLonToVec(lat, lon + 4, radius));
    }
  }
  for (let lon = -180; lon < 180; lon += 15) {
    for (let lat = -90; lat < 90; lat += 4) {
      push(latLonToVec(lat, lon, radius), latLonToVec(lat + 4, lon, radius));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export function Graticule() {
  const geom = useMemo(() => graticuleGeom(R + 0.008), []);
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color="#5eead4" transparent opacity={0.11} depthWrite={false} />
    </lineSegments>
  );
}

function orbitPoints(radius: number, incl: number, raan: number, segs = 128): Float32Array {
  const out = new Float32Array((segs + 1) * 3);
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const x = radius * Math.cos(t);
    const z = radius * Math.sin(t);
    const y = 0;
    const c = Math.cos(incl);
    const s = Math.sin(incl);
    const yi = y * c - z * s;
    const zi = y * s + z * c;
    const cr = Math.cos(raan);
    const sr = Math.sin(raan);
    const xr = x * cr - zi * sr;
    const zr = x * sr + zi * cr;
    out[i * 3] = xr;
    out[i * 3 + 1] = yi;
    out[i * 3 + 2] = zr;
  }
  return out;
}

const ORBITS: Array<{ id: keyof SysFlags; incl: number; raan: number; r: number; speed: number }> = [
  { id: "talker", incl: 0.22, raan: 0.4, r: 1.84, speed: 0.32 },
  { id: "hands", incl: 0.55, raan: 1.3, r: 1.98, speed: -0.24 },
  { id: "stt", incl: 0.95, raan: 2.1, r: 2.12, speed: 0.19 },
  { id: "tts", incl: 1.2, raan: 0.8, r: 2.26, speed: -0.15 },
];

function Orbit({
  incl,
  raan,
  r,
  speed,
  ok,
}: {
  incl: number;
  raan: number;
  r: number;
  speed: number;
  ok: boolean;
}) {
  const sat = useRef<THREE.Mesh>(null);
  const pts = useMemo(() => orbitPoints(r, incl, raan), [r, incl, raan]);
  const points = useMemo(() => {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length; i += 3) {
      arr.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
    }
    return arr;
  }, [pts]);

  useFrame(({ clock }) => {
    if (!sat.current) return;
    const segs = pts.length / 3 - 1;
    const t = ((clock.elapsedTime * speed) % 1 + 1) % 1;
    const i = Math.floor(t * segs);
    sat.current.position.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  });

  const color = ok ? "#5eead4" : "#8b9aaa";
  return (
    <group>
      <Line points={points} color={color} transparent opacity={ok ? 0.45 : 0.14} depthWrite={false} />
      <mesh ref={sat}>
        <octahedronGeometry args={[ok ? 0.028 : 0.018, 0]} />
        <meshBasicMaterial color={color} transparent opacity={ok ? 1 : 0.4} />
      </mesh>
    </group>
  );
}

export function SystemOrbits({ systems }: { systems: SysFlags }) {
  return (
    <group>
      {ORBITS.map((o) => (
        <Orbit key={o.id} {...o} ok={systems[o.id]} />
      ))}
    </group>
  );
}

function arcPoints(a: [number, number], b: [number, number], lift = 1.28): THREE.Vector3[] {
  const p0 = new THREE.Vector3(...latLonToVec(a[0], a[1], R));
  const p2 = new THREE.Vector3(...latLonToVec(b[0], b[1], R));
  const p1 = p0.clone().add(p2).normalize().multiplyScalar(R * lift);
  return new THREE.QuadraticBezierCurve3(p0, p1, p2).getPoints(48);
}

const LINKS: Array<[[number, number], [number, number]]> = [
  [[37.8, -122.4], [51.5, -0.1]],
  [[51.5, -0.1], [35.7, 139.8]],
  [[35.7, 139.8], [-33.9, 151.2]],
  [[40.7, -74.0], [1.3, 103.8]],
  [[-23.5, -46.6], [25.2, 55.3]],
];

export function DataArcs({ live, streaming }: { live: boolean; streaming: boolean }) {
  const routes = useMemo(() => LINKS.map(([a, b]) => arcPoints(a, b)), []);
  return (
    <group>
      {routes.map((pts, i) => (
        <Line
          key={i}
          points={pts}
          color="#5eead4"
          transparent
          opacity={streaming ? 0.55 : live ? 0.28 : 0.1}
          depthWrite={false}
        />
      ))}
    </group>
  );
}

export function RangeRings({ live }: { live: boolean }) {
  const op = live ? 0.22 : 0.08;
  return (
    <group>
      {[1.68, 2.38, 2.55].map((r) => (
        <mesh key={r} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r, 0.003, 8, 160]} />
          <meshBasicMaterial color="#5eead4" transparent opacity={op} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function LimbTicks() {
  const ticks = useMemo(() => {
    const items: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const major = i % 6 === 0;
      const r = 2.42;
      items.push({
        p: [Math.cos(a) * r, 0.02, Math.sin(a) * r],
        s: major ? [0.006, 0.07, 0.006] : [0.004, 0.03, 0.004],
      });
    }
    return items;
  }, []);
  return (
    <group>
      {ticks.map((t, i) => (
        <mesh key={i} position={t.p}>
          <boxGeometry args={t.s} />
          <meshBasicMaterial color="#8b9aaa" transparent opacity={0.55} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function ScanRing({ on }: { on: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * (on ? 1.4 : 0.15);
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2.8, 0, 0]}>
      <torusGeometry args={[1.62, 0.006, 8, 96, on ? Math.PI * 0.35 : Math.PI * 0.12]} />
      <meshBasicMaterial
        color="#5eead4"
        transparent
        opacity={on ? 0.85 : 0.12}
        depthWrite={false}
      />
    </mesh>
  );
}

export function LockReticle({ on }: { on: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    const dir = camera.position.clone().normalize();
    ref.current.position.copy(dir.multiplyScalar(R + 0.04));
    ref.current.lookAt(camera.position);
    ref.current.visible = on;
  });
  const arm = 0.055;
  const w = 0.006;
  return (
    <group ref={ref} visible={on}>
      {[
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ].map(([sx, sy], i) => (
        <group key={i} position={[sx * 0.07, sy * 0.07, 0]}>
          <mesh position={[sx * arm * 0.35, 0, 0]}>
            <boxGeometry args={[arm, w, w]} />
            <meshBasicMaterial color="#5eead4" />
          </mesh>
          <mesh position={[0, sy * arm * 0.35, 0]}>
            <boxGeometry args={[w, arm, w]} />
            <meshBasicMaterial color="#5eead4" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function MemoryBeads({ count }: { count: number }) {
  const n = Math.min(40, Math.max(0, count));
  const pts = useMemo(() => {
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(n, 1)) * Math.PI * 2;
      out.push([Math.cos(a) * 1.72, Math.sin(a * 2) * 0.08, Math.sin(a) * 1.72]);
    }
    return out;
  }, [n]);
  return (
    <group>
      {pts.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshBasicMaterial color="#5eead4" />
        </mesh>
      ))}
    </group>
  );
}
