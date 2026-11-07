// Numeric questions: each option is a range like "20-21", "32+", "≤19" or "Above $4.60", and settles from one number (or range) entered at resolution.

export type Range = { lo: number; loInc: boolean; hi: number; hiInc: boolean };

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const prefixes: [RegExp, (n: number) => Range][] = [
  [/^(?:>=|≥|at ?least|min)/, (n) => ({ lo: n, loInc: true, hi: Infinity, hiInc: false })],
  [/^(?:<=|≤|at ?most|max)/, (n) => ({ lo: -Infinity, loInc: false, hi: n, hiInc: true })],
  [/^(?:>|above|over|more ?than)/, (n) => ({ lo: n, loInc: false, hi: Infinity, hiInc: false })],
  [/^(?:<|below|under|less ?than|fewer ?than)/, (n) => ({ lo: -Infinity, loInc: false, hi: n, hiInc: false })],
];

/** Parse a range as written by a person. Null if it isn't one. `$`, commas and spaces are ignored. */
export function parseRange(text: string): Range | null {
  const s = text.toLowerCase().replace(/[$,\s]/g, '');
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^(${NUM})(?:-|–|to)(${NUM})$`)))) return valid({ lo: +m[1], loInc: true, hi: +m[2], hiInc: true });
  if ((m = s.match(new RegExp(`^(${NUM})\\+$`)))) return { lo: +m[1], loInc: true, hi: Infinity, hiInc: false };
  if ((m = s.match(new RegExp(`^(${NUM})$`)))) return { lo: +m[1], loInc: true, hi: +m[1], hiInc: true };
  for (const [re, make] of prefixes) {
    const rest = s.replace(re, '');
    if (rest !== s && new RegExp(`^${NUM}$`).test(rest)) return make(+rest);
  }
  return null;
}

const valid = (r: Range) => (r.lo < r.hi || (r.lo === r.hi && r.loInc && r.hiInc) ? r : null);

/** Does the option's range hold the answer? The whole answer must fall inside it (a single number is a range of one). */
export function rangeHolds(option: Range, answer: Range) {
  const loOk = answer.lo > option.lo || (answer.lo === option.lo && (option.loInc || !answer.loInc));
  const hiOk = answer.hi < option.hi || (answer.hi === option.hi && (option.hiInc || !answer.hiInc));
  return loOk && hiOk;
}

