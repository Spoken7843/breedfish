// The breeder's fish room over time (docs/GDD.txt#L109-L131): tanks and ponds with a capacity, a
// temperature and a ration; fish that grow and age week by week; free mating wherever mature males
// and receptive females share water; females that store sperm and keep having broods; uncertain
// paternity until a paternity test; colony ponds where nobody knows who the parents are; fry losses
// (cannibalism, density, nursery); overcrowding; heat; and the hidden genetic load that inbreeding
// exposes. Pure and deterministic: the same seed and the same actions give the same fish room.
import { offspring } from './engine.mjs';
import { phenotype } from './phenotype.mjs';
import { pedigreeCOI } from './pedigree.mjs';
import { deriveSeed, poisson, randomInt, rngFromSeed } from './rng.mjs';
import { migrateGenome } from './species.mjs';
import { lifeHistoryOf, lifeStage, lifespanDays, maleFertility, meanBrood, sexOf } from './lifehistory.mjs';
import { recessiveMarkers } from './deduce.mjs';

export const TANK_FORMAT = 3;
export const WEEK = 7;
/**
 * Default fish room: a breeding tank, a nursery, one tank per sex and a planted outdoor pond for
 * colony breeding. Capacity in adult fish; temperature in C; ration 'pouca' | 'normal' | 'farta'.
 * cover: share of fry that hide from adults (plants).
 */
export const DEFAULT_TANKS = [
  { id: 'casais', name: 'Casais', capacity: 12, tempC: 25, food: 'normal' },
  { id: 'bercario', name: 'Berçário', capacity: 80, nursery: true, tempC: 26, food: 'farta' },
  { id: 'machos', name: 'Machos', capacity: 40, tempC: 25, food: 'normal' },
  { id: 'femeas', name: 'Fêmeas', capacity: 40, tempC: 25, food: 'normal' },
  { id: 'lago', name: 'Lago', capacity: 200, pond: true, cover: 0.9, tempC: 24, food: 'normal' },
];
const NO_STORAGE = { weeklyKeep: 0, usePerConception: 1, minViable: 0.01, freshShare: 1, lastMaleBonus: 1 };
const DEFAULT_HUSBANDRY = { fryNurserySurvival: 1, fryBaseSurvival: 1, cannibalismPerAdult: 0, crowdMortality: 0, fryLethalDays: [7, 110] };
const LOAD = { alevino: 0.25, jovem: 0.6, adulto: 1, idoso: 1 };   // tank space a fish takes by life stage

// Genetic traits (sterility, lethals, adult size) do not depend on age: one phenotype per fish object.
const GENETIC = new WeakMap();
function genetic(species, fish) {
  let p = GENETIC.get(fish);
  if (!p) { p = phenotype(species, fish); GENETIC.set(fish, p); }
  return p;
}
const spermRules = species => (species.spermStorage ? lifeHistoryOf(species).sperm : NO_STORAGE);
const husbandry = species => ({ ...DEFAULT_HUSBANDRY, ...(species.husbandry ?? {}) });
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function createTank(species, { seed = 2026, tanks = DEFAULT_TANKS } = {}) {
  lifeHistoryOf(species);
  if (species.reproductiveMode !== 'livebearer') throw Error('the fish room handles livebearers only in this slice');
  if (!tanks.length || new Set(tanks.map(t => t.id)).size !== tanks.length || tanks.some(t => !(t.capacity > 0))) throw Error('invalid tanks');
  return { speciesId: species.id, seed: seed >>> 0, day: 0, broods: 0, maternityBox: true, alive: [], registry: {},
    tanks: tanks.map(t => ({ tempC: 25, food: 'normal', ...t })) };
}

/** Age in days of a fish that lives (or lived) in the room, on the current day. */
export const ageOf = (tank, fish) => tank.day - fish.bornDay;
export const findAlive = (tank, id) => tank.alive.find(f => f.id === id) ?? null;
export const nurseryOf = tank => tank.tanks.find(t => t.nursery) ?? tank.tanks[0];
export const tankById = (tank, id) => tank.tanks.find(t => t.id === id);
const defaultTankFor = (tank, fish) => tank.tanks.find(t => t.id === (sexOf(fish) === 'male' ? 'machos' : 'femeas'))?.id ?? tank.tanks[0].id;

