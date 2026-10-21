// GLSL ES 3.00 sources for the guppy spike.

const COMMON = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a*vnoise(p); p = p*2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0))*6.0 - 3.0); return c.z*mix(vec3(1.0), clamp(p-1.0, 0.0, 1.0), c.y); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// cellular noise: (distance to nearest feature point, to second nearest)
vec2 worley(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y)); vec2 r = g + hash22(i + g) - f; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(vec2(d1, d2));
}
`;

const SPINE = /* glsl */`
uniform vec4 uSpine[64];
vec4 spineAt(float st){
  float i0 = clamp(floor(st), 0.0, 62.0);
  float f = clamp(st - i0, 0.0, 1.0);
  int a = int(i0);
  return mix(uSpine[a], uSpine[a + 1], f);
}
`;

const LIGHT = /* glsl */`
uniform vec3 uCam; uniform vec3 uFogColor; uniform vec2 uFogRange; uniform float uTime, uCaustic;
const vec3 LIGHT_DIR = vec3(-0.27, 0.88, 0.40);
// Relief without a tangent frame (Mikkelsen 2010): h is a height in world units over the surface.
vec3 bumpNormal(vec3 N, vec3 P, float h){
  vec3 dpdx = dFdx(P), dpdy = dFdy(P);
  vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) < 1e-12) return N;
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * N - grad);
}
// Dappled light from the rippling surface, drifting over the fish as it swims.
float caustic(vec3 P, vec3 N){
  vec2 p = vec2(P.x + P.z * 0.6, P.y * 0.85 - P.z * 0.3) * 3.2;
  vec2 w1 = worley(p + vec2(uTime * 0.23, uTime * 0.11));
  vec2 w2 = worley(p * 1.41 + vec2(-uTime * 0.17, uTime * 0.2) + 5.2);
  float c = (1.0 - smoothstep(0.0, 0.2, w1.y - w1.x)) * (0.45 + 0.55 * (1.0 - smoothstep(0.0, 0.3, w2.y - w2.x)));
  return c * (0.35 + 0.65 * smoothstep(-0.4, 0.8, N.y)) * uCaustic;
}
// What a mirror-like surface (silver lining, guanine) reflects: bright surface above, green depths below.
vec3 envRefl(vec3 N, vec3 V){
  vec3 R = reflect(-V, N);
  vec3 up = vec3(0.86, 0.93, 0.84), mid = vec3(0.30, 0.44, 0.42), low = vec3(0.06, 0.12, 0.12);
  return R.y > 0.0 ? mix(mid, up, smoothstep(0.0, 0.75, R.y)) : mix(mid, low, smoothstep(0.0, -0.6, R.y));
}
vec3 shade(vec3 albedo, vec3 N, vec3 P, float gloss, float sheen){
  vec3 V = normalize(uCam - P);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(LIGHT_DIR);
  float wrap = clamp((dot(N, L) + 0.4) / 1.4, 0.0, 1.0);
  vec3 ambient = vec3(0.30, 0.38, 0.38);
  vec3 col = albedo * (ambient + wrap * vec3(1.0, 0.96, 0.86) * 0.72);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 38.0) * gloss;
  col += spec * vec3(1.0, 0.97, 0.88);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  col += rim * vec3(0.20, 0.34, 0.33) * (0.35 + sheen * 0.4);
  float cs = caustic(P, N);
  col += albedo * vec3(1.0, 0.97, 0.85) * cs * 0.42 + cs * spec * 0.6;
  return col;
}
vec3 fog(vec3 col, vec3 P){
  float d = length(uCam - P);
  return mix(col, uFogColor, smoothstep(uFogRange.x, uFogRange.y, d) * 0.6);
}
`;

export const FULLSCREEN_VS = /* glsl */`#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BACKGROUND_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform float uTime; uniform vec2 uRes; uniform vec2 uPan; uniform float uZoom;
${COMMON}
void main(){
  vec2 uv = (vUv - 0.5) / uZoom + 0.5 + uPan;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float y = uv.y;
  vec3 deep = vec3(0.045, 0.11, 0.11), mid = vec3(0.12, 0.27, 0.25), top = vec3(0.38, 0.54, 0.45);
  vec3 col = mix(deep, mid, smoothstep(-0.1, 0.55, y));
  col = mix(col, top, smoothstep(0.55, 1.05, y));
  col += vec3(0.30, 0.32, 0.20) * pow(smoothstep(0.78, 1.05, y), 3.0) * 0.5;
  // light shafts, slanted and drifting
  float x = p.x + (1.0 - y) * 0.32;
  float rays = smoothstep(0.55, 1.0, vnoise(vec2(x * 4.0 + uTime * 0.03, 0.5))) * 0.65
             + smoothstep(0.62, 1.0, vnoise(vec2(x * 9.0 - uTime * 0.025, 3.1))) * 0.35;
  col += vec3(0.32, 0.38, 0.28) * rays * smoothstep(0.05, 1.0, y) * 0.32;
  // far vegetation bands with parallax
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    float sc = 5.0 + fi * 4.0;
    vec2 q = vec2(p.x + uPan.x * (0.3 + 0.3 * fi), y);
    float sway = sin(uTime * 0.5 + q.x * 2.5 + fi) * 0.025 * (1.0 - y);
    float n = fbm(vec2((q.x + sway + fi * 1.7) * sc, q.y * 1.6 + fi * 2.0));
    float h = 0.32 + 0.42 * vnoise(vec2(q.x * sc * 0.18 + fi * 3.0, fi));
    float m = smoothstep(0.52, 0.6, n) * smoothstep(h, h - 0.22, q.y);
    vec3 plant = mix(vec3(0.07, 0.17, 0.11), vec3(0.16, 0.30, 0.17), fi * 0.4 + 0.2 * vnoise(q * 20.0));
    col = mix(col, plant, m * (0.62 - 0.17 * fi));
  }
  // sand floor with caustics
  float floorY = 0.12 + 0.025 * sin(p.x * 1.7) + 0.015 * sin(p.x * 4.3);
  float sand = smoothstep(floorY + 0.03, floorY - 0.02, y);
  vec3 sandCol = vec3(0.40, 0.36, 0.26) * (0.75 + 0.35 * fbm(p * vec2(22.0, 45.0)));
  float caus = pow(abs(sin(fbm(p * 4.0 + vec2(uTime * 0.12, -uTime * 0.07)) * 10.0)), 6.0) * fbm(p * 9.0);
  sandCol += vec3(0.30, 0.33, 0.24) * caus * 0.22 * smoothstep(-0.2, floorY, y);
  col = mix(col, sandCol, sand * 0.92);
  // drifting particles
  vec2 g = p * vec2(26.0, 26.0) + vec2(0.0, uTime * 0.08);
  vec2 cell = floor(g), f = fract(g) - 0.5;
  float hsh = hash12(cell);
  float speck = smoothstep(0.08, 0.0, length(f - (vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5) * 0.6)) * step(0.93, hsh);
  col += vec3(0.6, 0.65, 0.5) * speck * 0.35;
  o = vec4(col, 0.0); // alpha 0 = background, used as the fish mask by the paint passes
}`;

export const BODY_VS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec4 aA; // station, y, lateral, u
layout(location = 1) in vec4 aB; // nT, nY, nL, v
uniform mat4 uViewProj; uniform mat4 uModel; uniform mat3 uNormalMat; uniform float uLb, uSide;
${SPINE}
out vec3 vPos; out vec3 vN; out vec3 vBody; // (u, y/Lb, v)
void main(){
  vec4 sp = spineAt(aA.x);
  vec2 sc = normalize(sp.zw);
  vec3 T = vec3(-sc.y, 0.0, sc.x), L = vec3(sc.x, 0.0, sc.y), Y = vec3(0.0, 1.0, 0.0);
  vec3 p = vec3(sp.x, aA.y, sp.y) + L * aA.z * uSide;
  vec3 n = T * aB.x + Y * aB.y + L * aB.z * uSide;
  vec4 wp = uModel * vec4(p, 1.0);
  vPos = wp.xyz; vN = normalize(uNormalMat * n); vBody = vec3(aA.w, aA.y / uLb, aB.w);
  gl_Position = uViewProj * wp;
}`;

