// "Can this fish exist?" A breeder picks visible traits; the answer comes from the same species data and
// phenotype resolver that make every fish in the game, so what it says is what can be born. It looks for
// a genotype that shows all the asked values at once (per sex), and when there is none it says why: a
// trait with two values, a value no gene makes in that sex, or one gene hiding another (epistasis).
import { founder, phenotype } from './engine.mjs';
import { locusEffects, validateSpecies, yLocus } from './species.mjs';

const MAX_COMBOS = 20000;

function lociOf(species) {
  const out = [];
  for (const chr of species.chromosomes) for (const locus of chr.loci) out.push({ locus, where: 'autosomal' });
  for (const locus of species.xChromosome?.loci ?? []) out.push({ locus, where: 'X' });
  return out;
}

/** Genotype options at a locus: unordered allele pairs (an X in a male is one allele, written as a pair). */
function options(locus, where, sex) {
  const a = locus.alleles, out = [];
  if (where === 'X' && sex === 'male') return a.map(x => [x, x]);
  for (let i = 0; i < a.length; i++) for (let j = i; j < a.length; j++) out.push([a[i], a[j]]);
  return out;
}

const wildPair = locus => [locus.wild ?? locus.alleles[0], locus.wild ?? locus.alleles[0]];

/**
 * Number traits that an epistasis rule reads with `atLeast` (e.g. the tail spread that makes a half-moon):
 * the search tries their polygenes all low and all high.
 */
function thresholdTraits(species) {
  const out = new Set();
  for (const r of species.epistasis ?? []) for (const c of Array.isArray(r.when) ? r.when : [r.when]) if ('atLeast' in c) out.add(c.trait);
  return out;
}

function makeFish(species, sex, alleles, y) {
  return founder(species, { id: 'possible', sex: sex === 'male' ? 'XY' : 'XX', yPattern: sex === 'male' ? y : undefined, alleles, devSeed: 1 });
}

function polyBase(species, level) {
  const t = thresholdTraits(species), out = {};
  for (const { locus } of lociOf(species)) {
    if (!locus.polygenic || !t.has(locus.effect.trait)) continue;
    const [a, b] = locus.alleles;
    const plus = locus.effect.perAllele[a] >= locus.effect.perAllele[b] ? a : b, minus = plus === a ? b : a;
    out[locus.id] = level === 'high' ? [plus, plus] : [minus, minus];
  }
  return out;
}

const shows = (p, want) => Object.entries(want).every(([k, v]) => p[k] === v);

/**
 * For one sex: genotype changes (from wild type) that make each asked value, then combinations of them,
 * each checked with phenotype(). Returns {ok, alleles, y, p} or {ok: false, missing, masks}.
 */
