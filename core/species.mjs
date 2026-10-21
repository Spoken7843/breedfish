import { hashString, rngFromSeed } from './rng.mjs';

// Game genetics as data. Each species definition is data only; the engine and the phenotype resolver
// are species-agnostic. Guppy loci are modelled on genes described by breeders and papers (see
// docs/research.md), simplified for play; they are NOT validated genetic maps. TBD = no source yet.
//
// Locus kinds:
//   mendelian   - alleles listed in dominance order (first = most dominant); an effect maps the
//                 expressed allele to a trait value (null = no contribution). `genotypes` maps a whole
//                 genotype ('x/y', in allele-list order) and wins over `values`: incomplete dominance.
//   deleterious - same resolution as mendelian; tagged for genetic-load features (lab panels, viability).
//   additive    - effect.perAllele adds a number per allele copy to a number trait.
//   neutral     - no visible effect; marker for lab tests.
// A locus may have one `effect` or several `effects`. `wild` names the wild-type allele (default: first).
// Trait types: bool | enum | number. A bool fed by several effects needs combine 'any'|'all'; an enum fed
// by several needs combine 'priority' with a `priority` list (first wins). Number traits sum base +
// additive contributions + developmental noise, then clamp. sexLimited: only expressed in that observed
// sex. epistasis: ordered rules applied after all loci; `when` reads resolved traits (equals, in, atLeast;
// a list means all), `set` overrides, `map` turns listed values of a trait into others.
// expressedIn (locus or effect): only acts in that observed sex (carried silently by the other).
// codominant (mendelian locus with `values`): every allele present acts, not only the most dominant one
// (a haplotype block: a female's two X both show their genes).
// female (effect, 0..1): the effect also acts in females, at that strength (a male colour that shows
// faint in females); the phenotype lists such weakened traits in `strength`.
// carrierFrequency (deleterious locus): share of founders from the source population that carry one
// hidden copy (heterozygous; drawn by founderLoad). visible: false (trait): exists in the phenotype for
// the simulation (viability, fertility) but a breeder cannot see it; UIs never list it.
// polygenic (additive locus): one of many small-effect loci of a quantitative trait; founders draw
// them from a line profile (founderPolygenes). noiseShape 'normal' (number trait): environmental
// noise is roughly normal with sd = noise (default: uniform of width noise).
// xPartner (Y locus): the X locus it pairs with; xyRecombination is the chance per male meiosis that
// the two swap (a Y pattern moves to the X and back).
//
// Sex chromosomes: `xChromosome` (optional) holds X-linked loci. Females carry two X haplotypes that
// recombine like an autosome pair; males carry one X (hemizygous: its allele is expressed as if
// homozygous) plus the Y, whose single non-recombining locus lives in `sexLoci`.
//
// lifeHistory (optional, game values; TBD unless a source is cited in docs/research.md): ages in days.
//   maturityDays {female, male}; sexingDays (sex readable from); cycleDays (gestation or clutch cycle);
//   brood {first, peak, peakDays, declineDays, endDays}: mean brood by mother age, rising from `first`
//   at maturity to `peak`, flat until declineDays, then falling to zero at endDays;
//   maleFertility {declineDays, endDays, floor}: 1 until declineDays, then down to `floor` at endDays;
//   lifespanDays [min, max]: each fish draws its own lifespan from its developmental seed;
//   receptiveDays: a female can be inseminated from this age (conception waits for maturity);
//   sperm (species with spermStorage): weeklyKeep (stored sperm kept per week), usePerConception,
//   minViable (below it the store is spent), freshShare (paternity share of sperm received since the
//   last conception), lastMaleBonus (weight of the most recent male among the fresh ones);
//   weeklyMating / weeklyConception: chances per week that a receptive female sharing a tank with a
//   mature male mates, and that a mature female with viable sperm conceives.
// husbandry (optional, game values): fry survival at birth in a nursery, in a tank with adults
// (cannibalism per adult), mortality when a tank is over capacity, and the age window in which a
// fry lethal kills (fryLethalDays). temperature: reference (where cycleDays and growth hold), q10 of
// development, the range where broods shrink (stressFromC to lethalC) and environmental spinal
// defects per degree above defectFromC. food: growth and fry-survival factors per ration.
// growth (lifeHistory.growth): body length as a fraction of each fish's own adult length: at birth,
// weekly rate toward 1 by sex under reference conditions, the male's slowdown after maturity, and
// adult length in mm by sex (range set by the bodySize trait).

const GUPPY_Y_ALLELES = ['plain', 'ornate', 'snakeskin', 'cobra', 'moscow', 'japanBlue', 'coral', 'platinum',
  'dragon', 'koi', 'fullRed', 'doubleSword', 'topSword', 'bottomSword', 'redTail', 'blueTail',
  'moscowBlack', 'panda', 'galaxy', 'neonBlue', 'yellowTail', 'purpleTail', 'greenTail', 'multiTail', 'lace'];
/** Y haplotype effect table: every allele maps to null unless listed. */
const yValues = listed => Object.fromEntries(GUPPY_Y_ALLELES.map(a => [a, a in listed ? listed[a] : null]));
/**
 * What each sex-linked haplotype does; shared by the Y locus and its X-linked copy. A haplotype is a
 * block of linked genes, so one can carry several layers (galaxy = platinum + snakeskin), and the layers
 * of a male's X and Y add up (snakeskin from one, full red from the other). Most male colour genes act
 * only in males [19]; full red shows, weaker, in females [22] (strength TBD) and the snakeskin tail
 * (Sst) can show faintly in females [25]. Snakeskin body (Ssb) and tail (Sst) are separate genes [19]:
 * 'snakeskin' and 'cobra' carry both, 'lace' only the tail (the "lacetail"). Cobra bars come from the
 * autosomal Zebrinus (v8). Koi left the sex chromosomes in v7 (autosomal Kohaku, Ko); the 'koi'
 * haplotype survives only as a red tail for old codes. Platinum (Schimmelpfennig, Sc) is Y-linked [28].
 */
const GUPPY_SEX_PATTERN_EFFECTS = [
  { trait: 'pattern', expressedIn: 'male', values: yValues({ ornate: true, doubleSword: true, topSword: true, bottomSword: true }) },
  { trait: 'snakeskin', expressedIn: 'male', values: yValues({ snakeskin: 'snakeskin', cobra: 'snakeskin', galaxy: 'snakeskin' }) },
  { trait: 'bodyPattern', expressedIn: 'male', values: yValues({ moscow: 'moscow', japanBlue: 'japanBlue', coral: 'coral', moscowBlack: 'moscowBlack',
    panda: 'panda', neonBlue: 'neonBlue', platinum: 'platinum', dragon: 'dragon', galaxy: 'platinum' }) },
  { trait: 'fullRed', female: 0.55, values: yValues({ fullRed: true }) },
  { trait: 'tailPattern', female: 0.3, values: yValues({ snakeskin: 'snakeskin', cobra: 'snakeskin', galaxy: 'snakeskin', lace: 'snakeskin' }) },
  { trait: 'tailColor', expressedIn: 'male', values: yValues({ koi: 'red', dragon: 'red', fullRed: 'red', redTail: 'red', coral: 'red', blueTail: 'blue',
    japanBlue: 'blue', moscow: 'dark', platinum: 'white', moscowBlack: 'dark', panda: 'dark', neonBlue: 'blue', yellowTail: 'yellow',
    purpleTail: 'purple', greenTail: 'green', multiTail: 'multi' }) },
  { trait: 'tailShape', expressedIn: 'male', values: yValues({ doubleSword: 'doubleSword', topSword: 'topSword', bottomSword: 'bottomSword' }) },
];

const label = (text, labels) => ({ label: text, ...(labels ? { labels } : {}) });
/** One small-effect locus of a quantitative trait: '+' adds `step`, '-' (wild) adds nothing. */
const poly = (id, positionCm, trait, step) => ({ id, positionCm, alleles: ['+', '-'], wild: '-', kind: 'additive', polygenic: true,
  effect: { trait, perAllele: { '+': step, '-': 0 } } });