export const BODY_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; in vec3 vBody; out vec4 o;
uniform vec3 uDorsal, uFlank, uBelly, uPupil;
uniform float uMelanin, uRetic, uSheen, uGravid, uSeed, uChroma, uSex;
uniform vec4 uSpotA[8]; uniform vec4 uSpotB[8]; uniform int uSpotCount;
uniform vec4 uEye; // u, y, radius
uniform vec3 uIris; uniform float uIrisDark, uLb;
uniform int uPat; uniform vec3 uPatA, uPatB; uniform float uMetal, uPatK;
uniform int uSnake; uniform vec3 uSnakeA, uSnakeB; uniform float uSnakeK;
uniform vec3 uRedA, uRedB; uniform float uRedK;
uniform vec3 uKoiA, uKoiB; uniform float uKoiK, uKoiExt, uKoiBody;
uniform vec3 uZebraC, uGoldC; uniform float uZebra, uGold, uGlass, uPink;
uniform float uTux; uniform vec3 uTuxColor; uniform float uBrush;
${COMMON}
${LIGHT}
void main(){
  float u = vBody.x, yN = vBody.y, v = vBody.z;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vPos);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = abs(dot(N, V));
  vec2 bp = vec2(u, yN);
  // countershading
  vec3 albedo = v > 0.0 ? mix(uFlank, uDorsal, smoothstep(0.1, 0.92, v)) : mix(uFlank, uBelly, smoothstep(-0.05, -0.8, v));
  albedo *= 0.94 + 0.12 * fbm(bp * vec2(18.0, 30.0) + uSeed);
  // Scales: staggered rows of round scales laid like roof tiles. Each point shows the most anterior scale
  // that covers it, so every scale exposes its rounded rear margin; melanophores along those margins make
  // the reticulated net of a guppy's flank.
  vec2 q = vec2(u, yN) / 0.024;
  const float SR = 0.72;
  vec2 sc = vec2(0.0), sid = vec2(0.0); float best = 1e9;
  float j0 = floor(q.y);
  for (int dj = -1; dj <= 1; dj++){
    float j = j0 + float(dj), off = 0.5 * mod(j, 2.0), i0 = floor(q.x - off);
    for (int di = -1; di <= 1; di++){
      vec2 c = vec2(i0 + float(di) + off + 0.5, j + 0.5);
      vec2 d = q - c - (hash22(c + uSeed) - 0.5) * 0.1;
      if (length(d) < SR && c.x < best){ best = c.x; sc = d; sid = c; }
    }
  }
  float sr = length(sc);
  float margin = smoothstep(SR - 0.2, SR - 0.04, sr) * smoothstep(-0.1, 0.25, sc.x);
  float scaleEdge = margin * smoothstep(-0.45, 0.2, v) * smoothstep(0.1, 0.2, u) * (0.6 + 0.4 * vnoise(q * 0.35));
  albedo = mix(albedo, albedo * vec3(0.55, 0.55, 0.52), scaleEdge * uRetic);
  // relief: each scale rises from under the one in front toward its free rear margin and rolls off there,
  // tilted a little at random so the flank breaks the light into glints as the fish turns
  float scaleH = smoothstep(-0.2, SR * 0.85, sc.x) * (1.0 - smoothstep(SR - 0.24, SR, sr));
  scaleH *= 1.0 + (hash12(sid + uSeed * 1.3) - 0.5) * 0.8 + sc.y * (hash12(sid + 2.7) - 0.5) * 1.2;
  float scaleVis = (1.0 - smoothstep(0.15, 0.4, fwidth(q.x))) * smoothstep(-0.8, -0.3, v) * smoothstep(0.13, 0.22, u);
  N = bumpNormal(N, vPos, scaleH * 0.0016 * uLb * scaleVis);
  albedo *= 1.0 + (hash12(sid + 9.1) - 0.5) * 0.1 * scaleVis;   // each scale reflects a little differently
  // fine melanophores: dark pinpoints, denser on the back
  vec2 mq = bp / 0.0065; vec2 mc = floor(mq);
  float mdot = smoothstep(0.32, 0.12, length(fract(mq) - 0.5 - (hash22(mc + 4.1) - 0.5) * 0.5)) * step(0.55, hash12(mc + uSeed));
  albedo *= 1.0 - mdot * 0.3 * uMelanin * smoothstep(-0.4, 0.7, v) * (1.0 - smoothstep(0.15, 0.4, fwidth(mq.x))) * smoothstep(0.03, 0.1, u);
  // male iridophore sheen: view-dependent hue on the flank
  float sheenMask = smoothstep(0.55, 0.8, fbm(bp * vec2(7.0, 12.0) + uSeed * 1.7)) * smoothstep(0.15, 0.3, u) * smoothstep(0.95, 0.75, u) * smoothstep(0.75, 0.2, abs(v));
  vec3 irid = hsv2rgb(vec3(fract(0.48 + 0.35 * (1.0 - ndv) + 0.1 * fbm(bp * 9.0)), 0.55 * uChroma, 0.95));
  albedo = mix(albedo, irid, sheenMask * uSheen * 0.55);

  // ---- variety body colour, in layers: full red, snakeskin chain, metallic/solid pattern, Kohaku head ----
  float headMask = smoothstep(0.16, 0.26, u);
  float metal = 0.0;
  if (uGlass > 0.0) {                      // glass belly: no silvery lining, the gut (and a female's brood) show
    float belly = smoothstep(-0.28, -0.55, v) * smoothstep(0.13, 0.22, u) * smoothstep(0.78, 0.62, u);
    vec3 organs = mix(vec3(0.66, 0.42, 0.36), vec3(0.24, 0.19, 0.17), smoothstep(0.42, 0.62, fbm(bp * vec2(9.0, 15.0) + uSeed)));
    albedo = mix(albedo, organs, belly * 0.78);
    vec2 eg = vec2(u * 60.0, v * 6.0);
    float eye = smoothstep(0.2, 0.1, length(fract(eg) - 0.5)) * step(0.45, hash12(floor(eg) + uSeed));
    float brood = belly * smoothstep(0.38, 0.46, u) * smoothstep(0.7, 0.6, u) * uGravid;
    albedo = mix(albedo, vec3(0.04, 0.04, 0.05), eye * brood * 0.9);
  }
  if (uRedK > 0.0) {                       // full red: red over the whole body (fainter in females)
    float m = smoothstep(0.02, 0.1, u) * smoothstep(-0.95, -0.5, v);
    albedo = mix(albedo, mix(uRedA, uRedB, 0.3 * fbm(bp * 10.0 + uSeed)), m * 0.88 * uRedK);
    metal = max(metal, m * 0.25 * uRedK);
  }
  if (uSnake > 0 && uSnakeK > 0.0) {      // snakeskin / cobra: chain of dark links over a light ground
    vec2 sq = bp * 30.0;
    sq += (vec2(vnoise(sq * 0.35 + uSeed), vnoise(sq * 0.35 + uSeed + 7.0)) - 0.5) * 1.4;
    vec2 w = worley(sq);
    float chain = smoothstep(0.17, 0.05, w.y - w.x);
    float ground = headMask * smoothstep(-0.85, -0.45, v) * uSnakeK;
    albedo = mix(albedo, uSnakeA, 0.6 * ground * (1.0 - 0.6 * uRedK));   // over full red the chain sits on red
    albedo = mix(albedo, uSnakeB, chain * ground * 0.9);
    if (uSnake == 2){
      float bars = smoothstep(0.3, 0.85, sin(u * 70.0 + (vnoise(vec2(u * 8.0, yN * 20.0) + uSeed) - 0.5) * 3.0)) * smoothstep(0.45, 0.62, u) * smoothstep(-0.7, -0.3, v);
      albedo = mix(albedo, uSnakeB, bars * 0.75 * uSnakeK);
    }
    metal = max(metal, 0.15 * ground);
  }
  if (uZebra > 0.0) {                      // Zebrinus: vertical bars on the peduncle and rear body
    float bars = smoothstep(0.35, 0.8, sin(u * 62.0 + (vnoise(vec2(u * 7.0, yN * 18.0) + uSeed) - 0.5) * 3.2)) * smoothstep(0.42, 0.6, u) * smoothstep(-0.75, -0.25, v);
    albedo = mix(albedo, uZebraC, bars * 0.8 * uZebra);
  }
  float pk = uPatK;
  if (uPat == 3) {                         // moscow: solid metallic colour over the whole body
    float m = smoothstep(0.06, 0.15, u) * smoothstep(-0.95, -0.55, v) * pk;
    vec3 c = mix(uPatA, uPatB, 0.35 * fbm(bp * 8.0 + uSeed) + 0.3 * (1.0 - ndv));
    albedo = mix(albedo, c, m * 0.92); metal = max(metal, m * uMetal);
  } else if (uPat == 4) {                 // japan blue: light metallic blue on the rear body
    float m = smoothstep(0.42, 0.6, u + (vnoise(bp * 14.0 + uSeed) - 0.5) * 0.08) * smoothstep(-0.75, -0.3, v) * smoothstep(0.98, 0.6, v) * pk;
    albedo = mix(albedo, mix(uPatA, uPatB, 0.45 * (1.0 - ndv)), m * 0.88); metal = max(metal, m * uMetal);
  } else if (uPat == 5) {                 // coral: metallic red fore-body
    float m = smoothstep(0.1, 0.2, u) * smoothstep(0.6, 0.42, u + (vnoise(bp * 12.0 + uSeed) - 0.5) * 0.08) * smoothstep(-0.8, -0.3, v) * pk;
    albedo = mix(albedo, mix(uPatA, uPatB, 0.35 * (1.0 - ndv)), m * 0.9); metal = max(metal, m * uMetal);
  } else if (uPat == 6) {                 // platinum: pearly fore-body
    float m = smoothstep(0.04, 0.14, u) * smoothstep(0.68, 0.46, u + (vnoise(bp * 10.0 + uSeed) - 0.5) * 0.1) * pk;
    albedo = mix(albedo, mix(uPatA, uPatB, 0.4 * (1.0 - ndv)), m * 0.9); metal = max(metal, m * uMetal);
  } else if (uPat == 7) {                 // dragon: metallic plates over every scale
    vec2 dq = bp / 0.026; dq.x += 0.5 * mod(floor(dq.y), 2.0);
    float e = length((fract(dq) - 0.5) * vec2(1.0, 1.2));
    float plate = smoothstep(0.5, 0.3, e);
    float m = smoothstep(0.03, 0.12, u) * smoothstep(-0.9, -0.5, v) * pk;
    vec3 plateCol = mix(uPatA, hsv2rgb(vec3(fract(0.55 + 0.35 * (1.0 - ndv) + hash12(floor(dq)) * 0.15), 0.28, 1.0)), 0.35);
    albedo = mix(albedo, mix(albedo, plateCol, plate), m * 0.92); metal = max(metal, m * uMetal);
  } else if (uPat == 10) {                // panda: dark body, silvery-blue head
    float body = smoothstep(0.17, 0.3, u + (vnoise(bp * 12.0 + uSeed) - 0.5) * 0.06) * smoothstep(-0.95, -0.6, v) * pk;
    float head = (1.0 - body) * smoothstep(-0.6, 0.0, v) * pk;
    albedo = mix(albedo, uPatA, body * 0.92);
    albedo = mix(albedo, mix(uPatB, vec3(1.0), 0.3 * (1.0 - ndv)), head * 0.8); metal = max(metal, head * uMetal + body * 0.25);
  }
  if (uGold > 0.0) {                       // Metal Gold: metallic yellow over the upper body and head
    float m = smoothstep(0.04, 0.12, u) * smoothstep(0.88, 0.62, u) * smoothstep(-0.35, 0.25, v) * (0.75 + 0.25 * fbm(bp * 12.0 + uSeed));
    albedo = mix(albedo, mix(uGoldC, vec3(1.0, 0.95, 0.7), 0.3 * (1.0 - ndv)), m * 0.8 * uGold);
    metal = max(metal, m * 0.8 * uGold);
  }
  if (uPink > 0.0) {                       // Pink: translucent white on the rear peduncle
    float m = smoothstep(0.72, 0.86, u) * smoothstep(-0.9, -0.4, v);
    albedo = mix(albedo, vec3(0.96, 0.92, 0.95), m * 0.7 * uPink);
  }
  if (uKoiK > 0.0) {                       // Kohaku: red cap from the snout back to a reach set by the genes
    float reach = 0.2 + 0.3 * uKoiExt;
    float jag = (fbm(bp * 9.0 + uSeed) - 0.5) * 0.14;
    float cap = smoothstep(reach + 0.05, reach - 0.05, u + jag) * smoothstep(-0.55 - 0.35 * uKoiExt, 0.0, v);
    // males: red patches down the body, more in red-rich fish ("no two large males look alike")
    float patches = uKoiBody * smoothstep(0.66 - 0.3 * uKoiBody, 0.74 - 0.2 * uKoiBody, fbm(bp * vec2(6.0, 9.0) + uSeed * 2.3))
      * smoothstep(0.22, 0.32, u) * smoothstep(0.92, 0.78, u) * smoothstep(-0.8, -0.3, v);
    albedo = mix(albedo, mix(uKoiA, uKoiB, 0.3 * fbm(bp * 14.0)), max(cap, patches) * 0.95 * uKoiK);
  }
  // half-black (tuxedo): dark rear body with a ragged front edge
  if (uTux > 0.0){
    float edge = 0.47 + (vnoise(vec2(yN * 20.0, uSeed)) - 0.5) * 0.07;
    float m = smoothstep(edge - 0.03, edge + 0.04, u) * smoothstep(-1.0, -0.6, v);
    albedo = mix(albedo, uTuxColor, m * uTux * 0.95);
  }
  // wild-type ornamental spots
  for (int i = 0; i < 8; i++){
    if (i >= uSpotCount) break;
    vec4 s = uSpotA[i];
    vec2 d = vec2((u - s.x) / uSpotB[i].y, (v - s.y) * 0.1);
    float jag = (fbm(bp * 22.0 + float(i) * 7.3 + uSeed) - 0.5) * 0.55 * s.z;
    float m = smoothstep(s.z + 0.012, s.z - 0.012, length(d) + jag);
    float hue = uSpotB[i].x;
    vec3 c;
    if (s.w < 0.5) c = hsv2rgb(vec3(0.03 + 0.06 * hue, min(0.9, 0.45 + 0.4 * uChroma), 0.92));
    else if (s.w < 1.5) { c = vec3(0.04, 0.035, 0.045); m *= uMelanin; }
    else c = hsv2rgb(vec3(fract(hue + 0.3 * (1.0 - ndv)), 0.4 * uChroma + 0.1, 0.82));
    albedo = mix(albedo, c, m * 0.85);
  }
  // gills show through the operculum as a pinkish-red throat
  float throat = smoothstep(0.2, 0.06, u) * smoothstep(0.04, 0.09, u) * smoothstep(0.3, -0.3, v) * smoothstep(-0.95, -0.55, v);
  albedo = mix(albedo, vec3(0.88, 0.32, 0.38), throat * 0.6);
  // gravid spot (female)
  float gs = smoothstep(0.07, 0.02, length(vec2(u - 0.62, (v + 0.42) * 0.1)) + (fbm(bp * 30.0) - 0.5) * 0.03);
  albedo = mix(albedo, vec3(0.12, 0.10, 0.08), gs * uGravid * 0.7);
  // the upturned mouth at the snout tip and the nostril in front of the eye
  vec2 ma = vec2(0.001, 0.006), mb = vec2(0.03, -0.003), pa = bp - ma, ba = mb - ma;
  float mouth = smoothstep(0.0032, 0.0012, length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)));
  albedo *= 1.0 - 0.45 * mouth;
  albedo *= 1.0 - 0.5 * smoothstep(0.005, 0.0025, length(bp - vec2(uEye.x - uEye.z * 1.15, uEye.y + uEye.z * 0.35)));
  // operculum line and darker head top
  float gill = abs(length((bp - vec2(0.085, 0.0)) * vec2(1.0, 0.85)) - 0.085);
  albedo *= 1.0 - 0.22 * smoothstep(0.006, 0.0, gill) * step(-0.75, v) * step(u, 0.2) * uMelanin;
  albedo *= 1.0 - 0.18 * smoothstep(0.25, 0.0, u) * smoothstep(0.2, 0.8, v) * uMelanin;
  albedo *= 1.0 - 0.05 * smoothstep(0.05, 0.0, abs(v - 0.05)) * smoothstep(0.15, 0.4, u);
  // brush strokes laid along the body, in anatomical coordinates, so they bend with the fish
  float streak = vnoise(vec2(u * 40.0, yN * 180.0) + uSeed);
  float broad = vnoise(vec2(u * 8.0, yN * 40.0) + uSeed * 1.3);
  albedo *= 1.0 + ((streak - 0.5) * 0.24 + (broad - 0.5) * 0.16) * uBrush;
  albedo *= mix(vec3(1.0), broad > 0.5 ? vec3(1.04, 1.0, 0.95) : vec3(0.96, 0.99, 1.04), abs(broad - 0.5) * 1.6 * uBrush);
  vec3 col = shade(albedo, N, vPos, 0.35 + 0.35 * uSheen + metal * 0.9, uSheen + metal);
  col += metal * pow(1.0 - ndv, 1.5) * 0.25 * hsv2rgb(vec3(fract(0.55 + 0.3 * (1.0 - ndv)), 0.3, 1.0));
  // guanine mirrors: the silvery lining of the belly (seen through unpigmented skin; glass bellies lack
  // it) and the gill cover, which shimmers gold to green
  float fres = pow(1.0 - ndv, 1.2);
  float silver = smoothstep(-0.1, -0.5, v) * smoothstep(0.1, 0.2, u) * smoothstep(0.72, 0.55, u) * (1.0 - uGlass) * smoothstep(0.22, 0.7, luma(albedo));
  col = mix(col, envRefl(N, V) * mix(vec3(0.95, 0.97, 1.0), albedo, 0.3), silver * (0.3 + 0.4 * fres));
  float operD = length((bp - vec2(0.085, 0.0)) * vec2(1.0, 0.85));
  float oper = smoothstep(0.085, 0.07, operD) * smoothstep(0.1, 0.135, u) * smoothstep(-0.85, -0.45, v) * smoothstep(0.7, 0.25, v);
  vec3 operTint = hsv2rgb(vec3(fract(0.1 + 0.3 * (1.0 - ndv) + 0.08 * vnoise(bp * 80.0)), 0.35, 1.0));
  col = mix(col, envRefl(N, V) * operTint * 1.1, oper * (0.2 + 0.25 * fres) * (1.0 - 0.6 * uKoiK));
  // thin edges and the peduncle let light through, warm
  float thin = smoothstep(0.78, 1.0, abs(v)) * 0.6 + smoothstep(0.8, 1.0, u) * 0.5;
  col += albedo * vec3(1.0, 0.8, 0.66) * thin * (0.06 + 0.3 * max(0.0, dot(-N, normalize(LIGHT_DIR))));
  // eye: dark pupil, a silvery-gold iris with fine fibres and a darker upper rim, a bulging cornea
  vec2 ed = (bp - uEye.xy) / uEye.z;
  float er = length(ed);
  if (er < 1.3){
    float ang = atan(ed.y, ed.x);
    float fib = vnoise(vec2(ang * 9.0, er * 3.0) + uSeed) * 0.6 + vnoise(vec2(ang * 23.0, er * 7.0)) * 0.4;
    vec3 iris = uIris * (0.7 + 0.5 * fib);
    iris = mix(iris, iris * 0.35, smoothstep(0.05, 0.85, ed.y) * uIrisDark);
    iris = mix(iris, min(uIris * 1.3 + 0.08, vec3(1.0)), smoothstep(0.66, 0.57, er) * 0.8);
    vec3 pupil = uPupil * (0.55 + 0.45 * smoothstep(0.52, 0.0, er));
    vec3 e = mix(pupil, iris, smoothstep(0.5, 0.56, er));
    e = mix(e, vec3(0.06, 0.06, 0.05), smoothstep(0.86, 0.97, er));
    float dome = sqrt(max(0.0, 1.0 - min(er, 1.0) * min(er, 1.0)));
    e *= 0.72 + 0.32 * dome;
    // the bright surface mirrored in the cornea: a crisp catchlight and a soft lower glow
    float cl = smoothstep(0.2, 0.1, length((ed - vec2(-0.3, 0.33)) * vec2(1.0, 1.25)));
    float cl2 = smoothstep(0.07, 0.03, length(ed - vec2(0.2, 0.42)));
    float glow = smoothstep(0.5, 0.15, length((ed - vec2(0.12, -0.42)) * vec2(1.0, 1.9))) * 0.16;
    e += vec3(1.0, 0.99, 0.95) * (cl * 0.95 + cl2 * 0.5) + glow * vec3(0.7, 0.85, 0.8);
    col *= 1.0 - 0.3 * smoothstep(1.3, 1.02, er) * smoothstep(0.9, 1.02, er);   // socket shadow
    col = mix(col, e, smoothstep(1.0, 0.94, er));
  }
  o = vec4(fog(col, vPos), 1.0);
}`;

export const FIN_VS = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec4 aA; // station, y, flutter, q
layout(location = 1) in vec4 aB; // r, lateral, pecLen, isPec
uniform mat4 uViewProj; uniform mat4 uModel; uniform mat3 uNormalMat;
uniform float uTime, uFlutPhase, uPecBeta, uSide;
${SPINE}
out vec3 vPos; out vec3 vN; out vec2 vUV;
void main(){
  vec4 sp = spineAt(aA.x);
  vec2 sc = normalize(sp.zw);
  vec3 T = vec3(-sc.y, 0.0, sc.x), L = vec3(sc.x, 0.0, sc.y), Y = vec3(0.0, 1.0, 0.0);
  float wave = aB.x * 4.0 - uFlutPhase + aA.w * 3.5;
  float flut = aA.z * sin(wave);
  vec3 p = vec3(sp.x, aA.y, sp.y) + L * (aB.y * uSide + flut);
  vec3 n = normalize(L - T * aA.z * 2.0 * cos(wave));
  if (aB.w > 0.5){
    vec3 dir = T * cos(uPecBeta) + L * sin(uPecBeta) * uSide;
    p += dir * aA.w * aB.z;
    n = normalize(cross(Y, dir));
  }
  vec4 wp = uModel * vec4(p, 1.0);
  vPos = wp.xyz; vN = normalize(uNormalMat * n); vUV = vec2(aA.w, aB.x);
  gl_Position = uViewProj * wp;
}`;

