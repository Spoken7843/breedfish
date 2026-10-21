// Plantel visual spike: guppies of real hobby varieties, each drawn from its genome in WebGL2,
// swimming around a painted tank, with an optional oil-painting post-process. The panel shows the
// phenotype; the genotype only appears behind the explicit development-lab switch (AGENTS rule 5).
//
// Two views: "catalog" shows a page of variety founders (10 males + 2 females); "plantel" is the fish
// room over time (core/tank.mjs): tanks and a pond with temperature, ration and capacity; fish grow,
// age, mate, store sperm and die; ornaments are quantitative and respond to selection rounds
// (core/selection.mjs). The fish room is saved in this browser.
// Reproducible scene: ?mode=cross&mom=koi&dad=snakeskin&seed=2026&broods=2&t=12&focus=-1&oil=1&r=6&res=0.5&rs=1
import { SPECIES } from '../../core/species.mjs';
import { phenotype } from '../../core/engine.mjs';
import { hashString } from '../../core/rng.mjs';
import { GUPPY_STRAINS, strainFounder, Y_ONLY_PATTERNS } from '../../core/strains.mjs';
import { fertility, lifeStage, sexOf } from '../../core/lifehistory.mjs';
import { addFish, advance as advanceWeeks, ageOf, breedAndWait, canMate, coi, createTank, cull, findAlive, gestationDays, knownParents, lengthMm,
  loadTank as loadTankSave, moveFish, nurseryOf, paternityTest, saveTank, setTank, tankById, tankLoad, WEEK } from '../../core/tank.mjs';
import { batch } from '../../core/engine.mjs';
import { packFish, peekSpecies, unpackFish } from '../../core/code.mjs';
import { batchStats, categoryCounts, predictOffspring, quantitativeTraits, selectTop } from '../../core/selection.mjs';
import { deduceCarriers, recessiveMarkers } from '../../core/deduce.mjs';
import { genotypeSummary } from '../../core/lab.mjs';
import { hobbyName } from './names.mjs';
import { createGL, program, target, msaaTarget, mat4 } from './gl.mjs';
import { guppyLook, ART_STYLE_VERSION } from './look.mjs';
import { buildFish, spineAt, SPINE_SAMPLES } from './fishmesh.mjs';
import { createSchool, advance } from './swim.mjs';
import { FULLSCREEN_VS, BACKGROUND_FS, BODY_VS, BODY_FS, FIN_VS, FIN_FS } from './shaders.mjs';
import { createOil } from './oil.mjs';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const num = (key, fallback) => (params.has(key) && Number.isFinite(Number(params.get(key))) ? Number(params.get(key)) : fallback);
const STRAIN = Object.fromEntries(GUPPY_STRAINS.map(s => [s.id, s]));
const PAGE_SIZE = 10;
const PAGES = Math.ceil(GUPPY_STRAINS.length / PAGE_SIZE);
const MAX_SWIMMING = 20;      // fish drawn in the aquarium; the list holds the whole tank
const MAX_FRY_SWIMMING = 6;
const LIST_STEP = 40;
const FOUNDER_AGE = 150;      // days: founders are bought as young adults (TBD)
const SAVE_KEY = 'plantel.guppy.tank.v1';

const state = {
  mode: params.get('mode') === 'cross' || params.get('mode') === 'plantel' ? 'plantel' : 'catalog',
  page: Math.min(PAGES - 1, Math.max(0, num('page', 0))),
  mom: STRAIN[params.get('mom')] ? params.get('mom') : 'koi',
  dad: STRAIN[params.get('dad')] ? params.get('dad') : 'snakeskin',
  seed: num('seed', 2026) >>> 0,
  frozenT: params.has('t') ? num('t', 0) : null,
  focus: num('focus', -1),
  oil: params.get('oil') !== '0',
  radius: Math.min(8, Math.max(2, num('r', 6))),
  texture: Math.min(1, Math.max(0, num('tex', 0.75))),
  scale: [1, 0.75, 0.5].includes(num('res', 0)) ? num('res', 0.5) : 0.5,   // filter resolution
  renderScale: [1, 0.75, 0.5].includes(num('rs', 0)) ? num('rs', 1) : 1,   // scene resolution
  auto: !params.has('res') && !params.has('rs') && !params.has('oil'),
  paused: false,
  time: 0,
};

const species = SPECIES.guppy;
const LH = species.lifeHistory;
const FOV = (30 * Math.PI) / 180, BASE_DIST = 13.4;

// ---------- GL setup ----------
const canvas = $('stage');
let gl, floatRT;
try { ({ gl, floatRT } = createGL(canvas)); } catch (e) { fail(e); throw e; }
const progs = {
  bg: program(gl, FULLSCREEN_VS, BACKGROUND_FS, 'background'),
  body: program(gl, BODY_VS, BODY_FS, 'body'),
  fin: program(gl, FIN_VS, FIN_FS, 'fin'),
};
// Which GPU is drawing. Software rasterizers (SwiftShader, llvmpipe, Microsoft Basic Render) mean the
// browser has no hardware acceleration: start light instead of freezing the tab.
const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
const RENDERER = String(dbgInfo ? gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
const SOFTWARE_GL = /swiftshader|llvmpipe|software|basic render/i.test(RENDERER);
if (SOFTWARE_GL && state.auto) { state.oil = false; state.renderScale = 0.5; }
const emptyVao = gl.createVertexArray();
const oil = createOil(gl, floatRT);
let scene = null, msaa = null;
const camera = { eye: [0, 0.1, BASE_DIST], at: [0, 0.1, 0] };
let fishes = [], school = null;

function fail(e) {
  $('error').hidden = false;
  $('error').textContent = 'Não foi possível iniciar o WebGL2: ' + e.message;
}

// ---------- the breeding tank (plantel) ----------
let tank = null;
const breeding = { motherId: null, fatherId: null };
let lastEvent = '';

const done = new Set();   // challenges completed in this fish room

function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ tank: saveTank(species, tank), breeding, done: [...done] })); } catch { /* storage unavailable: the tank lives for this visit */ }
}
function restore() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    tank = loadTankSave(species, data.tank);
    breeding.motherId = findAlive(tank, data.breeding?.motherId) ? data.breeding.motherId : null;
    breeding.fatherId = findAlive(tank, data.breeding?.fatherId) ? data.breeding.fatherId : null;
    for (const id of data.done ?? []) done.add(id);
    return true;
  } catch { return false; }
}

/** Buy a founder of a strain into the tank (a young adult); ids look like koi-F1, snakeskin-M2. */
function buyFounder(strainId, sex) {
  const s = STRAIN[strainId], tag = sex === 'male' ? 'M' : 'F';
  let n = 1;
  while (tank.registry[`${s.id}-${tag}${n}`]) n++;
  return addFish(species, tank, strainFounder(s, sex, `${s.id}-${tag}${n}`), FOUNDER_AGE);
}
function newTank() {
  tank = createTank(species, { seed: state.seed });
  breeding.motherId = buyFounder(state.mom, 'female').id;
  breeding.fatherId = buyFounder(state.dad, 'male').id;
}
const fixedScene = ['mom', 'dad', 'seed', 'broods'].some(k => params.has(k));
const firstVisit = !fixedScene && !restore();
if (fixedScene || firstVisit) newTank();
for (let i = 0; i < Math.min(30, num('broods', 0)); i++) {
  const r = breedAndWait(species, tank, breeding.motherId, breeding.fatherId);
  if (!r.ok) advanceWeeks(species, tank, 4);
}

const strainOf = fish => (fish.generation === 0 ? STRAIN[fish.id.split('-')[0]] : null);

// ---------- phenotype, names and what the breeder can read ----------
const T = species.traits;
const markers = recessiveMarkers(species);
const fmtAge = d => {
  if (d < 30) return `${d} ${d === 1 ? 'dia' : 'dias'}`;
  const months = Math.floor(d / 30.44);
  if (months < 12) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  const y = Math.floor(months / 12), m = months % 12;
  return `${y} ${y === 1 ? 'ano' : 'anos'}${m ? ` e ${m} ${m === 1 ? 'mês' : 'meses'}` : ''}`;
};
const pct = x => `${Math.round(x * 100)}%`;
const genLabel = g => (g === 0 ? 'fundador' : `F${g}`);
const STAGE = { alevino: 'alevino', jovem: 'jovem', adulto: 'adulto', idoso: 'idoso' };

function varietySummary(p) {
  const parts = [];
  if (p.bodyPattern !== 'none') parts.push(T.bodyPattern.labels[p.bodyPattern]);
  if (p.tuxedo) parts.push('Tuxedo');
  if (p.tailPattern !== 'none') parts.push('cauda ' + T.tailPattern.labels[p.tailPattern].toLowerCase());
  if (p.tailColor !== 'natural') parts.push('cauda ' + T.tailColor.labels[p.tailColor].toLowerCase());
  parts.push(T.tailShape.labels[p.tailShape]);
  if (p.albino) parts.push('Albino');
  else if (p.redEye) parts.push('Olho vermelho');
  else if (p.lutino) parts.push('Lutino');
  else if (p.bodyBase !== 'grey') parts.push(T.bodyBase.labels[p.bodyBase]);
  if (p.blau !== 'none') parts.push(T.blau.labels[p.blau]);
  if (p.noOrange) parts.push('Blue');
  if (p.pattern && p.bodyPattern === 'none') parts.push('manchas selvagens');
  if (p.bigEar) parts.push('Dumbo ear');
  if (p.spinalDefect) parts.push('coluna torta');
  return parts.join(' · ');
}