export const SPECIES = {
  guppy: {
    id: 'guppy', label: 'Guppy', version: 8, view: 'lateral', reproductiveMode: 'livebearer',
    sexSystem: 'XY', sexReversalTemperatureC: null,
    spermStorage: true, eggCannibalism: false,
    growth: { adultAgeDays: 90 }, // TBD
    // FishBase: males mature at 2 months, females at 3; broods of 20-40 every ~4 weeks.
    // Reznick et al. 2006: ~20 broods per life, skipped litters and a post-reproductive phase. Curve shape TBD.
    lifeHistory: {
      maturityDays: { female: 90, male: 60 }, sexingDays: 30, cycleDays: 28,
      brood: { first: 8, peak: 32, peakDays: 240, declineDays: 540, endDays: 760 },
      maleFertility: { declineDays: 600, endDays: 1000, floor: 0.3 },
      lifespanDays: [720, 1050],
      receptiveDays: 60, weeklyMating: 0.7, weeklyConception: 0.9, // chances per week in a shared tank (TBD)
      // Lopez-Sepulcre et al. 2013: stored sperm still fertilizes 10 months after the male died.
      // Gasparini et al. 2018: fresh sperm sires ~99% of a brood over stored sperm. Evans & Magurran
      // 2001: second-male priority is more common than first-male priority. Exact rates TBD.
      sperm: { weeklyKeep: 0.93, usePerConception: 0.15, minViable: 0.03, freshShare: 0.98, lastMaleBonus: 2 },
      // Females keep growing all their life; males almost stop at maturity (TBD rates).
      growth: { birth: 0.15, weeklyRate: { female: 0.12, male: 0.18 }, maleAfterMaturity: 0.12, adultLengthMm: { female: [42, 60], male: [24, 34] } },
    },
    // Nakadate et al. 2003: inbreeding lowered guppy survival to day 120; fry lethals act in that window.
    // Arfah et al. 2005: 18-22 days of gestation and ~16 fry at 27 C; fewer fry (~10) and abnormal
    // vertebrae at 30 C; no births at 33 C. q10 and the reference temperature are game values (TBD).
    husbandry: { fryNurserySurvival: 0.9, fryBaseSurvival: 0.85, cannibalismPerAdult: 0.04, crowdMortality: 0.04, fryLethalDays: [7, 110],
      temperature: { referenceC: 25, q10: 2.5, stressFromC: 28, lethalC: 33, defectFromC: 29, defectPerDegree: 0.06 },
      food: { pouca: { growth: 0.6, fry: 0.85 }, normal: { growth: 1, fry: 1 }, farta: { growth: 1.3, fry: 1.05 } } }, // TBD
    traits: {
      albino:       { type: 'bool', default: false, ...label('Albino') },
      melanin:      { type: 'number', base: 1, min: 0, max: 1 },
      bodyBase:     { type: 'enum', default: 'grey', options: ['grey', 'blond', 'golden'], combine: 'priority', priority: ['golden', 'blond', 'grey'],
                      ...label('Cor de base', { grey: 'Cinza', blond: 'Blond', golden: 'Golden' }) },
      noOrange:     { type: 'bool', default: false, ...label('Blue (sem laranja)') },
      blau:         { type: 'enum', default: 'none', options: ['none', 'blueMetal', 'white'],
                      ...label('Blau', { none: 'Não', blueMetal: 'Azul metálico', white: 'Branco' }) },
      tuxedo:       { type: 'bool', default: false, ...label('Tuxedo (half-black)') },
      redEye:       { type: 'bool', default: false, ...label('Real red eye') },
      lutino:       { type: 'bool', default: false, ...label('Lutino') },
      pattern:      { type: 'bool', default: false, combine: 'any', sexLimited: 'male', ...label('Manchas selvagens') },
      // Body colour comes in layers that add up: full red, the snakeskin chain, a metallic or solid
      // pattern and the Kohaku red head (v7). Only within one layer does one value hide another.
      bodyPattern:  { type: 'enum', default: 'none',
                      options: ['none', 'moscow', 'japanBlue', 'coral', 'platinum', 'dragon', 'moscowBlack', 'panda', 'neonBlue'],
                      // X and Y both feed it; the visually dominant pattern wins (order TBD)
                      combine: 'priority', priority: ['moscowBlack', 'moscow', 'panda', 'neonBlue', 'dragon', 'coral', 'japanBlue', 'platinum', 'none'],
                      ...label('Padrão metálico', { none: 'Nenhum', moscow: 'Moscow', japanBlue: 'Japan blue', coral: 'Coral', platinum: 'Platinum',
                        dragon: 'Dragon', moscowBlack: 'Moscow preto', panda: 'Panda', neonBlue: 'Neon blue' }) },
      // 'cobra' is not made by a gene of its own: snakeskin plus Zebrinus bars (epistasis below)
      snakeskin:    { type: 'enum', default: 'none', options: ['none', 'snakeskin', 'cobra'], combine: 'priority', priority: ['cobra', 'snakeskin', 'none'],
                      ...label('Snakeskin no corpo', { none: 'Não', snakeskin: 'Snakeskin', cobra: 'King cobra (snakeskin + zebrinus)' }) },
      zebrinus:     { type: 'bool', default: false, ...label('Zebrinus (barras)') },
      glassBelly:   { type: 'bool', default: false, ...label('Glass belly (barriga transparente)') },
      pink:         { type: 'bool', default: false, ...label('Pink (pedúnculo branco translúcido)') },
      purpleBody:   { type: 'enum', default: 'none', options: ['none', 'het', 'hom'], ...label('Purple body', { none: 'Não', het: 'Purple (uma cópia)', hom: 'Purple (duas cópias)' }) },
      metalGold:    { type: 'bool', default: false, combine: 'any', ...label('Metal gold (amarelo metálico)') },
      micariff:     { type: 'bool', default: false, ...label('Micariff (amarelo)') },
      fullRed:      { type: 'bool', default: false, combine: 'any', ...label('Full red (corpo vermelho)') },
      kohaku:       { type: 'bool', default: false, ...label('Cabeça vermelha (koi)') },
      tailPattern:  { type: 'enum', default: 'none', options: ['none', 'snakeskin', 'mosaic', 'grass', 'leopard'],
                      combine: 'priority', priority: ['snakeskin', 'mosaic', 'leopard', 'grass', 'none'],
                      ...label('Padrão da cauda', { none: 'Liso', snakeskin: 'Snakeskin', mosaic: 'Mosaico', grass: 'Grass', leopard: 'Leopardo' }) },
      tailColor:    { type: 'enum', default: 'natural', options: ['natural', 'red', 'blue', 'white', 'dark', 'yellow', 'purple', 'green', 'multi', 'pastel'],
                      combine: 'priority', priority: ['dark', 'multi', 'red', 'purple', 'blue', 'green', 'yellow', 'pastel', 'white', 'natural'],
                      ...label('Cor da cauda', { natural: 'Natural', red: 'Vermelha', blue: 'Azul', white: 'Branca', dark: 'Escura', yellow: 'Amarela',
                        purple: 'Roxa', green: 'Verde', multi: 'Multicolor', pastel: 'Pastel' }) },
      iridescent:   { type: 'bool', default: false },
      // The delta complex hides the sword genes (Ds is recessive to it [19]); half-moon is not a gene but a
      // delta whose spread reaches ~180 degrees (epistasis below).
      tailShape:    { type: 'enum', default: 'round',
                      options: ['delta', 'veil', 'halfMoon', 'fan', 'flag', 'round', 'spade', 'spear', 'pin', 'lyre', 'topSword', 'bottomSword', 'doubleSword'],
                      combine: 'priority', priority: ['halfMoon', 'delta', 'veil', 'fan', 'flag', 'doubleSword', 'topSword', 'bottomSword', 'lyre', 'spade', 'spear', 'pin', 'round'],
                      ...label('Cauda', { delta: 'Delta', veil: 'Véu', halfMoon: 'Half-moon', fan: 'Fantail', flag: 'Flag (scarf)', round: 'Redonda', spade: 'Spade',
                        spear: 'Spear', pin: 'Pin', lyre: 'Lyre', topSword: 'Top sword', bottomSword: 'Bottom sword', doubleSword: 'Double sword' }) },
      tailBorder:   { type: 'bool', default: false, ...label('Borda da cauda') },
      bigEar:       { type: 'bool', default: false, ...label('Dumbo ear') },
      saturation:   { type: 'number', base: 0.2, noise: 0.15, min: 0, max: 1, ...label('Saturação') },
      luminance:    { type: 'number', base: 0.4, noise: 0.10, min: 0, max: 1, ...label('Luminância') },
      spinalDefect: { type: 'bool', default: false, ...label('Defeito de coluna') },
      // genetic load (docs/GDD.txt#L123-L131): hidden recessives that inbreeding exposes
      embryoLethal: { type: 'bool', default: false, combine: 'any', visible: false, ...label('Letal embrionário') },
      fryLethal:    { type: 'bool', default: false, combine: 'any', visible: false, ...label('Letal de alevino') },
      sterile:      { type: 'bool', default: false, visible: false, ...label('Estéril') },
      // quantitative ornaments (Brooks & Endler 2001: substantial additive variation in male
      // ornaments): many small loci plus environment; heritability around 0.5 here (TBD)
      tailSize:      { type: 'number', base: 0.1, noise: 0.11, noiseShape: 'normal', min: 0, max: 1, ...label('Tamanho da cauda') },
      tailSpread:    { type: 'number', base: 0.1, noise: 0.12, noiseShape: 'normal', min: 0, max: 1, ...label('Abertura da cauda') },
      dorsalSize:    { type: 'number', base: 0.1, noise: 0.12, noiseShape: 'normal', min: 0, max: 1, ...label('Tamanho da dorsal') },
      colorCoverage: { type: 'number', base: 0.1, noise: 0.12, noiseShape: 'normal', min: 0, max: 1, ...label('Cobertura de cor') },
      bodySize:      { type: 'number', base: 0.1, noise: 0.10, noiseShape: 'normal', min: 0, max: 1, ...label('Porte') },
      // how far the Kohaku red reaches: a cap on the head up to the nape and, in males, red patches on the
      // body; "an individually different degree of red" between males of one line [20]. Polygenic (TBD).
      headRed:       { type: 'number', base: 0.1, noise: 0.1, noiseShape: 'normal', min: 0, max: 1, ...label('Vermelho da cabeça') },
    },
    chromosomes: [
      { id: 'C1', lengthCm: 85, loci: [
        poly('Tz1', 8, 'tailSize', 0.08),
        { id: 'Alb', positionCm: 18, alleles: ['A', 'a'], kind: 'mendelian', effect: { trait: 'albino', values: { A: false, a: true } } },
        poly('Bz1', 35, 'bodySize', 0.1),
        { id: 'Blo', positionCm: 52, alleles: ['+', 'b'], kind: 'mendelian', effect: { trait: 'bodyBase', values: { '+': null, b: 'blond' } } },
        // linked to blond on purpose: the wanted trait can drag a deleterious neighbour (GDD)
        { id: 'Lt1', positionCm: 58, alleles: ['+', 'l'], kind: 'deleterious', carrierFrequency: 0.1, effect: { trait: 'embryoLethal', values: { '+': false, l: true } } },
        poly('Cv1', 75, 'colorCoverage', 0.1),
        poly('Hr1', 82, 'headRed', 0.11),
      ] },
      { id: 'C2', lengthCm: 95, loci: [
        // Pink: light, often translucent white on the rear peduncle; autosomal recessive [28]
        { id: 'Pk', positionCm: 20, tbd: 'nas fêmeas não confirmado', alleles: ['+', 'p'], kind: 'mendelian', effect: { trait: 'pink', expressedIn: 'male', values: { '+': false, p: true } } }, // in females: TBD (not shown)
        // a tail-size locus sits right next to the tail-shape series
        poly('Tz2', 40, 'tailSize', 0.08),
        // Tail shape series: the shape category; its size and spread are polygenic. Dominance order TBD.
        { id: 'Cau', positionCm: 46, tbd: 'ordem de dominância entre formatos não confirmada', alleles: ['Dl', 'Vl', 'Fn', 'Fl', 'Sp', 'Spr', 'Pn', 'Rd'], wild: 'Rd', kind: 'mendelian',
          effect: { trait: 'tailShape', values: { Dl: 'delta', Vl: 'veil', Fn: 'fan', Fl: 'flag', Sp: 'spade', Spr: 'spear', Pn: 'pin', Rd: 'round' } } },
        { id: 'Bord', positionCm: 51, alleles: ['B', 'b'], kind: 'mendelian', effect: { trait: 'tailBorder', values: { B: true, b: false } } },
        poly('Tw1', 60, 'tailSpread', 0.1),
        { id: 'Lyr', positionCm: 80, tbd: 'herança não confirmada', alleles: ['Lyr', '+'], wild: '+', kind: 'mendelian', effect: { trait: 'tailShape', values: { Lyr: 'lyre', '+': null } } }, // inheritance TBD
        poly('Dz1', 88, 'dorsalSize', 0.1),
      ] },
      { id: 'C3', lengthCm: 80, loci: [
        { id: 'Vi1', positionCm: 10, alleles: ['+', 'v'], kind: 'deleterious', carrierFrequency: 0.1, effect: { trait: 'fryLethal', values: { '+': false, v: true } } },
        poly('Cv2', 25, 'colorCoverage', 0.1),
        // Kohaku: red head (and red caudal) in both sexes [20][21]; dominant here, inheritance TBD (no source
        // gives it; females showing it rules out Y-only). Blue (r) and Asian Blau hide it (epistasis).
        { id: 'Ko', positionCm: 33, tbd: 'herança não publicada (dominante autossômico aqui)', alleles: ['Ko', '+'], wild: '+', kind: 'mendelian', effect: { trait: 'kohaku', values: { Ko: true, '+': false } } },
        { id: 'Pat', positionCm: 42, alleles: ['P', 'p'], kind: 'mendelian', effect: { trait: 'pattern', values: { P: true, p: false } } },
        poly('Tz3', 55, 'tailSize', 0.08),
        poly('Bz2', 78, 'bodySize', 0.1),
      ] },
      { id: 'C4', lengthCm: 75, loci: [
        poly('Tw2', 5, 'tailSpread', 0.1),
        { id: 'Sat', positionCm: 16, alleles: ['H', 'L'], kind: 'additive', effect: { trait: 'saturation', perAllele: { H: 0.23, L: 0 } } },
        poly('Dz2', 32, 'dorsalSize', 0.1),
        poly('Hr2', 40, 'headRed', 0.11),
        { id: 'Gol', positionCm: 50, alleles: ['+', 'g'], kind: 'mendelian', effect: { trait: 'bodyBase', values: { '+': null, g: 'golden' } } },
        // Real red eye: red eyes without albinism; inheritance TBD (recessive here).
        poly('Cv3', 60, 'colorCoverage', 0.1),
        { id: 'Rre', positionCm: 68, tbd: 'herança não confirmada (recessivo aqui)', alleles: ['+', 're'], kind: 'mendelian', effect: { trait: 'redEye', values: { '+': false, re: true } } },
        // Micariff: yellow body and fins; "yellow recessive", origin kept secret [29]; sexes TBD
        { id: 'Mic', positionCm: 72, tbd: 'origem secreta; nas fêmeas não confirmado', alleles: ['+', 'mc'], kind: 'mendelian', effect: { trait: 'micariff', expressedIn: 'male', values: { '+': false, mc: true } } }, // in females: TBD (not shown)
      ] },
      { id: 'C5', lengthCm: 82, loci: [
        poly('Tz4', 8, 'tailSize', 0.08),
        { id: 'Ste', positionCm: 20, alleles: ['+', 's'], kind: 'deleterious', carrierFrequency: 0.06, effect: { trait: 'sterile', values: { '+': false, s: true } } },
        { id: 'Luz', positionCm: 36, alleles: ['H', 'L'], kind: 'additive', effect: { trait: 'luminance', perAllele: { H: 0.18, L: 0 } } },
        poly('Bz3', 48, 'bodySize', 0.1),
        { id: 'Blu', positionCm: 60, alleles: ['+', 'r'], kind: 'mendelian', effect: { trait: 'noOrange', values: { '+': false, r: true } } },
        // Lutino (wine-red eye albino, wrea): autosomal recessive per Shaddock; partial melanin here.
        { id: 'Lut', positionCm: 75, alleles: ['+', 'w'], kind: 'mendelian', effect: { trait: 'lutino', values: { '+': false, w: true } } },
        // Glass belly: no silvery lining on the belly, the gut and embryos show; autosomal recessive [30][31]
        { id: 'Gb', positionCm: 80, alleles: ['+', 'gb'], kind: 'mendelian', effect: { trait: 'glassBelly', values: { '+': false, gb: true } } },
      ] },
      { id: 'C6', lengthCm: 60, loci: [
        // Purple Body: orange turns pinkish-purple, violet-blue shows more; incompletely dominant, both sexes [28]
        { id: 'Pb', positionCm: 4, alleles: ['+', 'Pb'], kind: 'mendelian', effect: { trait: 'purpleBody', genotypes: { '+/+': 'none', '+/Pb': 'het', 'Pb/Pb': 'hom' } } },
        poly('Tw3', 10, 'tailSpread', 0.1),
        { id: 'Def', positionCm: 22, alleles: ['D', 'd'], kind: 'deleterious', carrierFrequency: 0.12, effect: { trait: 'spinalDefect', values: { D: false, d: true } } },
        poly('Dz3', 35, 'dorsalSize', 0.1),
        { id: 'Dum', positionCm: 45, tbd: 'herança não confirmada (recessivo aqui)', alleles: ['+', 'du'], kind: 'mendelian', effect: { trait: 'bigEar', values: { '+': false, du: true } } }, // inheritance TBD
        { id: 'Vi2', positionCm: 50, alleles: ['+', 'v'], kind: 'deleterious', carrierFrequency: 0.1, effect: { trait: 'fryLethal', values: { '+': false, v: true } } },
        poly('Hr3', 57, 'headRed', 0.11),
      ] },
      { id: 'C7', lengthCm: 70, loci: [
        // Metal Gold: yellow metallic; heterozygotes show only in males, homozygotes in both sexes [19][28]
        // (linkage not described, autosomal here, TBD); Asian Blau hides it (epistasis)
        { id: 'Mg', positionCm: 5, tbd: 'cromossomo não descrito (autossômico aqui)', alleles: ['+', 'Mg'], kind: 'mendelian', effects: [
          { trait: 'metalGold', expressedIn: 'male', genotypes: { '+/+': null, '+/Mg': true, 'Mg/Mg': true } },
          { trait: 'metalGold', female: 1, genotypes: { '+/+': null, '+/Mg': null, 'Mg/Mg': true } }] },
        poly('Tz5', 15, 'tailSize', 0.08),
        // Fin colour of the line, expressed in both sexes (real tail colours are mostly X/Y-linked; dominance order TBD).
        { id: 'Fc', positionCm: 35, tbd: 'cor de nadadeira autossômica aqui; na vida real boa parte é ligada ao sexo', alleles: ['R', 'Pu', 'Bl', 'G', 'Ye', 'Pa', '+'], wild: '+', kind: 'mendelian',
          effect: { trait: 'tailColor', values: { R: 'red', Pu: 'purple', Bl: 'blue', G: 'green', Ye: 'yellow', Pa: 'pastel', '+': null } } },
        poly('Cv4', 50, 'colorCoverage', 0.1),
        poly('Tw4', 65, 'tailSpread', 0.1),
      ] },
      { id: 'C8', lengthCm: 65, loci: [
        poly('Hr4', 5, 'headRed', 0.11),
        // Asian Blau: blue metallic as heterozygote, white as homozygote (incomplete dominance).
        { id: 'Nb', positionCm: 15, alleles: ['+', 'Nb'], kind: 'mendelian',
          effect: { trait: 'blau', genotypes: { '+/+': 'none', '+/Nb': 'blueMetal', 'Nb/Nb': 'white' } } },
        poly('Dz4', 30, 'dorsalSize', 0.1),
        // Zebrinus: vertical bars on the peduncle and rear body; autosomal dominant [28]. With snakeskin it
        // makes the King Cobra, alone the "tiger" bars [31]
        { id: 'Ze', positionCm: 38, tbd: 'nas fêmeas não confirmado', alleles: ['Ze', '+'], wild: '+', kind: 'mendelian', effect: { trait: 'zebrinus', expressedIn: 'male', values: { Ze: true, '+': false } } }, // a male ornament; in females TBD (not shown)
        poly('Bz4', 45, 'bodySize', 0.1),
        { id: 'Lt2', positionCm: 60, alleles: ['+', 'l'], kind: 'deleterious', carrierFrequency: 0.1, effect: { trait: 'embryoLethal', values: { '+': false, l: true } } },
      ] },
    ],
    // X-linked colour pattern. Real guppy colour genes sit on both X and Y; here the X carries the same
    // haplotype series as the Y. It acts only in males (one X, hemizygous); females carry it silently
    // and pass it to their sons, which is how a breeder fixes a pattern through the female line.
    // Which varieties also have an X copy is TBD per variety (see core/strains.mjs and docs/research.md).
    // Half-black (Nigrocaudatus), grass and leopard are X-linked in the sources [3][4] (since v6).
    xChromosome: { id: 'X', lengthCm: 50, loci: [
      { id: 'Ni', positionCm: 10, alleles: ['Ni', '+'], wild: '+', kind: 'mendelian', effect: { trait: 'tuxedo', values: { Ni: true, '+': false } } },
      { id: 'Xc', positionCm: 25, alleles: GUPPY_Y_ALLELES, kind: 'mendelian', codominant: true, effects: GUPPY_SEX_PATTERN_EFFECTS },
      { id: 'Gra', positionCm: 35, alleles: ['Gra', '+'], wild: '+', kind: 'mendelian', effect: { trait: 'tailPattern', expressedIn: 'male', values: { Gra: 'grass', '+': null } } },
      // Mosaic: X-linked dominant [28] (autosomal before v8)
      { id: 'Mo', positionCm: 40, alleles: ['Mo', '+'], wild: '+', kind: 'mendelian', effect: { trait: 'tailPattern', expressedIn: 'male', values: { Mo: 'mosaic', '+': null } } },
      { id: 'Le', positionCm: 45, tbd: 'dominância não confirmada', alleles: ['Le', '+'], wild: '+', kind: 'mendelian', effect: { trait: 'tailPattern', expressedIn: 'male', values: { Le: 'leopard', '+': null } } }, // dominance TBD
    ] },
    // One Y-linked locus whose alleles are Y haplotypes; stored in genome.yPattern. Rarely it swaps with
    // its X partner in male meiosis (~3 crossovers in 669 progeny; colour factors can move to the X:
    // bioRxiv 2023.05.17.541215). Rate TBD.
    sexLoci: {
      Y_Cob: { chromosome: 'Y', alleles: GUPPY_Y_ALLELES, default: 'plain', effects: GUPPY_SEX_PATTERN_EFFECTS, xPartner: 'Xc', xyRecombination: 0.005 },
    },
    // Blue (csf1ra) fish have no xanthophores, so no orange or red at all [18]; Asian Blau suppresses red,
    // and as a homozygote (white) hides it [19]. The heterozygote's weaker red is drawn by the art.
    epistasis: [
      { when: { trait: 'lutino', equals: true }, set: { melanin: 0.4 } },
      { when: { trait: 'albino', equals: true }, set: { melanin: 0 } },
      { when: { trait: 'noOrange', equals: true }, set: { kohaku: false, fullRed: false },
        map: { tailColor: { red: 'white', yellow: 'white', pastel: 'white', multi: 'blue' } } },
      { when: { trait: 'blau', equals: 'white' }, set: { kohaku: false, fullRed: false } },
      // albinos have no melanin, so golden and blond (melanophore genes) cannot be seen [18]
      { when: { trait: 'albino', equals: true }, map: { bodyBase: { golden: 'grey', blond: 'grey' } } },
      // yellow needs xanthophores (none in Blue [18]); Asian Blau suppresses yellow, so no Metal Gold with it [19]
      { when: { trait: 'noOrange', equals: true }, set: { micariff: false, metalGold: false } },
      { when: { trait: 'blau', in: ['blueMetal', 'white'] }, set: { metalGold: false } },
      // King Cobra = snakeskin + Zebrinus bars [31]
      { when: [{ trait: 'snakeskin', equals: 'snakeskin' }, { trait: 'zebrinus', equals: true }], set: { snakeskin: 'cobra' } },
      // half-moon: a delta opened to ~180 degrees (spread 0.75 of the 0-1 measure here, TBD)
      { when: [{ trait: 'tailShape', equals: 'delta' }, { trait: 'tailSpread', atLeast: 0.75 }], set: { tailShape: 'halfMoon' } },
    ],
    // what a show line looks like where a breeder does not care (previews of built fish): delta tail,
    // no wild spots, no tail border
    showBackground: { Cau: ['Dl', 'Dl'], Pat: ['p', 'p'], Bord: ['b', 'b'] },
    phenotypeModel: 'varieties_v5'
  },
  medaka: {
    id: 'medaka', label: 'Medaka', version: 1, view: 'top', reproductiveMode: 'egg_layer',
    sexSystem: 'XY', sexReversalTemperatureC: null, sexReversalPlanned: true, // threshold intentionally unspecified pending biological validation
    spermStorage: false, eggCannibalism: true,
    growth: { adultAgeDays: 90 }, // TBD
    // All TBD: a cycle is one round of collected and hatched eggs, not a single daily clutch.
    lifeHistory: {
      maturityDays: { female: 80, male: 75 }, sexingDays: 45, cycleDays: 14,
      brood: { first: 10, peak: 40, peakDays: 200, declineDays: 600, endDays: 1000 },
      maleFertility: { declineDays: 700, endDays: 1300, floor: 0.3 },
      lifespanDays: [800, 1400],
    },
    traits: {
      albino:       { type: 'bool', default: false, label: 'Albino' },
      melanin:      { type: 'number', base: 1, min: 0, max: 1 },
      iridescent:   { type: 'bool', default: false, label: 'Brilho dorsal' },
      pattern:      { type: 'bool', default: false, label: 'Manchas' },
      saturation:   { type: 'number', base: 0.2, noise: 0.15, min: 0, max: 1, label: 'Saturação' },
      luminance:    { type: 'number', base: 0.4, noise: 0.10, min: 0, max: 1, label: 'Luminância' },
      spinalDefect: { type: 'bool', default: false, label: 'Defeito de coluna' },
    },
    chromosomes: [
      { id: 'C1', lengthCm: 65, loci: [
        { id: 'Alb', positionCm: 11, alleles: ['A', 'a'], kind: 'mendelian', effect: { trait: 'albino', values: { A: false, a: true } } },
      ] },
      { id: 'C2', lengthCm: 80, loci: [
        { id: 'Iri', positionCm: 19, alleles: ['I', 'i'], kind: 'mendelian', effect: { trait: 'iridescent', values: { I: true, i: false } } },
      ] },
      { id: 'C3', lengthCm: 70, loci: [
        { id: 'Pat', positionCm: 26, alleles: ['P', 'p'], kind: 'mendelian', effect: { trait: 'pattern', values: { P: true, p: false } } },
      ] },
      { id: 'C4', lengthCm: 62, loci: [
        { id: 'Sat', positionCm: 24, alleles: ['H', 'L'], kind: 'additive', effect: { trait: 'saturation', perAllele: { H: 0.23, L: 0 } } },
      ] },
      { id: 'C5', lengthCm: 78, loci: [
        { id: 'Luz', positionCm: 29, alleles: ['H', 'L'], kind: 'additive', effect: { trait: 'luminance', perAllele: { H: 0.18, L: 0 } } },
      ] },
      { id: 'C6', lengthCm: 90, loci: [
        { id: 'Def', positionCm: 38, alleles: ['D', 'd'], kind: 'deleterious', effect: { trait: 'spinalDefect', values: { D: false, d: true } } },
      ] },
    ],
    sexLoci: {},
    epistasis: [
      { when: { trait: 'albino', equals: true }, set: { melanin: 0 } },
    ],
    phenotypeModel: 'illustrative_v1'
  }
};

