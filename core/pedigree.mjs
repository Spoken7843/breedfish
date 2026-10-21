/** Exact pedigree recursion under the explicit assumption that unrelated founders have kinship=0. */
export function pedigreeCOI(motherId, fatherId, animals) {
  const memo = new Map(), visiting = new Set();
  function phi(a, b) {
    if (!a || !b) return 0;
    const key = [a, b].sort().join('|');
    if (memo.has(key)) return memo.get(key);
    if (visiting.has(key)) throw Error('pedigree cycle detected');
    visiting.add(key);
    const fishA = animals[a], fishB = animals[b];
    if (!fishA || !fishB) throw Error('unknown pedigree ID');
    let result;
    if (a === b) result = fishA.parents ? (1 + phi(...fishA.parents)) / 2 : 0.5;
    else if (fishA.parents && (!fishB.parents || (fishA.generation ?? 0) >= (fishB.generation ?? 0))) {
      result = (phi(fishA.parents[0], b) + phi(fishA.parents[1], b)) / 2;
    } else if (fishB.parents) {
      result = (phi(a, fishB.parents[0]) + phi(a, fishB.parents[1])) / 2;
    } else result = 0;
    memo.set(key, result); visiting.delete(key); return result;
  }
  return phi(motherId, fatherId);
}
