// The options that won a question: every one that resolved Yes. A date question's options can overlap ("Before 11/15", "On 11/14"),
// so each one that held the moment is named, as on a several-winner question.
export const winningOptions = <T extends { won: boolean }>(options: T[]): T[] => options.filter((o) => o.won);