export const FIN_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; in vec2 vUV; out vec4 o;
uniform vec3 uColA, uColB, uPatDark, uPatLight; uniform float uAlpha, uSpeckle, uBorder, uIri, uMelanin, uSeed, uChroma;
uniform int uKind, uTailPat, uSword; uniform float uBrush, uLb;
${COMMON}
${LIGHT}
void main(){
  float q = vUV.x, r = vUV.y;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vPos);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = abs(dot(N, V));
  // 'along' runs from the fin base to its free edge, 'across' counts fin rays
  // (kinds: 0 caudal, 1 dorsal, 2 anal/gonopodium, 3 pectoral, 4 pelvic)
  float along, across;
  if (uKind == 0){ along = q; across = r * 9.5; }
  else if (uKind == 3){ along = q; across = r * 3.0; }
  else { along = r; across = q * (uKind == 4 ? 3.0 : 7.0); }
  // fin rays: slightly wandering, thinner toward the edge, forking in two (guppy rays branch)
  float wob = (vnoise(vec2(along * 3.0, across * 0.6) + uSeed) - 0.5) * 0.3;
  float cx = across + wob;
  float f = fract(cx) - 0.5;
  float fork = 0.2 * smoothstep(0.38, 0.85, along);
  float dRay = min(abs(f - fork), abs(f + fork));
  float aa = fwidth(cx);
  float detail = 1.0 - smoothstep(0.18, 0.45, aa);      // rays fade before they get smaller than a few pixels
  float wRay = mix(0.09, 0.045, along) + aa * 0.5;
  float ray = (1.0 - smoothstep(wRay - aa, wRay + aa, dRay)) * detail;
  // jointed rays: faint segments along each ray
  float joint = smoothstep(0.82, 1.0, sin(along * 70.0 + floor(cx) * 1.7)) * ray * detail;
  // relief: raised rays, and on the caudal the membrane falls in soft pleats toward the edge
  float pleat = sin(r * 13.0 + (vnoise(vec2(r * 3.0, along * 2.0) + uSeed) - 0.5) * 2.5 + along * 1.5);
  float h = ray * 0.0016 + (uKind == 0 ? pleat * 0.014 * smoothstep(0.08, 0.9, along) : 0.0);
  N = bumpNormal(N, vPos, h * uLb);

  vec3 col = mix(uColA, uColB, pow(q, 1.3));
  // pigment is densest at the base of the fin; the outer membrane is thinner; colour runs in streaks along the rays
  col *= mix(0.86, 1.0, smoothstep(0.0, 0.3, along));
  col *= 1.0 + (vnoise(vec2(across * 1.3, along * 0.9) + uSeed * 0.7) - 0.5) * 0.22;
  // dark fins show light rays over a dark membrane; light fins show darker rays
  float darkFin = 1.0 - smoothstep(0.3, 0.5, max(uColA.r, max(uColA.g, uColA.b)));
  col = mix(col * (1.0 - 0.16 * ray - 0.12 * joint), col + vec3(0.18, 0.24, 0.32) * ray * smoothstep(0.1, 0.6, along), darkFin);
  // generic melanophore speckle
  vec2 sp = vec2(q * 7.0, r * 6.0) + uSeed;
  float n = fbm(sp) + 0.35 * fbm(sp * 3.1);
  col = mix(col, vec3(0.05, 0.04, 0.05), smoothstep(0.78, 0.9, n) * uSpeckle);
  // variety tail patterns (tail and dorsal)
  if ((uKind == 0 || uKind == 1) && uTailPat > 0){
    vec2 p = (uKind == 0 ? vec2(q * 9.0, r * 6.5) : vec2(q * 5.0, r * 4.0)) + uSeed;
    if (uTailPat == 1){            // snakeskin rosettes
      vec2 w = worley(p * 1.1);
      float ring = smoothstep(0.18, 0.28, w.x) * smoothstep(0.5, 0.38, w.x);
      col = mix(col, uPatLight, smoothstep(0.25, 0.0, w.x) * 0.6);
      col = mix(col, uPatDark, ring * 0.85);
    } else if (uTailPat == 2){     // mosaic: dark irregular tiles, heavier toward the base
      vec2 w = worley(p * 0.9 + vec2(vnoise(p * 0.7) * 1.2));
      float lines = smoothstep(0.24, 0.06, w.y - w.x);
      float base = smoothstep(0.5, 0.1, q) * smoothstep(0.35, 0.7, fbm(p * 0.8));
      col = mix(col, uPatDark, clamp(lines * 0.85 + base * 0.8, 0.0, 0.95));
    } else if (uTailPat == 3){     // grass: fine, dense seed-like dots
      vec2 g = p * 3.2; vec2 c = floor(g), fc = fract(g) - 0.5;
      vec2 off = (hash22(c) - 0.5) * 0.5;
      float on = step(0.35, hash12(c + 3.7));
      col = mix(col, uPatDark, smoothstep(0.2, 0.1, length(fc - off)) * on * 0.85);
    } else if (uTailPat == 5){     // multicolour: broad bands of three colours
      float band = r * 2.2 + q * 1.4 + (fbm(p * 0.6) - 0.5) * 1.6;
      float k = fract(band * 0.5);
      vec3 third = vec3(0.98, 0.82, 0.2);
      col = k < 0.33 ? col : (k < 0.66 ? mix(col, uColB, 0.85) : mix(col, third, 0.85));
    } else if (uTailPat == 4){     // leopard: bold, spaced spots
      vec2 g = p * 1.25; vec2 c = floor(g), fc = fract(g) - 0.5;
      vec2 off = (hash22(c) - 0.5) * 0.4;
      float on = step(0.25, hash12(c + 1.3));
      float rr = 0.18 + 0.12 * hash12(c + 9.1);
      float d = length((fc - off) * vec2(1.0, 1.15)) + (vnoise(g * 4.0) - 0.5) * 0.08;
      col = mix(col, uPatDark, smoothstep(rr, rr - 0.05, d) * on * 0.9);
    }
  }
  // swords: stronger colour along the extended rays and a dark outer edge
  if (uKind == 0 && uSword > 0){
    float top = (uSword == 1 || uSword == 3) ? smoothstep(0.7, 0.88, r) : 0.0;
    float bot = (uSword == 2 || uSword == 3) ? smoothstep(-0.7, -0.88, r) : 0.0;
    float swd = max(top, bot) * smoothstep(0.15, 0.45, q);
    col = mix(col, clamp(uColB * 1.2, 0.0, 1.0), swd * 0.6);
    col = mix(col, vec3(0.05), swd * smoothstep(0.92, 0.99, abs(r)) * uMelanin * 0.8);
  }
  // brush strokes along the fin rays (oil mode)
  vec2 bq = uKind == 0 ? vec2(q * 26.0, r * 60.0) : vec2(q * 40.0, r * 14.0);
  col *= 1.0 + ((vnoise(bq + uSeed) - 0.5) * 0.22 + (vnoise(bq * 0.2 + uSeed * 2.1) - 0.5) * 0.14) * uBrush;
  // iridescent tint
  vec3 irid = hsv2rgb(vec3(fract(0.5 + 0.4 * (1.0 - ndv) + 0.2 * q), 0.5 * uChroma, 1.0));
  col = mix(col, irid, uIri * 0.35 * smoothstep(0.2, 0.9, q));

  // membrane thins toward the edge and recedes between the ray tips: a soft, slightly scalloped edge
  float dn = clamp(dRay / 0.5, 0.0, 1.0);
  float edgeAt = 1.0 - 0.05 * dn * detail - 0.03 * vnoise(vec2(across * 2.3, 0.0) + uSeed * 3.1);
  float edge = 1.0 - smoothstep(edgeAt - 0.07, edgeAt, along);
  // dark border on the trailing edge of the tail
  float border = uKind == 0 ? smoothstep(edgeAt - 0.15, edgeAt - 0.06, along) * uBorder : 0.0;
  col = mix(col, vec3(0.05, 0.04, 0.05), border * 0.9);
  float alpha = uAlpha * (0.88 + 0.12 * ray) * (1.0 - 0.15 * smoothstep(0.5, 1.0, along)) * edge;
  if (uKind == 0) alpha *= smoothstep(1.0, 0.94, abs(r));
  else if (uKind != 3) alpha *= smoothstep(1.0, 0.9, q);
  alpha = max(alpha, border * 0.95 * edge);
  if (uKind == 3){ alpha = uAlpha * (0.85 + 0.3 * ray) * smoothstep(1.0, 0.85, q) * smoothstep(1.0, 0.8, abs(r)); col = mix(uColA, col, 0.3); }
  vec3 shaded = shade(col, N, vPos, 0.35, uIri);
  // light through the thin membrane: a fin glows in its own colour, most when lit from behind
  float back = max(0.0, dot(-N, normalize(LIGHT_DIR)));
  shaded += col * col * (0.5 * back + 0.14);
  o = vec4(fog(shaded, vPos), alpha);
}`;

// ---- painterly post-process ----

export const TENSOR_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uTexel;
vec3 s(vec2 d){ return texture(uSrc, vUv + d * uTexel).rgb; }
void main(){
  vec3 gx = (s(vec2(-1,-1)) + 2.0*s(vec2(-1,0)) + s(vec2(-1,1)) - s(vec2(1,-1)) - 2.0*s(vec2(1,0)) - s(vec2(1,1))) / 4.0;
  vec3 gy = (s(vec2(-1,-1)) + 2.0*s(vec2(0,-1)) + s(vec2(1,-1)) - s(vec2(-1,1)) - 2.0*s(vec2(0,1)) - s(vec2(1,1))) / 4.0;
  o = vec4(dot(gx, gx), dot(gy, gy), dot(gx, gy), 1.0);
}`;

