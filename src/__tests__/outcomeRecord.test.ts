import { applyResult, applyResultToBucket, countBucketsWithAWin, DEFAULT_OUTCOME_RECORD, getBestWinRateKey, getMaxWinsInAnyBucket, getMostPlayedKey, getWinRate, OutcomeRecord, resultFor } from '../index'

describe('resultFor', () => {
  it('reads a null winner as a draw for everyone', () => {
    expect(resultFor(null, 1)).toBe('draw')
    expect(resultFor(null, 2)).toBe('draw')
  })

  it('reads a win for the matching subject and a loss for everyone else', () => {
    expect(resultFor(1, 1)).toBe('win')
    expect(resultFor(1, 2)).toBe('loss')
  })

  it('works for string subjects like a profile id or a color', () => {
    expect(resultFor('profile-1', 'profile-1')).toBe('win')
    expect(resultFor('profile-1', 'profile-2')).toBe('loss')
  })
})

describe('applyResult', () => {
  it('increments played plus exactly the matching outcome bucket', () => {
    expect(applyResult(DEFAULT_OUTCOME_RECORD, 'win')).toEqual({ played: 1, wins: 1, losses: 0, draws: 0 })
    expect(applyResult(DEFAULT_OUTCOME_RECORD, 'loss')).toEqual({ played: 1, wins: 0, losses: 1, draws: 0 })
    expect(applyResult(DEFAULT_OUTCOME_RECORD, 'draw')).toEqual({ played: 1, wins: 0, losses: 0, draws: 1 })
  })

  it('starts from zero for an absent record, so a bucket never has to be seeded', () => {
    expect(applyResult(undefined, 'win')).toEqual({ played: 1, wins: 1, losses: 0, draws: 0 })
  })

  it('does not mutate the record it is given', () => {
    const prev = { ...DEFAULT_OUTCOME_RECORD }
    applyResult(prev, 'win')
    expect(prev).toEqual(DEFAULT_OUTCOME_RECORD)
  })

  it('accumulates across a mixed sequence', () => {
    const record = (['win', 'win', 'draw', 'loss', 'win'] as const).reduce<OutcomeRecord>((acc, result) => applyResult(acc, result), DEFAULT_OUTCOME_RECORD)
    expect(record).toEqual({ played: 5, wins: 3, losses: 1, draws: 1 })
  })
})

describe('applyResultToBucket', () => {
  it('creates a bucket on first use and leaves the others untouched', () => {
    const buckets = applyResultToBucket({ '#ff0000': { played: 2, wins: 1, losses: 1, draws: 0 } }, '#00ff00', 'win')
    expect(buckets['#00ff00']).toEqual({ played: 1, wins: 1, losses: 0, draws: 0 })
    expect(buckets['#ff0000']).toEqual({ played: 2, wins: 1, losses: 1, draws: 0 })
  })

  it('does not mutate the map it is given', () => {
    const before = {}
    applyResultToBucket(before, 'a', 'win')
    expect(before).toEqual({})
  })

  it('treats keys verbatim, so callers must normalize casing themselves', () => {
    const buckets = applyResultToBucket(applyResultToBucket({}, '#FF0000', 'win'), '#ff0000', 'win')
    expect(Object.keys(buckets).sort()).toEqual(['#FF0000', '#ff0000'])
  })
})

describe('getWinRate', () => {
  it('returns 0 rather than NaN for a record with nothing played', () => {
    expect(getWinRate(DEFAULT_OUTCOME_RECORD)).toBe(0)
  })

  it('is wins over played', () => {
    expect(getWinRate({ played: 4, wins: 3, losses: 1, draws: 0 })).toBe(0.75)
  })
})

describe('bucket summaries', () => {
  const buckets: Record<string, OutcomeRecord> = {
    red: { played: 10, wins: 4, losses: 6, draws: 0 },
    blue: { played: 4, wins: 3, losses: 1, draws: 0 },
    green: { played: 2, wins: 2, losses: 0, draws: 0 },
    grey: { played: 3, wins: 0, losses: 3, draws: 0 }
  }

  it('getMostPlayedKey picks the highest played count', () => {
    expect(getMostPlayedKey(buckets)).toBe('red')
  })

  it('getMostPlayedKey returns null for an empty map', () => {
    expect(getMostPlayedKey({})).toBeNull()
  })

  it('getBestWinRateKey ignores buckets under the sample floor', () => {
    // green has a perfect 2/2 but only 2 rounds, under the default floor of 3 — blue (3/4) wins.
    expect(getBestWinRateKey(buckets)).toBe('blue')
  })

  it('getBestWinRateKey honours an explicit sample floor', () => {
    expect(getBestWinRateKey(buckets, 1)).toBe('green')
    expect(getBestWinRateKey(buckets, 11)).toBeNull()
  })

  it('getMaxWinsInAnyBucket finds the single best bucket, not the total', () => {
    expect(getMaxWinsInAnyBucket(buckets)).toBe(4)
    expect(getMaxWinsInAnyBucket({})).toBe(0)
  })

  it('countBucketsWithAWin counts distinct buckets with at least one win', () => {
    expect(countBucketsWithAWin(buckets)).toBe(3)
    expect(countBucketsWithAWin({})).toBe(0)
  })
})
