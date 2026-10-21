// Phenotype -> visual parameters for the guppy spike. Art decisions only: no genetics here (the
// look reads the phenotype, never the genome). Everything else comes from the fish's developmental
// seed, so the same genome always paints the same fish. Bump ART_STYLE_VERSION whenever a change
// alters existing fish.
import { rngFromSeed } from '../../core/rng.mjs';

export const ART_STYLE_VERSION = 'oil-spike-0.9.0';

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const scale = (c, k) => c.map(v => v * k);
const clamp01 = c => c.map(v => Math.min(1, Math.max(0, v)));
const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const chroma = (c, k) => { const l = luma(c); return clamp01(c.map(v => l + (v - l) * k)); };
/** Blue guppies (r/r) have no orange/yellow pigment: warm colours become pale blue-white. */
const coolIfBlue = (c, noOrange) => (noOrange && c[0] > c[2] + 0.12 ? mix(c, [0.78, 0.85, 0.96], 0.85) : c);

// Half-height profiles in body lengths, sampled at U. Dorsal (up) and ventral (down) edges.
const U = [0, 0.02, 0.06, 0.12, 0.22, 0.35, 0.5, 0.65, 0.8, 0.92, 1.0];
const PROFILES = {
  male: {
    dorsal: [0.005, 0.036, 0.066, 0.094, 0.116, 0.126, 0.122, 0.106, 0.085, 0.068, 0.06],
    ventral: [0.005, 0.03, 0.06, 0.086, 0.11, 0.12, 0.114, 0.094, 0.076, 0.064, 0.058],
  },
  female: {
    dorsal: [0.005, 0.032, 0.06, 0.086, 0.106, 0.116, 0.112, 0.094, 0.07, 0.055, 0.05],
    ventral: [0.005, 0.028, 0.058, 0.088, 0.122, 0.142, 0.144, 0.112, 0.076, 0.056, 0.05],
  },
};