/** What a breeder sees in fry: eye and body colour only. */
function fryLooks(p) {
  if (p.albino) return 'Olho vermelho (albino)';
  if (p.redEye) return 'Olho vermelho';
  if (p.lutino) return 'Olho vinho (lutino)';
  if (p.bodyBase !== 'grey') return `Corpo ${T.bodyBase.labels[p.bodyBase].toLowerCase()}`;
  return p.noOrange ? 'Corpo azulado' : '';
}

// Discrete traits a fish can show; "characteristics" for the ranking count the non-default ones.
const RANKED = Object.entries(T).filter(([k, t]) => t.type !== 'number' && t.label && !['pattern', 'spinalDefect'].includes(k));
const characteristics = p => RANKED.filter(([k, t]) => p[k] !== t.default).length - (p.spinalDefect ? 1 : 0);

// Goal chips: any labelled trait value, plus "no spinal defect".
const GOALS = [];
for (const [k, t] of Object.entries(T)) {
  if (t.type === 'number' || !t.label || k === 'spinalDefect') continue;
  if (t.type === 'bool') GOALS.push({ key: `${k}=true`, trait: k, value: true, group: 'Outros', label: t.label });
  else for (const o of t.options) if (o !== t.default) GOALS.push({ key: `${k}=${o}`, trait: k, value: o, group: t.label, label: `${t.label}: ${t.labels?.[o] ?? o}` });
}
GOALS.push({ key: 'spinalDefect=false', trait: 'spinalDefect', value: false, group: 'Outros', label: 'Sem defeito de coluna' });
// Quantitative ornaments a breeder measures (0-100 in the UI) and their short names.
const QUANT = quantitativeTraits(species).filter(k => !['saturation', 'luminance'].includes(k));
const SHORT = { tailSize: 'cauda', tailSpread: 'abertura', dorsalSize: 'dorsal', colorCoverage: 'cor', bodySize: 'porte' };
const n100 = x => Math.round(x * 100);
for (const k of QUANT) for (const min of [0.5, 0.6, 0.7, 0.8]) GOALS.push({ key: `${k}>=${min}`, trait: k, min, group: 'Medidas (mínimo)', label: `${T[k].label} ≥ ${n100(min)}` });
const GOAL = Object.fromEntries(GOALS.map(g => [g.key, g]));

const view = { tank: '', sex: '', age: '', goals: [], onlyGoal: false, sort: 'new', lab: false, shown: LIST_STEP, cullArmed: false, resetArmed: false,
  sel: { by: 'goal', scope: 'adult', keep: 0.2, action: 'cull', armed: false }, sample: 1 };
const tankName = id => tank.tanks.find(t => t.id === id)?.name ?? id;

// Traits a breeder can already read in fry (eye and body colour); fins and patterns come later.
const FRY_VISIBLE = new Set(['albino', 'redEye', 'lutino', 'bodyBase', 'noOrange']);

/** Goal match for one fish: sex-limited traits do not count for females (they cannot show them), and
 *  fry are judged only on what fry show. */
function goalScore(p, fry = false) {
  let hit = 0, applicable = 0;
  for (const key of view.goals) {
    const g = GOAL[key];
    if (fry && !FRY_VISIBLE.has(g.trait)) continue;
    if (T[g.trait].sexLimited && T[g.trait].sexLimited !== p.observedSex) continue;
    applicable++;
    if (g.min !== undefined ? p[g.trait] >= g.min : p[g.trait] === g.value) hit++;
  }
  return { hit, applicable, all: applicable > 0 && hit === applicable };
}

function plantelEntries() {
  const ph = new Map();
  const phenoOf = id => {
    if (ph.has(id)) return ph.get(id);
    const r = tank.registry[id];
    if (!r) return null;
    if (!r.fish) { ph.set(id, r.stub ?? null); return r.stub ?? null; }   // pruned: only the markers it showed
    const alive = !r.fate;
    const p = phenotype(species, r.fish, { ageDays: alive ? Math.max(0, ageOf(tank, r.fish)) : 200, growth: alive ? r.fish.growth : null, environment: r.fish.env });
    ph.set(id, p);
    return p;
  };
  const children = new Map();
  for (const r of Object.values(tank.registry)) for (const pid of knownParents(tank, r.id) ?? []) if (pid) (children.get(pid) ?? children.set(pid, []).get(pid)).push(r.id);
  // the breeder only knows fathers that are certain (or tested)
  const ctx = { phenotypeOf: phenoOf, parentsOf: id => knownParents(tank, id), childrenOf: id => children.get(id) ?? [] };
  return tank.alive.map(fish => {
    const p = phenoOf(fish.id), age = ageOf(tank, fish), sex = sexOf(fish), stage = lifeStage(species, sex, age);
    const strain = strainOf(fish);
    const name = stage === 'alevino' ? 'Alevino' : (strain ? strain.name : hobbyName(p));
    // fry cannot be judged yet: no characteristics and no goal score until the sex shows
    const fry = stage === 'alevino';
    return { fish, p, age, sex, stage, name, fert: fertility(species, sex, age), chars: fry ? 0 : characteristics(p), len: lengthMm(species, fish),
      goal: goalScore(p, fry),
      carriers: deduceCarriers(markers, fish.id, ctx) };
  });
}

/** A measure the breeder can take: fins of fry are not readable yet. */
const measure = (e, k) => (e.stage === 'alevino' ? -1 : e.p[k]);

function visibleEntries(entries) {
  let list = entries.filter(e => (!view.tank || e.fish.tankId === view.tank)
    && (!view.sex || (e.stage !== 'alevino' && e.sex === view.sex))
    && (!view.age || (view.age === 'young' ? ['alevino', 'jovem'].includes(e.stage) : e.stage === view.age))
    && (!view.onlyGoal || !view.goals.length || e.goal.all));
  const byNew = (a, b) => a.age - b.age || a.fish.id.localeCompare(b.fish.id);
  const sorters = {
    goal: (a, b) => b.goal.hit - a.goal.hit || Number(b.goal.all) - Number(a.goal.all) || b.chars - a.chars || byNew(a, b),
    chars: (a, b) => b.chars - a.chars || byNew(a, b),
    new: byNew,
    old: (a, b) => -byNew(a, b),
    // a random sample, stable until the breeder asks for another one
    random: (a, b) => hashString(a.fish.id + ':' + view.sample) - hashString(b.fish.id + ':' + view.sample),
    ...Object.fromEntries(QUANT.map(k => [`q:${k}`, (a, b) => measure(b, k) - measure(a, k) || byNew(a, b)])),
  };
  list = [...list].sort(sorters[view.sort] ?? byNew);
  return list;
}

// ---------- tank contents (what swims) ----------
let entriesCache = [], listCache = [];

function tankMembers() {
  if (state.mode === 'catalog') {
    const strains = GUPPY_STRAINS.slice(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE);
    const males = strains.map(s => ({ fish: strainFounder(s, 'male', `${s.id}-M`, hashString(`${s.id}:M:${state.seed}`)), name: s.name, note: s.note, strain: s }));
    const females = [strains[Math.min(1, strains.length - 1)], strains[Math.min(7, strains.length - 1)]].map(s => ({
      fish: strainFounder(s, 'female', `${s.id}-F`, hashString(`${s.id}:F:${state.seed}`)), name: `${s.name} (fêmea)`, strain: s,
      note: Y_ONLY_PATTERNS.has(s.y)
        ? 'Fêmea da linhagem: maior, mais cinza, com a cor de cauda da linhagem. O padrão desta variedade é só do Y: passa de pai para filho, a fêmea não carrega.'
        : 'Fêmea da linhagem: maior, mais cinza, com a cor de cauda da linhagem. Ela carrega o padrão da variedade no X, sem mostrar, e passa para os filhos machos.',
    }));
    return [...males, ...females].map(m => ({ ...m, p: phenotype(species, m.fish) }));
  }
  entriesCache = plantelEntries();
  listCache = visibleEntries(entriesCache);
  // The aquarium follows the list order but keeps fry to a few, so a fresh brood does not hide the
  // adults; the focused fish always swims.
  const grown = listCache.filter(e => e.stage !== 'alevino'), fry = listCache.filter(e => e.stage === 'alevino');
  const fryShown = Math.min(fry.length, Math.max(MAX_FRY_SWIMMING, MAX_SWIMMING - grown.length));
  const pickedFry = new Set(fry.slice(0, fryShown));
  const show = listCache.filter(e => e.stage !== 'alevino' || pickedFry.has(e)).slice(0, MAX_SWIMMING);
  if (state.focusId && !show.some(e => e.fish.id === state.focusId)) {
    const focused = entriesCache.find(e => e.fish.id === state.focusId);
    if (focused) show[show.length === MAX_SWIMMING ? MAX_SWIMMING - 1 : show.length] = focused;
  }
  return show.map(e => ({ fish: e.fish, name: e.name, p: e.p, entry: e }));
}

