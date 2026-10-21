// Procedural guppy geometry. Body and fins are static lattices in a "rest frame" (s along the body
// from the snout, y up, l toward the fish's own +z side); the vertex shader bends them along a spine that
// is re-integrated every frame, so the same mesh swims, turns and shows any genotype. The body is a
// half shell drawn twice (uSide = +1 / -1), so the fish can be seen from either side while it turns.
import { gridIndices, mesh } from './gl.mjs';
import { profileAt } from './look.mjs';

export const SPINE_SAMPLES = 64;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Static vertical bend of the spine for a spinal defect (kyphosis hump + dropped tail). */
export function bend(look, u) {
  if (!look.defect) return 0;
  return look.length * (0.05 * Math.exp(-(((u - 0.55) / 0.13) ** 2)) - 0.055 * smooth(0.62, 1.05, u));
}

/**
 * Caudal outline per shape: for r in [-1, 1] (ventral to dorsal edge) returns the ray length (in tail
 * lengths), its angle from the body axis and an extra vertical offset at the tip.
 */
function caudalRay(shape, r) {
  const a = Math.abs(r), s = Math.sign(r);
  switch (shape) {
    case 'delta': { const ang = r * 0.62; return { len: (1 / Math.cos(ang)) * (1 - 0.05 * r * r), ang, lift: 0 }; }
    case 'veil': return { len: 1.0 * (1 - 0.22 * r * r) + 0.18 * Math.max(0, -r), ang: r * 0.36, lift: -0.22 };
    case 'round': return { len: 0.9 * (1 - 0.32 * r * r), ang: r * 0.62, lift: 0 };
    case 'fan': return { len: 0.95 * (1 - 0.18 * r * r), ang: r * 0.78, lift: 0 };
    case 'halfMoon': return { len: 1.0 * (1 - 0.04 * r * r), ang: r * 1.12, lift: 0 };
    case 'flag': { const ang = r * 0.1; return { len: 1 / Math.cos(ang), ang, lift: 0 }; }
    case 'spear': return { len: 0.92 * (1 - 0.78 * a) + 0.1, ang: r * 0.46, lift: 0 };
    case 'spade': return { len: 0.95 * (1 - 0.62 * a) + 0.12, ang: r * 0.5, lift: 0 };
    case 'pin': return { len: 0.62 * (1 - 0.3 * r * r) + 0.95 * Math.exp(-((r / 0.07) ** 2)), ang: r * 0.55, lift: 0 };
    case 'lyre': return { len: 0.55 + 0.75 * a ** 4, ang: r * 0.55 - s * 0.18 * a ** 6, lift: 0 };
    case 'doubleSword': case 'topSword': case 'bottomSword': {
      const up = shape !== 'bottomSword' && r > 0, down = shape !== 'topSword' && r < 0;
      const sword = (up || down) ? smooth(0.7, 0.98, a) : 0;
      return { len: 0.62 * (1 - 0.25 * r * r) + 1.05 * sword, ang: r * (0.42 - 0.2 * sword), lift: 0 };
    }
    default: return { len: 1, ang: r * 0.5, lift: 0 };
  }
}