// ---- species revisions: genome migrations (keyed by the OLD version) ----

/** Rebuild a genome from one chromosome layout ({chr: [locus ids]}) to another, by locus id.
 *  Loci that did not exist get the species' wild-type allele on both homologs. */
function relayout(species, fromLayout, toLayout, genome) {
  const byId = {};
  for (const [chrId, ids] of Object.entries(fromLayout)) {
    const homologs = genome.chromosomes?.[chrId];
    if (!Array.isArray(homologs) || homologs.length !== 2) throw Error('missing chromosome ' + chrId);
    ids.forEach((id, i) => { byId[id] = [homologs[0][i], homologs[1][i]]; });
  }
  const all = [...species.chromosomes.flatMap(c => c.loci), ...(species.xChromosome?.loci ?? [])];
  const wild = id => { const l = all.find(x => x.id === id); return l.wild ?? l.alleles[0]; };
  const chromosomes = {};
  for (const [chrId, ids] of Object.entries(toLayout)) {
    chromosomes[chrId] = [0, 1].map(h => ids.map(id => (byId[id] ? byId[id][h] : wild(id))));
  }
  return { ...genome, chromosomes };
}
const layoutOf = species => Object.fromEntries(species.chromosomes.map(c => [c.id, c.loci.map(l => l.id)]));
const GUPPY_LAYOUTS = {
  1: { C1: ['Alb'], C2: ['Cau', 'Bord'], C3: ['Pat'], C4: ['Sat'], C5: ['Luz'], C6: ['Def'] },
  2: { C1: ['Alb', 'Blo'], C2: ['Cau', 'Bord', 'Lyr'], C3: ['Pat', 'Mo'], C4: ['Sat', 'Gol'], C5: ['Luz', 'Blu'], C6: ['Def', 'Dum'], C7: ['Ni', 'Gra'], C8: ['Nb', 'Le'] },
  3: { C1: ['Alb', 'Blo'], C2: ['Cau', 'Bord', 'Lyr'], C3: ['Pat', 'Mo'], C4: ['Sat', 'Gol', 'Rre'], C5: ['Luz', 'Blu', 'Lut'], C6: ['Def', 'Dum'],
    C7: ['Ni', 'Fc', 'Gra'], C8: ['Nb', 'Le'] },
  5: { C1: ['Alb', 'Blo', 'Lt1'], C2: ['Cau', 'Bord', 'Lyr'], C3: ['Vi1', 'Pat', 'Mo'], C4: ['Sat', 'Gol', 'Rre'], C5: ['Ste', 'Luz', 'Blu', 'Lut'],
    C6: ['Def', 'Dum', 'Vi2'], C7: ['Ni', 'Fc', 'Gra'], C8: ['Nb', 'Le', 'Lt2'] },
  6: { C1: ['Tz1', 'Alb', 'Bz1', 'Blo', 'Lt1', 'Cv1'], C2: ['Tz2', 'Cau', 'Bord', 'Tw1', 'Lyr', 'Dz1'], C3: ['Vi1', 'Cv2', 'Pat', 'Tz3', 'Mo', 'Bz2'],
    C4: ['Tw2', 'Sat', 'Dz2', 'Gol', 'Cv3', 'Rre'], C5: ['Tz4', 'Ste', 'Luz', 'Bz3', 'Blu', 'Lut'], C6: ['Tw3', 'Def', 'Dz3', 'Dum', 'Vi2'],
    C7: ['Tz5', 'Fc', 'Cv4', 'Tw4'], C8: ['Nb', 'Dz4', 'Bz4', 'Lt2'] },
};
GUPPY_LAYOUTS[7] = { ...GUPPY_LAYOUTS[6],
  C1: [...GUPPY_LAYOUTS[6].C1, 'Hr1'], C3: ['Vi1', 'Cv2', 'Ko', 'Pat', 'Tz3', 'Mo', 'Bz2'], C4: ['Tw2', 'Sat', 'Dz2', 'Hr2', 'Gol', 'Cv3', 'Rre'],
  C6: [...GUPPY_LAYOUTS[6].C6, 'Hr3'], C8: ['Hr4', ...GUPPY_LAYOUTS[6].C8] };