function loadTank() {
  fishes.forEach(f => f.geo.dispose());
  fishes = tankMembers().map((m, index) => {
    const look = guppyLook(m.p);
    return { ...m, look, geo: buildFish(gl, look), spine: new Float32Array(SPINE_SAMPLES * 4), index };
  });
  if (state.mode === 'plantel') state.focus = state.focusId ? fishes.findIndex(f => f.fish.id === state.focusId) : -1;
  if (state.focus >= fishes.length) state.focus = -1;
  school = createSchool(fishes, state.seed);
  school.focus = state.focus;
  state.time = 0;
  renderList();
  syncControls();
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * state.renderScale;
  const w = Math.max(320, Math.round(canvas.clientWidth * dpr)), h = Math.max(180, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h || !scene) {
    canvas.width = w; canvas.height = h;
    scene?.dispose(); msaa?.dispose();
    scene = target(gl, w, h);
    msaa = msaaTarget(gl, w, h, 4);
  }
}

// ---------- rendering ----------
function updateCamera(dt) {
  let eye, at;
  const aspect = canvas.width / canvas.height;
  const sw = state.focus >= 0 ? school.swimmers[state.focus] : null;
  if (sw) {
    const L = sw.fish.look;
    const total = L.length * (1 + L.tail.length);
    const dist = Math.max(2.4 * Math.min(1, L.length / 0.9), total / 0.6 / (2 * Math.tan(FOV / 2) * aspect));
    at = [sw.pos[0], sw.pos[1], sw.pos[2]];
    // stay broadside: look along the fish's flank normal, on whichever side the camera already is
    const side = [Math.sin(sw.yaw), Math.cos(sw.yaw)];
    const sgn = side[0] * (camera.eye[0] - at[0]) + side[1] * (camera.eye[2] - at[2]) >= 0 ? 1 : -1;
    eye = [at[0] + side[0] * sgn * dist, at[1] + 0.12, at[2] + side[1] * sgn * dist];
  } else { eye = [0, 0.1, BASE_DIST]; at = [0, 0.1, 0]; }
  const k = dt === null ? 1 : 1 - Math.exp(-dt * 2.5);
  for (let i = 0; i < 3; i++) { camera.eye[i] += (eye[i] - camera.eye[i]) * k; camera.at[i] += (at[i] - camera.at[i]) * k; }
}

function fishFrame(f, t) {
  const sw = school.swimmers[f.index];
  const model = mat4.model(sw.pos, sw.yaw, sw.pitch, 1, 1);
  spineAt(f.look, f.geo, sw.phase, 0.55 + 0.6 * sw.effort, sw.yawRate, f.spine);
  return { sw, model, normalMat: mat4.normalFromModel(model, 1), t };
}

function common(prog, f, fr, viewProj) {
  return prog.m4('uViewProj', viewProj).m4('uModel', fr.model).m3('uNormalMat', fr.normalMat).v4('uSpine', f.spine)
    .f('uCam', ...camera.eye).f('uFogColor', 0.12, 0.25, 0.24).f('uFogRange', BASE_DIST - 1.5, BASE_DIST + 4.5)
    .f('uTime', fr.t).f('uSeed', f.look.seed).f('uChroma', 0.55 + f.p.saturation).f('uMelanin', f.look.melanin)
    .f('uBrush', state.oil ? state.texture : 0);
}

function drawBody(f, fr, viewProj) {
  const L = f.look, body = progs.body.use();
  common(body, f, fr, viewProj);
  const spotA = new Float32Array(32), spotB = new Float32Array(32);
  L.spots.slice(0, 8).forEach((s, i) => { spotA.set([s.u, s.v, s.radius, s.kind], i * 4); spotB.set([s.hue, s.stretch, 0, 0], i * 4); });
  body.f('uLb', L.length).v3('uDorsal', L.colors.dorsal).v3('uFlank', L.colors.flank).v3('uBelly', L.colors.belly)
    .f('uRetic', L.reticulation).f('uSheen', L.sheen).f('uGravid', L.gravid).f('uSex', L.sex === 'male' ? 1 : 0)
    .v4('uSpotA', spotA).v4('uSpotB', spotB).i('uSpotCount', Math.min(8, L.spots.length))
    .f('uEye', L.eye.u, L.eye.y, L.eye.radius, 0).v3('uPupil', L.eye.pupil)
    .i('uPat', L.bodyPattern.id).v3('uPatA', L.bodyPattern.colA).v3('uPatB', L.bodyPattern.colB).f('uMetal', L.bodyPattern.metal)
    .f('uTux', L.tuxedo.amount).v3('uTuxColor', L.tuxedo.color);
  body.f('uSide', 1); f.geo.body.draw();
  body.f('uSide', -1); f.geo.body.draw();
}

function drawFins(f, fr, viewProj) {
  const L = f.look, sw = fr.sw, fin = progs.fin.use();
  common(fin, f, fr, viewProj);
  const hover = 1 - Math.min(1, sw.effort);
  fin.f('uFlutPhase', sw.phase * 1.3).f('uPecBeta', 0.55 + (0.22 + 0.25 * hover) * Math.sin(fr.t * 2 * Math.PI * 2.2 + L.swim.phase));
  const draw = (geo, F, kind, side = 1) => {
    fin.v3('uColA', F.colorA).v3('uColB', F.colorB ?? F.colorA).f('uAlpha', F.alpha).f('uSpeckle', F.speckle ?? 0)
      .f('uBorder', F.border ?? 0).f('uIri', F.iridescence ?? 0.1).i('uKind', kind)
      .i('uTailPat', F.pattern ?? 0).v3('uPatDark', F.patDark ?? [0, 0, 0]).v3('uPatLight', F.patLight ?? F.colorA)
      .i('uSword', F.sword ?? 0).f('uSide', side);
    geo.draw();
  };
  // which flank faces the camera: the fish's local +z axis is column 2 of the model matrix
  const m = fr.model, toCam = [camera.eye[0] - m[12], camera.eye[1] - m[13], camera.eye[2] - m[14]];
  const near = m[8] * toCam[0] + m[9] * toCam[1] + m[10] * toCam[2] >= 0 ? 1 : -1;
  draw(f.geo.pectoral, L.pectoral, 3, -near);
  draw(f.geo.caudal, L.tail, 0);
  draw(f.geo.dorsal, L.dorsalFin, 1);
  draw(f.geo.anal, L.anal, 2);
  draw(f.geo.pectoral, L.pectoral, 3, near);
}

function render(t, dt) {
  resize();
  advance(school, t, () => { const s = createSchool(fishes, state.seed); s.focus = state.focus; return s; });
  school.focus = state.focus;
  updateCamera(dt);
  const aspect = canvas.width / canvas.height;
  const viewProj = mat4.mul(mat4.perspective(FOV, aspect, 0.1, 60), mat4.lookAt(camera.eye, camera.at, [0, 1, 0]));

  gl.bindFramebuffer(gl.FRAMEBUFFER, msaa.fbo);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  const zoom = BASE_DIST / Math.max(2, camera.eye[2] - camera.at[2]);
  progs.bg.use().f('uTime', t).f('uRes', canvas.width, canvas.height)
    .f('uPan', camera.at[0] * 0.035, camera.at[1] * 0.035).f('uZoom', 1 + (zoom - 1) * 0.25);
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // ?solo=1 with a focus draws only that fish (specimen captures)
  const frames = fishes.filter(f => !SOLO || f.index === state.focus).map(f => [f, fishFrame(f, t)]);
  // opaque bodies with depth, then translucent fins back to front
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(true);
  for (const [f, fr] of frames) drawBody(f, fr, viewProj);
  const dist = fr => Math.hypot(camera.eye[0] - fr.model[12], camera.eye[1] - fr.model[13], camera.eye[2] - fr.model[14]);
  frames.sort((a, b) => dist(b[1]) - dist(a[1]));
  gl.enable(gl.BLEND);
  // colour blends normally; alpha accumulates fin coverage into the fish mask
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  for (const [f, fr] of frames) drawFins(f, fr, viewProj);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  msaa.resolveTo(scene);
  oil.apply(scene, { enabled: state.oil, radius: state.radius, scale: state.scale, stroke: state.texture, impasto: state.texture, canvas: state.texture });
}

