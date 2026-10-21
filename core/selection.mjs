// Selection tools that use only what a breeder can see (phenotypes) plus species data: batch
// statistics, truncation by a score, heritability of quantitative traits and the breeder's equation
// for a pair. Pure; no genotype is read here.
import { validateSpecies } from './species.mjs';

/** Quantitative traits a breeder can measure: labelled, visible number traits fed by additive loci. */
export function quantitativeTraits(species) {
  validateSpecies(species);
  const fed = new Set(species.chromosomes.flatMap(c => c.loci).filter(l => l.kind === 'additive').map(l => l.effect.trait));
  return Object.entries(species.traits).filter(([k, t]) => t.type === 'number' && t.label && t.visible !== false && fed.has(k)).map(([k]) => k);
}

/**
 * Narrow-sense heritability of a number trait at allele frequency 1/2: additive variance of its loci
 * over that plus the environmental variance of its noise. It falls as selection fixes alleles; this is
 * the value of an unselected population.
 */
export function heritability(species, trait) {
  const t = species.traits[trait];
  let va = 0;
  for (const chr of species.chromosomes) {
    for (const l of chr.loci) {
      if (l.kind !== 'additive' || l.effect.trait !== trait) continue;
      const [a, b] = l.alleles;
      va += 2 * 0.25 * (l.effect.perAllele[a] - l.effect.perAllele[b]) ** 2;
    }
  }
  const ve = t.noiseShape === 'normal' ? (t.noise ?? 0) ** 2 : (t.noise ?? 0) ** 2 / 12;
  return va + ve > 0 ? va / (va + ve) : 0;
}

/** Mean, standard deviation and a 10-bin histogram of values in [0, 1]. */
export function batchStats(values) {
  const n = values.length;
  const bins = Array(10).fill(0);
  if (!n) return { n, mean: null, sd: null, min: null, max: null, bins };
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) { sum += v; min = Math.min(min, v); max = Math.max(max, v); bins[Math.min(9, Math.max(0, Math.floor(v * 10)))]++; }
  const mean = sum / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean, sd, min, max, bins };
}

/** Counts of each value, most common first: [[value, count]]. */
export function categoryCounts(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Truncation selection: keep the best `fraction` of items by score (ties keep the original order). */
export function selectTop(items, score, fraction) {
  if (!(fraction > 0 && fraction <= 1)) throw RangeError('fraction must be in (0, 1]');
  const ranked = items.map((item, i) => ({ item, i, s: score(item) })).sort((a, b) => b.s - a.s || a.i - b.i);
  const k = Math.max(1, Math.round(items.length * fraction));
  return { keep: ranked.slice(0, k).map(r => r.item), cull: ranked.slice(k).map(r => r.item) };
}

/**
 * Breeder's equation for a pair: expected offspring mean = population mean + h2 x (midparent -
 * population mean). Values are phenotypes the breeder measured; popMean is the batch average.
 */
export function predictOffspring(species, trait, motherValue, fatherValue, popMean) {
  const h2 = heritability(species, trait);
  const mid = (motherValue + fatherValue) / 2;
  return { mean: popMean + h2 * (mid - popMean), h2 };
}
