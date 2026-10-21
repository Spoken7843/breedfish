// Founder catalog: guppy varieties as genotypes. Each strain gives the autosomal genotype shared by
// both sexes, the Y haplotype carried by its males and the X-linked copy of the pattern that both
// sexes carry (females carry it silently and pass it to their sons; see strainX). Names follow the
// hobby (body/eye + colour + pattern + tail, e.g. "HB Blue Delta"); genetics follow core/species.mjs
// and docs/research.md.
import { SPECIES } from './species.mjs';
import { founder, founderLoad, founderPolygenes } from './engine.mjs';
import { deriveSeed, hashString } from './rng.mjs';

const hom = a => [a, a];
// common background: no wild ornaments, no tail border
const fancy = (alleles, tail = 'Dl') => ({ Pat: hom('p'), Bord: hom('b'), Cau: hom(tail), ...alleles });

export const GUPPY_STRAINS = [
  // ---- tuxedo (half-black) family ----
  // Wild stock is low-saturation (Sat L/L): drab olive body, a few small spots, clear tail. The
  // additive Sat/Luz loci default to H in founders, so the wild strain sets them explicitly.
  { id: 'wild', name: 'Selvagem', y: 'ornate', alleles: { Cau: hom('Rd'), Pat: hom('P'), Bord: hom('b'), Sat: hom('L'), Luz: ['H', 'L'] },
    note: 'Fêmea cinza; macho oliva com poucas manchas pequenas (laranja, preta, um brilho azulado) e cauda quase transparente.' },
  { id: 'hbBlue', name: 'Tuxedo azul · HB Blue Delta', y: 'blueTail', alleles: fancy({ Ni: hom('Ni'), Fc: hom('Bl') }),
    note: 'Metade de trás preta e nadadeiras azuis. A fêmea mostra a cauda azul e só um leve escuro no fim do corpo.' },
  { id: 'hbRed', name: 'Tuxedo vermelho · HB Red Delta', y: 'redTail', alleles: fancy({ Ni: hom('Ni'), Fc: hom('R'), Sat: hom('H') }),
    note: 'Metade de trás preta (Nigrocaudatus) e nadadeiras vermelhas.' },
  { id: 'hbYellow', name: 'Tuxedo amarelo · HB Yellow', y: 'yellowTail', alleles: fancy({ Ni: hom('Ni'), Fc: hom('Ye'), Sat: hom('H') }),
    note: 'Half-black com nadadeiras amarelas.' },
  { id: 'hbPurple', name: 'Tuxedo roxo · HB Purple', y: 'purpleTail', alleles: fancy({ Ni: hom('Ni'), Fc: hom('Pu') }),
    note: 'Half-black com nadadeiras roxas.' },
  { id: 'hbGreen', name: 'Tuxedo verde · HB Green', y: 'greenTail', alleles: fancy({ Ni: hom('Ni'), Fc: hom('G') }),
    note: 'Half-black com nadadeiras verdes, cor rara de fixar.' },
  { id: 'hbPastel', name: 'Tuxedo pastel · HB Pastel Delta', y: 'plain', alleles: fancy({ Ni: hom('Ni'), Fc: hom('Pa') }),
    note: 'Half-black com cauda clara, rosada.' },
  { id: 'hbMosaic', name: 'Tuxedo mosaico · HB Blue Mosaic', y: 'blueTail', alleles: fancy({ Ni: hom('Ni'), Mo: hom('Mo'), Fc: hom('Bl') }),
    note: 'Half-black com cauda em mosaico sobre azul.' },
  { id: 'koiTuxedo', name: 'Koi tuxedo', y: 'redTail', alleles: fancy({ Ni: hom('Ni'), Ko: hom('Ko'), Blo: hom('b'), Fc: hom('R'), Sat: hom('H') }), koi: true,
    note: 'Cabeça vermelha (Kohaku, nos dois sexos), frente clara, traseira preta e cauda vermelha.' },
  { id: 'hbAlbino', name: 'Tuxedo albino · RREA HB Red', y: 'redTail', alleles: fancy({ Ni: hom('Ni'), Alb: hom('a'), Fc: hom('R'), Sat: hom('H') }),
    note: 'Sem melanina, o preto do tuxedo vira um rosado claro.' },
  // ---- snakeskin, cobra and tail patterns ----
  { id: 'snakeskin', name: 'Snakeskin', y: 'snakeskin', alleles: fancy({}),
    note: 'Corrente escura sobre o corpo e rosetas na cauda (Ssb, ligado ao Y).' },
  { id: 'goldenSnakeskin', name: 'Golden snakeskin', y: 'snakeskin', alleles: fancy({ Gol: hom('g'), Sat: hom('H') }),
    note: 'Snakeskin sobre base golden (g/g, kita).' },
  { id: 'kingCobra', name: 'King cobra', y: 'snakeskin', alleles: fancy({ Ze: hom('Ze') }, 'Vl'),
    note: 'Snakeskin (Ssb/Sst, no X ou Y) com as barras verticais do Zebrinus (autossômico dominante).' },
  { id: 'galaxy', name: 'Galaxy', y: 'galaxy', alleles: fancy({}),
    note: 'Um Y que carrega dois genes juntos: platinum (só do Y) na frente do corpo e snakeskin no resto.' },
  { id: 'redLace', name: 'Red lace', y: 'lace', alleles: fancy({ Fc: hom('R'), Sat: hom('H') }),
    note: 'Só o snakeskin da cauda (Sst, o "lacetail"): renda fina na cauda vermelha, corpo sem corrente.' },
  { id: 'blueLace', name: 'Blue lace', y: 'lace', alleles: fancy({ Fc: hom('Bl') }),
    note: 'Renda snakeskin só na cauda, sobre azul.' },
  { id: 'yellowSnakeskin', name: 'Metal yellow lace (yellow snakeskin)', y: 'snakeskin', alleles: fancy({ Mg: hom('Mg'), Fc: hom('Ye'), Sat: hom('H') }),
    note: 'Snakeskin com Metal Gold e sem Asian Blau, que apagaria o amarelo.' },
  { id: 'metalLaceGold', name: 'Metal lace gold', y: 'lace', alleles: fancy({ Mg: hom('Mg'), Gol: hom('g'), Fc: hom('Ye'), Sat: hom('H') }),
    note: 'Metal Gold sobre golden, com renda na cauda.' },
  { id: 'koiCobra', name: 'Koi cobra', y: 'snakeskin', alleles: fancy({ Ko: hom('Ko'), Ze: hom('Ze'), Fc: hom('R'), Sat: hom('H') }), koi: true,
    note: 'Cabeça vermelha do koi sobre king cobra (snakeskin + zebrinus).' },
  { id: 'tiger', name: 'Tiger', y: 'ornate', alleles: fancy({ Ze: hom('Ze'), Mg: hom('Mg'), Fc: hom('Ye') }),
    note: 'Barras do Zebrinus "com falhas que mostram as outras cores"; composição exata da linhagem não publicada.' },
  { id: 'blueMosaic', name: 'Mosaico azul · Blue Mosaic', y: 'blueTail', alleles: fancy({ Mo: hom('Mo'), Fc: hom('Bl') }),
    note: 'Cauda em ladrilhos irregulares escuros sobre azul.' },
  { id: 'redGrass', name: 'Grass vermelho · Red Grass', y: 'redTail', alleles: fancy({ Gra: hom('Gra'), Fc: hom('R'), Sat: hom('H') }),
    note: 'Pontinhos finos e densos na cauda e na dorsal.' },
  { id: 'blueGrass', name: 'Blue grass', y: 'blueTail', alleles: fancy({ Gra: hom('Gra'), Blu: hom('r'), Fc: hom('Bl') }),
    note: 'Grass sobre base blue (r/r, sem laranja).' },
  { id: 'leopard', name: 'Leopardo · Yellow Leopard', y: 'plain', alleles: fancy({ Le: hom('Le'), Fc: hom('Ye'), Sat: hom('H') }),
    note: 'Pintas escuras espaçadas sobre cauda amarela.' },
  { id: 'multicolor', name: 'Multicolor (party)', y: 'multiTail', alleles: fancy({ Sat: hom('H') }),
    note: 'Três ou mais cores na cauda.' },
  { id: 'fullGold', name: 'Full gold · amarelo', y: 'yellowTail', alleles: fancy({ Gol: hom('g'), Fc: hom('Ye'), Sat: hom('H') }),
    note: 'Corpo golden com nadadeiras amarelas.' },
  // ---- solid, metallic and head patterns ----
  { id: 'koi', name: 'Koi', y: 'redTail', alleles: fancy({ Ko: hom('Ko'), Blo: hom('b'), Fc: hom('R'), Sat: hom('H') }), koi: true,
    note: 'Corpo claro com cabeça e cauda vermelhas. A fêmea também tem cabeça e cauda vermelhas; nos machos o vermelho varia e pode descer pelo corpo.' },
  { id: 'albinoKoi', name: 'Koi albino', y: 'redTail', alleles: fancy({ Ko: hom('Ko'), Alb: hom('a'), Fc: hom('R'), Sat: hom('H') }), koi: true,
    note: 'Koi com olho vermelho (a/a): vermelho e branco, sem preto.' },
  { id: 'redDragon', name: 'Red dragon', y: 'dragon', alleles: fancy({ Fc: hom('R'), Sat: hom('H') }),
    note: 'Escamas metálicas em placas no corpo e cauda vermelha forte.' },
  { id: 'moscowBlue', name: 'Moscow blue veil', y: 'moscow', alleles: fancy({ Fc: hom('Bl') }, 'Vl'),
    note: 'Corpo inteiro azul-escuro metálico, sem manchas.' },
  { id: 'fullBlack', name: 'Full black · Moscow preto', y: 'moscowBlack', alleles: fancy({}, 'Vl'),
    note: 'Preto profundo no corpo e nas nadadeiras.' },
  { id: 'panda', name: 'Panda', y: 'panda', alleles: fancy({}),
    note: 'Corpo escuro, cauda mais escura e cabeça prateada.' },
  { id: 'neonBlue', name: 'Neon blue', y: 'neonBlue', alleles: fancy({ Fc: hom('Bl'), Nb: ['+', 'Nb'] }),
    note: 'Azul elétrico metálico no corpo.' },
  { id: 'japanBlue', name: 'Japan blue', y: 'japanBlue', alleles: fancy({ Fc: hom('Bl') }),
    note: 'Azul-claro metálico na metade de trás do corpo.' },
  { id: 'platinum', name: 'Full platinum', y: 'platinum', alleles: fancy({ Nb: ['+', 'Nb'] }),
    note: 'Frente do corpo branco-perolada e cauda clara.' },
  { id: 'coral', name: 'Coral', y: 'coral', alleles: fancy({ Fc: hom('R'), Sat: hom('H') }),
    note: 'Vermelho metálico na frente do corpo.' },
  // ---- eye and body mutations ----
  { id: 'redGlass', name: 'Red glass belly', y: 'redTail', alleles: fancy({ Gb: hom('gb'), Fc: hom('R'), Sat: hom('H') }),
    note: 'Glass belly (gb/gb, recessivo): a barriga não tem o forro prateado e mostra os órgãos.' },
  { id: 'albinoGlass', name: 'Albino red tail glass belly', y: 'redTail', alleles: fancy({ Gb: hom('gb'), Alb: hom('a'), Fc: hom('R'), Sat: hom('H') }),
    note: 'Albino + glass belly: quase transparente; na fêmea dá para ver os filhotes dentro.' },
  { id: 'goldKoiGlass', name: 'Gold koi glass belly', y: 'redTail', alleles: fancy({ Ko: hom('Ko'), Gol: hom('g'), Gb: hom('gb'), Fc: hom('R'), Sat: hom('H') }), koi: true,
    note: 'Golden + koi + glass belly: existe à venda com esse nome.' },
  { id: 'purple', name: 'Purple delta', y: 'purpleTail', alleles: fancy({ Pb: hom('Pb'), Fc: hom('Pu') }),
    note: 'Purple Body em dose dupla: laranja vira rosa-arroxeado. O "all purple" de exposição precisa de mais um gene ainda não identificado.' },
  { id: 'moscowPurple', name: 'Moscow purple', y: 'moscow', alleles: fancy({ Pb: hom('Pb'), Fc: hom('Pu') }, 'Vl'),
    note: 'Moscow com Purple Body, que puxa o corpo para violeta.' },
  { id: 'micariff', name: 'Yellow micariff', y: 'yellowTail', alleles: fancy({ Mic: hom('mc'), Fc: hom('Ye'), Sat: hom('H') }),
    note: 'Amarelo recessivo do Sri Lanka, origem guardada em segredo; só aparece no F2.' },
  { id: 'pinkWhite', name: 'Pink white', y: 'plain', alleles: fancy({ Pk: hom('p'), Fc: hom('Pa') }),
    note: 'Pink (p/p): branco translúcido no fim do corpo.' },
  { id: 'japanBlueRed', name: 'Japan blue red tail', y: 'japanBlue', alleles: fancy({ Fc: hom('R'), Sat: hom('H') }),
    note: 'Azul do Japan Blue (só no Y) com cauda vermelha.' },
  { id: 'moscowAlbino', name: 'Blue moscow albino', y: 'moscow', alleles: fancy({ Alb: hom('a'), Fc: hom('Bl') }, 'Vl'),
    note: 'Moscow sem melanina: azul claro e brilhante.' },
  { id: 'snakeskinAlbino', name: 'Snakeskin albino red tail', y: 'snakeskin', alleles: fancy({ Alb: hom('a'), Fc: hom('R'), Sat: hom('H') }),
    note: 'Snakeskin sem melanina: a corrente fica laranja.' },
  { id: 'dumboDragon', name: 'Dumbo dragon', y: 'dragon', alleles: fancy({ Dum: hom('du'), Fc: hom('R'), Sat: hom('H') }),
    note: 'Escamas metálicas de dragon com peitorais de dumbo.' },
  { id: 'fullRedAlbino', name: 'RREA Full Red', y: 'fullRed', alleles: fancy({ Alb: hom('a'), Fc: hom('R'), Sat: hom('H') }),
    note: 'Albino de olho vermelho, corpo e nadadeiras vermelhos. A fêmea também fica avermelhada, mais fraca.' },
  { id: 'rre', name: 'RRE Red · real red eye', y: 'redTail', alleles: fancy({ Rre: hom('re'), Fc: hom('R'), Sat: hom('H') }),
    note: 'Olho vermelho sem ser albino: o corpo mantém a melanina.' },
  { id: 'lutino', name: 'Lutino', y: 'redTail', alleles: fancy({ Lut: hom('w'), Fc: hom('R') }),
    note: 'Olho vinho e escuro reduzido (wrea).' },
  { id: 'blondRed', name: 'Blond red tail', y: 'redTail', alleles: fancy({ Blo: hom('b'), Fc: hom('R'), Sat: hom('H') }),
    note: 'Corpo blond (b/b) com cauda vermelha.' },
  { id: 'fullWhite', name: 'Full white', y: 'plain', alleles: fancy({ Nb: hom('Nb'), Fc: hom('Pa') }),
    note: 'Branco leitoso com olho preto (Nb/Nb).' },
  { id: 'dumbo', name: 'Dumbo ear', y: 'redTail', alleles: fancy({ Dum: hom('du'), Nb: hom('Nb'), Fc: hom('R') }),
    note: 'Peitorais enormes e claras, como orelhas.' },
  // ---- tail shapes ----
  { id: 'doubleSword', name: 'Double sword', y: 'doubleSword', alleles: { Cau: hom('Rd'), Pat: hom('P'), Bord: hom('b'), Sat: ['H', 'L'] },
    note: 'Cauda curta com espadas em cima e embaixo (Ds, ligado ao Y).' },
  { id: 'topSword', name: 'Top sword', y: 'topSword', alleles: { Cau: hom('Rd'), Pat: hom('P'), Bord: hom('b'), Sat: ['H', 'L'] },
    note: 'Espada só no raio de cima.' },
  { id: 'bottomSword', name: 'Bottom sword', y: 'bottomSword', alleles: { Cau: hom('Rd'), Pat: hom('P'), Bord: hom('b'), Sat: ['H', 'L'] },
    note: 'Espada só no raio de baixo.' },
  { id: 'lyre', name: 'Lyretail neon', y: 'blueTail', alleles: fancy({ Lyr: ['Lyr', '+'], Fc: hom('Bl') }, 'Rd'),
    note: 'Centro curto e raios de cima e de baixo alongados em curva.' },
  { id: 'halfMoon', name: 'Half-moon blue', y: 'blueTail', alleles: fancy({ Fc: hom('Bl') }, 'Dl'),
    note: 'Um delta que abre ~180 graus: half-moon não é gene, é abertura (muitos genes); parte dos filhos sai delta comum.' },
  { id: 'fantail', name: 'Fantail red', y: 'redTail', alleles: fancy({ Fc: hom('R') }, 'Fn'),
    note: 'Leque de bordas arredondadas.' },
  { id: 'flag', name: 'Flag (scarf) purple', y: 'purpleTail', alleles: fancy({ Fc: hom('Pu') }, 'Fl'),
    note: 'Cauda retangular, longa e estreita.' },
  { id: 'spade', name: 'Spadetail', y: 'redTail', alleles: { Cau: hom('Sp'), Pat: hom('P'), Bord: hom('b'), Fc: hom('R') },
    note: 'Cauda em ponta, como uma pá.' },
  { id: 'spear', name: 'Speartail', y: 'ornate', alleles: { Cau: hom('Spr'), Pat: hom('P'), Bord: hom('b'), Sat: ['H', 'L'] },
    note: 'Cauda oval que afina até uma ponta central.' },
  { id: 'pintail', name: 'Pintail', y: 'ornate', alleles: { Cau: hom('Pn'), Pat: hom('P'), Bord: hom('b'), Sat: ['H', 'L'] },
    note: 'Cauda curta com o raio central longo.' },
];

