export const geo = {
  hdg: 0,
  lat: 0,
  lon: 0,
  mode: "HOLD",
};

export function latLonToVec(lat: number, lon: number, r: number): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return [
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  ];
}

export type SysFlags = {
  talker: boolean;
  hands: boolean;
  stt: boolean;
  tts: boolean;
};