// ---------- loop ----------
let last = null, fpsFrames = 0, fpsSince = 0;
const started = performance.now();
// Frame cost is measured directly (render + wait for the GPU) every few frames. Unlike the frame
// rate, it is not distorted when the browser throttles a background window or tab.
const pixel = new Uint8Array(4);
let frameNo = 0, frameCost = null;
function timedRender(t, dt) {
  const t0 = performance.now();
  render(t, dt);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return performance.now() - t0;
}
function loop(now) {
  const rawDt = last === null ? 0 : (now - last) / 1000;
  const dt = last === null ? null : Math.min(0.1, rawDt);
  last = now;
  if (!state.paused && dt !== null) state.time += dt;
  const t = state.frozenT ?? state.time;
  const camDt = state.frozenT !== null ? null : dt;
  try {
    if (frameNo++ % 12 === 0 || rawDt > 0.1) {
      const cost = timedRender(t, camDt);
      frameCost = frameCost === null ? cost : frameCost * 0.5 + cost * 0.5;
      autoQuality(cost);
    } else render(t, camDt);
  } catch (e) { fail(e); throw e; }
  fpsFrames++;
  if (now - fpsSince > 1000) {
    const fps = (fpsFrames * 1000) / (now - fpsSince);
    const budget = frameCost === null ? '' : ` · quadro ${frameCost.toFixed(1)} ms (até ${Math.min(999, Math.round(1000 / frameCost))} FPS)`;
    const away = document.visibilityState === 'visible' ? '' : ' · em segundo plano';
    $('fps').textContent = `${Math.round(fps)} FPS${budget} · ${canvas.width}×${canvas.height} · ${state.oil ? `filtro ${Math.round(state.scale * 100)}%` : 'sem filtro'}${away}`;
    fpsFrames = 0; fpsSince = now;
  }
  window.__plantelFrames = (window.__plantelFrames ?? 0) + 1;
  // ?still=1 renders a single frame (for scripted, reproducible captures) and stops the loop.
  if (!STILL) requestAnimationFrame(loop);
}
const STILL = params.get('still') === '1';
const SOLO = params.get('solo') === '1';

// While the user has not picked settings, step down until the frame cost holds: filter at 50%,
// then scene resolution 75% and 50%, then the filter off.
const LADDER = [
  { scale: 0.5, renderScale: 1, oil: true },
  { scale: 0.5, renderScale: 0.75, oil: true },
  { scale: 0.5, renderScale: 0.5, oil: true },
  { scale: 0.5, renderScale: 0.5, oil: false },
];
let slowSamples = 0, lastStep = 0;
function stepDown() {
  if (!state.auto || state.frozenT !== null || state.paused) return;
  const now = performance.now();
  if (now - lastStep < 1200) return;
  const i = LADDER.findIndex(l => l.scale === state.scale && l.renderScale === state.renderScale && l.oil === state.oil);
  if (i === LADDER.length - 1) return;
  Object.assign(state, LADDER[Math.min(LADDER.length - 1, i + 1)]);
  $('res').value = String(state.scale);
  $('oil').checked = state.oil;
  lastStep = now; slowSamples = 0;
}
// cost in ms of one rendered frame; 25 ms = 40 FPS. A frame over 120 ms steps down at once.
function autoQuality(cost) {
  if (performance.now() - started < 2500) return;
  if (cost > 120) { stepDown(); return; }
  slowSamples = cost > 25 ? slowSamples + 1 : 0;
  if (slowSamples >= 3) stepDown();
}

// ---------- UI ----------
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(c => c !== null && c !== undefined && c !== false));
  return node;
};

function setParent(fish) {
  if (sexOf(fish) === 'male') breeding.fatherId = fish.id; else breeding.motherId = fish.id;
  persist();
}

function catalogCard(f, i) {
  const isMale = f.p.observedSex === 'male';
  const portrait = el('button', { type: 'button', textContent: state.focus === i ? 'Voltar' : 'Retrato' });
  portrait.addEventListener('click', () => { state.focus = state.focus === i ? -1 : i; school.focus = state.focus; renderList(); });
  const use = el('button', { type: 'button', className: 'use', textContent: isMale ? 'Comprar como pai' : 'Comprar como mãe' });
  use.addEventListener('click', () => {
    const bought = buyFounder(f.strain.id, isMale ? 'male' : 'female');
    setParent(bought);
    lastEvent = `${bought.id} entrou no plantel (${fmtAge(FOUNDER_AGE)}) e é ${isMale ? 'o pai' : 'a mãe'} do casal.`;
    syncControls();
  });
  return el('li', { className: state.focus === i ? 'active' : '' },
    el('div', { className: 'fish-head' }, el('strong', { textContent: `${isMale ? '♂' : '♀'} ${f.name}` }), portrait),
    el('p', { textContent: `${hobbyName(f.p)} — ${varietySummary(f.p)}` }),
    use,
    f.note ? el('details', { className: 'card-more' }, el('summary', { textContent: 'Sobre a variedade' }), el('p', { className: 'note', textContent: f.note })) : null);
}

/** What the breeder knows about a female's reproduction (never whether a male was sterile). */
function femaleStatus(fish, e) {
  if (e.stage === 'alevino') return '';
  if (fish.pregnancy) return `Prenhe: pare em ${Math.max(0, fish.pregnancy.dueDay - tank.day)} dias.`;
  if (!fish.matedWith.length) return 'Virgem.';
  const males = fish.sperm.map(x => x.maleId);
  if (!males.length) return `Acasalou com ${fish.matedWith.join(', ')}; o esperma guardado acabou.`;
  const since = tank.day - Math.max(fish.lastBirthDay ?? -Infinity, Math.min(...fish.sperm.map(x => x.day)));
  const late = e.stage !== 'jovem' && since > 6 * WEEK ? ` Sem ninhada há ${Math.floor(since / WEEK)} semanas: macho ou fêmea estéril?` : '';
  return `Guarda esperma de ${males.join(', ')}.${late}`;
}

function fatherLine(fish) {
  const r = tank.registry[fish.id];
  if (!r.parents) return null;
  if (r.motherKnown === false) return el('p', { className: 'note', textContent: 'Pais desconhecidos: nasceu solto no lago.' });
  if (r.fatherKnown) return el('p', { className: 'note', textContent: `Pais: ${r.parents[0]} × ${r.parents[1]}` });
  const odds = r.fatherCandidates.map(([id, w]) => `${id} ${Math.round(w * 100)}%`).join(' · ');
  const test = el('button', { type: 'button', className: 'use ghost', textContent: 'Teste de paternidade' });
  test.addEventListener('click', () => {
    const father = paternityTest(tank, fish.id);
    lastEvent = `Teste de paternidade de ${fish.id}: o pai é ${father}.`;
    persist(); refresh();
  });
  return el('div', { className: 'father' }, el('p', { className: 'note', textContent: `Mãe ${r.parents[0]}; pai incerto: ${odds}` }), test);
}

/** Pedigree as far as the breeder knows it: parents and grandparents, expandable (GDD: navigable tree). */
function pedigreeTree(id, depth = 3) {
  const node = pid => {
    const r = tank.registry[pid];
    const alive = r && !r.fate;
    const label = !r ? `${pid} (sem registro)` : `${pid}${r.fate ? ` · ${r.fate}` : ''}${r.fish ? ` · ${hobbyName(phenotype(species, r.fish, { environment: r.fish.env }))}` : ''}`;
    const li = el('li', {}, alive ? (() => {
      const b = el('button', { type: 'button', className: 'link', textContent: label });
      b.addEventListener('click', () => { state.focusId = pid; view.tank = ''; refresh(); });
      return b;
    })() : el('span', { textContent: label }));
    return li;
  };
  const walk = (pid, d) => {
    const parents = knownParents(tank, pid);
    if (!parents || d === 0) return null;
    const ul = el('ul');
    ['♀', '♂'].forEach((sexMark, i) => {
      const parentId = parents[i];
      const li = parentId ? node(parentId) : el('li', { textContent: `${sexMark} desconhecido` });
      if (parentId) { li.prepend(`${sexMark} `); const sub = walk(parentId, d - 1); if (sub) li.append(sub); }
      ul.append(li);
    });
    return ul;
  };
  const tree = walk(id, depth);
  if (!tree) return null;
  return el('details', { className: 'pedigree' }, el('summary', { textContent: 'Pedigree' }), tree);
}

/** Measured ornaments and length, 0-100 like a judge's sheet. */
function measuresLine(e) {
  if (e.stage === 'alevino') return null;
  const parts = QUANT.filter(k => k !== 'bodySize').map(k => `${SHORT[k]} ${n100(e.p[k])}`);
  if (e.len) parts.push(`${Math.round(e.len)} mm`);
  return el('p', { className: 'measures', textContent: parts.join(' · ') });
}

/** Copy a fish's code (whole genome + developmental seed): whoever pastes it gets the same fish. */
function shareButton(fish) {
  const b = el('button', { type: 'button', className: 'use ghost', textContent: 'Código', title: 'Copiar o código deste peixe para mandar a alguém' });
  b.addEventListener('click', async () => {
    const code = packFish(fish);
    $('import-code').value = code;
    try { await navigator.clipboard.writeText(code); lastEvent = `Código de ${fish.id} copiado. Quem colar em "Importar peixe" recebe exatamente este peixe.`; }
    catch { $('import-code').select(); lastEvent = `O código de ${fish.id} está no campo "Importar peixe": copie de lá e mande.`; }
    syncControls();
  });
  return b;
}