function searchSex(species, want, sex, depth = 0) {
  const y = yLocus(species);
  const asked = Object.entries(want).filter(([k, v]) => v !== species.traits[k].default);
  const results = [];
  for (const level of ['low', 'high']) {
    const base = polyBase(species, level);
    const baseY = y?.default ?? null;
    const producers = {};
    for (const [trait, value] of asked) {
      const list = [];
      const test = (alleles, yp) => phenotype(species, makeFish(species, sex, { ...base, ...alleles }, yp), { ageDays: 365 })[trait] === value;
      if (test({}, baseY)) list.push({ alleles: {}, y: null });
      for (const { locus, where } of lociOf(species)) {
        if (locus.polygenic || locus.kind === 'neutral') continue;
        if (!locusEffects(locus).some(e => e.trait === trait) && !touchesByEpistasis(species, trait)) continue;
        for (const pair of options(locus, where, sex)) {
          if (pair[0] === wildPair(locus)[0] && pair[1] === wildPair(locus)[1]) continue;
          if (test({ [locus.id]: pair }, baseY)) list.push({ alleles: { [locus.id]: pair }, y: null });
        }
      }
      if (sex === 'male' && y) for (const hap of y.alleles) if (hap !== baseY && test({}, hap)) list.push({ alleles: {}, y: hap });
      // values that only an epistasis rule makes (cobra = snakeskin + zebrinus): make the rule's conditions
      if (!list.length && depth < 2) {
        for (const rule of species.epistasis ?? []) {
          const makes = rule.set?.[trait] === value || Object.values(rule.map?.[trait] ?? {}).includes(value);
          if (!makes) continue;
          // each condition on its own (together they may already read as the rule's result), then all at once
          const conds = (Array.isArray(rule.when) ? rule.when : [rule.when]).filter(c => 'equals' in c);
          const parts = conds.map(c => searchSex(species, { [c.trait]: c.equals }, sex, depth + 1));
          if (parts.some(r => !r.ok)) continue;
          const alleles = {}; let yp = null, clash = false;
          for (const r of parts) {
            for (const [id, pair] of Object.entries(r.alleles)) {
              if (base[id] && base[id][0] === pair[0] && base[id][1] === pair[1]) continue;
              if (alleles[id] && (alleles[id][0] !== pair[0] || alleles[id][1] !== pair[1])) clash = true;
              alleles[id] = pair;
            }
            if (r.y && r.y !== baseY) { if (yp && yp !== r.y) clash = true; yp = r.y; }
          }
          if (!clash && test(alleles, yp ?? baseY)) list.push({ alleles, y: yp });
        }
      }
      // a value hidden by another allele of the same pathway (a sword under the wild-type... or a delta):
      // try two changes among the loci that make this trait
      if (!list.length && depth === 0 && level === 'high' && !results[0]?.producers[trait]?.length) {
        const makers = lociOf(species).filter(({ locus }) => !locus.polygenic && locusEffects(locus).some(e => e.trait === trait));
        const opts = makers.flatMap(({ locus, where }) => options(locus, where, sex).map(pair => ({ [locus.id]: pair })));
        outer: for (let i = 0; i < opts.length; i++) for (let j = i + 1; j < opts.length; j++) {
          const alleles = { ...opts[i], ...opts[j] };
          if (Object.keys(alleles).length < 2) continue;
          if (test(alleles, baseY)) { list.push({ alleles, y: null }); break outer; }
        }
        if (!list.length && sex === 'male' && y && locusEffects(y).some(e => e.trait === trait)) {
          outer2: for (const yp of y.alleles) for (const o of opts) if (test(o, yp)) { list.push({ alleles: o, y: yp }); break outer2; }
        }
      }
      // Y-linked colours: offer the Y route first (an X copy only arises by rare X-Y crossing over)
      list.sort((a, b) => (b.y ? 1 : 0) - (a.y ? 1 : 0));
      producers[trait] = list;
    }
    results.push({ level, base, producers });
  }
  // a value nothing makes in this sex
  const missing = asked.filter(([trait]) => results.every(r => !r.producers[trait].length)).map(([trait, value]) => ({ trait, value }));
  if (missing.length) return { ok: false, missing, masks: [] };
  for (const { base, producers } of results) {
    const lists = asked.map(([trait]) => producers[trait]);
    if (lists.some(l => !l.length)) continue;
    let tried = 0;
    const pick = (i, alleles, yp) => {
      if (tried++ > MAX_COMBOS) return null;
      if (i === lists.length) {
        const p = phenotype(species, makeFish(species, sex, { ...base, ...alleles }, yp ?? y?.default), { ageDays: 365 });
        return shows(p, want) ? { ok: true, alleles: { ...base, ...alleles }, y: yp ?? y?.default ?? null, p } : null;
      }
      for (const prod of lists[i]) {
        if (prod.y && yp && prod.y !== yp) continue;
        const clash = Object.entries(prod.alleles).some(([id, pair]) => alleles[id] && (alleles[id][0] !== pair[0] || alleles[id][1] !== pair[1]));
        if (clash) continue;
        const r = pick(i + 1, { ...alleles, ...prod.alleles }, prod.y ?? yp);
        if (r) return r;
      }
      return null;
    };
    const found = pick(0, {}, null);
    if (found) return found;
  }
  return { ok: false, missing: [], masks: masking(species, want, sex, results) };
}