export const BLUR_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uDir;
void main(){
  const float w[5] = float[5](0.2270, 0.1945, 0.1216, 0.0540, 0.0162);
  vec4 acc = texture(uSrc, vUv) * w[0];
  for (int i = 1; i < 5; i++){
    acc += texture(uSrc, vUv + uDir * float(i)) * w[i];
    acc += texture(uSrc, vUv - uDir * float(i)) * w[i];
  }
  o = acc;
}`;

// Anisotropic Kuwahara with polynomial sector weights (Kyprianidis et al.), 8 sectors.
export const KUWAHARA_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc, uTfm; uniform vec2 uTexel;
uniform float uRadius, uQ, uAlpha, uHardness, uZeroCross;
${COMMON}
void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 warp = (vec2(vnoise(fc / 7.0), vnoise(fc / 7.0 + 19.3)) - 0.5) * 2.6 * uTexel;
  vec2 uv = vUv + warp;
  float fishMask = texture(uSrc, vUv).a;
  vec3 t = texture(uTfm, uv).xyz;
  float E = t.x, G = t.y, F = t.z;
  float disc = sqrt(max(0.0, (E - G) * (E - G) + 4.0 * F * F));
  float l1 = 0.5 * (E + G + disc), l2 = 0.5 * (E + G - disc);
  vec2 v = vec2(l1 - E, -F);
  vec2 dir = length(v) > 1e-8 ? normalize(v) : vec2(0.0, 1.0);
  float phi = -atan(dir.y, dir.x);
  float A = (l1 + l2 > 1e-8) ? (l1 - l2) / (l1 + l2) : 0.0;
  // lighter abstraction over the fish keeps eyes, edges and patterns readable for selection
  float radius = uRadius * mix(1.0, 0.55, fishMask);
  float a = radius * clamp((uAlpha + A) / uAlpha, 0.1, 2.0);
  float b = radius * clamp(uAlpha / (uAlpha + A), 0.1, 2.0);
  float c = cos(phi), s = sin(phi);
  int maxX = int(sqrt(a * a * c * c + b * b * s * s));
  int maxY = int(sqrt(a * a * s * s + b * b * c * c));
  float zeta = 1.0 / radius;
  float sz = sin(uZeroCross);
  float eta = (zeta + cos(uZeroCross)) / (sz * sz);
  vec4 m[8]; vec3 sq[8];
  for (int k = 0; k < 8; k++){ m[k] = vec4(0.0); sq[k] = vec3(0.0); }
  for (int y = -maxY; y <= maxY; y++){
    for (int x = -maxX; x <= maxX; x++){
      vec2 off = vec2(float(x), float(y));
      vec2 w0 = vec2(c * off.x - s * off.y, s * off.x + c * off.y) * vec2(0.5 / a, 0.5 / b);
      float r2 = dot(w0, w0);
      if (r2 > 0.25) continue;
      vec3 col = texture(uSrc, uv + off * uTexel).rgb;
      float wk[8];
      float sum = 0.0, z;
      vec2 vv = w0;
      float vxx = zeta - eta * vv.x * vv.x, vyy = zeta - eta * vv.y * vv.y;
      z = max(0.0, vv.y + vxx);  wk[0] = z * z;
      z = max(0.0, -vv.x + vyy); wk[2] = z * z;
      z = max(0.0, -vv.y + vxx); wk[4] = z * z;
      z = max(0.0, vv.x + vyy);  wk[6] = z * z;
      vv = 0.70710678 * vec2(vv.x - vv.y, vv.x + vv.y);
      vxx = zeta - eta * vv.x * vv.x; vyy = zeta - eta * vv.y * vv.y;
      z = max(0.0, vv.y + vxx);  wk[1] = z * z;
      z = max(0.0, -vv.x + vyy); wk[3] = z * z;
      z = max(0.0, -vv.y + vxx); wk[5] = z * z;
      z = max(0.0, vv.x + vyy);  wk[7] = z * z;
      for (int k = 0; k < 8; k++) sum += wk[k];
      float g = exp(-3.125 * r2) / max(sum, 1e-6);
      for (int k = 0; k < 8; k++){
        float w = wk[k] * g;
        m[k] += vec4(col * w, w);
        sq[k] += col * col * w;
      }
    }
  }
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 8; k++){
    if (m[k].w <= 1e-6) continue;
    vec3 mean = m[k].rgb / m[k].w;
    vec3 var = abs(sq[k] / m[k].w - mean * mean);
    float sigma2 = var.r + var.g + var.b;
    float w = 1.0 / (1.0 + pow(uHardness * 1000.0 * sigma2, 0.5 * uQ));
    acc += vec4(mean * w, w);
  }
  o = vec4(acc.w > 0.0 ? clamp(acc.rgb / acc.w, 0.0, 1.0) : texture(uSrc, uv).rgb, fishMask);
}`;