// ---------- challenges: goals for a new breeder, checked against the fish room ----------
const born = () => Object.values(tank.registry).filter(r => r.fish && r.fish.generation >= 1 && r.fish.origin !== 'external');
const bornPheno = r => phenotype(species, r.fish, { environment: r.fish.env });
const isAdultMale = f => sexOf(f) === 'male' && ageOf(tank, f) >= LH.maturityDays.male;
const CHALLENGES = [
  { id: 'brood', title: 'Primeira ninhada', text: 'Cruze um casal e veja os filhotes nascerem.', test: () => born().length > 0 },
  { id: 'albino', title: 'O albino escondido', text: 'Faça nascer um albino de pai e mãe que não são albinos (os dois portadores).',
    test: () => born().some(r => bornPheno(r).albino && r.parents.every(id => { const pr = tank.registry[id]; return pr?.fish && !phenotype(species, pr.fish).albino; })) },
  { id: 'sexes', title: 'Berçário em ordem', text: 'Separe por sexo uma ninhada antes que ela cruze sozinha.', test: () => tank.alive.some(f => f.generation >= 1 && (f.tankId === 'machos' || f.tankId === 'femeas')) },
  { id: 'line', title: 'Linhagem fixada', text: 'Tenha 8 machos adultos F2 ou mais, nascidos aqui, todos com o mesmo padrão de corpo.',
    test: () => { const c = categoryCounts(tank.alive.filter(f => isAdultMale(f) && f.generation >= 2 && f.origin !== 'external').map(f => phenotype(species, f).bodyPattern).filter(v => v !== 'none')); return (c[0]?.[1] ?? 0) >= 8; } },
  { id: 'show', title: 'Cauda de exposição', text: 'Crie um macho com cauda ≥ 85 e cor ≥ 85.',
    test: () => tank.alive.some(f => isAdultMale(f) && f.generation >= 1 && f.origin !== 'external' && (p => p.tailSize >= 0.85 && p.colorCoverage >= 0.85)(phenotype(species, f))) },
  { id: 'pond', title: 'Seleção no lago', text: 'Leve a média da cauda dos machos adultos do Lago a 60 ou mais (com pelo menos 10 machos).',
    test: () => { const m = tank.alive.filter(f => f.tankId === 'lago' && isAdultMale(f)); return m.length >= 10 && m.reduce((a, f) => a + phenotype(species, f).tailSize, 0) / m.length >= 0.6; } },
];
function renderChallenges() {
  for (const c of CHALLENGES) if (!done.has(c.id) && c.test()) { done.add(c.id); lastEvent = `${lastEvent ? lastEvent + ' ' : ''}Desafio cumprido: ${c.title}!`; persist(); }
  $('challenges-count').textContent = `${done.size}/${CHALLENGES.length}`;
  $('challenges').replaceChildren(...CHALLENGES.map(c => el('li', { className: done.has(c.id) ? 'done' : '' },
    el('b', { textContent: `${done.has(c.id) ? '✓' : '○'} ${c.title}` }), el('span', { textContent: ` ${c.text}` }))));
}

function plantelCard(e) {
  const { fish, p } = e;
  const swimming = fishes.find(f => f.fish.id === fish.id);
  const focused = state.focusId === fish.id;
  const fry = e.stage === 'alevino';
  const sexMark = fry ? '·' : e.sex === 'male' ? '♂' : '♀';
  const portrait = el('button', { type: 'button', textContent: focused ? 'Voltar' : 'Retrato' });
  portrait.addEventListener('click', () => { state.focusId = focused ? null : fish.id; loadTank(); });
  const goal = view.goals.length && e.goal.applicable ? ` · meta ${e.goal.hit}/${e.goal.applicable}` : '';
  const info = `${tankName(fish.tankId)} · ${fmtAge(e.age)} · ${STAGE[e.stage]}${fry ? '' : ` · fertilidade ${pct(e.fert)}`} · ${fish.origin === 'external' ? 'importado' : genLabel(fish.generation ?? 0)}${fry ? '' : ` · ${e.chars} caract.`}${goal}`;
  const isParent = fish.id === breeding.motherId || fish.id === breeding.fatherId;
  const use = el('button', { type: 'button', className: 'use',
    textContent: isParent ? (e.sex === 'male' ? 'É o pai' : 'É a mãe') : (e.sex === 'male' ? 'Usar como pai' : 'Usar como mãe') });
  use.disabled = isParent || fry;
  if (fry) use.title = `O sexo aparece com ${LH.sexingDays} dias`;
  use.addEventListener('click', () => { setParent(fish); renderList(); syncControls(); });
  const drop = el('button', { type: 'button', className: 'use ghost', textContent: 'Descartar' });
  drop.addEventListener('click', () => {
    cull(tank, [fish.id]);
    if (isParent) { if (breeding.motherId === fish.id) breeding.motherId = null; if (breeding.fatherId === fish.id) breeding.fatherId = null; }
    lastEvent = `${fish.id} foi descartado.`;
    persist(); refresh();
  });
  const move = el('select', { className: 'move', title: 'Mover para outro aquário' },
    el('option', { value: '', textContent: 'Mover para…' }),
    ...tank.tanks.filter(t => t.id !== fish.tankId).map(t => el('option', { value: t.id, textContent: t.name })));
  move.addEventListener('change', ev => {
    if (!ev.target.value) return;
    moveFish(tank, [fish.id], ev.target.value);
    lastEvent = `${fish.id} foi para ${tankName(ev.target.value)}.`;
    persist(); refresh();
  });
  const conf = e.carriers.confirmed.map(m => m.label), poss = e.carriers.possible.map(m => m.label);
  const status = e.sex === 'female' ? femaleStatus(fish, e) : '';
  return el('li', { className: `${focused ? 'active' : ''}${isParent ? ' parent-pick' : ''}` },
    el('div', { className: 'fish-head' },
      el('strong', { textContent: `${sexMark} ${e.name}` }, el('span', { className: 'fish-id', textContent: ` ${fish.id}` })),
      portrait),
    el('p', { className: 'meta-line', textContent: info + (swimming ? '' : ' · fora do aquário') }),
    fry ? el('p', { textContent: [fryLooks(p), `Sexo aparece com ${LH.sexingDays} dias; o macho ganha cor até ${LH.maturityDays.male} dias.`].filter(Boolean).join(' · ') })
      : el('p', { textContent: varietySummary(p) }),
    measuresLine(e),
    status ? el('p', { className: 'status', textContent: status }) : null,
    fry ? null : use,
    // everything else stays one tap away, so the list reads as a list of fish, not of buttons
    el('details', { className: 'card-more' }, el('summary', { textContent: 'Detalhes' }),
      fatherLine(fish),
      pedigreeTree(fish.id),
      conf.length ? el('p', { className: 'carrier', textContent: `Portador confirmado (pelo pedigree): ${conf.join(', ')}` }) : null,
      poss.length ? el('p', { className: 'carrier soft', textContent: `Pode carregar: ${poss.join(', ')}` }) : null,
      view.lab ? el('p', { className: 'lab', textContent: `Lab: ${genotypeSummary(species, fish)}` }) : null,
      el('div', { className: 'card-actions' }, move, shareButton(fish), drop)));
}

function renderList() {
  const list = $('fish-list');
  if (state.mode === 'catalog') {
    list.replaceChildren(...fishes.map(catalogCard));
    $('more').hidden = true;
    return;
  }
  const shown = listCache.slice(0, view.shown);
  list.replaceChildren(...shown.map(plantelCard));
  if (!shown.length) list.append(el('li', { className: 'empty', textContent: 'Nenhum peixe passa no filtro.' }));
  $('more').hidden = listCache.length <= view.shown;
  $('more').textContent = `Mostrar mais (${listCache.length - view.shown})`;
}

function parentLine(id) {
  const r = id && tank.registry[id];
  if (!r || r.fate) return 'nenhum escolhido';
  const fish = r.fish, age = ageOf(tank, fish), sex = sexOf(fish);
  const strain = strainOf(fish);
  const name = strain ? strain.name : hobbyName(phenotype(species, fish, { ageDays: age }));
  return `${name} · ${fish.id} · ${fmtAge(age)} · fertilidade ${pct(fertility(species, sex, age))}`;
}

/** Problems a breeder should see: tanks over capacity, and mature males with receptive females where that is not meant. */
function tankAlerts() {
  const alerts = [];
  for (const t of tank.tanks) {
    const l = tankLoad(species, tank, t.id);
    if (l.load > 1) alerts.push(`${t.name} lotado (${l.used.toFixed(0)}/${t.capacity}): peixes morrem e as ninhadas encolhem.`);
    const temp = species.husbandry?.temperature;
    if (temp && t.tempC >= temp.lethalC) alerts.push(`${t.name} a ${t.tempC} °C: nenhum filhote nasce.`);
    else if (temp && t.tempC > temp.stressFromC) alerts.push(`${t.name} a ${t.tempC} °C: ninhadas menores${t.tempC > temp.defectFromC ? ' e filhotes com coluna torta' : ''}.`);
    if (t.id === 'casais' || t.pond) continue;
    const here = tank.alive.filter(f => f.tankId === t.id);
    const males = here.some(f => sexOf(f) === 'male' && ageOf(tank, f) >= LH.maturityDays.male);
    const females = here.some(f => sexOf(f) === 'female' && ageOf(tank, f) >= (LH.receptiveDays ?? LH.maturityDays.female));
    if (males && females) alerts.push(`${t.name}: machos maduros com fêmeas — eles cruzam por conta própria. Separe por sexo.`);
  }
  return alerts;
}

