// Trade rate limit (vault "Abuse limits": 30 trades a minute per member), on the shared limiter.
import { hit, type Rule } from '../ratelimit/ratelimit.ts';

export const TRADES_PER_MINUTE = 30;
const TRADES: Rule = { name: 'trade', limit: TRADES_PER_MINUTE, windowMs: 60_000 };

export function tradeAllowed(userId: number, now = Date.now()): boolean {
  return hit(`u:${userId}`, TRADES, now).allowed;
}