// ---------- environment: temperature, ration, growth ----------

/** Development speed relative to the reference temperature (q10 rule). */
export function tempRate(species, tempC) {
  const t = husbandry(species).temperature;
  return t ? t.q10 ** ((tempC - t.referenceC) / 10) : 1;
}
/** Gestation length at a temperature (shorter when warm). */
export function gestationDays(species, tempC) {
  return Math.max(14, Math.round(lifeHistoryOf(species).cycleDays / tempRate(species, tempC)));
}
/** Brood factor from heat stress: 1 up to stressFromC, 0 at lethalC. */
export function heatBroodFactor(species, tempC) {
  const t = husbandry(species).temperature;
  if (!t || tempC <= t.stressFromC) return 1;
  return clamp((t.lethalC - tempC) / (t.lethalC - t.stressFromC), 0, 1);
}
function heatDefectChance(species, tempC) {
  const t = husbandry(species).temperature;
  return t ? clamp(t.defectPerDegree * (tempC - t.defectFromC), 0, 0.5) : 0;
}
const ration = (species, food) => husbandry(species).food?.[food] ?? { growth: 1, fry: 1 };

/** Weekly growth rate toward the fish's own adult length (before environment). */
function baseGrowthRate(species, sex, ageDays) {
  const lh = lifeHistoryOf(species), g = lh.growth;
  if (!g) return 0;
  const rate = g.weeklyRate[sex];
  return sex === 'male' && ageDays >= lh.maturityDays.male ? rate * g.maleAfterMaturity : rate;
}
/** Share of adult length reached at an age under reference conditions. */
export function expectedGrowth(species, sex, ageDays) {
  const g = lifeHistoryOf(species).growth;
  if (!g) return 1;
  let x = g.birth;
  for (let d = 0; d + WEEK <= ageDays; d += WEEK) x += baseGrowthRate(species, sex, d) * (1 - x);
  return x;
}
/** Body length in mm now: the fish's adult length (sex and bodySize) times the share it has reached. */
export function lengthMm(species, fish) {
  const g = lifeHistoryOf(species).growth;
  if (!g) return null;
  const [lo, hi] = g.adultLengthMm[sexOf(fish)];
  const size = genetic(species, fish).bodySize ?? 0.5;
  return (lo + (hi - lo) * size) * (fish.growth ?? 1);
}
/** Brood multiplier from body size: a female bigger than usual for her age carries more fry. */
function sizeBroodFactor(species, tank, female) {
  const g = lifeHistoryOf(species).growth;
  if (!g) return 1;
  const [lo, hi] = g.adultLengthMm.female;
  const mean = (lo + hi) / 2, expected = mean * expectedGrowth(species, 'female', ageOf(tank, female));
  return clamp((lengthMm(species, female) / expected) ** 2, 0.3, 2.2);
}

// ---------- adding, moving, loads ----------

/** Put a fish in the room (a bought founder or an imported fish) at the given age, in a tank. */
export function addFish(species, tank, fish, ageDays = 0, tankId = null) {
  if (fish.speciesId !== species.id) throw Error('fish of another species');
  if (tank.registry[fish.id]) throw Error('duplicate fish id ' + fish.id);
  const where = tankId ?? defaultTankFor(tank, fish);
  if (!tankById(tank, where)) throw Error('unknown tank ' + where);
  Object.assign(fish, { bornDay: tank.day - ageDays, tankId: where, sperm: [], pregnancy: null, matedWith: [], lastBirthDay: null,
    growth: fish.growth ?? expectedGrowth(species, sexOf(fish), ageDays), env: fish.env ?? null });
  tank.alive.push(fish);
  tank.registry[fish.id] = { id: fish.id, parents: fish.parents, generation: fish.generation ?? 0, fish, fate: null, diedDay: null,
    motherKnown: true, fatherKnown: true, fatherCandidates: null };
  return fish;
}

export function moveFish(tank, ids, tankId) {
  if (!tankById(tank, tankId)) throw Error('unknown tank ' + tankId);
  const set = new Set(ids);
  let moved = 0;
  for (const f of tank.alive) if (set.has(f.id) && f.tankId !== tankId) { f.tankId = tankId; moved++; }
  return moved;
}

