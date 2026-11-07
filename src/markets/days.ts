// How a day reads, e.g. "1 Jun 2027". Days are UTC.
export const dayText = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