/** Does an epistasis rule set or map this trait (so loci of other traits can make it)? */
function touchesByEpistasis(species, trait) {
  return (species.epistasis ?? []).some(r => (r.set && trait in r.set) || (r.map && trait in r.map));
}

/** Which asked value disappears when another one is made ("albino hides golden"), from the combined phenotype. */
function masking(species, want, sex, results) {
  const out = [];
  const asked = Object.entries(want).filter(([k, v]) => v !== species.traits[k].default);
  const r = results[0], yd = yLocus(species)?.default;
  for (let i = 0; i < asked.length; i++) for (let j = i + 1; j < asked.length; j++) {
    const [a, va] = asked[i], [b, vb] = asked[j];
    const pa = r.producers[a]?.[0], pb = r.producers[b]?.[0];
    if (!pa || !pb) continue;
    const q = phenotype(species, makeFish(species, sex, { ...r.base, ...pa.alleles, ...pb.alleles }, pb.y ?? pa.y ?? yd), { ageDays: 365 });
    const lostA = q[a] !== va, lostB = q[b] !== vb;
    if (lostA === lostB) continue;
    const [hider, hiderValue, hidden, hiddenValue] = lostB ? [a, va, b, vb] : [b, vb, a, va];
    out.push({ hider, hiderValue, hidden, hiddenValue });
  }
  return out;
}

/**
 * How the found genotype makes the asked values: each changed locus, where it sits and whether one copy
 * is enough (dominant) or two are needed (recessive). Loci with a `tbd` note keep it.
 */
function needs(species, found, sex, want) {
  const out = [];
  const base = makeFish(species, sex, {}, yLocus(species)?.default);
  const ok = (alleles, y) => shows(phenotype(species, makeFish(species, sex, alleles, y), { ageDays: 365 }), want);
  for (const { locus, where } of lociOf(species)) {
    const pair = found.alleles[locus.id];
    if (!pair || (pair[0] === wildPair(locus)[0] && pair[1] === wildPair(locus)[1])) continue;
    // drop it entirely: if the fish still shows everything, this locus is not needed
    const without = { ...found.alleles }; delete without[locus.id];
    if (ok(without, found.y)) continue;
    const mutant = pair.find(a => a !== (locus.wild ?? locus.alleles[0])) ?? pair[0];
    const one = where === 'X' && sex === 'male' ? null : ok({ ...found.alleles, [locus.id]: [mutant, locus.wild ?? locus.alleles[0]] }, found.y);
    out.push({ locus: locus.id, where, allele: mutant, copies: where === 'X' && sex === 'male' ? 1 : one ? 1 : 2, polygenic: !!locus.polygenic,
      traits: [...new Set(locusEffects(locus).map(e => e.trait))], tbd: locus.tbd ?? null });
  }
  const y = yLocus(species);
  if (sex === 'male' && y && found.y && found.y !== y.default && !ok(found.alleles, y.default)) {
    out.push({ locus: y.id, where: 'Y', allele: found.y, copies: 1, polygenic: false, traits: [...new Set(locusEffects(y).map(e => e.trait))], tbd: y.tbd ?? null });
  }
  void base;
  return out;
}

/**
 * want: {trait: value, ...} (one value per trait; a UI that lets the breeder pick two values of one trait
 * must say "one fish has one" itself). sex: 'male' | 'female' | 'any'.
 * Returns {possible, bySex: {male, female}} where each sex has {ok, needs, missing, masks}.
 */
export function canExist(species, want, { sex = 'any' } = {}) {
  validateSpecies(species);
  for (const [k, v] of Object.entries(want)) if (!species.traits[k] || species.traits[k].visible === false) throw Error('unknown trait ' + k);
  const sexes = sex === 'any' ? ['male', 'female'] : [sex];
  const bySex = {};
  for (const s of sexes) {
    const r = searchSex(species, want, s);
    bySex[s] = r.ok ? { ok: true, needs: needs(species, r, s, want), missing: [], masks: [] } : { ok: false, needs: [], missing: r.missing, masks: r.masks };
  }
  return { possible: sexes.some(s => bySex[s].ok), bySex };
}
