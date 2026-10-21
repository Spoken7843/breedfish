import { hashString, poisson, randomInt, randomSeed, rngFromSeed } from './rng.mjs';
import { findLocus, validateSpecies, yLocus } from './species.mjs';

export { phenotype, displayTraits } from './phenotype.mjs';

/** Bump when meiosis, mutation or expression rules change the individuals produced from the same inputs. */
export const ENGINE_VERSION = '0.5.0';

// Genome: {chromosomes:{C1:[[allele,...],[allele,...]], ...}, sexChromosomes:['X','Y'], yPattern: 'ornate'|null,
//          x: [[allele,...] per X]} (x only for species with an xChromosome; XX has two haplotypes, XY one).
// Founder alleles for an X-linked locus are given as a pair like any other; an XY founder uses the first.
export function founder(species, { id, sex = 'XX', yPattern, alleles = {}, devSeed }) {
  validateSpecies(species);
  if (!['XX', 'XY'].includes(sex)) throw Error('invalid chromosomal sex');
  const y = yLocus(species);
  let pattern = null;
  if (sex === 'XY' && y) {
    pattern = yPattern ?? y.default;
    if (!y.alleles.includes(pattern)) throw Error('invalid Y allele');
  } else if (yPattern != null && sex === 'XY') throw Error('species has no Y-linked locus');
  const chromosomes = {};
  for (const chr of species.chromosomes) {
    chromosomes[chr.id] = [[], []];
    for (const locus of chr.loci) {
      const wild = locus.wild ?? locus.alleles[0];
      const pair = alleles[locus.id] ?? [wild, wild];
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some(a => !locus.alleles.includes(a))) throw Error('invalid allele ' + locus.id);
      chromosomes[chr.id][0].push(pair[0]);
      chromosomes[chr.id][1].push(pair[1]);
    }
  }
  const genome = { chromosomes, sexChromosomes: sex.split(''), yPattern: pattern };
  if (species.xChromosome) {
    const xCount = sex === 'XX' ? 2 : 1;
    genome.x = Array.from({ length: xCount }, () => []);
    for (const locus of species.xChromosome.loci) {
      const wild = locus.wild ?? locus.alleles[0];
      const pair = alleles[locus.id] ?? [wild, wild];
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some(a => !locus.alleles.includes(a))) throw Error('invalid allele ' + locus.id);
      genome.x.forEach((hap, h) => hap.push(pair[h]));
    }
  }
  // Without an explicit devSeed each founder still gets its own developmental noise, derived from its id.
  const seed = devSeed ?? hashString(`${species.id}:${id}`);
  return { id, speciesId: species.id, generation: 0, parents: null, genome, devSeed: seed };
}

/**
 * Hidden genetic load of a founder from the source population (docs/GDD.txt#L124): for every
 * deleterious locus with a carrierFrequency, a founder carries one copy with that probability.
 * Founders sold are healthy, so carriers are heterozygous. Returns a founder `alleles` map.
 */
export function founderLoad(species, seed) {
  validateSpecies(species);
  const rng = rngFromSeed(seed >>> 0), load = {};
  for (const chr of species.chromosomes) {
    for (const locus of chr.loci) {
      if (!locus.carrierFrequency) continue;
      const [healthy, bad] = locus.alleles;
      if (rng() < locus.carrierFrequency) load[locus.id] = [healthy, bad];
    }
  }
  return load;
}

/**
 * Polygenic make-up of a founder from its line: `profile` maps a quantitative trait to the frequency
 * of the increasing allele in that line (0..1). Founders of a line differ from each other, so
 * selection inside a line works. Returns a founder `alleles` map.
 */
export function founderPolygenes(species, profile, seed) {
  validateSpecies(species);
  const rng = rngFromSeed(seed >>> 0), alleles = {};
  for (const chr of species.chromosomes) {
    for (const locus of chr.loci) {
      if (!locus.polygenic) continue;
      const p = profile?.[locus.effect.trait];
      if (p === undefined) continue;
      const [a, b] = locus.alleles;
      const plus = locus.effect.perAllele[a] >= locus.effect.perAllele[b] ? a : b, minus = plus === a ? b : a;
      alleles[locus.id] = [rng() < p ? plus : minus, rng() < p ? plus : minus];
    }
  }
  return alleles;
}