// ---------- batch tools: statistics, selection rounds, planner ----------
const SCOPES = { adult: 'adultos', male: 'machos adultos', female: 'fêmeas adultas', all: 'todos com sexo visível' };
function inScope(e, scope) {
  if (e.stage === 'alevino') return false;
  if (scope === 'all') return true;
  const adult = e.stage === 'adulto' || e.stage === 'idoso';
  return adult && (scope === 'adult' || e.sex === scope);
}
function selScore(e) {
  const by = view.sel.by;
  if (by === 'goal') return e.goal.hit + (e.goal.all ? 0.5 : 0) + e.chars * 0.01;
  if (by === 'chars') return e.chars;
  return e.p[by.slice(2)] ?? 0;
}
/** What a selection round would do on the fish in the current list (filters and tank apply). */
function selectionPlan() {
  const pool = listCache.filter(e => inScope(e, view.sel.scope));
  if (!pool.length) return { pool, keep: [], cull: [] };
  // per sex, so a round never wipes out one sex
  const parts = view.sel.scope === 'adult' || view.sel.scope === 'all' ? ['male', 'female'].map(sx => pool.filter(e => e.sex === sx)) : [pool];
  const out = { pool, keep: [], cull: [] };
  for (const part of parts) {
    if (!part.length) continue;
    const r = selectTop(part, selScore, view.sel.keep);
    out.keep.push(...r.keep); out.cull.push(...r.cull);
  }
  return out;
}

function histogram(values) {
  const st = batchStats(values);
  const peak = Math.max(1, ...st.bins);
  return el('span', { className: 'hist', title: `média ${n100(st.mean ?? 0)} ± ${n100(st.sd ?? 0)}` },
    ...st.bins.map(b => el('i', { style: `height:${Math.round((b / peak) * 100)}%` })));
}

function renderStats() {
  const box = $('batch-stats');
  const list = listCache;
  const pond = view.tank && tankById(tank, view.tank)?.pond;
  if (list.length < 12 && !pond) { box.replaceChildren(); box.hidden = true; return; }
  box.hidden = false;
  const fry = list.filter(e => e.stage === 'alevino').length;
  const males = list.filter(e => e.stage !== 'alevino' && e.sex === 'male'), females = list.filter(e => e.stage !== 'alevino' && e.sex === 'female');
  const rows = [];
  for (const k of QUANT) {
    const row = el('div', { className: 'stat-row' }, el('span', { className: 'stat-name', textContent: SHORT[k] }));
    for (const group of [males, females]) {
      const st = batchStats(group.map(e => e.p[k]));
      row.append(el('span', { className: 'stat-cell' }, histogram(group.map(e => e.p[k])),
        el('b', { textContent: st.n ? `${n100(st.mean)}±${n100(st.sd)}` : '—' })));
    }
    rows.push(row);
  }
  const top = (label, values) => {
    const c = categoryCounts(values).slice(0, 3);
    return c.length ? `${label}: ${c.map(([v, n]) => `${v} ${Math.round((n / values.length) * 100)}%`).join(', ')}` : '';
  };
  const cats = [
    top('cauda ♂', males.map(e => T.tailColor.labels[e.p.tailColor])),
    top('formato ♂', males.map(e => T.tailShape.labels[e.p.tailShape])),
    top('corpo ♂', males.map(e => T.bodyPattern.labels[e.p.bodyPattern])),
    top('albino', list.filter(e => e.p.albino).length ? list.map(e => (e.p.albino ? 'sim' : 'não')) : []),
  ].filter(Boolean);
  box.replaceChildren(
    el('p', { className: 'hint', textContent: `Lote: ${list.length} peixes · ${males.length} ♂ · ${females.length} ♀ · ${fry} alevinos` }),
    el('div', { className: 'stat-row head' }, el('span', { className: 'stat-name' }), el('span', { className: 'stat-cell', textContent: 'machos' }), el('span', { className: 'stat-cell', textContent: 'fêmeas' })),
    ...rows,
    ...cats.map(c => el('p', { className: 'hint', textContent: c })));
}

/** Expected offspring of the chosen pair: breeder's equation on measured ornaments (plus the full lab forecast). */
function plannerText() {
  const mom = findAlive(tank, breeding.motherId), dad = findAlive(tank, breeding.fatherId);
  if (!mom || !dad) return '';
  const momE = entriesCache.find(e => e.fish === mom), dadE = entriesCache.find(e => e.fish === dad);
  if (!momE || !dadE) return '';
  const adults = entriesCache.filter(e => e.stage === 'adulto' || e.stage === 'idoso');
  const pop = k => (adults.length ? adults.reduce((a, e) => a + e.p[k], 0) / adults.length : 0.5);
  const parts = QUANT.map(k => { const pr = predictOffspring(species, k, momE.p[k], dadE.p[k], pop(k)); return `${SHORT[k]} ~${n100(pr.mean)}`; });
  let text = `Filhos esperados (média): ${parts.join(' · ')}. A média puxa para a do plantel (herdabilidade ~0,6).`;
  if (view.lab) {
    const kids = batch(species, mom, dad, { seed: hashString(`${mom.id}x${dad.id}`), count: 300 }).map(k => phenotype(species, k));
    const lost = kids.filter(k => k.embryoLethal).length;
    const sons = kids.filter(k => k.observedSex === 'male' && !k.embryoLethal);
    const pctOf = (list, f) => Math.round((list.filter(f).length / Math.max(1, list.length)) * 100);
    const topOf = (list, k) => categoryCounts(list.map(x => T[k].labels[x[k]])).slice(0, 3).map(([v, n]) => `${v} ${Math.round((n / list.length) * 100)}%`).join(', ');
    text += ` Lab (300 simulados): filhos com cauda ${topOf(sons, 'tailColor')}; corpo ${topOf(sons, 'bodyPattern')}; albinos ${pctOf(kids, k => k.albino)}%; embriões perdidos ${Math.round((lost / kids.length) * 100)}%.`;
  }
  return text;
}

