import { AchievementDefinition, tieredFamily } from '../index'

interface Stats {
  wins: number
}

function family(thresholds = { bronze: 10, silver: 50, gold: 200 }, scope?: 'device' | 'profile'): AchievementDefinition<Stats>[] {
  return tieredFamily<Stats>({
    id: 'total_wins',
    titles: { bronze: 'Winner', silver: 'Big Winner', gold: 'Champion' },
    description: (n) => `Win ${n} total games.`,
    icon: 'trophy',
    thresholds,
    value: (stats) => stats.wins,
    scope
  })
}

describe('tieredFamily', () => {
  it('generates exactly three achievements, in ascending tier order', () => {
    expect(family().map((a) => a.tier)).toEqual(['bronze', 'silver', 'gold'])
  })

  it('suffixes each id with its own tier', () => {
    expect(family().map((a) => a.id)).toEqual(['total_wins_bronze', 'total_wins_silver', 'total_wins_gold'])
  })

  it('renders each tier description with that tier own threshold', () => {
    expect(family().map((a) => a.description)).toEqual(['Win 10 total games.', 'Win 50 total games.', 'Win 200 total games.'])
  })

  it('gives every tier the same icon and its own title', () => {
    const generated = family()
    expect(generated.every((a) => a.icon === 'trophy')).toBe(true)
    expect(generated.map((a) => a.title)).toEqual(['Winner', 'Big Winner', 'Champion'])
  })

  it('unlocks a tier at exactly its threshold, not one short of it', () => {
    const [bronze] = family()
    expect(bronze.isUnlocked({ wins: 9 })).toBe(false)
    expect(bronze.isUnlocked({ wins: 10 })).toBe(true)
    expect(bronze.isUnlocked({ wins: 11 })).toBe(true)
  })

  it('unlocks lower tiers before higher ones at an intermediate value', () => {
    expect(family().map((a) => a.isUnlocked({ wins: 50 }))).toEqual([true, true, false])
  })

  it('reports progress as a clamped fraction of the threshold', () => {
    const [bronze, silver] = family()
    expect(bronze.progress?.({ wins: 0 })).toBe(0)
    expect(bronze.progress?.({ wins: 5 })).toBe(0.5)
    expect(silver.progress?.({ wins: 5 })).toBe(0.1)
  })

  it('caps progress at 1 once past the threshold', () => {
    const [bronze] = family()
    expect(bronze.progress?.({ wins: 999 })).toBe(1)
  })

  it('reports full progress for a non-positive threshold instead of Infinity or NaN', () => {
    const [bronze] = family({ bronze: 0, silver: 1, gold: 2 })
    expect(bronze.progress?.({ wins: 0 })).toBe(1)
    expect(bronze.isUnlocked({ wins: 0 })).toBe(true)
  })

  it('leaves scope undefined unless one is passed', () => {
    expect(family().every((a) => a.scope === undefined)).toBe(true)
    expect(family(undefined, 'device').every((a) => a.scope === 'device')).toBe(true)
  })
})

describe('tieredFamily progress option', () => {
  interface Timed {
    bestSeconds: number | null
  }

  // The documented lower-is-better shape: negate both the value and the thresholds so the `>=`
  // comparison still reads correctly.
  function speedFamily(progress: false | ((stats: Timed, threshold: number) => number) | undefined) {
    return tieredFamily<Timed>({
      id: 'speed',
      titles: { bronze: 'Quick', silver: 'Quicker', gold: 'Quickest' },
      description: (n) => `Win in under ${-n} seconds.`,
      icon: 'timer',
      thresholds: { bronze: -600, silver: -300, gold: -180 },
      value: (stats) => (stats.bestSeconds === null ? -Infinity : -stats.bestSeconds),
      progress
    })
  }

  it('still unlocks correctly for a negated lower-is-better family', () => {
    const [bronze, silver, gold] = speedFamily(false)
    expect(bronze.isUnlocked({ bestSeconds: 500 })).toBe(true)
    expect(silver.isUnlocked({ bestSeconds: 500 })).toBe(false)
    expect(gold.isUnlocked({ bestSeconds: 100 })).toBe(true)
  })

  it('never unlocks anything when there is no time recorded yet', () => {
    expect(speedFamily(false).some((a) => a.isUnlocked({ bestSeconds: null }))).toBe(false)
  })

  it('omits progress entirely when passed false', () => {
    expect(speedFamily(false).every((a) => a.progress === undefined)).toBe(true)
  })

  it('would otherwise report a full bar for a player who is far too slow — the reason false exists', () => {
    // 1200s against a -600 bronze threshold: the automatic fraction is (-1200)/(-600) = 2, which
    // clamps to 1. Guards the exact footgun the option documents.
    const [bronze] = speedFamily(undefined)
    expect(bronze.progress?.({ bestSeconds: 1200 })).toBe(1)
    expect(bronze.isUnlocked({ bestSeconds: 1200 })).toBe(false)
  })

  it('uses a supplied progress function, clamped, with that tier own threshold', () => {
    const [bronze] = speedFamily((stats, threshold) => (stats.bestSeconds === null ? 0 : -threshold / stats.bestSeconds))
    // 600s against a 600s target reads as complete; 1200s reads as half way.
    expect(bronze.progress?.({ bestSeconds: 600 })).toBe(1)
    expect(bronze.progress?.({ bestSeconds: 1200 })).toBe(0.5)
    expect(bronze.progress?.({ bestSeconds: null })).toBe(0)
  })
})