/** Change a tank's temperature or ration. */
export function setTank(tank, tankId, { tempC, food } = {}) {
  const t = tankById(tank, tankId);
  if (!t) throw Error('unknown tank ' + tankId);
  if (tempC !== undefined) { if (!(tempC >= 15 && tempC <= 36)) throw RangeError('temperature out of range'); t.tempC = tempC; }
  if (food !== undefined) t.food = food;
  return t;
}

/** Space used in a tank: { used, capacity, load (used / capacity), count }. Fry take less room. */
export function tankLoad(species, tank, tankId) {
  const t = tankById(tank, tankId);
  let used = 0, count = 0;
  for (const f of tank.alive) if (f.tankId === tankId) { used += LOAD[lifeStage(species, sexOf(f), ageOf(tank, f))]; count++; }
  return { used, capacity: t.capacity, load: used / t.capacity, count };
}

// ---------- mating, sperm, conception ----------

/** Sperm a male leaves in a female. His age lowers the amount; a sterile male's sperm does not fertilize. */
function inseminate(species, tank, female, male) {
  const amount = maleFertility(species, ageOf(tank, male));
  const viable = !genetic(species, male).sterile;
  const entry = female.sperm.find(e => e.maleId === male.id);
  if (entry) Object.assign(entry, { amount: Math.min(1.5, entry.amount + amount), day: tank.day, fresh: true, viable });
  else female.sperm.push({ maleId: male.id, amount, day: tank.day, fresh: true, viable });
  if (!female.matedWith.includes(male.id)) female.matedWith.push(male.id);
}

/** Paternity odds of a female's next brood from her sperm store: [[maleId, share]], plus the strength (0..1). */
export function spermWeights(species, female) {
  const sp = spermRules(species);
  const viable = female.sperm.filter(e => e.viable && e.amount >= sp.minViable);
  if (!viable.length) return { weights: [], strength: 0 };
  const fresh = viable.filter(e => e.fresh), stored = viable.filter(e => !e.fresh);
  const last = fresh.length ? Math.max(...fresh.map(e => e.day)) : null;
  const share = (list, total) => {
    const w = list.map(e => e.amount * (e.fresh && e.day === last ? sp.lastMaleBonus : 1));
    const sum = w.reduce((a, b) => a + b, 0);
    return list.map((e, i) => [e.maleId, (total * w[i]) / sum]);
  };
  const weights = fresh.length && stored.length ? [...share(fresh, sp.freshShare), ...share(stored, 1 - sp.freshShare)]
    : share(fresh.length ? fresh : stored, 1);
  return { weights, strength: Math.min(1, viable.reduce((s, e) => s + e.amount, 0)) };
}

function pick(weights, rng) {
  let r = rng() * weights.reduce((s, [, w]) => s + w, 0);
  for (const [id, w] of weights) { if ((r -= w) <= 0) return id; }
  return weights[weights.length - 1][0];
}

/** Why a female cannot have a brood from now on, or '' if she can (age only; sterility stays hidden). */
function femaleBlock(species, tank, f) {
  const lh = lifeHistoryOf(species), age = ageOf(tank, f);
  if (meanBrood(species, Math.max(age, lh.maturityDays.female) + lh.cycleDays) <= 0) return 'a mãe já passou da idade de ter filhotes';
  return '';
}

/** Expected size of a brood this female would have now with this male (before chance and losses). */
export function expectedBrood(species, tank, female, male) {
  const lh = lifeHistoryOf(species);
  const t = tankById(tank, female.tankId);
  const birthAge = Math.max(ageOf(tank, female), lh.maturityDays.female) + gestationDays(species, t.tempC);
  return meanBrood(species, birthAge) * sizeBroodFactor(species, tank, female) * heatBroodFactor(species, t.tempC)
    * (male ? maleFertility(species, ageOf(tank, male)) : 1);
}