// Polygenic profile of a line: frequency of the increasing allele for each quantitative trait.
// Show lines have been selected for big, open, fully coloured fins; wild stock has small clear fins.
// Game values (TBD); each founder draws its own alleles, so founders of one line differ.
const Q_FANCY = { tailSize: 0.75, tailSpread: 0.7, dorsalSize: 0.65, colorCoverage: 0.75, bodySize: 0.6, headRed: 0.3 };
const Q_SHORT = { tailSize: 0.45, tailSpread: 0.45, dorsalSize: 0.5, colorCoverage: 0.6, bodySize: 0.5 };
const Q_WILD = { tailSize: 0.2, tailSpread: 0.25, dorsalSize: 0.25, colorCoverage: 0.3, bodySize: 0.35 };
const SHORT_TAILS = new Set(['doubleSword', 'topSword', 'bottomSword', 'spade', 'spear', 'pintail', 'lyre']);

/** Polygenic profile of a strain (`strain.quant` overrides). */
export function strainQuant(strain) {
  if (strain.quant) return strain.quant;
  if (strain.koi) return { ...Q_FANCY, headRed: 0.7 };   // koi lines are selected for a big red cap
  if (strain.id === 'wild') return Q_WILD;
  if (SHORT_TAILS.has(strain.id)) return Q_SHORT;
  if (strain.id === 'halfMoon') return { ...Q_FANCY, tailSpread: 0.97 };
  return Q_FANCY;
}

