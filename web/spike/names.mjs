// Hobby-style names for a guppy phenotype, the way breeders write them:
// [eye/body mutation] + [colour] + [pattern] + [tail], e.g. "HB Blue Delta", "RREA Full Red Delta".
const COLOR = { red: 'Red', blue: 'Blue', white: 'White', dark: 'Black', yellow: 'Yellow', purple: 'Purple', green: 'Green', multi: 'Multicolor', pastel: 'Pastel', natural: '' };
const TAIL = { delta: 'Delta', veil: 'Veil', halfMoon: 'Half Moon', fan: 'Fantail', flag: 'Flag', round: 'Round', spade: 'Spade', spear: 'Spear',
  pin: 'Pintail', lyre: 'Lyretail', topSword: 'Top Sword', bottomSword: 'Bottom Sword', doubleSword: 'Double Sword' };
const BODY = { moscow: 'Moscow Blue', moscowBlack: 'Full Black', panda: 'Panda', neonBlue: 'Neon Blue', japanBlue: 'Japan Blue', coral: 'Coral',
  platinum: 'Platinum' };

export function hobbyName(p) {
  const parts = [];
  if (p.albino) parts.push('RREA'); else if (p.redEye) parts.push('RRE'); else if (p.lutino) parts.push('Lutino');
  if (p.bigEar) parts.push('Dumbo Ear');
  if (p.bodyBase === 'golden') parts.push('Gold'); else if (p.bodyBase === 'blond') parts.push('Blond');
  if (p.blau === 'white') parts.push('White');
  if (p.pink) parts.push('Pink');
  if (p.purpleBody !== 'none') parts.push('Purple');
  if (p.micariff) parts.push('Micariff');
  if (p.metalGold) parts.push('Metal');
  const color = COLOR[p.tailColor] ?? '';
  // body layers, the way breeders stack them: Koi + pattern (+ Full Red) + tail
  if (p.kohaku) parts.push('Koi');
  if (p.tuxedo) parts.push(...(p.kohaku ? ['Tuxedo'] : ['HB', color || 'Grey']));
  const galaxy = p.bodyPattern === 'platinum' && p.snakeskin === 'snakeskin';
  if (galaxy) parts.push('Galaxy');
  else {
    if (p.fullRed) parts.push('Full Red');
    if (p.bodyPattern === 'dragon') parts.push(p.fullRed ? '' : color || 'Silver', 'Dragon');
    else if (BODY[p.bodyPattern]) parts.push(p.bodyPattern === 'platinum' && !p.fullRed && !p.kohaku ? 'Full Platinum' : BODY[p.bodyPattern]);
    if (p.snakeskin === 'cobra') parts.push('King Cobra'); else if (p.snakeskin === 'snakeskin') parts.push('Snakeskin');
    else if (p.zebrinus) parts.push('Tiger');
  }

  const bodyShown = p.kohaku || p.fullRed || p.snakeskin !== 'none' || p.bodyPattern !== 'none' || p.zebrinus || p.metalGold || p.micariff || p.purpleBody !== 'none';
  const lace = p.tailPattern === 'snakeskin' && p.snakeskin === 'none';   // tail-only snakeskin (Sst): "lace"
  if (lace) parts.push(p.tuxedo || bodyShown ? '' : color, 'Lace');
  if (p.tailPattern === 'mosaic' || p.tailPattern === 'grass' || p.tailPattern === 'leopard') {
    if (!p.tuxedo && color) parts.push(color);
    parts.push({ mosaic: 'Mosaic', grass: 'Grass', leopard: 'Leopard' }[p.tailPattern]);
  } else if (!lace && !p.tuxedo && !bodyShown && color) parts.push(color, p.tailColor === 'multi' ? '' : 'Tail');
  else if (p.kohaku && !p.tuxedo && color && color !== 'Red') parts.push(color, 'Tail');
  if (p.noOrange) parts.unshift('Blue base');
  if (p.pattern && !bodyShown && !p.tuxedo && !color) parts.push('Wild');
  if (!parts.filter(Boolean).length) parts.push('Selvagem');
  if (p.glassBelly) parts.push('Glass Belly');
  parts.push(TAIL[p.tailShape] ?? p.tailShape);
  return parts.filter(Boolean).join(' ');
}
