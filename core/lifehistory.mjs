// Life history from species data: maturity, fertility by age, brood size and lifespan. Pure and
// deterministic; every number comes from species.lifeHistory (see core/species.mjs for the meaning
// and docs/research.md for sources; the curve shapes are game assumptions, TBD).
import { deriveSeed, poisson, rngFromSeed } from './rng.mjs';
import { validateSpecies } from './species.mjs';

export function lifeHistoryOf(species) {
  validateSpecies(species);
  if (!species.lifeHistory) throw Error(`species ${species.id} has no lifeHistory`);
  return species.lifeHistory;
}

/** Chromosomal sex as the tank uses it ('male' | 'female'). Guppy has no sex reversal. */
export function sexOf(fish) {
  return fish.genome.sexChromosomes.includes('Y') ? 'male' : 'female';
}

/** Mean brood of a female at ageDays: 0 before maturity and after reproduction ends. */
export function meanBrood(species, ageDays) {
  const { maturityDays, brood: b } = lifeHistoryOf(species);
  const start = maturityDays.female;
  if (ageDays < start || ageDays >= b.endDays) return 0;
  if (ageDays < b.peakDays) return b.first + ((b.peak - b.first) * (ageDays - start)) / Math.max(1, b.peakDays - start);
  if (ageDays < b.declineDays) return b.peak;
  return (b.peak * (b.endDays - ageDays)) / (b.endDays - b.declineDays);
}

/** Male fertility factor at ageDays: 0 before maturity, 1 in his prime, down to `floor` when old. */
export function maleFertility(species, ageDays) {
  const { maturityDays, maleFertility: m } = lifeHistoryOf(species);
  if (ageDays < maturityDays.male) return 0;
  if (ageDays <= m.declineDays) return 1;
  if (ageDays >= m.endDays) return m.floor;
  return 1 - ((1 - m.floor) * (ageDays - m.declineDays)) / (m.endDays - m.declineDays);
}

/** Fertility 0..1 for display and ranking: a female's mean brood relative to her peak; a male's factor. */
export function fertility(species, sex, ageDays) {
  return sex === 'female' ? meanBrood(species, ageDays) / lifeHistoryOf(species).brood.peak : maleFertility(species, ageDays);
}

/** Each fish's own lifespan in days, drawn from its developmental seed. */
export function lifespanDays(species, fish) {
  const [min, max] = lifeHistoryOf(species).lifespanDays;
  return Math.round(min + (max - min) * rngFromSeed(deriveSeed(fish.devSeed, 'lifespan'))());
}

/** 'alevino' (sex not readable yet) | 'jovem' (not mature) | 'adulto' | 'idoso' (fertility falling). */
export function lifeStage(species, sex, ageDays) {
  const lh = lifeHistoryOf(species);
  if (ageDays < lh.sexingDays) return 'alevino';
  if (ageDays < lh.maturityDays[sex]) return 'jovem';
  const decline = sex === 'female' ? lh.brood.declineDays : lh.maleFertility.declineDays;
  return ageDays >= decline ? 'idoso' : 'adulto';
}

/**
 * Whether a pair can produce a brood now. Ages are at mating; the female gives birth one cycle later.
 * Returns { ok, reason } with a short Portuguese reason for the UI.
 */
export function pairStatus(species, motherAge, fatherAge) {
  const lh = lifeHistoryOf(species);
  if (motherAge < lh.maturityDays.female) return { ok: false, reason: `a mãe ainda é jovem (madura com ${lh.maturityDays.female} dias)` };
  if (fatherAge < lh.maturityDays.male) return { ok: false, reason: `o pai ainda é jovem (maduro com ${lh.maturityDays.male} dias)` };
  if (meanBrood(species, motherAge + lh.cycleDays) <= 0) return { ok: false, reason: 'a mãe já passou da idade de ter filhotes' };
  return { ok: true, reason: '' };
}

/** Expected brood size of a mating (mean, before chance). */
export function expectedBrood(species, motherAge, fatherAge) {
  return meanBrood(species, motherAge + lifeHistoryOf(species).cycleDays) * maleFertility(species, fatherAge);
}

/** Brood size of one mating: Poisson around the expected size, so small or empty broods happen. */
export function broodSize(species, motherAge, fatherAge, rng) {
  const mean = expectedBrood(species, motherAge, fatherAge);
  return mean > 0 ? poisson(rng, mean) : 0;
}