/** Can this female be mated with this male now? { ok, reason, expected } */
export function canMate(species, tank, femaleId, maleId) {
  const lh = lifeHistoryOf(species);
  const f = findAlive(tank, femaleId), m = findAlive(tank, maleId);
  if (!f || !m) return { ok: false, reason: 'escolha uma mãe e um pai vivos do plantel', expected: 0 };
  if (sexOf(f) !== 'female' || sexOf(m) !== 'male') return { ok: false, reason: 'a mãe precisa ser fêmea e o pai, macho', expected: 0 };
  const receptive = lh.receptiveDays ?? lh.maturityDays.female;
  if (ageOf(tank, f) < receptive) return { ok: false, reason: `a mãe ainda é jovem (aceita o macho com ${receptive} dias)`, expected: 0 };
  if (ageOf(tank, m) < lh.maturityDays.male) return { ok: false, reason: `o pai ainda é jovem (maduro com ${lh.maturityDays.male} dias)`, expected: 0 };
  const block = femaleBlock(species, tank, f);
  if (block) return { ok: false, reason: block, expected: 0 };
  return { ok: true, reason: '', expected: expectedBrood(species, tank, f, m) };
}

/** Put a chosen pair together briefly: the male's sperm goes into the female (time does not pass). */
export function mate(species, tank, femaleId, maleId) {
  const status = canMate(species, tank, femaleId, maleId);
  if (!status.ok) return status;
  inseminate(species, tank, findAlive(tank, femaleId), findAlive(tank, maleId));
  return status;
}

function tryConceive(species, tank, f, rng, ev) {
  const lh = lifeHistoryOf(species), sp = spermRules(species);
  if (ageOf(tank, f) < lh.maturityDays.female || genetic(species, f).sterile || femaleBlock(species, tank, f)) return;
  const { weights, strength } = spermWeights(species, f);
  if (!weights.length || rng() >= (lh.weeklyConception ?? 1)) return;
  const t = tankById(tank, f.tankId);
  f.pregnancy = { conceivedDay: tank.day, dueDay: tank.day + gestationDays(species, t.tempC), weights, strength };
  for (const e of f.sperm) { e.amount *= 1 - sp.usePerConception; e.fresh = false; }
  ev.conceived.push(f.id);
}

// ---------- birth ----------

function giveBirth(species, tank, mother, rng) {
  const hb = husbandry(species), preg = mother.pregnancy;
  mother.pregnancy = null;
  mother.lastBirthDay = tank.day;
  const home = tankById(tank, mother.tankId);
  const load = tankLoad(species, tank, mother.tankId).load;
  const n = poisson(rng, meanBrood(species, ageOf(tank, mother)) * preg.strength * sizeBroodFactor(species, tank, mother)
    * heatBroodFactor(species, home.tempC) * (load > 1 ? 1 / load : 1));
  const broodNo = ++tank.broods;
  // in a pond nobody catches the mother: fry are born there; elsewhere the breeding box can move them
  const dest = home.pond ? home : tank.maternityBox ? nurseryOf(tank) : home;
  const adults = tank.alive.filter(f => f !== mother && f.tankId === dest.id && ageOf(tank, f) >= lifeHistoryOf(species).sexingDays).length;
  const destLoad = tankLoad(species, tank, dest.id).load;
  const survival = (dest.nursery ? hb.fryNurserySurvival : hb.fryBaseSurvival * (1 - hb.cannibalismPerAdult) ** (adults * (1 - (dest.cover ?? 0))))
    * ration(species, dest.food).fry * clamp(1.25 - destLoad, 0, 1);   // density-dependent recruitment
  const candidates = preg.weights.filter(([, w]) => w >= 0.01);
  const colony = home.pond;
  const defect = heatDefectChance(species, home.tempC);
  let embryosLost = 0, eaten = 0;
  const born = [];
  for (let i = 0; i < n; i++) {
    const father = tank.registry[pick(preg.weights, rng)].fish;
    const kid = offspring(species, mother, father, rng, `N${broodNo}-tmp${i}`);
    if (genetic(species, kid).embryoLethal) { embryosLost++; continue; }
    if (rng() >= survival) { eaten++; continue; }
    if (defect && rng() < defect) kid.env = { spinalDefect: true };
    kid.id = `${colony ? 'L' : 'N'}${broodNo}-${String(born.length + 1).padStart(2, '0')}`;
    kid.growth = lifeHistoryOf(species).growth?.birth ?? 1;
    addFish(species, tank, kid, 0, dest.id);
    const r = tank.registry[kid.id];
    if (colony) Object.assign(r, { motherKnown: false, fatherKnown: false, fatherCandidates: null });
    else if (candidates.length > 1) Object.assign(r, { fatherKnown: false, fatherCandidates: candidates });
    born.push(kid);
  }
  return { mother: mother.id, broodNo, born, embryosLost, eaten, tankId: dest.id, fathers: colony ? [] : candidates, colony,
    conceivedDay: preg.conceivedDay };
}

