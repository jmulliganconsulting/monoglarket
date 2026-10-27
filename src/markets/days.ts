// A date question's days are YYYY-MM-DD, UTC. A line that is not a real day becomes an invalid date.
export const parseDay = (line: string) => {
	const d = new Date(`${line}T00:00:00Z`);
	return Number.isNaN(d.getTime()) || !d.toISOString().startsWith(line) ? new Date(NaN) : d;
};

// How a day reads in an option's name, e.g. "1 Jun 2027".
export const dayText = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
