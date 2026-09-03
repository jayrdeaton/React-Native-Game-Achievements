export type RoundResult = 'win' | 'loss' | 'draw'

// The played/wins/losses/draws quadruple every game re-declares half a dozen times over (overall,
// per difficulty, per color, per mode, per profile). Nothing here knows what a bucket *means* —
// that's entirely the game's own stats shape.
export interface OutcomeRecord {
  played: number
  wins: number
  losses: number
  draws: number
}

export const DEFAULT_OUTCOME_RECORD: OutcomeRecord = { played: 0, wins: 0, losses: 0, draws: 0 }

// Which result a round was from one participant's point of view. `winner === null` means a draw;
// anything else is a win for whoever matches and a loss for everyone who doesn't. Compared with
// ===, so use a primitive (a seat number, a profile id, a color) rather than an object identity.
export function resultFor<T>(winner: T | null, subject: T): RoundResult {
  if (winner === null) return 'draw'
  return winner === subject ? 'win' : 'loss'
}

// Adds one round to a record. An absent `prev` starts from zero, so a caller never has to seed a
// bucket before its first round.
export function applyResult(prev: OutcomeRecord | undefined, result: RoundResult): OutcomeRecord {
  const base = prev ?? DEFAULT_OUTCOME_RECORD
  return {
    played: base.played + 1,
    wins: base.wins + (result === 'win' ? 1 : 0),
    losses: base.losses + (result === 'loss' ? 1 : 0),
    draws: base.draws + (result === 'draw' ? 1 : 0)
  }
}

// The keyed-bucket form of applyResult — returns a new map with just that one key replaced. Keys
// are used verbatim: normalize first (lowercase a hex color, say) if two spellings should count as
// the same bucket.
export function applyResultToBucket(buckets: Record<string, OutcomeRecord>, key: string, result: RoundResult): Record<string, OutcomeRecord> {
  return { ...buckets, [key]: applyResult(buckets[key], result) }
}

// 0 for a bucket with no rounds yet, rather than NaN — every caller wants it sortable.
export function getWinRate(record: OutcomeRecord): number {
  return record.played > 0 ? record.wins / record.played : 0
}

// A bucket needs at least this many rounds before its win rate means anything — otherwise one lucky
// win reads as a flawless 100%.
export const DEFAULT_MIN_SAMPLE = 3

// The player's most-used bucket ("favorite color"). Ties go to whichever key Object.entries yields
// first; null when there are no buckets at all.
export function getMostPlayedKey(buckets: Record<string, OutcomeRecord>): string | null {
  let best: string | null = null
  let bestPlayed = 0
  for (const [key, record] of Object.entries(buckets)) {
    if (record.played > bestPlayed) {
      best = key
      bestPlayed = record.played
    }
  }
  return best
}

// The bucket with the highest win rate, ignoring any with fewer than `minSample` rounds ("best
// performing color"). Null when nothing clears the sample floor.
export function getBestWinRateKey(buckets: Record<string, OutcomeRecord>, minSample: number = DEFAULT_MIN_SAMPLE): string | null {
  let best: string | null = null
  let bestRate = -1
  for (const [key, record] of Object.entries(buckets)) {
    if (record.played < minSample) continue
    const rate = getWinRate(record)
    if (rate > bestRate) {
      best = key
      bestRate = rate
    }
  }
  return best
}

// Wins in whichever single bucket has the most — the `value` accessor for an "N wins with one
// color" tiered family (see tieredFamily.ts).
export function getMaxWinsInAnyBucket(buckets: Record<string, OutcomeRecord>): number {
  return Object.values(buckets).reduce((max, record) => Math.max(max, record.wins), 0)
}

// How many distinct buckets have at least one win — the `value` accessor for a "win with N
// different colors" tiered family (see tieredFamily.ts).
export function countBucketsWithAWin(buckets: Record<string, OutcomeRecord>): number {
  return Object.values(buckets).filter((record) => record.wins > 0).length
}