export function buildFish(gl, look) {
  const Lb = look.length;
  const T = look.tail, Lt = T.length * Lb;
  const S = Lb + Lt * 1.6;
  const station = s => (s / S) * (SPINE_SAMPLES - 1);
  const hd = u => profileAt(look.profile.dorsal, u) * Lb;
  const hv = u => profileAt(look.profile.ventral, u) * Lb;

  // ---- body: one half shell; the shader mirrors it for the other side ----
  const NB = 64, NV = 27;
  const rest = [];
  for (let k = 0; k < NV; k++) {
    const lin = -1 + (2 * k) / (NV - 1);
    const v = Math.sin((lin * Math.PI) / 2);
    for (let j = 0; j < NB; j++) {
      const u = Math.pow(j / (NB - 1), 1.3);
      const h = v >= 0 ? hd(u) : hv(u);
      const t = (0.42 + 0.22 * (1 - u)) * 0.5 * (hd(u) + hv(u)) * (look.thickness / 0.5);
      rest.push({ u, v, s: u * Lb, y: bend(look, u) + h * v, l: t * Math.sqrt(Math.max(0, 1 - v * v)) });
    }
  }
  const at = (j, k) => rest[Math.min(NV - 1, Math.max(0, k)) * NB + Math.min(NB - 1, Math.max(0, j))];
  const bodyV = [];
  for (let k = 0; k < NV; k++) for (let j = 0; j < NB; j++) {
    const p = at(j, k);
    const a = at(j + 1, k), b = at(j - 1, k), c = at(j, k + 1), d = at(j, k - 1);
    const du = [-(a.s - b.s), a.y - b.y, a.l - b.l], dv = [-(c.s - d.s), c.y - d.y, c.l - d.l];
    let n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
    if (n[2] < 0) n = n.map(x => -x);
    const len = Math.hypot(...n) || 1;
    n = n.map(x => x / len);
    bodyV.push(station(p.s), p.y, p.l, p.u, -n[0], n[1], n[2], p.v);
  }
  const body = mesh(gl, new Float32Array(bodyV), new Uint32Array(gridIndices(NB, NV)), [[0, 4], [1, 4]]);

  // ---- fins: (station, y, flutter, q) + (r, lateral, pecLen, isPec) ----
  const finMesh = (cols, rows, fn) => {
    const verts = [];
    for (let k = 0; k < rows; k++) for (let j = 0; j < cols; j++) verts.push(...fn(j / (cols - 1), k / (rows - 1)));
    return mesh(gl, new Float32Array(verts), new Uint32Array(gridIndices(cols, rows)), [[0, 4], [1, 4]]);
  };

  const hb = hd(1) * 0.92, yPed = bend(look, 1);
  const caudal = finMesh(30, 49, (q, rr) => {
    const r = rr * 2 - 1;
    const ray = caudalRay(T.shape, r), len = ray.len, lift = ray.lift, ang = ray.ang * (T.spread ?? 1);
    const qq = Math.pow(q, 0.9);
    const L = len * Lt;
    const s = Lb - 0.02 * Lb + qq * L * Math.cos(ang);
    const y = yPed + r * hb * (1 - qq * 0.2) + qq * L * Math.sin(ang) + lift * Lt * qq * qq * (0.6 + 0.4 * (1 - r) / 2);
    return [station(s), y, 0.045 * Lt * qq * qq, q, r, 0, 0, 0];
  });

  const median = (F, up) => finMesh(14, 13, (q, r) => {
    const u = F.u0 + q * (F.u1 - F.u0);
    const edge = up ? hd(u) : -hv(u);
    const sBase = u * Lb;
    const height = F.height * Lb * (1 - 0.75 * q) * (F.gonopodium ? 0.35 : 1);
    const reach = F.sweep * Lb * (0.3 + 0.7 * q);
    const rr = Math.pow(r, 0.95);
    const s = sBase + rr * reach;
    const y = bend(look, u) + edge * 0.94 + (up ? 1 : -1) * rr * height;
    return [station(s), y, 0.02 * Lb * rr * rr, q, r, 0, 0, 0];
  });
  const dorsal = median(look.dorsalFin, true);
  const anal = median(look.anal, false);

  const P = look.pectoral;
  const uP = 0.21, sP = uP * Lb, yP = bend(look, uP) - 0.25 * hv(uP), tP = 0.5 * (hd(uP) + hv(uP)) * 0.5;
  const pecLen = P.length * Lb;
  const pectoral = finMesh(12, 11, (a, rr) => {
    const r = rr * 2 - 1;
    const width = P.width * Lb * Math.sin(Math.PI * Math.min(1, a * 1.1 + 0.05)) * (0.45 + 0.55 * a);
    return [station(sP), yP + r * width - 0.02 * Lb * a, 0.004 * Lb * a, a, r, tP + 0.004 * Lb, pecLen, 1];
  });

  return { body, caudal, dorsal, anal, pectoral, S, Lb, dispose() { [body, caudal, dorsal, anal, pectoral].forEach(m => m.dispose()); } };
}

/**
 * Integrate the swimming spine: a travelling wave whose amplitude grows toward the tail, continued
 * into the caudal fin. `phase` is the integrated tail-beat phase, `ampScale` follows the swimming
 * effort and `turn` (rad/s of yaw) curls the body into the turn. Output per sample:
 * (x, z, sin(theta), cos(theta)), centred on 40% of the body so the fish recoils around its centre.
 */
export function spineAt(look, geo, phase, ampScale, turn, out) {
  const N = SPINE_SAMPLES, S = geo.S, Lb = geo.Lb, ds = S / (N - 1);
  const k = (2 * Math.PI) / (0.95 * Lb);
  const amp = look.swim.amp * ampScale;
  const curl = Math.max(-0.9, Math.min(0.9, turn * 0.35));
  let x = 0, z = 0, cx = 0, cz = 0;
  const cIdx = (0.4 * Lb) / ds;
  for (let i = 0; i < N; i++) {
    const s = i * ds, u = Math.min(s / Lb, 1.25);
    const A = amp * Lb * (0.03 + 0.97 * u * u);
    const dA = s / Lb < 1.25 ? amp * Lb * 0.97 * 2 * u / Lb : 0;
    const arg = k * s - phase;
    const theta = Math.atan(dA * Math.sin(arg) + A * k * Math.cos(arg)) + curl * Math.min(1, s / Lb) * 0.8;
    if (i > 0) { x -= ds * Math.cos(theta); z += ds * Math.sin(theta); }
    out[i * 4] = x; out[i * 4 + 1] = z; out[i * 4 + 2] = Math.sin(theta); out[i * 4 + 3] = Math.cos(theta);
    if (i === Math.floor(cIdx)) { cx = x; cz = z; }
  }
  for (let i = 0; i < N; i++) { out[i * 4] -= cx; out[i * 4 + 1] -= cz; }
  return out;
}