/** Recombine two homologs of a chromosome definition into one haplotype (Haldane, Poisson crossovers). */
function recombine(chr, homologs, rng) {
  const crossovers = Array.from({ length: poisson(rng, chr.lengthCm / 100) }, () => rng() * chr.lengthCm).sort((a, b) => a - b);
  let homolog = randomInt(rng, 2), cursor = 0;
  return chr.loci.map((locus, index) => {
    while (cursor < crossovers.length && crossovers[cursor] < locus.positionCm) { homolog ^= 1; cursor++; }
    return homologs[homolog][index];
  });
}

export function makeGamete(species, genome, rng) {
  validateSpecies(species);
  const chromosomes = {};
  for (const chr of species.chromosomes) {
    const homologs = genome.chromosomes[chr.id];
    if (!homologs || homologs.length !== 2 || homologs.some(h => h.length !== chr.loci.length)) throw Error('invalid genome for chromosome ' + chr.id);
    chromosomes[chr.id] = recombine(chr, homologs, rng);
  }
  const sexChromosome = genome.sexChromosomes[randomInt(rng, 2)];
  // A female's two X recombine like autosomes. In a male, the Y locus can rarely swap with its X
  // partner (xyRecombination), moving a Y pattern to the X and back. The X draws come last, so
  // species without an X keep the exact gametes of earlier engine versions.
  let x = null, yPattern = sexChromosome === 'Y' ? genome.yPattern : null;
  const X = species.xChromosome;
  if (X) {
    const xs = genome.x;
    const expected = genome.sexChromosomes.filter(s => s === 'X').length;
    if (!Array.isArray(xs) || xs.length !== expected || xs.some(h => h.length !== X.loci.length)) throw Error('invalid genome for chromosome X');
    const y = yLocus(species);
    if (expected === 1 && y?.xPartner && y.xyRecombination > 0 && rng() < y.xyRecombination) {
      const i = X.loci.findIndex(l => l.id === y.xPartner);
      if (sexChromosome === 'X') { x = [...xs[0]]; x[i] = genome.yPattern; } else yPattern = xs[0][i];
    } else if (sexChromosome === 'X') x = xs.length === 2 ? recombine(X, xs, rng) : [...xs[0]];
  }
  return { chromosomes, sexChromosome, yPattern, x };
}

export function offspring(species, mother, father, rng, id) {
  if (mother.speciesId !== species.id || father.speciesId !== species.id) throw Error('cross-species breeding not enabled');
  if (mother.genome.sexChromosomes.includes('Y')) throw Error('mother must be chromosomal XX in this vertical slice');
  if (!father.genome.sexChromosomes.includes('Y')) throw Error('father must be chromosomal XY in this vertical slice');
  const a = makeGamete(species, mother.genome, rng), b = makeGamete(species, father.genome, rng);
  const chromosomes = {};
  for (const chr of species.chromosomes) chromosomes[chr.id] = [a.chromosomes[chr.id], b.chromosomes[chr.id]];
  const genome = { chromosomes, sexChromosomes: [a.sexChromosome, b.sexChromosome], yPattern: b.sexChromosome === 'Y' ? b.yPattern : null };
  if (species.xChromosome) genome.x = [a.x, ...(b.sexChromosome === 'X' ? [b.x] : [])];
  return {
    id, speciesId: species.id, generation: Math.max(mother.generation ?? 0, father.generation ?? 0) + 1, parents: [mother.id, father.id], devSeed: randomSeed(rng),
    genome,
  };
}

/** Alleles a fish carries at a locus: two for autosomes and XX, one for the single X of a male. */
export function genotypeAt(species, fish, locusId) {
  const found = findLocus(species, locusId);
  if (!found) return null;
  if (found.xLinked) return fish.genome.x.map(h => h[found.index]);
  return fish.genome.chromosomes[found.chromosome.id].map(h => h[found.index]);
}

export function batch(species, mother, father, { seed = 2026, count = 100 } = {}) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100000) throw RangeError('invalid batch size');
  const rng = rngFromSeed(seed);
  return Array.from({ length: count }, (_, i) => offspring(species, mother, father, rng, `${mother.id}-${father.id}-${seed}-${i}`));
}