// ---------- deaths, growth, the weekly step ----------

function fryLethalAge(species, fish) {
  const [a, b] = husbandry(species).fryLethalDays;
  return Math.round(a + (b - a) * rngFromSeed(deriveSeed(fish.devSeed, 'fryLethal'))());
}

function bury(species, tank, rng) {
  const hb = husbandry(species), loads = {};
  for (const t of tank.tanks) loads[t.id] = tankLoad(species, tank, t.id).load;
  const died = [];
  tank.alive = tank.alive.filter(f => {
    const age = ageOf(tank, f);
    let fate = null;
    if (age >= lifespanDays(species, f)) fate = 'velhice';
    else if (genetic(species, f).fryLethal && age >= fryLethalAge(species, f)) fate = 'fraqueza';
    else if (loads[f.tankId] > 1) {
      const fry = lifeStage(species, sexOf(f), age) === 'alevino';
      if (rng() < Math.min(0.3, hb.crowdMortality * (loads[f.tankId] - 1) * (fry ? 2 : 1))) fate = 'superlotação';
    }
    if (!fate) return true;
    Object.assign(tank.registry[f.id], { fate, diedDay: tank.day });
    died.push({ fish: f, fate });
    return false;
  });
  return died;
}

function grow(species, tank) {
  const loads = {};
  for (const t of tank.tanks) loads[t.id] = tankLoad(species, tank, t.id).load;
  for (const f of tank.alive) {
    const t = tankById(tank, f.tankId);
    const rate = baseGrowthRate(species, sexOf(f), ageOf(tank, f)) * tempRate(species, t.tempC) * ration(species, t.food).growth
      * (loads[t.id] > 1 ? 1 / loads[t.id] : 1);
    f.growth = (f.growth ?? 1) + Math.min(0.5, rate) * (1 - (f.growth ?? 1));
  }
}

/**
 * One week in the fish room: due broods are born, fish sharing water mate, females with viable
 * sperm conceive, stored sperm ages, everyone grows, and fish die of old age, of a fry lethal or of
 * overcrowding. The registry is pruned of dead fish nobody needs any more.
 */
export function advanceWeek(species, tank) {
  const lh = lifeHistoryOf(species), sp = spermRules(species);
  const rng = rngFromSeed(deriveSeed(tank.seed, `week:${tank.day}`));
  tank.day += WEEK;
  const ev = { days: WEEK, births: [], matings: [], conceived: [], died: [] };
  for (const f of [...tank.alive]) if (f.pregnancy && tank.day >= f.pregnancy.dueDay) ev.births.push(giveBirth(species, tank, f, rng));
  const receptive = lh.receptiveDays ?? lh.maturityDays.female;
  for (const t of tank.tanks) {
    const here = tank.alive.filter(f => f.tankId === t.id);
    const males = here.filter(f => sexOf(f) === 'male' && ageOf(tank, f) >= lh.maturityDays.male);
    if (!males.length) continue;
    for (const f of here) {
      if (sexOf(f) !== 'female' || ageOf(tank, f) < receptive || rng() >= (lh.weeklyMating ?? 1)) continue;
      const m = males[randomInt(rng, males.length)];
      inseminate(species, tank, f, m);
      ev.matings.push([f.id, m.id, t.id]);
    }
  }
  for (const f of tank.alive) if (sexOf(f) === 'female' && !f.pregnancy) tryConceive(species, tank, f, rng, ev);
  for (const f of tank.alive) {
    if (!f.sperm.length) continue;
    for (const e of f.sperm) e.amount *= sp.weeklyKeep;
    f.sperm = f.sperm.filter(e => e.amount >= sp.minViable);
  }
  grow(species, tank);
  ev.died = bury(species, tank, rng);
  if (Object.keys(tank.registry).length > tank.alive.length * 2 + 300) prune(species, tank);
  return ev;
}

/** Several weeks; the events of each week merged. */
export function advance(species, tank, weeks) {
  if (!Number.isSafeInteger(weeks) || weeks < 1) throw RangeError('invalid number of weeks');
  return mergeEvents(Array.from({ length: weeks }, () => advanceWeek(species, tank)));
}