/** Smooth interpolation of a profile at u in [0,1]. */
export function profileAt(values, u) {
  const x = Math.min(1, Math.max(0, u));
  let i = 0; while (i < U.length - 2 && U[i + 1] < x) i++;
  const t = (x - U[i]) / (U[i + 1] - U[i]);
  const p0 = values[Math.max(0, i - 1)], p1 = values[i], p2 = values[i + 1], p3 = values[Math.min(values.length - 1, i + 2)];
  const t2 = t * t, t3 = t2 * t; // Catmull-Rom
  return Math.max(0, 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
}

// Shader ids (keep in sync with BODY_FS / FIN_FS). Body colour is drawn in layers (v0.7): full red,
// the snakeskin chain (SNAKE), one metallic/solid pattern (BODY_PATTERNS) and the Kohaku red head.
export const BODY_PATTERNS = { none: 0, moscow: 3, japanBlue: 4, coral: 5, platinum: 6, dragon: 7, moscowBlack: 3, panda: 10, neonBlue: 3 };
const SNAKE = { none: 0, snakeskin: 1, cobra: 2 };
export const TAIL_PATTERNS = { none: 0, snakeskin: 1, mosaic: 2, grass: 3, leopard: 4, multi: 5 };

const SNAKE_COLORS = {
  snakeskin: [[0.86, 0.84, 0.48], [0.07, 0.09, 0.05], 0.15],
  cobra:     [[0.80, 0.86, 0.46], [0.06, 0.08, 0.05], 0.15],
};
const RED_BODY = [[0.82, 0.13, 0.11], [0.95, 0.40, 0.26]];
const KOI_RED = [[0.94, 0.26, 0.10], [1.00, 0.55, 0.20]];
const BODY_PATTERN_COLORS = {
  moscow:    [[0.10, 0.17, 0.38], [0.32, 0.52, 0.86], 0.8],
  japanBlue: [[0.48, 0.78, 0.96], [0.22, 0.52, 0.88], 0.9],
  coral:     [[0.95, 0.30, 0.22], [1.00, 0.58, 0.42], 0.75],
  platinum:  [[0.96, 0.96, 0.93], [0.84, 0.90, 1.00], 1.0],
  dragon:    [[0.90, 0.92, 0.95], [0.42, 0.46, 0.55], 1.0],
  moscowBlack: [[0.035, 0.035, 0.05], [0.16, 0.20, 0.32], 0.55],
  panda:     [[0.05, 0.06, 0.11], [0.78, 0.84, 0.95], 0.7],
  neonBlue:  [[0.10, 0.50, 1.00], [0.45, 0.88, 1.00], 1.0],
};

const TAIL_COLORS = {
  red: [[0.88, 0.14, 0.10], [0.62, 0.05, 0.08]],
  blue: [[0.26, 0.50, 0.92], [0.10, 0.25, 0.66]],
  white: [[0.95, 0.95, 0.93], [0.84, 0.88, 0.94]],
  dark: [[0.10, 0.15, 0.30], [0.05, 0.07, 0.15]],
  yellow: [[0.98, 0.84, 0.22], [0.92, 0.66, 0.10]],
  purple: [[0.50, 0.22, 0.66], [0.28, 0.10, 0.42]],
  green: [[0.30, 0.68, 0.36], [0.12, 0.42, 0.26]],
  pastel: [[0.98, 0.86, 0.84], [0.90, 0.72, 0.76]],
  multi: [[0.92, 0.24, 0.14], [0.18, 0.40, 0.90]],
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function guppyLook(p) {
  const rng = rngFromSeed(p.spotsSeed);
  const r = (a, b) => a + (b - a) * rng();
  const male = p.observedSex === 'male';
  // Age: fry are small and drab; line colours and the male's fins and ornaments come in as the fish
  // matures (sizeFactor = age / adult age, from the phenotype).
  // growth (sizeFactor, share of adult length) sets the size; age (maturity) sets colours and fins
  const grown = p.sizeFactor ?? 1;
  const adult = smooth(0.4, 0.9, p.maturity ?? grown);
  // quantitative ornaments (0..1 measured phenotypes; 0.5 when a species does not have them)
  const q = k => (Number.isFinite(p[k]) ? p[k] : 0.5);
  const cov = q('colorCoverage');
  const mel = p.melanin;
  const bright = 0.72 + 0.55 * (p.luminance - 0.5);
  const chromaK = 0.55 + 1.0 * p.saturation;
  const blue = p.noOrange;

  // ---- body palette from base colour, Asian Blau and albinism ----
  let dorsal, flank, belly, retic;
  if (p.albino) { dorsal = [0.80, 0.60, 0.50]; flank = [0.92, 0.76, 0.66]; belly = [0.97, 0.89, 0.82]; retic = 0; }
  else if (p.bodyBase === 'golden') { dorsal = [0.62, 0.48, 0.22]; flank = [0.86, 0.72, 0.40]; belly = [0.96, 0.90, 0.74]; retic = 0.75; }
  else if (p.bodyBase === 'blond') { dorsal = [0.62, 0.58, 0.44]; flank = [0.84, 0.80, 0.66]; belly = [0.95, 0.92, 0.84]; retic = 0.15; }
  else if (male) { dorsal = [0.34, 0.36, 0.30]; flank = [0.58, 0.59, 0.52]; belly = [0.80, 0.79, 0.72]; retic = 0.35; }
  else if (p.tailColor !== 'natural') { dorsal = [0.46, 0.47, 0.52]; flank = [0.72, 0.72, 0.76]; belly = [0.90, 0.88, 0.88]; retic = 0.4; } // fancy-line female: silvery
  else { dorsal = [0.33, 0.34, 0.27]; flank = [0.60, 0.58, 0.47]; belly = [0.84, 0.82, 0.72]; retic = 0.5; }
  if (p.blau === 'white') { dorsal = mix(dorsal, [0.88, 0.88, 0.88], 0.8); flank = mix(flank, [0.95, 0.95, 0.94], 0.85); belly = [0.97, 0.97, 0.96]; retic *= 0.2; }
  if (p.blau === 'blueMetal') { dorsal = mix(dorsal, [0.25, 0.38, 0.62], 0.55); flank = mix(flank, [0.55, 0.70, 0.90], 0.55); }
  if (blue) { dorsal = mix(dorsal, [0.38, 0.42, 0.50], 0.4); flank = mix(flank, [0.70, 0.76, 0.86], 0.35); }
  // Micariff: a yellow body (Metal Gold adds its metallic yellow as a layer below)
  if (p.micariff) { dorsal = mix(dorsal, [0.86, 0.72, 0.30], 0.35); flank = mix(flank, [0.98, 0.86, 0.40], 0.55); belly = mix(belly, [1.0, 0.94, 0.70], 0.3); }
  const hueJitter = r(-0.025, 0.025);
  [dorsal, flank, belly] = [dorsal, flank, belly].map(c => clamp01(scale(c.map((v, i) => v + (i === 0 ? hueJitter : i === 2 ? -hueJitter : 0)), bright)));

  // Purple Body turns warm colours (orange, red) toward pinkish purple: one copy a little, two a lot [Bias]
  const purpleK = p.purpleBody === 'hom' ? 0.65 : p.purpleBody === 'het' ? 0.3 : 0;
  const purple = c => (purpleK ? mix(c, [0.70, 0.27, 0.62], purpleK * Math.max(0, Math.min(1, (c[0] - c[2]) * 1.6))) : c);

  // ---- male ornaments ----
  // Wild-type males carry a few modest spots (orange, black, a little iridescence) on a drab olive
  // body; more saturated fish get one or two more and slightly bigger ones. Radius is in body
  // lengths along u; across the body 0.1 spans the whole half-height, so 0.05 is already a big spot.
  const spots = [];
  if (p.pattern) {
    const n = 2 + Math.floor(rng() * (1.5 + 2 * p.saturation));
    for (let i = 0; i < n; i++) {
      const kind = i === 0 ? 0 : i === 1 ? 1 : rng() < 0.4 ? 0 : rng() < 0.55 ? 1 : 2;
      spots.push({ u: r(0.3, 0.86), v: r(-0.55, 0.5), radius: r(0.028, 0.045 + 0.03 * p.saturation) * adult, stretch: r(0.9, 1.6), kind, hue: kind === 2 ? r(0.45, 0.72) : r(0, 1) });
    }
    if (adult < 0.15) spots.length = 0;
  }
  // ---- body colour layers; `k` is how strongly this fish shows each (a female shows some faint) ----
  const strength = t => p.strength?.[t] ?? 1;
  // Asian Blau suppresses red: the heterozygote keeps a paler red (the homozygote hides it in the genetics)
  const redK = p.blau === 'blueMetal' ? 0.55 : 1;
  const layer = (id, cols, k, metal = 0) => ({ id: adult < 0.1 ? 0 : id, colA: mix(flank, cols[0], adult), colB: mix(flank, cols[1], adult), metal: metal * adult, k: k * adult });
  const bp = BODY_PATTERN_COLORS[p.bodyPattern];
  const bodyPattern = bp
    ? layer(BODY_PATTERNS[p.bodyPattern], [coolIfBlue(chroma(bp[0], chromaK), blue), coolIfBlue(chroma(bp[1], chromaK), blue)], strength('bodyPattern'), bp[2])
    : { id: 0, colA: [0, 0, 0], colB: [0, 0, 0], metal: 0, k: 0 };
  const sc = SNAKE_COLORS[p.snakeskin];
  let snakeCols = sc ? [chroma(sc[0], chromaK), sc[1]] : null;
  if (sc && p.bodyBase === 'golden') snakeCols[0] = chroma([0.95, 0.80, 0.35], chromaK);
  if (sc && mel < 0.3) snakeCols[1] = coolIfBlue([0.86, 0.42, 0.22], blue);   // no melanin: an orange chain
  if (sc && blue) snakeCols = snakeCols.map(c => coolIfBlue(c, blue));
  const snake = sc ? layer(SNAKE[p.snakeskin], snakeCols, strength('snakeskin'), sc[2]) : { id: 0, colA: [0, 0, 0], colB: [0, 0, 0], metal: 0, k: 0 };
  const fullRed = p.fullRed ? layer(1, RED_BODY.map(c => purple(chroma(c, chromaK))), strength('fullRed') * redK, 0.25) : { id: 0, colA: [0, 0, 0], colB: [0, 0, 0], metal: 0, k: 0 };
  // Zebrinus bars (the cobra already draws them with its chain); Metal Gold; glass belly; pink peduncle
  const barColor = mel > 0.3 ? [0.06, 0.06, 0.07] : coolIfBlue([0.86, 0.45, 0.25], blue);
  const zebra = { k: p.zebrinus && p.snakeskin !== 'cobra' ? adult : 0, color: barColor };
  const gold = { k: p.metalGold ? adult * strength('metalGold') : 0, color: chroma([0.98, 0.80, 0.30], chromaK) };
  const glass = p.glassBelly ? 1 : 0;
  const pink = p.pink ? adult : 0;
  // Kohaku: a red cap whose reach is the polygenic headRed; males also carry red on the body (varies)
  const koi = p.kohaku
    ? { ...layer(1, KOI_RED.map(c => purple(chroma(c, chromaK))), strength('kohaku') * redK), extent: q('headRed'), body: male ? q('headRed') : 0 }
    : { id: 0, colA: [0, 0, 0], colB: [0, 0, 0], metal: 0, k: 0, extent: 0, body: 0 };
  const tuxedo = p.tuxedo
    ? { amount: Math.max(0.15, mel) * (male ? 1 : 0.32) * (0.35 + 0.65 * adult), color: mel > 0.5 ? [0.04, 0.04, 0.06] : [0.55, 0.42, 0.40] }
    : { amount: 0, color: [0, 0, 0] };

  // ---- fins ----
  const orange = purple(chroma(mix([0.95, 0.46, 0.14], [0.86, 0.18, 0.12], rng()), chromaK));
  let tailA, tailB, tailAlpha, iri = 0.3;
  if (TAIL_COLORS[p.tailColor]) { [tailA, tailB] = TAIL_COLORS[p.tailColor].map(purple); tailAlpha = male ? 0.92 : 0.78; }
  else if (p.micariff) { [tailA, tailB] = TAIL_COLORS.yellow; tailAlpha = male ? 0.9 : 0.75; }
  else if (male && p.tailPattern === 'leopard') { tailA = [0.96, 0.82, 0.30]; tailB = [0.90, 0.66, 0.18]; tailAlpha = 0.9; }
  else if (male && p.tailPattern === 'grass') { tailA = [0.86, 0.82, 0.36]; tailB = [0.70, 0.66, 0.22]; tailAlpha = 0.88; }
  else if (male && p.tailPattern === 'snakeskin') { tailA = [0.84, 0.82, 0.40]; tailB = [0.64, 0.60, 0.24]; tailAlpha = 0.9; }
  else if (male && p.tailPattern === 'mosaic') { tailA = [0.30, 0.48, 0.86]; tailB = [0.18, 0.30, 0.70]; tailAlpha = 0.9; }
  // wild-type tail: mostly clear olive-grey membrane, a warm wash toward the edge, black speckles
  else if (male && p.pattern) { tailA = mix([0.62, 0.63, 0.56], orange, 0.18 + 0.2 * p.saturation); tailB = mix([0.50, 0.52, 0.46], orange, 0.3 + 0.25 * p.saturation); tailAlpha = 0.62; iri = 0.25; }
  else if (male && (p.bodyPattern !== 'none' || p.snakeskin !== 'none' || p.fullRed || p.kohaku)) { tailA = orange; tailB = chroma(mix(orange, [0.7, 0.1, 0.15], 0.5), chromaK); tailAlpha = 0.9; }
  else if (male) { tailA = [0.55, 0.66, 0.70]; tailB = [0.42, 0.55, 0.64]; tailAlpha = 0.72; iri = 0.45; }
  else { tailA = mix(flank, [0.8, 0.8, 0.74], 0.3); tailB = mix(flank, [0.55, 0.55, 0.5], 0.4); tailAlpha = 0.55; iri = 0.1; }
  tailA = coolIfBlue(chroma(tailA, chromaK), blue); tailB = coolIfBlue(chroma(tailB, chromaK), blue);
  // females carry the line colour deeper and duskier than males (dark membrane, light rays)
  // (koi females keep a clear red caudal like their red head: "a red head and a red caudal fin")
  const dusk = p.kohaku ? 0.25 : 1;
  if (!male && p.tailColor !== 'natural') { tailA = mix(tailA, [0.07, 0.08, 0.16], 0.55 * dusk); tailB = mix(tailB, [0.04, 0.04, 0.10], 0.65 * dusk); }
  // colour coverage: low-coverage fins show more clear membrane between the colour
  if (TAIL_COLORS[p.tailColor] || (male && p.tailPattern !== 'none')) {
    const clear = mix(flank, [0.8, 0.8, 0.74], 0.3);
    tailA = mix(tailA, clear, (1 - cov) * 0.6); tailB = mix(tailB, clear, (1 - cov) * 0.45); tailAlpha *= 0.7 + 0.3 * cov;
  }
  if (adult < 1) {
    const fryA = mix(flank, [0.8, 0.8, 0.74], 0.3), fryB = mix(flank, [0.55, 0.55, 0.5], 0.4);
    tailA = mix(fryA, tailA, adult); tailB = mix(fryB, tailB, adult); tailAlpha = 0.55 + (tailAlpha - 0.55) * adult;
  }

  const fancy = ['delta', 'veil', 'halfMoon', 'fan', 'flag'].includes(p.tailShape);
  const fancyFemale = !male && (fancy || p.tailColor !== 'natural');
  const shape = male ? p.tailShape : (fancyFemale ? 'fan' : 'round');
  const TAIL_LENGTH = { delta: 1.0, veil: 1.12, halfMoon: 0.95, fan: 0.8, flag: 1.0, round: 0.5, spade: 0.55, spear: 0.7, pin: 0.55, lyre: 0.78,
    topSword: 0.62, bottomSword: 0.62, doubleSword: 0.62 };
  // females show at most a faint lace of a male tail pattern (strength < 1)
  const tailPat = male ? (TAIL_PATTERNS[p.tailPattern] || (p.tailColor === 'multi' ? TAIL_PATTERNS.multi : 0)) : (p.tailPattern !== 'none' ? TAIL_PATTERNS[p.tailPattern] : 0);
  const tailPatK = male ? 1 : strength('tailPattern');
  const patDark = mel > 0.3 ? [0.05, 0.04, 0.05] : coolIfBlue([0.80, 0.32, 0.16], blue);
  const fullLength = (male ? TAIL_LENGTH[shape] * (0.7 + 0.45 * q('tailSize')) : (fancyFemale ? 0.5 : 0.36) * (0.85 + 0.25 * q('tailSize')));
  const tail = {
    shape: adult < 0.3 ? 'round' : shape, length: 0.36 + (fullLength - 0.36) * adult, spread: 0.8 + 0.4 * q('tailSpread') * adult + 0.2 * (1 - adult),
    colorA: tailA, colorB: tailB, alpha: tailAlpha,
    speckle: (male ? (p.pattern && !tailPat ? 0.5 : 0.15) : 0.12) * mel,
    iridescence: iri, border: p.tailBorder ? mel : 0,
    pattern: tailPat, patDark: tailPatK < 1 ? mix(tailA, patDark, tailPatK * 1.6) : patDark, patLight: mix(tailA, [1, 1, 0.9], 0.35 * tailPatK),
    sword: male && adult >= 0.3 ? (shape === 'doubleSword' ? 3 : shape === 'topSword' ? 1 : shape === 'bottomSword' ? 2 : 0) : 0,
  };
  if (adult < 0.3) tail.pattern = 0;
  if (p.albino) { tail.colorA = mix(tail.colorA, [1, 0.8, 0.72], 0.2); tail.colorB = mix(tail.colorB, [1, 0.72, 0.66], 0.2); }

  const dorsalFin = male
    ? { u0: 0.5, u1: 0.64, height: (0.085 + ((fancy ? 0.18 : 0.15) - 0.085) * adult) * (0.7 + 0.6 * q('dorsalSize')),
        sweep: (0.12 + ((fancy ? 0.5 : 0.4) - 0.12) * adult) * (0.7 + 0.6 * q('dorsalSize')),
        colorA: mix(tail.colorA, flank, 0.25), colorB: tail.colorB, alpha: Math.min(0.9, tail.alpha), pattern: tail.pattern, patDark, patLight: tail.patLight }
    : { u0: 0.55, u1: 0.66, height: fancyFemale ? 0.1 : 0.085, sweep: fancyFemale ? 0.16 : 0.12,
        colorA: fancyFemale ? mix(tail.colorA, flank, 0.45) : mix(flank, [0.75, 0.75, 0.7], 0.3), colorB: fancyFemale ? tail.colorB : undefined,
        alpha: fancyFemale ? 0.7 : 0.55, pattern: 0, patDark, patLight: flank };
  dorsalFin.speckle = (male && p.pattern && !tailPat ? 0.5 : 0.15) * mel;

  const anal = male
    ? { u0: 0.5, u1: 0.56, height: 0.05, sweep: 0.2, colorA: scale(flank, 0.7), alpha: 0.85, gonopodium: true }
    : { u0: 0.6, u1: 0.68, height: 0.07, sweep: 0.08, colorA: mix(flank, [0.8, 0.8, 0.75], 0.3), alpha: 0.5, gonopodium: false };

  // pelvic fins: a small pair just ahead of the anal fin (the gonopodium in males), clear with a pale edge
  const pelvic = male
    ? { u0: 0.4, u1: 0.43, height: 0.055, sweep: 0.11, colorA: mix(flank, [0.92, 0.92, 0.88], 0.45), alpha: 0.5 }
    : { u0: 0.44, u1: 0.47, height: 0.06, sweep: 0.1, colorA: mix(flank, [0.88, 0.88, 0.84], 0.35), alpha: 0.42 };

  const pectoral = p.bigEar
    ? { length: 0.34, width: 0.11, colorA: mix([0.96, 0.92, 0.90], tail.colorA, 0.2), alpha: 0.78 }
    : { length: 0.17, width: 0.045, colorA: [0.9, 0.9, 0.86], alpha: 0.22 };

  return {
    artStyle: ART_STYLE_VERSION,
    sex: male ? 'male' : 'female',
    // body length (snout to peduncle), world units; females are much larger; fry start at about a third
    length: (male ? 1.0 : 1.5) * (0.12 + 0.88 * Math.min(1.1, grown)) * (0.88 + 0.24 * q('bodySize')),
    profile: PROFILES[male ? 'male' : 'female'],
    thickness: 0.5,
    colors: { dorsal, flank, belly },
    melanin: mel, reticulation: retic * mel, sheen: male ? 0.55 : 0.2,
    spots, gravid: !male ? 0.8 * mel * smooth(0.85, 1, grown) : 0,
    bodyPattern, snake, fullRed, koi, zebra, gold, glass, pink, tuxedo,
    eye: { u: male ? 0.085 : 0.08, y: 0.022, radius: 0.04,
      pupil: p.albino ? [0.75, 0.16, 0.2] : p.redEye ? [0.62, 0.06, 0.08] : p.lutino ? [0.36, 0.06, 0.10] : [0.03, 0.03, 0.04],
      // iris: silvery gold with a melanin-dark upper rim; without melanin it is pale pink
      iris: p.albino ? [0.96, 0.72, 0.70] : p.redEye || p.lutino ? [0.88, 0.80, 0.68] : p.bodyBase === 'golden' ? [0.86, 0.76, 0.50] : [0.80, 0.76, 0.58],
      irisDark: p.albino ? 0 : (p.redEye || p.lutino ? 0.25 : 0.8) * mel },
    tail, dorsalFin, anal, pelvic, pectoral,
    defect: p.spinalDefect ? 1 : 0,
    swim: { freq: male ? r(1.6, 2.1) : r(1.2, 1.5), amp: male ? r(0.05, 0.065) : r(0.04, 0.05), phase: r(0, Math.PI * 2) },
    seed: p.spotsSeed % 997,
  };
}