GUPPY_LAYOUTS[8] = { ...GUPPY_LAYOUTS[7],
  C2: ['Pk', ...GUPPY_LAYOUTS[7].C2], C3: GUPPY_LAYOUTS[7].C3.filter(id => id !== 'Mo'), C4: [...GUPPY_LAYOUTS[7].C4, 'Mic'],
  C5: [...GUPPY_LAYOUTS[7].C5, 'Gb'], C6: ['Pb', ...GUPPY_LAYOUTS[7].C6], C7: ['Mg', ...GUPPY_LAYOUTS[7].C7],
  C8: ['Hr4', 'Nb', 'Dz4', 'Ze', 'Bz4', 'Lt2'] };
const GUPPY_X_LAYOUTS = { 5: ['Xc'], 6: ['Ni', 'Xc', 'Gra', 'Le'], 7: ['Ni', 'Xc', 'Gra', 'Le'], 8: ['Ni', 'Xc', 'Gra', 'Mo', 'Le'] };
/**
 * v5 -> v6: Ni, Gra and Le move from autosomes to the X (an XY keeps the allele of its first homolog,
 * the one it shows as hemizygous), and the new polygenic loci are drawn with frequency 1/2 from a
 * hash of the old genome, so old fish get ordinary, varied fins instead of all the same.
 */
