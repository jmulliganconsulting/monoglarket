// The option(s) that won a question. A date question's winner is the earliest option that held, the one the event happened by;
// every later "on or before" option also holds, so only the earliest is named. A several-winner question names all that won.
export function winningOptions<T extends { won: boolean; optionDate: Date | string | null }>(options: T[]): T[] {
  const won = options.filter((o) => o.won);
  const time = (o: T) => (o.optionDate ? new Date(o.optionDate).getTime() : Infinity);
  if (won.some((o) => o.optionDate)) return won.toSorted((a, b) => time(a) - time(b)).slice(0, 1);
  return won;
}
