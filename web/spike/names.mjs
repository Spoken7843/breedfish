// Hobby-style names for a guppy phenotype, the way breeders write them:
// [eye/body mutation] + [colour] + [pattern] + [tail], e.g. "HB Blue Delta", "RREA Full Red Delta".
const COLOR = { red: 'Red', blue: 'Blue', white: 'White', dark: 'Black', yellow: 'Yellow', purple: 'Purple', green: 'Green', multi: 'Multicolor', pastel: 'Pastel', natural: '' };
const TAIL = { delta: 'Delta', veil: 'Veil', halfMoon: 'Half Moon', fan: 'Fantail', flag: 'Flag', round: 'Round', spade: 'Spade', spear: 'Spear',
  pin: 'Pintail', lyre: 'Lyretail', topSword: 'Top Sword', bottomSword: 'Bottom Sword', doubleSword: 'Double Sword' };
const BODY = { snakeskin: 'Snakeskin', cobra: 'King Cobra', moscow: 'Moscow Blue', moscowBlack: 'Full Black', panda: 'Panda', galaxy: 'Galaxy',
  neonBlue: 'Neon Blue', japanBlue: 'Japan Blue', coral: 'Coral', platinum: 'Full Platinum', koi: 'Koi', fullRed: 'Full Red' };

export function hobbyName(p) {
  const parts = [];
  if (p.albino) parts.push('RREA'); else if (p.redEye) parts.push('RRE'); else if (p.lutino) parts.push('Lutino');
  if (p.bigEar) parts.push('Dumbo Ear');
  if (p.bodyBase === 'golden') parts.push('Gold'); else if (p.bodyBase === 'blond') parts.push('Blond');
  if (p.blau === 'white') parts.push('White');
  const color = COLOR[p.tailColor] ?? '';
  if (p.tuxedo) parts.push('HB', color || 'Grey');
  if (p.bodyPattern === 'dragon') parts.push(color || 'Silver', 'Dragon');
  else if (BODY[p.bodyPattern]) parts.push(BODY[p.bodyPattern]);
  if (p.tailPattern === 'mosaic' || p.tailPattern === 'grass' || p.tailPattern === 'leopard') {
    if (!p.tuxedo && color) parts.push(color);
    parts.push({ mosaic: 'Mosaic', grass: 'Grass', leopard: 'Leopard' }[p.tailPattern]);
  } else if (!p.tuxedo && p.bodyPattern === 'none' && color) parts.push(color, p.tailColor === 'multi' ? '' : 'Tail');
  if (p.noOrange) parts.unshift('Blue base');
  if (p.pattern && p.bodyPattern === 'none' && !p.tuxedo && !color) parts.push('Wild');
  if (!parts.length) parts.push('Selvagem');
  parts.push(TAIL[p.tailShape] ?? p.tailShape);
  return parts.filter(Boolean).join(' ');
}