function toV6(species, genome) {
  const byId = {};
  for (const [chrId, ids] of Object.entries(GUPPY_LAYOUTS[5])) {
    const homologs = genome.chromosomes?.[chrId];
    if (!Array.isArray(homologs) || homologs.length !== 2) throw Error('missing chromosome ' + chrId);
    ids.forEach((id, i) => { byId[id] = [homologs[0][i], homologs[1][i]]; });
  }
  const xs = genome.x ?? [];
  const x = xs.map((hap, h) => GUPPY_X_LAYOUTS[6].map(id => (id === 'Xc' ? hap[GUPPY_X_LAYOUTS[5].indexOf('Xc')] : byId[id][h])));
  const rng = rngFromSeed(hashString(JSON.stringify(genome)));
  const loci = Object.fromEntries(species.chromosomes.flatMap(c => c.loci).map(l => [l.id, l]));
  const chromosomes = {};
  for (const [chrId, ids] of Object.entries(GUPPY_LAYOUTS[6])) {
    chromosomes[chrId] = [[], []];
    for (const id of ids) {
      for (const h of [0, 1]) {
        chromosomes[chrId][h].push(byId[id] ? byId[id][h] : loci[id].polygenic ? (rng() < 0.5 ? '+' : '-') : (loci[id].wild ?? loci[id].alleles[0]));
      }
    }
  }
  return { ...genome, chromosomes, x };
}
/**
 * v6 -> v7: koi leaves the sex chromosomes. Each 'koi' haplotype (X or Y) becomes a red tail and gives
 * the fish one copy of the autosomal Kohaku allele (two at most). The new red-head polygenes are drawn
 * from a hash of the old genome (koi fish lean red-headed). Old koi lines made their white body with
 * Asian Blau, which now hides red; those fish get a blond body instead, so a koi stays a koi.
 */