export function mergeEvents(list) {
  return list.reduce((a, e) => ({ days: a.days + e.days, births: [...a.births, ...e.births], matings: [...a.matings, ...e.matings],
    conceived: [...a.conceived, ...e.conceived], died: [...a.died, ...e.died] }), { days: 0, births: [], matings: [], conceived: [], died: [] });
}

/**
 * The breeder's controlled cross: mate the pair, then let the weeks pass until that female gives
 * birth to a brood conceived after this mating (up to maxWeeks). If she was already pregnant, the
 * earlier brood is born first and comes back in `earlier`.
 */
export function breedAndWait(species, tank, femaleId, maleId, { maxWeeks = 10 } = {}) {
  const status = mate(species, tank, femaleId, maleId);
  if (!status.ok) return { ok: false, reason: status.reason, events: mergeEvents([]), brood: null, earlier: [] };
  const matedDay = tank.day, weeks = [];
  let brood = null;
  for (let w = 0; w < maxWeeks && !brood; w++) {
    const ev = advanceWeek(species, tank);
    weeks.push(ev);
    brood = ev.births.find(b => b.mother === femaleId && b.conceivedDay > matedDay) ?? null;
    if (!findAlive(tank, femaleId)) break;
  }
  const earlier = weeks.flatMap(e => e.births).filter(b => b.mother === femaleId && b.conceivedDay <= matedDay);
  const reason = brood ? (brood.born.length ? '' : 'a ninhada não vingou') : findAlive(tank, femaleId) ? 'ela não ficou prenhe a tempo' : 'a mãe morreu antes de parir';
  return { ok: true, reason, events: mergeEvents(weeks), brood, earlier };
}

// ---------- the breeder's knowledge ----------

/** Remove fish by the breeder's choice (they stay in the pedigree). */
export function cull(tank, ids) {
  const set = new Set(ids), removed = [];
  tank.alive = tank.alive.filter(f => {
    if (!set.has(f.id)) return true;
    Object.assign(tank.registry[f.id], { fate: 'descarte', diedDay: tank.day });
    removed.push(f);
    return false;
  });
  return removed;
}

/** Paternity test: reveals the father of a fish whose father was uncertain. Returns his id. */
export function paternityTest(tank, id) {
  const r = tank.registry[id];
  if (!r?.parents) throw Error('no parents to test');
  Object.assign(r, { fatherKnown: true, fatherCandidates: null });
  return r.parents[1];
}

/** Parents the breeder knows: [mother or null, father or null]; null for founders. */
export function knownParents(tank, id) {
  const r = tank.registry[id];
  if (!r?.parents) return null;
  return [r.motherKnown === false ? null : r.parents[0], r.fatherKnown === false ? null : r.parents[1]];
}

/**
 * Coefficient of inbreeding of a pair's offspring from what the breeder knows: unknown parents count
 * as unrelated, so the value is a minimum when the pedigree has an unknown parent (uncertain: true).
 */
export function coi(tank, motherId, fatherId) {
  const known = {};
  let uncertain = false;
  for (const [id, r] of Object.entries(tank.registry)) known[id] = { parents: knownParents(tank, id), generation: r.generation };
  const seen = new Set(), stack = [motherId, fatherId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id) || !tank.registry[id]) continue;
    seen.add(id);
    const r = tank.registry[id];
    if (r.parents && (r.fatherKnown === false || r.motherKnown === false)) uncertain = true;
    stack.push(...(known[id].parents ?? []));
  }
  let value = 0;
  try { value = pedigreeCOI(motherId, fatherId, known); } catch { value = 0; }
  return { value, uncertain };
}

/**
 * Drop dead fish nobody needs: kept in full are the living, their known ancestors and males whose
 * sperm is still stored; dead fish that showed a recessive marker stay as a small stub (evidence
 * for carrier deduction); the rest leave the registry.
 */
