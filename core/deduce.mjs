// What a breeder can conclude about hidden genes from phenotypes alone (docs/GDD.txt#L99: genotype
// hidden; the player deduces it from the pedigree, test crosses or the lab). No genotype is read here:
// only the species data (to know which visible values are simple recessives) and relatives' phenotypes.

/**
 * Simple recessive markers of a species: a visible value produced by the recessive allele of a
 * two-allele autosomal locus, in both sexes, different from the trait's default. Showing it means
 * the fish is homozygous for that allele.
 */
export function recessiveMarkers(species) {
  const markers = [], seen = new Set();
  for (const chr of species.chromosomes) {
    for (const locus of chr.loci) {
      if (!['mendelian', 'deleterious'].includes(locus.kind) || locus.alleles.length !== 2 || locus.expressedIn) continue;
      const effects = locus.effects ?? (locus.effect ? [locus.effect] : []);
      if (effects.length !== 1 || effects[0].genotypes) continue;
      const effect = effects[0], trait = species.traits[effect.trait];
      const [dominant, recessive] = locus.alleles;
      const value = effect.values[recessive];
      if (value === null || value === effect.values[dominant] || value === trait.default || trait.sexLimited || trait.visible === false) continue;
      const key = `${effect.trait}=${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = trait.type === 'bool' ? trait.label : (trait.labels?.[value] ?? String(value));
      markers.push({ key, trait: effect.trait, value, label: label ?? key });
    }
  }
  return markers;
}

/**
 * Carriers deduced from relatives. `phenotypeOf(id)` gives a fish's phenotype (or null if unknown),
 * `parentsOf(id)` its parent ids (or null) and `childrenOf(id)` its children's ids.
 * Returns { confirmed: [marker], possible: [marker] } for markers the fish does not show:
 * confirmed when a parent or a child shows the marker (the fish must carry one copy);
 * possible when a parent is a confirmed carrier.
 */
export function deduceCarriers(markers, id, { phenotypeOf, parentsOf, childrenOf }) {
  const shows = (fid, m) => phenotypeOf(fid)?.[m.trait] === m.value;
  const confirmedFor = (fid, m) => !shows(fid, m)
    && ((parentsOf(fid) ?? []).some(p => shows(p, m)) || childrenOf(fid).some(c => shows(c, m)));
  const confirmed = [], possible = [];
  for (const m of markers) {
    if (shows(id, m)) continue;
    if (confirmedFor(id, m)) confirmed.push(m);
    else if ((parentsOf(id) ?? []).some(p => confirmedFor(p, m))) possible.push(m);
  }
  return { confirmed, possible };
}