function toV7(species, genome) {
  const xi = GUPPY_X_LAYOUTS[6].indexOf('Xc');
  const xs = genome.x ?? [];
  const koi = Math.min(2, (genome.yPattern === 'koi' ? 1 : 0) + xs.filter(h => h[xi] === 'koi').length);
  const x = xs.map(h => h.map((a, i) => (i === xi && a === 'koi' ? 'redTail' : a)));
  const g = relayout(species, GUPPY_LAYOUTS[6], GUPPY_LAYOUTS[7], { ...genome, x, yPattern: genome.yPattern === 'koi' ? 'redTail' : genome.yPattern });
  const at = id => { for (const [chr, ids] of Object.entries(GUPPY_LAYOUTS[7])) { const i = ids.indexOf(id); if (i !== -1) return [chr, i]; } return null; };
  const set = (id, pair) => { const [chr, i] = at(id); g.chromosomes[chr][0][i] = pair[0]; g.chromosomes[chr][1][i] = pair[1]; };
  const get = id => { const [chr, i] = at(id); return [g.chromosomes[chr][0][i], g.chromosomes[chr][1][i]]; };
  const rng = rngFromSeed(hashString('v7:' + JSON.stringify(genome)));
  for (const id of ['Hr1', 'Hr2', 'Hr3', 'Hr4']) set(id, [0, 1].map(() => (rng() < (koi ? 0.75 : 0.5) ? '+' : '-')));
  if (koi) {
    set('Ko', koi === 2 ? ['Ko', 'Ko'] : ['Ko', '+']);
    if (get('Nb').includes('Nb')) { set('Nb', ['+', '+']); set('Blo', ['b', 'b']); }
  }
  return g;
}
/**
 * v7 -> v8: Mosaic moves to the X (a male keeps the allele of his first homolog), platinum leaves the X
 * (it is Y-linked), half-moon stops being an allele (a delta; the spread decides), and a 'cobra' haplotype
 * becomes plain snakeskin plus one Zebrinus allele, which is what makes the cobra bars. New loci are wild.
 */
function toV8(species, genome) {
  const c3 = GUPPY_LAYOUTS[7].C3, mi = c3.indexOf('Mo');
  const mo = genome.chromosomes.C3.map(h => h[mi]);
  const xi = GUPPY_X_LAYOUTS[7].indexOf('Xc');
  const cobra = (genome.yPattern === 'cobra' ? 1 : 0) + (genome.x ?? []).filter(h => h[xi] === 'cobra').length;
  const x = (genome.x ?? []).map((h, k) => {
    const xc = h[xi] === 'platinum' || h[xi] === 'galaxy' ? (h[xi] === 'galaxy' ? 'snakeskin' : 'plain') : h[xi];
    return [h[0], xc, h[2], mo[k], h[3]];
  });
  const g = relayout(species, GUPPY_LAYOUTS[7], GUPPY_LAYOUTS[8], { ...genome, x });
  const ci = GUPPY_LAYOUTS[8].C2.indexOf('Cau');
  for (const h of [0, 1]) if (g.chromosomes.C2[h][ci] === 'Hm') g.chromosomes.C2[h][ci] = 'Dl';
  if (cobra) { const zi = GUPPY_LAYOUTS[8].C8.indexOf('Ze'); g.chromosomes.C8[0][zi] = 'Ze'; if (cobra > 1) g.chromosomes.C8[1][zi] = 'Ze'; }
  return g;
}
/** v3 -> v4: add the X with its (then single) pattern locus as wild type, one haplotype per X. */
function addX(genome) {
  return { ...genome, x: genome.sexChromosomes.filter(s => s === 'X').map(() => ['plain']) };
}
// migrations[v] turns a version-v genome into version v+1 (v2 -> v3 added Rre, Lut, Fc and Cau alleles;
// v3 -> v4 added the X chromosome; v4 -> v5 added hidden deleterious loci, as non-carriers).
SPECIES.guppy.migrations = {
  1: genome => relayout(SPECIES.guppy, GUPPY_LAYOUTS[1], GUPPY_LAYOUTS[2], genome),
  2: genome => relayout(SPECIES.guppy, GUPPY_LAYOUTS[2], GUPPY_LAYOUTS[3], genome),
  3: genome => addX(genome),
  4: genome => relayout(SPECIES.guppy, GUPPY_LAYOUTS[3], GUPPY_LAYOUTS[5], genome),
  5: genome => toV6(SPECIES.guppy, genome),
  6: genome => toV7(SPECIES.guppy, genome),
  7: genome => toV8(SPECIES.guppy, genome),
};
if (JSON.stringify(layoutOf(SPECIES.guppy)) !== JSON.stringify(GUPPY_LAYOUTS[8])
  || JSON.stringify(SPECIES.guppy.xChromosome.loci.map(l => l.id)) !== JSON.stringify(GUPPY_X_LAYOUTS[8])) {
  throw Error('guppy chromosome layout changed: add a layout and a migration');
}