function syncControls() {
  const plantel = state.mode === 'plantel';
  $('mode-catalog').setAttribute('aria-pressed', String(!plantel));
  $('mode-cross').setAttribute('aria-pressed', String(plantel));
  $('catalog-controls').hidden = plantel;
  $('cross-controls').hidden = !plantel;
  $('tank-controls').hidden = !plantel;
  const from = state.page * PAGE_SIZE + 1, to = Math.min(GUPPY_STRAINS.length, from + PAGE_SIZE - 1);
  $('page-label').textContent = `Variedades ${from}–${to} de ${GUPPY_STRAINS.length}`;
  $('prev').disabled = state.page === 0;
  $('next').disabled = state.page >= PAGES - 1;
  $('mom-name').textContent = parentLine(breeding.motherId);
  $('dad-name').textContent = parentLine(breeding.fatherId);
  const status = canMate(species, tank, breeding.motherId, breeding.fatherId);
  $('cross').disabled = !status.ok;
  const c = status.ok ? coi(tank, breeding.motherId, breeding.fatherId) : { value: 0, uncertain: false };
  const mom = findAlive(tank, breeding.motherId);
  const already = mom?.pregnancy ? ' Ela já está prenhe: essa ninhada nasce antes.' : mom?.sperm.length ? ' Ela guarda esperma de outro macho; o fresco vence quase sempre.' : '';
  $('cross-hint').textContent = status.ok
    ? `Ninhada esperada: cerca de ${Math.round(status.expected)} filhotes em 5 semanas. Consanguinidade dos filhotes: ${c.uncertain ? 'pelo menos ' : ''}${(c.value * 100).toFixed(1)}%.${already}`
    : `Não dá para cruzar: ${status.reason}.`;
  $('planner').textContent = status.ok ? plannerText() : '';
  $('planner').hidden = !status.ok;
  $('maternity').checked = tank.maternityBox;
  $('event').textContent = lastEvent;
  $('event').hidden = !lastEvent;
  const alive = tank.alive.length, fry = tank.alive.filter(f => ageOf(tank, f) < LH.sexingDays).length;
  const fates = Object.values(tank.registry).reduce((acc, r) => { if (r.fate) acc[r.fate] = (acc[r.fate] ?? 0) + 1; return acc; }, {});
  const deaths = ['velhice', 'fraqueza', 'superlotação', 'descarte'].filter(k => fates[k]).map(k => `${fates[k]} ${{ velhice: 'de velhice', fraqueza: 'de fraqueza', 'superlotação': 'de superlotação', descarte: 'descartados' }[k]}`);
  $('tank-status').textContent = `Dia ${tank.day} (semana ${Math.floor(tank.day / WEEK)}) · ${alive} vivos${fry ? ` (${fry} alevinos)` : ''} · ${tank.broods} ninhadas${deaths.length ? ' · ' + deaths.join(' · ') : ''}`;
  if (plantel) {
    $('tank-tabs').replaceChildren(...[{ id: '', name: 'Todos' }, ...tank.tanks].map(t => {
      const label = t.id ? (() => { const l = tankLoad(species, tank, t.id); return `${t.name} ${Math.round(l.used)}/${t.capacity}`; })() : `Todos ${alive}`;
      const b = el('button', { type: 'button', textContent: label, className: t.id && tankLoad(species, tank, t.id).load > 1 ? 'over' : '' });
      b.setAttribute('aria-pressed', String(view.tank === t.id));
      b.addEventListener('click', () => { view.tank = t.id; view.shown = LIST_STEP; refresh(); });
      return b;
    }));
    const current = view.tank ? tankById(tank, view.tank) : null;
    $('tank-settings').hidden = !current;
    if (current) {
      $('tank-temp').value = String(current.tempC);
      $('tank-food').value = current.food;
      $('tank-info').textContent = `${current.name}: gestação de ~${gestationDays(species, current.tempC)} dias a ${current.tempC} °C${current.pond ? ' · colônia solta: ninguém sabe quem é pai ou mãe de quem nasce aqui' : ''}${current.nursery ? ' · berçário: os filhotes ficam protegidos' : ''}.`;
    }
    $('pond-stock').hidden = !current?.pond;
    renderStats();
    const plan = selectionPlan();
    $('sel-action').replaceChildren(el('option', { value: 'cull', textContent: 'Descartar o resto' }),
      ...tank.tanks.map(t => el('option', { value: `move:${t.id}`, textContent: `Mover os melhores para ${t.name}` })));
    $('sel-by').value = view.sel.by; $('sel-scope').value = view.sel.scope; $('sel-keep').value = String(view.sel.keep); $('sel-action').value = view.sel.action;
    $('sel-preview').textContent = plan.pool.length
      ? `Rodada sobre ${plan.pool.length} ${SCOPES[view.sel.scope]} da lista: ficam ${plan.keep.length} (os melhores de cada sexo), ${view.sel.action === 'cull' ? 'saem' : 'ficam onde estão'} ${plan.cull.length}.`
      : 'Nenhum peixe da lista entra nessa rodada.';
    $('sel-apply').disabled = !plan.cull.length && view.sel.action === 'cull';
    $('sel-apply').textContent = view.sel.armed ? 'Confirmar a rodada' : 'Fazer a rodada de seleção';
    const alerts = tankAlerts();
    $('alerts').replaceChildren(...alerts.map(a => el('p', { className: 'hint warn', textContent: a })));
    const hidden = entriesCache.length - listCache.length;
    $('cull-rest').hidden = hidden <= 0;
    const spare = entriesCache.filter(e => !listCache.includes(e) && (e.fish.id === breeding.motherId || e.fish.id === breeding.fatherId)).length;
    $('cull-rest').textContent = view.cullArmed ? `Confirmar: descartar ${hidden - spare}` : `Descartar os ${hidden - spare} fora do filtro`;
    const nursery = nurseryOf(tank);
    const sortable = tank.alive.filter(f => f.tankId === nursery.id && ageOf(tank, f) >= LH.sexingDays).length;
    $('separate').hidden = !sortable;
    $('separate').textContent = `Separar por sexo (${sortable})`;
    $('move-all').replaceChildren(el('option', { value: '', textContent: `Mover os ${listCache.length} da lista para…` }),
      ...tank.tanks.map(t => el('option', { value: t.id, textContent: t.name })));
    const swim = fishes.length;
    $('list-count').textContent = `${listCache.length} de ${entriesCache.length} no filtro · no aquário: ${swim === listCache.length ? 'todos' : `${swim} (os primeiros da lista)`}`;
    $('goal-chips').replaceChildren(...view.goals.map(key => {
      const chip = el('button', { type: 'button', className: 'chip', textContent: `${GOAL[key].label} ✕` });
      chip.addEventListener('click', () => { view.goals = view.goals.filter(k => k !== key); if (!view.goals.length && view.sort === 'goal') view.sort = 'new'; refresh(); });
      return chip;
    }));
    $('sort').value = view.sort;
    const filters = view.goals.length + (view.sex ? 1 : 0) + (view.age ? 1 : 0) + (view.onlyGoal ? 1 : 0);
    $('filter-sum').textContent = `Filtrar e ordenar${filters ? ` · ${filters} ativo${filters > 1 ? 's' : ''}` : ''} · ${listCache.length} na lista`;
  }
  $('reset').textContent = view.resetArmed ? 'Confirmar: apagar o plantel' : 'Recomeçar plantel';
  renderChallenges();
  $('event').textContent = lastEvent;
  $('event').hidden = !lastEvent;
}

/** Recompute the list and the fish in the aquarium after any change to the tank or the filters. */
function refresh() {
  view.cullArmed = false; view.resetArmed = false;
  if (state.mode === 'plantel') loadTank(); else { renderList(); syncControls(); }
}

/** One short report of what happened while time passed. */
function describe(ev, lead = '') {
  const parts = lead ? [lead] : [];
  const colony = ev.births.filter(b => b.colony);
  if (colony.length) {
    const born = colony.reduce((n, b) => n + b.born.length, 0), lost = colony.reduce((n, b) => n + b.eaten + b.embryosLost, 0);
    parts.push(`Lago: ${colony.length} ninhadas soltas, ${born} filhotes sobreviveram e ${lost} se perderam (comidos, densidade ou embriões).`);
  }
  for (const b of ev.births.filter(x => !x.colony)) {
    const males = b.born.filter(f => sexOf(f) === 'male').length;
    const losses = [b.embryosLost ? `${b.embryosLost} embriões não vingaram` : '', b.eaten ? `${b.eaten} alevinos comidos ou perdidos` : ''].filter(Boolean).join(', ');
    const dads = b.colony ? 'pais desconhecidos (colônia)' : b.fathers.length > 1 ? `pai incerto (${b.fathers.map(([id]) => id).join(' ou ')})` : `pai ${b.fathers[0]?.[0] ?? '?'}`;
    parts.push(`${b.mother} pariu a ninhada N${b.broodNo}: ${b.born.length} filhotes (${males} ♂, ${b.born.length - males} ♀) em ${tankName(b.tankId)}, ${dads}${losses ? `; ${losses}` : ''}.`);
  }
  const loose = ev.matings.filter(([, , t]) => t !== 'casais' && !tankById(tank, t)?.pond);   // the pond is a colony on purpose
  if (loose.length) parts.push(`${loose.length} acasalamentos sem controle (${[...new Set(loose.map(([, , t]) => tankName(t)))].join(', ')}).`);
  const byFate = {};
  for (const d of ev.died) (byFate[d.fate] ??= []).push(d.fish.id);
  for (const [fate, ids] of Object.entries(byFate)) parts.push(`Morreram de ${fate}: ${ids.length > 6 ? `${ids.length} peixes` : ids.join(', ')}.`);
  if (!parts.length) parts.push(`Passaram ${ev.days} dias sem novidade.`);
  return parts.join(' ');
}

function afterTime() {
  for (const k of ['motherId', 'fatherId']) if (!findAlive(tank, breeding[k])) breeding[k] = null;
  if (state.focusId && !findAlive(tank, state.focusId)) state.focusId = null;
  persist(); refresh();
}

// mother / father pickers: buy a founder of a strain
for (const id of ['mom', 'dad']) {
  const pick = el('option', { value: '', textContent: id === 'mom' ? 'Comprar fundadora de uma linhagem…' : 'Comprar fundador de uma linhagem…' });
  $(id).replaceChildren(pick, ...GUPPY_STRAINS.map(s => el('option', { value: s.id, textContent: s.name })));
  $(id).addEventListener('change', e => {
    if (!e.target.value) return;
    const sex = id === 'mom' ? 'female' : 'male';
    const bought = buyFounder(e.target.value, sex);
    setParent(bought);
    lastEvent = `${bought.id} entrou no plantel com ${fmtAge(FOUNDER_AGE)}.`;
    e.target.value = '';
    refresh();
  });
}

// goal and filters
const goalSelect = $('goal-add');
goalSelect.replaceChildren(el('option', { value: '', textContent: 'Adicionar característica à meta…' }),
  ...[...new Set(GOALS.map(g => g.group))].map(group => {
    const og = el('optgroup', { label: group });
    og.append(...GOALS.filter(g => g.group === group).map(g => el('option', { value: g.key, textContent: g.label })));
    return og;
  }));
