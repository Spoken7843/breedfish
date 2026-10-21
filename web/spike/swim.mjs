// Deterministic swimming for the tank. Every fish steers toward wander targets inside the tank,
// keeps clear of walls and of the others, alternates cruising with short hovers, and turns with a
// limited yaw rate. The simulation advances in fixed steps, so a given seed and time always give the
// same scene (a frozen ?t= replays from zero).
import { rngFromSeed } from '../../core/rng.mjs';

export const TANK = { x: [-5.8, 5.8], y: [-2.3, 2.6], z: [-3.6, 1.0] };
const TANK_DEFAULT = TANK;
const STEP = 1 / 60;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// Each fish wanders around its own home area and now and then makes a long trip across the tank,
// so the school spreads over the whole tank instead of piling up in the middle.
function pick(rng, sw, B = TANK) {
  const [x0, x1] = B.x, [y0, y1] = B.y, [z0, z1] = B.z;
  if (rng() < 0.2) return [x0 + 0.6 + rng() * (x1 - x0 - 1.2), y0 + 0.5 + rng() * (y1 - y0 - 1.0), z0 + 0.4 + rng() * (z1 - z0 - 0.8)];
  const h = sw.home;
  return [clamp(h[0] + (rng() - 0.5) * 4.2, x0 + 0.6, x1 - 0.6), clamp(h[1] + (rng() - 0.5) * 1.4, y0 + 0.4, y1 - 0.4), clamp(h[2] + (rng() - 0.5) * 2.0, z0 + 0.4, z1 - 0.4)];
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** `bounds` (default the whole tank) is the box the fish keep to, e.g. a smaller one for a close preview. */
export function createSchool(fishes, seed, bounds = TANK) {
  const TANK = bounds;
  const n = fishes.length;
  const stride = [7, 5, 11, 13, 17].find(s => gcd(s, n) === 1) ?? 1;
  const swimmers = fishes.map((f, i) => {
    const rng = rngFromSeed((seed ^ (f.look.seed * 7919) ^ (i * 104729)) >>> 0);
    // homes on a staggered grid: columns across the width, alternating height and depth
    const col = (i * stride) % n;
    const home = [TANK.x[0] + 1.0 + ((col + 0.5) / n) * (TANK.x[1] - TANK.x[0] - 2.0),
      TANK.y[0] + 0.7 + (((i * 5) % 4) / 3) * (TANK.y[1] - TANK.y[0] - 1.4),
      TANK.z[0] + 0.6 + (((i * 3) % 3) / 2) * (TANK.z[1] - TANK.z[0] - 1.2)];
    const pos = [home[0] + (rng() - 0.5), home[1], home[2]];
    const sw = {
      fish: f, rng, pos, home, yaw: rng() < 0.5 ? 0 : Math.PI, pitch: 0, speed: 0.2, yawRate: 0,
      phase: rng() * 6.28, effort: 0.5, target: null, retargetAt: 0, hoverUntil: 0, cruise: 0.38 + rng() * 0.18,
    };
    sw.target = pick(rng, sw, bounds);
    return sw;
  });
  return { swimmers, time: 0, focus: -1, bounds };
}

function stepOne(school, sw, t) {
  const { rng } = sw;
  const TANK = school.bounds ?? TANK_DEFAULT;
  const Lb = sw.fish.look.length;
  const focused = school.focus === sw.fish.index;
  if (focused) {
    // in portrait the fish patrols slowly across the tank, broadside to the camera
    const goRight = Math.cos(sw.yaw) >= 0;
    if (!sw.focusTarget) sw.focusTarget = [goRight ? 3 : -3, 0.2, -0.4];
    else if (goRight && sw.pos[0] > 2.6) sw.focusTarget = [-3, 0.2, -0.4];
    else if (!goRight && sw.pos[0] < -2.6) sw.focusTarget = [3, 0.2, -0.4];
    sw.target = sw.focusTarget;
  } else if ((sw.focusTarget && !(sw.focusTarget = null)) || t >= sw.retargetAt || Math.hypot(sw.target[0] - sw.pos[0], sw.target[2] - sw.pos[2]) < 0.5) {
    sw.target = pick(rng, sw, TANK);
    sw.retargetAt = t + 5 + rng() * 7;
    if (rng() < 0.3) sw.hoverUntil = t + 1.2 + rng() * 2.2;
  }
  // desired direction: target + wall avoidance + separation
  let dx = sw.target[0] - sw.pos[0], dy = sw.target[1] - sw.pos[1], dz = sw.target[2] - sw.pos[2];
  const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
  const wall = (p, lo, hi) => (p < lo + 0.7 ? (lo + 0.7 - p) * 1.6 : 0) - (p > hi - 0.7 ? (p - hi + 0.7) * 1.6 : 0);
  dx += wall(sw.pos[0], ...TANK.x); dy += wall(sw.pos[1], ...TANK.y); dz += wall(sw.pos[2], ...TANK.z);
  for (const o of school.swimmers) {
    if (o === sw) continue;
    const ox = sw.pos[0] - o.pos[0], oy = sw.pos[1] - o.pos[1], oz = sw.pos[2] - o.pos[2];
    const d = Math.hypot(ox, oy, oz);
    const reach = 0.9 * (Lb + o.fish.look.length) / 2 + 0.3;
    if (d > 1e-4 && d < reach) { const k = (reach - d) / reach * 1.4 / d; dx += ox * k; dy += oy * k * 0.6; dz += oz * k; }
  }
  const desiredYaw = Math.atan2(-dz, dx);
  const desiredPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)) * 0.7, -0.35, 0.35);
  const maxTurn = 1.8 * STEP;
  const dYaw = clamp(wrapAngle(desiredYaw - sw.yaw), -maxTurn, maxTurn);
  sw.yaw = wrapAngle(sw.yaw + dYaw);
  sw.yawRate = sw.yawRate * 0.9 + (dYaw / STEP) * 0.1;
  sw.pitch += (desiredPitch - sw.pitch) * Math.min(1, STEP * 2.5);
  // speed: cruise, slower in sharp turns, near-still while hovering
  const hovering = !focused && t < sw.hoverUntil;
  const turnFactor = 1 - 0.55 * Math.min(1, Math.abs(wrapAngle(desiredYaw - sw.yaw)) / Math.PI);
  const target = (focused ? 0.22 : hovering ? 0.05 : sw.cruise) * Lb * turnFactor;
  sw.speed += (target - sw.speed) * Math.min(1, STEP * 1.5);
  const cp = Math.cos(sw.pitch);
  sw.pos[0] += Math.cos(sw.yaw) * cp * sw.speed * STEP;
  sw.pos[2] += -Math.sin(sw.yaw) * cp * sw.speed * STEP;
  sw.pos[1] += Math.sin(sw.pitch) * sw.speed * STEP;
  for (let i = 0; i < 3; i++) sw.pos[i] = clamp(sw.pos[i], ...[TANK.x, TANK.y, TANK.z][i]);
  // tail beat: frequency and amplitude follow the effort (speed plus turning)
  sw.effort = clamp(sw.speed / (0.45 * Lb) + Math.abs(sw.yawRate) * 0.25, 0.25, 1.6);
  const freq = sw.fish.look.swim.freq * (0.55 + 0.6 * sw.effort);
  sw.phase += 2 * Math.PI * freq * STEP;
}

/** Advance the school to time t (seconds) in fixed steps; going back in time replays from zero. */
export function advance(school, t, rebuild) {
  if (t < school.time) { const fresh = rebuild(); Object.assign(school, fresh); }
  while (school.time + STEP <= t) {
    school.time += STEP;
    for (const sw of school.swimmers) stepOne(school, sw, school.time);
  }
  return school;
}