// Brush field: fine bristle streaks (x) and broad stroke-to-stroke variation (y), smeared along the
// image flow by a short line integral. Runs once per frame at the filter resolution.
export const STROKE_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTfm; uniform vec2 uTexel, uRes;
${COMMON}
vec2 flowAt(vec2 uv){
  vec3 t = texture(uTfm, uv).xyz;
  float E = t.x, G = t.y, F = t.z;
  float disc = sqrt(max(0.0, (E - G) * (E - G) + 4.0 * F * F));
  float l1 = 0.5 * (E + G + disc);
  vec2 v = vec2(l1 - E, -F);
  return length(v) > 1e-8 ? normalize(v) : vec2(1.0, 0.0);
}
void main(){
  vec2 dir = flowAt(vUv);
  vec2 acc = vec2(0.0);
  for (int i = -8; i <= 8; i++){
    vec2 p = (vUv + dir * float(i) * uTexel * 1.6) * uRes;
    acc += vec2(vnoise(p / 2.2), vnoise(p / 8.0 + 37.0));
  }
  o = vec4(acc / 17.0, 0.0, 1.0);
}`;

// Impasto relief, per-stroke paint variation, canvas weave and oil grading over the Kuwahara image.
export const PAINT_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc, uStrokes, uScene; uniform vec2 uTexel, uSmallTexel, uRes; uniform float uStroke, uImpasto, uCanvas, uDetail;
${COMMON}
float height(vec2 uv){
  vec2 st = texture(uStrokes, uv).xy;
  return luma(texture(uSrc, uv).rgb) + (st.x - 0.5) * 0.9 * uStroke + (st.y - 0.5) * 0.6 * uStroke;
}
void main(){
  vec4 src = texture(uSrc, vUv);
  // fish keep most of their own detail (rays, scales, eyes): the abstraction is for the water and plants
  vec4 sharp = texture(uScene, vUv);
  vec3 col = mix(src.rgb, sharp.rgb, clamp(sharp.a, 0.0, 1.0) * uDetail);
  float onScene = 1.0 - 0.75 * src.a;   // fish carry their own strokes, in body coordinates
  vec2 st = texture(uStrokes, vUv).xy;
  col *= 1.0 + (st.x - 0.5) * 0.3 * uStroke * onScene;
  // each broad stroke carries slightly different paint: warm or cool, lighter or darker
  float jitter = (st.y - 0.5) * 2.0 * uStroke * onScene;
  col *= mix(vec3(1.0), jitter > 0.0 ? vec3(1.06, 1.01, 0.93) : vec3(0.94, 0.99, 1.05), abs(jitter) * 0.8);
  vec2 dx = vec2(max(uTexel.x, uSmallTexel.x * 0.75), 0.0), dy = vec2(0.0, max(uTexel.y, uSmallTexel.y * 0.75));
  float hx = height(vUv + dx) - height(vUv - dx);
  float hy = height(vUv + dy) - height(vUv - dy);
  vec3 N = normalize(vec3(-hx * uImpasto * 3.0 * (0.5 + 0.5 * onScene), -hy * uImpasto * 3.0 * (0.5 + 0.5 * onScene), 1.0));
  vec3 L = normalize(vec3(-0.45, 0.6, 0.66));
  col *= 0.86 + 0.24 * dot(N, L);
  col += pow(max(dot(reflect(-L, N), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * 0.06 * uImpasto;
  vec2 px = vUv * uRes;
  float weave = (sin(px.x * 1.65) * sin(px.y * 1.65)) * 0.5 + 0.5;
  float grain = hash12(floor(px));
  col *= 1.0 + uCanvas * ((weave - 0.5) * 0.06 + (grain - 0.5) * 0.04);
  // oil grading: richer darks, a touch more chroma, warm lights and cool shadows
  float lum = luma(col);
  col = mix(vec3(lum), col, 1.1);
  col = pow(max(col, 0.0), vec3(1.06));
  col *= mix(vec3(0.95, 0.99, 1.05), vec3(1.05, 1.0, 0.9), smoothstep(0.15, 0.7, lum));
  vec2 vg = vUv - 0.5;
  col *= 1.0 - 0.35 * dot(vg, vg);
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export const BLIT_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc;
void main(){ o = vec4(texture(uSrc, vUv).rgb, 1.0); }`;
