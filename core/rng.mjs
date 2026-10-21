/** Deterministic, self-contained PRNG; never use Math.random in domain code. */
export function rngFromSeed(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function randomInt(rng, maxExclusive) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) throw new RangeError('invalid bound');
  return Math.floor(rng() * maxExclusive);
}
export function poisson(rng, lambda) {
  if (lambda < 0 || !Number.isFinite(lambda)) throw new RangeError('invalid lambda');
  const threshold = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > threshold);
  return k - 1;
}
export function randomSeed(rng) { return Math.floor(rng() * 0x100000000) >>> 0; }

/** FNV-1a 32-bit hash of a string; stable across platforms. */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Independent sub-seed for one consumer of a seed (phenotype noise, spot layout, render...). */
export function deriveSeed(seed, salt) {
  return rngFromSeed((seed >>> 0) ^ hashString(String(salt)))() * 0x100000000 >>> 0;
}