// ---- validation ----

const LOCUS_KINDS = new Set(['mendelian', 'deleterious', 'additive', 'neutral']);
const TRAIT_TYPES = new Set(['bool', 'enum', 'number']);
const validated = new WeakSet();

function checkTraitValue(trait, value, where) {
  const ok = trait.type === 'bool' ? typeof value === 'boolean'
    : trait.type === 'enum' ? trait.options.includes(value)
    : Number.isFinite(value);
  if (!ok) throw Error(`invalid value for trait at ${where}`);
}

/** Genotype key in allele-list order, e.g. '+/Nb'. */
export function genotypeKey(alleles, a, b) {
  return alleles.indexOf(a) <= alleles.indexOf(b) ? `${a}/${b}` : `${b}/${a}`;
}

export function locusEffects(locus) {
  return locus.effects ?? (locus.effect ? [locus.effect] : []);
}

function checkEffect(species, owner, effect, alleles, kind, contributors) {
  const trait = species.traits[effect?.trait];
  if (!trait) throw Error(`${owner}: effect targets unknown trait`);
  if (effect.expressedIn !== undefined && !['male', 'female'].includes(effect.expressedIn)) throw Error(`${owner}: invalid effect expressedIn`);
  if (effect.female !== undefined && !(effect.female >= 0 && effect.female <= 1)) throw Error(`${owner}: effect female strength in [0, 1]`);
  if (kind === 'additive') {
    if (trait.type !== 'number') throw Error(`${owner}: additive effect needs a number trait`);
    for (const a of alleles) if (!Number.isFinite(effect.perAllele?.[a])) throw Error(`${owner}: missing perAllele for ${a}`);
  } else if (effect.genotypes) {
    for (let i = 0; i < alleles.length; i++) for (let j = i; j < alleles.length; j++) {
      const key = `${alleles[i]}/${alleles[j]}`;
      if (!(key in effect.genotypes)) throw Error(`${owner}: missing genotype ${key}`);
      if (effect.genotypes[key] !== null) checkTraitValue(trait, effect.genotypes[key], `${owner}/${key}`);
    }
  } else {
    for (const a of alleles) {
      if (!(a in (effect.values ?? {}))) throw Error(`${owner}: missing value for allele ${a}`);
      if (effect.values[a] !== null) checkTraitValue(trait, effect.values[a], `${owner}/${a}`);
    }
  }
  contributors[effect.trait] = (contributors[effect.trait] ?? 0) + 1;
}

