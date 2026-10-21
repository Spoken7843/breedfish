// Development laboratory (AGENTS.md rule 5 exception): the genotype in compact notation. Never shown in
// Creator mode; the prototype exposes it only behind an explicit "lab" switch.
import { yLocus } from './species.mjs';

/** Non-wild alleles of every locus, e.g. "Alb a/a · Fc Bl/+ · X:Xc koi/plain · Y snakeskin". */
export function genotypeSummary(species, fish) {
  const parts = [];
  const poly = {};   // polygenic loci are summed per trait: "+ alleles / total"
  for (const chr of species.chromosomes) {
    chr.loci.forEach((locus, i) => {
      const [a, b] = fish.genome.chromosomes[chr.id].map(h => h[i]);
      if (locus.polygenic) {
        const t = (poly[locus.effect.trait] ??= { plus: 0, total: 0 });
        const plus = locus.effect.perAllele[locus.alleles[0]] >= locus.effect.perAllele[locus.alleles[1]] ? locus.alleles[0] : locus.alleles[1];
        t.plus += (a === plus) + (b === plus); t.total += 2;
        return;
      }
      const wild = locus.wild ?? locus.alleles[0];
      if (a !== wild || b !== wild) parts.push(`${locus.id} ${a}/${b}`);
    });
  }
  for (const [trait, t] of Object.entries(poly)) parts.push(`${species.traits[trait]?.label ?? trait} ${t.plus}/${t.total}+`);
  if (species.xChromosome && fish.genome.x) {
    species.xChromosome.loci.forEach((locus, i) => {
      const wild = locus.wild ?? locus.alleles[0];
      const alleles = fish.genome.x.map(h => h[i]);
      if (alleles.some(a => a !== wild)) parts.push(`X:${locus.id} ${alleles.join('/')}`);
    });
  }
  if (yLocus(species) && fish.genome.yPattern) parts.push(`Y ${fish.genome.yPattern}`);
  return parts.join(' · ') || 'tudo selvagem';
}