/** Haplotypes the sources describe as Y-linked only (docs/research.md): the line's females carry nothing of them. */
// Panda is a Moscow form (Bias: "Pink Moscow (Panda)"), so it is Y-only too (v7).
// Platinum (Schimmelpfennig) is Y-linked dominant [28], so galaxy (platinum + snakeskin) is a Y haplotype too (v8).
export const Y_ONLY_PATTERNS = new Set(['moscow', 'moscowBlack', 'japanBlue', 'coral', 'panda', 'platinum', 'galaxy']);

/** Sex-linked pattern a strain carries on its X chromosomes (both sexes); `strain.x` overrides. */
export function strainX(strain) {
  return strain.x ?? (Y_ONLY_PATTERNS.has(strain.y) ? 'plain' : strain.y);
}

/**
 * Founder fish of a strain. Both sexes carry the strain's X pattern; males also get its Y haplotype.
 * Every founder also brings its own hidden genetic load (founderLoad) and its own draw of the line's
 * polygenes (founderPolygenes), both from its seed.
 */
export function strainFounder(strain, sex, id, devSeed) {
  const seed = devSeed ?? hashString(`guppy:${id}`);
  return founder(SPECIES.guppy, {
    id, sex: sex === 'male' ? 'XY' : 'XX', yPattern: sex === 'male' ? strain.y : undefined,
    alleles: { ...founderLoad(SPECIES.guppy, deriveSeed(seed, 'load')), ...founderPolygenes(SPECIES.guppy, strainQuant(strain), deriveSeed(seed, 'poly')),
      Xc: hom(strainX(strain)), ...strain.alleles }, devSeed: seed,
  });
}