export function validateSpecies(species) {
  if (validated.has(species)) return true;
  if (!species || !species.id || !Array.isArray(species.chromosomes)) throw Error('invalid species');
  if (!Number.isSafeInteger(species.version) || species.version < 1) throw Error('species needs integer version');
  if (species.chromosomes.length < 6 || species.chromosomes.length > 12) throw Error('requires 6-12 autosome pairs');
  if (!(species.growth?.adultAgeDays > 0)) throw Error('invalid growth.adultAgeDays');
  const lh = species.lifeHistory;
  if (lh) {
    const b = lh.brood, m = lh.maleFertility;
    const ok = lh.maturityDays?.female > 0 && lh.maturityDays?.male > 0 && lh.sexingDays > 0 && lh.cycleDays > 0
      && b && 0 < b.first && b.first <= b.peak && Math.max(lh.maturityDays.female, 1) <= b.peakDays && b.peakDays <= b.declineDays && b.declineDays < b.endDays
      && m && 0 < m.declineDays && m.declineDays < m.endDays && m.floor >= 0 && m.floor <= 1
      && Array.isArray(lh.lifespanDays) && 0 < lh.lifespanDays[0] && lh.lifespanDays[0] <= lh.lifespanDays[1]
      && (lh.receptiveDays === undefined || (lh.receptiveDays > 0 && lh.receptiveDays <= lh.maturityDays.female))
      && [lh.weeklyMating, lh.weeklyConception].every(x => x === undefined || (x >= 0 && x <= 1));
    if (!ok) throw Error('invalid lifeHistory');
    const sp = lh.sperm;
    if (species.spermStorage && !(sp && sp.weeklyKeep > 0 && sp.weeklyKeep < 1 && sp.usePerConception >= 0 && sp.usePerConception < 1
      && sp.minViable > 0 && sp.freshShare >= 0 && sp.freshShare <= 1 && sp.lastMaleBonus >= 1)) throw Error('spermStorage needs lifeHistory.sperm');
  }
  const hb = species.husbandry;
  const gr = lh?.growth;
  if (gr && !(gr.birth > 0 && gr.birth < 1 && ['female', 'male'].every(sx => gr.weeklyRate?.[sx] > 0 && gr.weeklyRate[sx] < 1) && gr.maleAfterMaturity >= 0 && gr.maleAfterMaturity <= 1
    && ['female', 'male'].every(sx => gr.adultLengthMm?.[sx]?.[0] > 0 && gr.adultLengthMm[sx][0] <= gr.adultLengthMm[sx][1]))) throw Error('invalid lifeHistory.growth');
  const temp = hb?.temperature;
  if (temp && !(temp.q10 > 1 && temp.stressFromC < temp.lethalC && temp.defectPerDegree >= 0)) throw Error('invalid husbandry.temperature');
  if (hb?.food && !Object.values(hb.food).every(f => f.growth > 0 && f.fry > 0)) throw Error('invalid husbandry.food');
  if (hb && !(hb.fryNurserySurvival > 0 && hb.fryNurserySurvival <= 1 && hb.fryBaseSurvival > 0 && hb.fryBaseSurvival <= 1
    && hb.cannibalismPerAdult >= 0 && hb.cannibalismPerAdult < 1 && hb.crowdMortality >= 0 && hb.crowdMortality < 1
    && (!hb.fryLethalDays || (hb.fryLethalDays[0] >= 0 && hb.fryLethalDays[0] <= hb.fryLethalDays[1])))) throw Error('invalid husbandry');
  const traits = species.traits;
  if (!traits || typeof traits !== 'object') throw Error('species needs traits');
  for (const [name, t] of Object.entries(traits)) {
    if (!TRAIT_TYPES.has(t.type)) throw Error(`trait ${name}: invalid type`);
    if (t.type === 'enum' && (!Array.isArray(t.options) || !t.options.includes(t.default))) throw Error(`trait ${name}: enum default must be an option`);
    if (t.type === 'bool' && typeof t.default !== 'boolean') throw Error(`trait ${name}: bool needs default`);
    if (t.type === 'number' && (!Number.isFinite(t.base) || !(t.min <= t.max))) throw Error(`trait ${name}: number needs base/min/max`);
    if (t.combine && !['any', 'all', 'priority'].includes(t.combine)) throw Error(`trait ${name}: invalid combine`);
    if (t.combine === 'priority' && (t.type !== 'enum' || !t.options.every(o => t.priority?.includes(o)))) throw Error(`trait ${name}: priority must list every option`);
    if ((t.combine === 'any' || t.combine === 'all') && t.type !== 'bool') throw Error(`trait ${name}: any/all only for bool`);
    if (t.noiseShape !== undefined && (t.type !== 'number' || !['uniform', 'normal'].includes(t.noiseShape))) throw Error(`trait ${name}: invalid noiseShape`);
  }
  const ids = new Set(), contributors = {};
  if (species.xChromosome && (species.xChromosome.id !== 'X' || !Array.isArray(species.xChromosome.loci))) throw Error('invalid X chromosome');
  for (const chr of [...species.chromosomes, ...(species.xChromosome ? [species.xChromosome] : [])]) {
    if (!(chr.lengthCm > 0)) throw Error('invalid chromosome length');
    let last = -1;
    for (const locus of chr.loci) {
      if (ids.has(locus.id)) throw Error('duplicate locus ' + locus.id);
      ids.add(locus.id);
      if (!(locus.positionCm >= 0 && locus.positionCm <= chr.lengthCm && locus.positionCm >= last)) throw Error('unsorted/out-of-range loci');
      if (!Array.isArray(locus.alleles) || locus.alleles.length < 2 || new Set(locus.alleles).size !== locus.alleles.length) throw Error('locus needs distinct alleles ' + locus.id);
      if (locus.wild !== undefined && !locus.alleles.includes(locus.wild)) throw Error('wild allele not in alleles ' + locus.id);
      if (!LOCUS_KINDS.has(locus.kind)) throw Error('invalid locus kind ' + locus.id);
      if (locus.expressedIn !== undefined && !['male', 'female'].includes(locus.expressedIn)) throw Error('invalid expressedIn ' + locus.id);
      if (locus.codominant && (locus.kind === 'additive' || locusEffects(locus).some(e => e.genotypes))) throw Error('codominant needs a values locus ' + locus.id);
      if (locus.polygenic && (locus.kind !== 'additive' || locus.alleles.length !== 2)) throw Error('polygenic locus must be a two-allele additive locus ' + locus.id);
      if (locus.carrierFrequency !== undefined && (locus.kind !== 'deleterious' || locus.alleles.length !== 2 || !(locus.carrierFrequency >= 0 && locus.carrierFrequency <= 0.5))) {
        throw Error('carrierFrequency needs a two-allele deleterious locus and a value in [0, 0.5] ' + locus.id);
      }
      if (locus.kind !== 'neutral') {
        const effects = locusEffects(locus);
        if (!effects.length) throw Error('locus needs an effect ' + locus.id);
        effects.forEach(e => checkEffect(species, locus.id, e, locus.alleles, locus.kind, contributors));
      }
      last = locus.positionCm;
    }
  }
  const yLoci = Object.entries(species.sexLoci ?? {});
  if (yLoci.length > 1) throw Error('export format 1 supports a single Y-linked locus');
  for (const [id, locus] of yLoci) {
    if (locus.chromosome !== 'Y') throw Error(`sex locus ${id}: only Y-linked loci are supported`);
    if (locus.xPartner !== undefined) {
      const partner = species.xChromosome?.loci.find(l => l.id === locus.xPartner);
      if (!partner || !locus.alleles.every(a => partner.alleles.includes(a)) || !partner.alleles.every(a => locus.alleles.includes(a))) throw Error(`sex locus ${id}: xPartner must be an X locus with the same alleles`);
      if (!(locus.xyRecombination >= 0 && locus.xyRecombination <= 0.05)) throw Error(`sex locus ${id}: xyRecombination in [0, 0.05]`);
    }
    if (!Array.isArray(locus.alleles) || !locus.alleles.includes(locus.default)) throw Error(`sex locus ${id}: default must be an allele`);
    const effects = locusEffects(locus);
    if (!effects.length) throw Error(`sex locus ${id}: needs an effect`);
    effects.forEach(e => checkEffect(species, id, e, locus.alleles, 'mendelian', contributors));
  }
  for (const [name, count] of Object.entries(contributors)) {
    const t = traits[name];
    if (count > 1 && t.type === 'enum' && t.combine !== 'priority') throw Error(`trait ${name}: enum fed by more than one locus needs combine priority`);
    if (count > 1 && t.type === 'bool' && !t.combine) throw Error(`trait ${name}: several loci need combine any|all`);
  }
  for (const rule of species.epistasis ?? []) {
    const conds = Array.isArray(rule.when) ? rule.when : [rule.when];
    if (!conds.length) throw Error('epistasis: empty when');
    for (const c of conds) {
      const when = traits[c?.trait];
      if (!when) throw Error('epistasis: unknown trait in when');
      if ('equals' in c) checkTraitValue(when, c.equals, 'epistasis.when');
      else if ('in' in c) { if (!Array.isArray(c.in)) throw Error('epistasis: in needs a list'); c.in.forEach(v => checkTraitValue(when, v, 'epistasis.when')); }
      else if (!(when.type === 'number' && Number.isFinite(c.atLeast))) throw Error('epistasis: atLeast needs a number trait');
    }
    for (const [name, value] of Object.entries(rule.set ?? {})) {
      if (!traits[name]) throw Error('epistasis: unknown trait in set');
      checkTraitValue(traits[name], value, 'epistasis.set');
    }
    for (const [name, table] of Object.entries(rule.map ?? {})) {
      if (!traits[name] || traits[name].type !== 'enum') throw Error('epistasis: map needs an enum trait');
      for (const [from, to] of Object.entries(table)) { checkTraitValue(traits[name], from, 'epistasis.map'); checkTraitValue(traits[name], to, 'epistasis.map'); }
    }
  }
  validated.add(species);
  return true;
}

/** Bring a genome written for species revision `fromVersion` up to the current one. */
export function migrateGenome(species, genome, fromVersion) {
  if (!Number.isSafeInteger(fromVersion) || fromVersion < 1) throw Error('invalid species version');
  if (fromVersion > species.version) throw Error('genome from a newer species revision');
  let g = genome;
  for (let v = fromVersion; v < species.version; v++) {
    const migrate = species.migrations?.[v];
    if (!migrate) throw Error('no migration for species revision ' + v);
    g = migrate(g);
  }
  return g;
}

/** Where a locus lives: {chromosome, index, locus, xLinked}. X-linked loci are found too. */
export function findLocus(species, locusId) {
  for (const chr of species.chromosomes) {
    const index = chr.loci.findIndex(l => l.id === locusId);
    if (index !== -1) return { chromosome: chr, index, locus: chr.loci[index], xLinked: false };
  }
  const index = species.xChromosome?.loci.findIndex(l => l.id === locusId) ?? -1;
  if (index !== -1) return { chromosome: species.xChromosome, index, locus: species.xChromosome.loci[index], xLinked: true };
  return null;
}

/**
 * Strongest expression in females of a trait value (or of any value when `value` is omitted) across
 * the loci that make it: 0 = only males show it, 1 = females show it fully. For breeder UIs.
 */
export function femaleExpression(species, trait, value) {
  let best = 0;
  const loci = [...species.chromosomes.flatMap(c => c.loci), ...(species.xChromosome?.loci ?? []), ...Object.values(species.sexLoci ?? {})];
  for (const locus of loci) {
    for (const e of locusEffects(locus)) {
      if (e.trait !== trait) continue;
      const vals = e.genotypes ? Object.values(e.genotypes) : e.values ? Object.values(e.values) : [];
      if (value !== undefined && !vals.includes(value)) continue;
      if (value === undefined && !vals.some(v => v !== null && v !== species.traits[trait].default)) continue;
      const k = e.female ?? ((e.expressedIn ?? locus.expressedIn) === 'male' ? 0 : 1);
      best = Math.max(best, k);
    }
  }
  return best;
}

export function yLocus(species) {
  const entry = Object.entries(species.sexLoci ?? {})[0];
  return entry ? { id: entry[0], ...entry[1] } : null;
}
