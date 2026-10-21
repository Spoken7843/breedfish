import { deriveSeed, rngFromSeed } from './rng.mjs';
import { genotypeKey, locusEffects, validateSpecies, yLocus } from './species.mjs';

function clamp(x, min, max) { return Math.min(max, Math.max(min, x)); }

/** The allele expressed under complete dominance: the first of locus.alleles present in the genotype. */
function expressedAllele(alleles, genotype) {
  return alleles.find(a => genotype.includes(a));
}

/** Value one effect gives for a genotype; null means the effect does not contribute. */
function effectValue(effect, alleles, genotype) {
  if (effect.genotypes) return effect.genotypes[genotypeKey(alleles, genotype[0], genotype[1])];
  return effect.values[expressedAllele(alleles, genotype)];
}

/**
 * Generic genotype -> phenotype resolution driven entirely by species data (see core/species.mjs).
 * Deterministic for (species, genome, devSeed, environment). No locus or trait names are hard-coded here.
 */
/**
 * Options: ageDays (maturity of colours and fins), growth (0..1 body length attained; default from
 * age), environment ({trait: value} set by rearing, not genes: e.g. a spinal defect from heat; it
 * overrides the genetic value and is listed in `environmental`), temperatureC (sex reversal species).
 */
export function phenotype(species, fish, { ageDays = 100, temperatureC = 26, growth = null, environment = null } = {}) {
  validateSpecies(species);
  const chromosomalSex = fish.genome.sexChromosomes.includes('Y') ? 'XY' : 'XX';
  const sexReversed = species.sexReversalTemperatureC !== null && chromosomalSex === 'XX' && temperatureC >= species.sexReversalTemperatureC;
  const observedSex = chromosomalSex === 'XY' || sexReversed ? 'male' : 'female';

  const discrete = {}; // trait -> list of values from loci
  const sums = {};     // trait -> additive total
  const push = (trait, value) => { (discrete[trait] ??= []).push(value); };

  const express = (locus, genotype) => {
    if (locus.kind === 'neutral' || (locus.expressedIn && locus.expressedIn !== observedSex)) return;
    for (const effect of locusEffects(locus)) {
      if (locus.kind === 'additive') {
        sums[effect.trait] = (sums[effect.trait] ?? 0) + genotype.reduce((s, a) => s + effect.perAllele[a], 0);
      } else {
        const v = effectValue(effect, locus.alleles, genotype);
        if (v !== null && v !== undefined) push(effect.trait, v);
      }
    }
  };
  for (const chr of species.chromosomes) {
    const homologs = fish.genome.chromosomes[chr.id];
    chr.loci.forEach((locus, index) => express(locus, [homologs[0][index], homologs[1][index]]));
  }
  // X-linked loci: XX reads both haplotypes; a single X is hemizygous and counts as a double dose.
  if (species.xChromosome) {
    const xs = fish.genome.x;
    species.xChromosome.loci.forEach((locus, index) => express(locus, [xs[0][index], (xs[1] ?? xs[0])[index]]));
  }
  const y = yLocus(species);
  if (y && chromosomalSex === 'XY' && fish.genome.yPattern != null) {
    for (const effect of locusEffects(y)) {
      const v = effect.values[fish.genome.yPattern];
      if (v !== null && v !== undefined) push(effect.trait, v);
    }
  }

  // One independent noise draw per number trait, in declaration order, so traits do not co-vary by accident.
  const noise = rngFromSeed(deriveSeed(fish.devSeed, 'phenotype'));
  const traits = {};
  for (const [name, t] of Object.entries(species.traits)) {
    let value;
    if (t.type === 'number') {
      // 'normal': the sum of three uniform draws, scaled to sd 1 (traits added later keep earlier draws)
      const r = t.noiseShape === 'normal' ? (noise() + noise() + noise() - 1.5) / 0.5 : noise() - 0.5;
      value = clamp(t.base + (sums[name] ?? 0) + (t.noise ?? 0) * r, t.min, t.max);
    } else {
      const values = discrete[name];
      if (!values?.length) value = t.default;
      else if (t.type === 'bool') value = t.combine === 'all' ? values.every(Boolean) : values.some(Boolean);
      else if (t.combine === 'priority') value = t.priority.find(o => values.includes(o));
      else value = values[0];
    }
    if (t.sexLimited && t.sexLimited !== observedSex) value = t.type === 'number' ? t.base : t.default;
    traits[name] = value;
  }
  for (const rule of species.epistasis ?? []) {
    if (traits[rule.when.trait] === rule.when.equals) Object.assign(traits, rule.set);
  }
  const environmental = [];
  for (const [name, value] of Object.entries(environment ?? {})) {
    if (!(name in species.traits) || value === undefined || value === null) continue;
    if (traits[name] !== value) environmental.push(name);
    traits[name] = value;
  }
  const maturity = clamp(ageDays / species.growth.adultAgeDays, 0.1, 1);

  return {
    species: species.id, chromosomalSex, observedSex, sexReversed,
    ...traits,
    maturity, sizeFactor: growth === null ? maturity : clamp(growth, 0.05, 1.2), ageDays, environmental,
    spotsSeed: deriveSeed(fish.devSeed, 'spots'), temperatureC,
  };
}

/** Traits the UI may show, with display labels; hidden-genotype rules are the caller's concern. */
export function displayTraits(species, p) {
  return Object.entries(species.traits)
    .filter(([, t]) => t.label && t.visible !== false)
    .map(([name, t]) => {
      const v = p[name];
      const text = t.type === 'bool' ? (v ? 'Sim' : 'Não')
        : t.type === 'enum' ? (t.labels?.[v] ?? v)
        : `${Math.round(v * 100)}%`;
      return { name, label: t.label, value: v, text };
    });
}
