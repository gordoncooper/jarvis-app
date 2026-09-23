export const stageEarthVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Day on the sunlit face, city lights only where the sun is down. */
export const stageEarthFrag = /* glsl */ `
uniform sampler2D tDay;
uniform sampler2D tNight;
uniform sampler2D tSpec;
uniform sampler2D tNormal;
uniform vec3 uSunDir;
uniform vec3 uFillDir;
uniform float uLights;
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 bump = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
  vec3 nb = normalize(n + bump * 0.28);

  vec3 sun = normalize(uSunDir);
  vec3 view = normalize(cameraPosition - vWorld);
  float ndl = dot(nb, sun);

  vec3 dayC = texture2D(tDay, vUv).rgb;
  float ocean = texture2D(tSpec, vUv).r;

  // A wide ramp, not a line. Day and city lights overlap through the twilight.
  float shade = smoothstep(-0.85, 0.75, ndl);
  vec3 dayLit = dayC * (0.06 + 1.05 * shade);
  vec3 nt = texture2D(tNight, vUv).rgb;
  nt = max(nt - vec3(0.015), 0.0);
  float nightMask = 1.0 - smoothstep(-0.55, 0.9, ndl);
  nt = pow(nt, vec3(1.2));
  vec3 lights = nt * vec3(0.92, 0.76, 0.5) * uLights * nightMask;
  vec3 col = dayLit * shade + lights;

  vec3 halfV = normalize(sun + view);
  float spec = pow(max(dot(nb, halfV), 0.0), 40.0) * ocean * shade;
  col += vec3(0.85, 0.92, 1.0) * spec * 0.35;

  float fillN = smoothstep(-0.2, 0.8, dot(nb, normalize(uFillDir)));
  col += dayC * fillN * 0.06;

  // The shell only draws outside the disc. This is the same glow, on the
  // surface, so the crust does not meet the air on a hard edge.
  float ndv = clamp(dot(n, view), 0.0, 1.0);
  float limb = pow(1.0 - ndv, 2.6);
  float crown = pow(max(smoothstep(-0.55, 0.85, ndl), 0.0), 0.85);
  vec3 atmoCol = mix(vec3(0.16, 0.34, 0.62), vec3(0.55, 0.74, 0.95), crown);
  atmoCol = mix(atmoCol, vec3(0.20, 0.38, 0.66), fillN * (1.0 - crown));
  col += atmoCol * limb * (0.15 + 0.50 * crown + 0.12 * fillN);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const stageCloudVert = stageEarthVert;

export const stageCloudFrag = /* glsl */ `
uniform sampler2D tCloud;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  float ndl = dot(normalize(vWorldNormal), normalize(uSunDir));
  float lit = smoothstep(-0.7, 0.75, ndl);
  float c = texture2D(tCloud, vUv).r;
  float alpha = c * mix(0.16, 0.55, lit);
  vec3 col = mix(vec3(0.45, 0.5, 0.58), vec3(0.9, 0.93, 0.97), lit);
  gl_FragColor = vec4(col, alpha);
}
`;

export const stageAtmoVert = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Thin limb only. The shell is a few percent larger than the earth, and the
 *  light dies inside that skin, so it cannot become a dome or a hard ring. */
export const stageAtmoFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uFillDir;
uniform vec3 uCenter;
uniform float uEarthR;
uniform float uAtmoR;
varying vec3 vWorld;

void main() {
  vec3 sun = normalize(uSunDir);
  vec3 ro = cameraPosition - uCenter;
  vec3 rd = normalize(vWorld - cameraPosition);
  float dist = length(cross(rd, ro));
  float span = max(uAtmoR - uEarthR, 0.001);
  float x = (dist - uEarthR) / span;
  // The disc owns the inner half of the glow. Drawing it here too stacks a line.
  if (x < 0.0 || x > 1.0) discard;

  // Exponent above 2 so the slope is already zero at the shell edge.
  // The mesh boundary is black, which is what removes the line against space.
  float scatter = exp(-x * 1.15) * pow(clamp(1.0 - x, 0.0, 1.0), 2.4);

  vec3 closest = ro + rd * dot(-ro, rd);
  vec3 limbN = normalize(closest);
  float sunAmt = smoothstep(-0.55, 0.85, dot(limbN, sun));
  float crown = pow(max(sunAmt, 0.0), 0.85);
  float fillAmt = smoothstep(-0.15, 0.7, dot(limbN, normalize(uFillDir)));
  vec3 col = mix(vec3(0.16, 0.34, 0.62), vec3(0.55, 0.74, 0.95), crown);
  col = mix(col, vec3(0.20, 0.38, 0.66), fillAmt * (1.0 - crown));
  float a = scatter * (0.07 + 0.66 * crown + 0.26 * fillAmt);
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) * 0.02;
  gl_FragColor = vec4(max(col * a, 0.0), 1.0);
}
`;

/** Pinprick stars. Size is in pixels. Twinkle is a small brightness sway. */
export const stageStarVert = /* glsl */ `
attribute float aPhase;
attribute float aSize;
attribute float aGain;
attribute float aBright;
attribute float aWarm;
uniform float uTime;
uniform float uPixelRatio;
varying float vTw;
varying float vBright;
varying float vWarm;

void main() {
  float s1 = sin(uTime * aGain + aPhase);
  float s2 = sin(uTime * aGain * 2.17 + aPhase * 1.7);
  float tw = 0.74 + 0.20 * s1 + 0.06 * s2;
  vTw = tw;
  vBright = aBright;
  vWarm = aWarm;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, aSize * uPixelRatio);
}
`;

export const stageStarFrag = /* glsl */ `
varying float vTw;
varying float vBright;
varying float vWarm;

void main() {
  vec2 p = gl_PointCoord - vec2(0.5);
  if (dot(p, p) > 0.25) discard;
  vec3 cool = vec3(0.80, 0.88, 1.0);
  vec3 warm = vec3(1.0, 0.90, 0.74);
  vec3 col = mix(cool, warm, vWarm) * vBright * vTw;
  gl_FragColor = vec4(col, 1.0);
}
`;
