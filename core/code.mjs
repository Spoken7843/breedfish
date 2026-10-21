/** Prototype portable genome exchange. CRC32 is integrity checking, NOT anti-forgery.
 * PL1 encodes JSON, not an optimized binary packing. Do not accept this as production format.
 *
 * Versioning: `format` is the payload layout (migrated through FORMAT_MIGRATIONS);
 * `speciesVersion` is the species' loci/alleles revision (migrated through species.migrations);
 * `engineVersion` is informational only: a newer engine may render the same genome differently,
 * but it must never make an old code unreadable.
 */
import { ENGINE_VERSION } from './engine.mjs';
import { SPECIES, migrateGenome, validateSpecies, yLocus } from './species.mjs';

export const EXPORT_FORMAT = 1;
// FORMAT_MIGRATIONS[n] turns a format-n payload into format n+1. None needed yet.
const FORMAT_MIGRATIONS = {};

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}
function b64url(bytes) {
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function unb64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw Error('invalid code alphabet');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

export function packFish(fish) {
  const species = SPECIES[fish.speciesId];
  const payload = {
    format: EXPORT_FORMAT, engineVersion: ENGINE_VERSION, speciesId: fish.speciesId,
    speciesVersion: species?.version ?? 1, genome: fish.genome, devSeed: fish.devSeed,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return `PL1.${b64url(bytes)}.${crc32(bytes).toString(16).padStart(8, '0')}`;
}

function decode(code) {
  if (typeof code !== 'string' || code.length > 16000) throw Error('invalid code length');
  const bits = code.trim().split('.');
  if (bits.length !== 3 || bits[0] !== 'PL1' || !/^[0-9a-f]{8}$/.test(bits[2])) throw Error('invalid format');
  const bytes = unb64url(bits[1]);
  if (crc32(bytes).toString(16).padStart(8, '0') !== bits[2]) throw Error('checksum mismatch');
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!payload || typeof payload !== 'object') throw Error('invalid payload');
  return payload;
}

/** Species id of a code after integrity checks, so a UI can pick the right species before importing. */
export function peekSpecies(code) {
  const { speciesId } = decode(code);
  if (typeof speciesId !== 'string') throw Error('invalid species');
  return speciesId;
}

export function unpackFish(code, species) {
  validateSpecies(species);
  let payload = decode(code);
  if (!Number.isSafeInteger(payload.format) || payload.format < 1) throw Error('invalid format version');
  if (payload.format > EXPORT_FORMAT) throw Error('code from a newer version');
  while (payload.format < EXPORT_FORMAT) payload = FORMAT_MIGRATIONS[payload.format](payload);
  if (payload.speciesId !== species.id) throw Error('species mismatch');
  const speciesVersion = payload.speciesVersion ?? 1;
  if (!Number.isSafeInteger(speciesVersion) || speciesVersion < 1) throw Error('invalid species version');
  if (speciesVersion > species.version) throw Error('code from a newer species revision');
  const genome = migrateGenome(species, payload.genome, speciesVersion);
  if (!Number.isSafeInteger(payload.devSeed) || payload.devSeed < 0 || payload.devSeed >= 2 ** 32) throw Error('invalid developmental seed');
  const g = genome;
  if (!g || !Array.isArray(g.sexChromosomes) || g.sexChromosomes.length !== 2 || g.sexChromosomes.some(s => !['X', 'Y'].includes(s))) throw Error('invalid sex chromosomes');
  const yCount = g.sexChromosomes.filter(s => s === 'Y').length;
  if (yCount > 1) throw Error('invalid sex genotype');
  const y = yLocus(species);
  let yPattern = null;
  if (yCount === 1 && y) {
    if (!y.alleles.includes(g.yPattern)) throw Error('invalid Y pattern');
    yPattern = g.yPattern;
  } else if (yCount === 0 && g.yPattern != null) throw Error('Y pattern on an XX genome');
  // XY of a species without a Y-linked locus: engine 0.1.0 wrote 'plain' there; it carries no information.
  // Rebuild the genome from validated pieces only; unknown fields in the payload are dropped.
  const chromosomes = {};
  for (const chr of species.chromosomes) {
    const homologs = g.chromosomes?.[chr.id];
    if (!Array.isArray(homologs) || homologs.length !== 2) throw Error('missing chromosome');
    chromosomes[chr.id] = homologs.map(hap => {
      if (!Array.isArray(hap) || hap.length !== chr.loci.length) throw Error('invalid chromosome length');
      hap.forEach((allele, index) => { if (!chr.loci[index].alleles.includes(allele)) throw Error('unknown allele'); });
      return [...hap];
    });
  }
  const genomeOut = { chromosomes, sexChromosomes: [...g.sexChromosomes], yPattern };
  if (species.xChromosome) {
    const loci = species.xChromosome.loci, xCount = g.sexChromosomes.filter(s => s === 'X').length;
    if (!Array.isArray(g.x) || g.x.length !== xCount) throw Error('invalid X chromosomes');
    genomeOut.x = g.x.map(hap => {
      if (!Array.isArray(hap) || hap.length !== loci.length) throw Error('invalid chromosome length');
      hap.forEach((allele, index) => { if (!loci[index].alleles.includes(allele)) throw Error('unknown allele'); });
      return [...hap];
    });
  }
  return {
    id: 'EXTERNAL', origin: 'external', speciesId: species.id, generation: 0, parents: null, devSeed: payload.devSeed,
    genome: genomeOut,
  };
}
