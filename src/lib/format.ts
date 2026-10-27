// Dabloon amounts everywhere on the site: 1850 -> "1,850", -1200 -> "-1,200".
export const coins = (n: number) => n.toLocaleString('en-US');

/** With a + on gains: 50 -> "+50", -1200 -> "-1,200". */
export const signedCoins = (n: number) => (n > 0 ? '+' : '') + coins(n);

/** A date and time. The year is shown only when it isn't the current year. */
export const dateTime = (d: Date) =>
  d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