export function prune(species, tank) {
  const keep = new Set(), stack = tank.alive.map(f => f.id);
  for (const f of tank.alive) {
    for (const e of f.sperm) stack.push(e.maleId);
    for (const [id] of f.pregnancy?.weights ?? []) stack.push(id);
  }
  while (stack.length) {
    const id = stack.pop();
    if (!id || keep.has(id) || !tank.registry[id]) continue;
    keep.add(id);
    stack.push(...(knownParents(tank, id) ?? []));
  }
  const markers = recessiveMarkers(species);
  for (const [id, r] of Object.entries(tank.registry)) {
    if (keep.has(id) || !r.fate) continue;
    const p = r.fish ? genetic(species, r.fish) : r.stub;
    const shown = Object.fromEntries(markers.filter(m => p?.[m.trait] === m.value).map(m => [m.trait, m.value]));
    if (Object.keys(shown).length) { r.stub = shown; r.fish = null; } else delete tank.registry[id];
  }
}

// ---------- save / load ----------

/** Plain JSON snapshot of the fish room (genomes included), for saving. */
export function saveTank(species, tank) {
  const registry = {};
  for (const [id, r] of Object.entries(tank.registry)) {
    const base = { parents: r.parents, generation: r.generation, fate: r.fate, diedDay: r.diedDay, motherKnown: r.motherKnown,
      fatherKnown: r.fatherKnown, fatherCandidates: r.fatherCandidates };
    const f = r.fish;
    registry[id] = f ? { ...base, bornDay: f.bornDay, devSeed: f.devSeed, genome: f.genome, origin: f.origin ?? null, tankId: f.tankId,
      sperm: f.sperm, pregnancy: f.pregnancy, matedWith: f.matedWith, lastBirthDay: f.lastBirthDay, growth: f.growth, env: f.env ?? null }
      : { ...base, stub: r.stub };
  }
  return { format: TANK_FORMAT, speciesId: species.id, speciesVersion: species.version, seed: tank.seed, day: tank.day, broods: tank.broods,
    tanks: tank.tanks, maternityBox: tank.maternityBox, alive: tank.alive.map(f => f.id), registry };
}

/** Rebuild the fish room from saveTank output. Older formats: 1 (one tank), 2 (no pond, no growth). */
export function loadTank(species, data) {
  if (!data || ![1, 2, TANK_FORMAT].includes(data.format) || data.speciesId !== species.id) throw Error('incompatible tank save');
  if (!Number.isSafeInteger(data.day) || !Number.isSafeInteger(data.broods)) throw Error('invalid tank save');
  const tanks = data.format === 1 ? DEFAULT_TANKS
    : data.format === 2 ? [...data.tanks.map(t => ({ ...DEFAULT_TANKS.find(d => d.id === t.id), ...t })), ...DEFAULT_TANKS.filter(d => d.pond && !data.tanks.some(t => t.id === d.id))]
    : data.tanks;
  const tank = createTank(species, { seed: data.seed, tanks });
  tank.day = data.day; tank.broods = data.broods;
  tank.maternityBox = data.maternityBox ?? true;
  for (const [id, r] of Object.entries(data.registry ?? {})) {
    const entry = { id, parents: r.parents, generation: r.generation, fate: r.fate, diedDay: r.diedDay,
      motherKnown: r.motherKnown ?? true, fatherKnown: r.fatherKnown ?? true, fatherCandidates: r.fatherCandidates ?? null, fish: null };
    if (!r.genome) { entry.stub = r.stub ?? {}; tank.registry[id] = entry; continue; }
    const fish = { id, speciesId: species.id, generation: r.generation, parents: r.parents, devSeed: r.devSeed,
      genome: migrateGenome(species, r.genome, data.speciesVersion), bornDay: r.bornDay, ...(r.origin ? { origin: r.origin } : {}),
      tankId: r.tankId ?? null, sperm: r.sperm ?? [], pregnancy: r.pregnancy ?? null, matedWith: r.matedWith ?? [], lastBirthDay: r.lastBirthDay ?? null,
      env: r.env ?? null };
    fish.growth = r.growth ?? expectedGrowth(species, sexOf(fish), data.day - r.bornDay);
    if (!fish.tankId) {
      const fry = data.day - r.bornDay < lifeHistoryOf(species).sexingDays;
      fish.tankId = fry ? nurseryOf(tank).id : defaultTankFor(tank, fish);
    }
    entry.fish = fish;
    tank.registry[id] = entry;
  }
  tank.alive = (data.alive ?? []).map(id => {
    const r = tank.registry[id];
    if (!r?.fish || r.fate || !tankById(tank, r.fish.tankId)) throw Error('invalid tank save');
    return r.fish;
  });
  return tank;
}