goalSelect.addEventListener('change', e => {
  const key = e.target.value;
  e.target.value = '';
  if (!key || view.goals.includes(key)) return;
  // one value per trait: a new tail colour replaces the old one
  view.goals = [...view.goals.filter(k => GOAL[k].trait !== GOAL[key].trait), key];
  view.sort = 'goal';
  refresh();
});
$('f-sex').addEventListener('change', e => { view.sex = e.target.value; refresh(); });
$('f-age').addEventListener('change', e => { view.age = e.target.value; refresh(); });
$('only-goal').addEventListener('change', e => { view.onlyGoal = e.target.checked; refresh(); });
$('sort').addEventListener('change', e => { view.sort = e.target.value; refresh(); });
$('lab').addEventListener('change', e => { view.lab = e.target.checked; renderList(); syncControls(); });
$('more').addEventListener('click', () => { view.shown += LIST_STEP; renderList(); });
$('cull-rest').addEventListener('click', () => {
  if (!view.cullArmed) { view.cullArmed = true; syncControls(); return; }
  const keep = new Set([...listCache.map(e => e.fish.id), breeding.motherId, breeding.fatherId]);
  const removed = cull(tank, entriesCache.filter(e => !keep.has(e.fish.id)).map(e => e.fish.id));
  lastEvent = `${removed.length} peixes descartados (o casal escolhido fica).`;
  persist(); refresh();
});
$('reset').addEventListener('click', () => {
  if (!view.resetArmed) { view.resetArmed = true; syncControls(); return; }
  newTank();
  lastEvent = 'Plantel novo: um casal de fundadores.';
  state.focusId = null;
  persist(); refresh();
});

$('cross').addEventListener('click', () => {
  const r = breedAndWait(species, tank, breeding.motherId, breeding.fatherId);
  if (!r.ok) { lastEvent = `Não deu para cruzar: ${r.reason}.`; syncControls(); return; }
  lastEvent = describe(r.events, r.brood ? `Cruzamento ${breeding.motherId} × ${breeding.fatherId}: ninhada N${r.brood.broodNo}.` : `Cruzamento sem ninhada: ${r.reason}.`);
  state.mode = 'plantel';
  afterTime();
});
for (const [id, weeks] of [['week', 1], ['wait', 4]]) {
  $(id).addEventListener('click', () => { lastEvent = describe(advanceWeeks(species, tank, weeks)); afterTime(); });
}
$('maternity').addEventListener('change', e => { tank.maternityBox = e.target.checked; persist(); syncControls(); });
$('separate').addEventListener('click', () => {
  const nursery = nurseryOf(tank);
  const ready = tank.alive.filter(f => f.tankId === nursery.id && ageOf(tank, f) >= LH.sexingDays);
  const m = moveFish(tank, ready.filter(f => sexOf(f) === 'male').map(f => f.id), 'machos');
  const f = moveFish(tank, ready.filter(x => sexOf(x) === 'female').map(x => x.id), 'femeas');
  lastEvent = `Separados: ${m} machos para Machos e ${f} fêmeas para Fêmeas.`;
  persist(); refresh();
});
$('move-all').addEventListener('change', e => {
  const to = e.target.value;
  if (!to) return;
  const n = moveFish(tank, listCache.map(x => x.fish.id), to);
  lastEvent = `${n} peixes foram para ${tankName(to)}.`;
  persist(); refresh();
});

// tank settings, pond stocking, selection rounds
$('tank-temp').replaceChildren(...[20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33].map(c => el('option', { value: String(c), textContent: `${c} °C` })));
$('tank-temp').addEventListener('change', e => { setTank(tank, view.tank, { tempC: Number(e.target.value) }); persist(); syncControls(); });
$('tank-food').addEventListener('change', e => { setTank(tank, view.tank, { food: e.target.value }); persist(); syncControls(); });
$('stock-strain').replaceChildren(el('option', { value: '', textContent: 'Povoar o lago: 10 ♀ + 5 ♂ de…' }),
  ...GUPPY_STRAINS.map(st => el('option', { value: st.id, textContent: st.name })));
$('stock-strain').addEventListener('change', e => {
  const id = e.target.value;
  if (!id) return;
  const pond = tank.tanks.find(t => t.pond);
  const bought = [...Array(10)].map(() => buyFounder(id, 'female')).concat([...Array(5)].map(() => buyFounder(id, 'male')));
  moveFish(tank, bought.map(f => f.id), pond.id);
  lastEvent = `15 fundadores de ${STRAIN[id].name} soltos no ${pond.name}.`;
  e.target.value = '';
  persist(); refresh();
});
$('sel-by').replaceChildren(el('option', { value: 'goal', textContent: 'Meta (características)' }), el('option', { value: 'chars', textContent: 'Mais características' }),
  ...QUANT.map(k => el('option', { value: `q:${k}`, textContent: T[k].label })));
for (const [id, key, cast] of [['sel-by', 'by', String], ['sel-scope', 'scope', String], ['sel-keep', 'keep', Number], ['sel-action', 'action', String]]) {
  $(id).addEventListener('change', e => { view.sel[key] = cast(e.target.value); view.sel.armed = false; syncControls(); });
}
$('sel-apply').addEventListener('click', () => {
  if (!view.sel.armed) { view.sel.armed = true; syncControls(); return; }
  view.sel.armed = false;
  const plan = selectionPlan();
  const spare = new Set([breeding.motherId, breeding.fatherId]);
  if (view.sel.action === 'cull') {
    const removed = cull(tank, plan.cull.map(e => e.fish.id).filter(id => !spare.has(id)));
    lastEvent = `Rodada de seleção: ficaram ${plan.keep.length}, saíram ${removed.length}.`;
  } else {
    const to = view.sel.action.slice(5);
    const n = moveFish(tank, plan.keep.map(e => e.fish.id), to);
    lastEvent = `Rodada de seleção: ${n} melhores foram para ${tankName(to)}.`;
  }
  persist(); refresh();
});
$('resample').addEventListener('click', () => { view.sample++; view.sort = 'random'; refresh(); });
$('import-btn').addEventListener('click', () => {
  const code = $('import-code').value.trim();
  try {
    if (peekSpecies(code) !== species.id) throw Error('esse código é de outra espécie');
    const fish = unpackFish(code, species);
    let n = 1;
    while (tank.registry[`IMP-${n}`]) n++;
    fish.id = `IMP-${n}`;
    addFish(species, tank, fish, FOUNDER_AGE);
    lastEvent = `${fish.id} chegou por código (${hobbyName(phenotype(species, fish))}) e foi para ${tankName(fish.tankId)}.`;
    $('import-code').value = '';
    state.mode = 'plantel';
    persist(); refresh();
  } catch (err) {
    lastEvent = `Não deu para importar: ${/species|espécie/.test(err.message) ? 'esse código é de outra espécie' : 'o código está incompleto ou foi alterado'}.`;
    syncControls();
  }
});

$('oil').checked = state.oil;
$('radius').value = state.radius;
$('texture').value = state.texture;
$('res').value = String(state.scale);
$('art').textContent = ART_STYLE_VERSION;
$('gpu').textContent = /,|\(/.test(RENDERER) ? 'GPU: ' + RENDERER.replace(/^ANGLE \(/, '').replace(/\)$/, '').slice(0, 70) : 'GPU não informada pelo navegador';
if (SOFTWARE_GL) {
  $('gpu-note').hidden = false;
  $('gpu-note').textContent = 'O navegador está desenhando sem placa de vídeo (' + RENDERER.slice(0, 60) + '). Comecei sem o filtro e em resolução baixa. Ative "Usar aceleração de hardware" nas configurações do navegador e recarregue para ver a pintura.';
}
$('mode-catalog').addEventListener('click', () => { state.mode = 'catalog'; state.focus = -1; loadTank(); });
$('mode-cross').addEventListener('click', () => { state.mode = 'plantel'; state.focus = -1; loadTank(); });
$('prev').addEventListener('click', () => { state.page = Math.max(0, state.page - 1); state.focus = -1; loadTank(); });
$('next').addEventListener('click', () => { state.page = Math.min(PAGES - 1, state.page + 1); state.focus = -1; loadTank(); });
$('res').addEventListener('change', e => { state.scale = Number(e.target.value); state.auto = false; });
$('oil').addEventListener('change', e => { state.oil = e.target.checked; state.auto = false; });
$('radius').addEventListener('input', e => { state.radius = Number(e.target.value); });
$('texture').addEventListener('input', e => { state.texture = Number(e.target.value); });
$('pause').addEventListener('click', e => { state.paused = !state.paused; e.target.textContent = state.paused ? 'Continuar' : 'Pausar'; });
$('capture')?.addEventListener('click', () => {
  render(state.frozenT ?? state.time, null);
  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `plantel-guppy-${state.mode}-seed${state.seed}-t${(state.frozenT ?? state.time).toFixed(2)}-${ART_STYLE_VERSION}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
});

// a ?focus= index picks a fish of the first view; later the focus follows the fish id
if (state.mode === 'plantel' && state.focus >= 0) {
  entriesCache = plantelEntries(); listCache = visibleEntries(entriesCache);
  state.focusId = listCache[state.focus]?.fish.id ?? null;
}
persist();
loadTank();
$('guide').classList.toggle('new', firstVisit);   // closed, but highlighted for a new player
requestAnimationFrame(loop);
