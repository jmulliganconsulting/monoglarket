// Early-sale fee (vault "ADR-021 Members can cash out before resolution"). Every sale before resolution pays it.
// The UI, the server and the portfolio all read it from here, so changing SELL_FEE changes every screen.
export const SELL_FEE = 0.05;

/** The house's cut of a sale's gross proceeds. Rounded up, so rounding favours the house (ADR-007). */
export const sellFee = (gross: number) => Math.max(0, Math.ceil(gross * SELL_FEE - 1e-9));

/** What the member actually receives for a sale worth `gross` before the fee. */
export const netOfFee = (gross: number) => gross - sellFee(gross);
