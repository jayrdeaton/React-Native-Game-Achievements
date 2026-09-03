import { achievementUnlockedAt, evaluateUnlockedIds, isAchievementUnlocked, newlyUnlocked, parseUnlockedKey, unlockedKey } from '../index'
import { applyTestOutcome, DEFAULT_TEST_STATS, TEST_CATALOG, TestStats } from './fixtures'

function statsAfter(...results: ('win' | 'loss' | 'draw')[]): TestStats {
  return results.reduce((stats, result) => applyTestOutcome(stats, result), DEFAULT_TEST_STATS)
}

describe('evaluateUnlockedIds', () => {
  it('returns nothing for a fresh, untouched stats blob', () => {
    expect([...evaluateUnlockedIds(TEST_CATALOG, DEFAULT_TEST_STATS)]).toEqual([])
  })

  it('returns every achievement whose predicate the stats clear', () => {
    expect(evaluateUnlockedIds(TEST_CATALOG, statsAfter('win'))).toEqual(new Set(['first_game', 'flawless_debut', 'total_wins_bronze']))
  })

  it('unlocks higher tiers as the underlying value grows', () => {
    expect(evaluateUnlockedIds(TEST_CATALOG, statsAfter('win', 'win', 'win'))).toEqual(new Set(['first_game', 'flawless_debut', 'total_wins_bronze', 'total_wins_silver']))
  })

  it('leaves a device-scoped achievement locked when its own condition is unmet', () => {
    // First game was a loss, so flawless_debut never unlocks no matter how many wins follow.
    const stats = statsAfter('loss', 'win', 'win', 'win')
    expect(evaluateUnlockedIds(TEST_CATALOG, stats).has('flawless_debut')).toBe(false)
  })

  it('skips device-scoped achievements entirely under profile scope', () => {
    const stats = statsAfter('win')
    const ids = evaluateUnlockedIds(TEST_CATALOG, stats, { scope: 'profile' })
    expect(ids.has('flawless_debut')).toBe(false)
    expect(ids.has('first_game')).toBe(true)
  })
})

describe('unlockedKey', () => {
  it('leaves a device-wide unlock as a bare achievement id', () => {
    expect(unlockedKey('first_game', null)).toBe('first_game')
  })

  it('namespaces a profile-scoped unlock under its profile id', () => {
    expect(unlockedKey('first_game', 'profile-1')).toBe('profile-1:first_game')
  })

  it('keeps two profiles unlock keys distinct for the same achievement', () => {
    expect(unlockedKey('first_game', 'a')).not.toBe(unlockedKey('first_game', 'b'))
  })
})

describe('parseUnlockedKey', () => {
  it('round-trips a device-wide key', () => {
    expect(parseUnlockedKey(unlockedKey('first_game', null))).toEqual({ profileId: null, achievementId: 'first_game' })
  })

  it('round-trips a profile-scoped key', () => {
    expect(parseUnlockedKey(unlockedKey('first_game', 'profile-1'))).toEqual({ profileId: 'profile-1', achievementId: 'first_game' })
  })

  it('splits on the first colon only', () => {
    expect(parseUnlockedKey('profile-1:odd:id')).toEqual({ profileId: 'profile-1', achievementId: 'odd:id' })
  })
})

describe('newlyUnlocked', () => {
  it('reports everything as new against an empty unlock map', () => {
    expect(newlyUnlocked(TEST_CATALOG, statsAfter('win'), {}).map((a) => a.id)).toEqual(['first_game', 'flawless_debut', 'total_wins_bronze'])
  })

  it('excludes achievements already recorded in the unlock map', () => {
    const unlocked = { first_game: 1, flawless_debut: 1 }
    expect(newlyUnlocked(TEST_CATALOG, statsAfter('win'), unlocked).map((a) => a.id)).toEqual(['total_wins_bronze'])
  })

  it('returns an empty list when nothing new cleared', () => {
    const stats = statsAfter('win')
    const unlocked = Object.fromEntries([...evaluateUnlockedIds(TEST_CATALOG, stats)].map((id) => [id, 1]))
    expect(newlyUnlocked(TEST_CATALOG, stats, unlocked)).toEqual([])
  })

  it('preserves catalog order', () => {
    const ids = newlyUnlocked(TEST_CATALOG, statsAfter('win', 'win', 'win'), {}).map((a) => a.id)
    expect(ids).toEqual(['first_game', 'flawless_debut', 'total_wins_bronze', 'total_wins_silver'])
  })

  it('never reports a device-scoped achievement for a profile, even with matching stats', () => {
    const stats = statsAfter('win')
    expect(newlyUnlocked(TEST_CATALOG, stats, {}, 'profile-1').map((a) => a.id)).toEqual(['first_game', 'total_wins_bronze'])
  })

  it('reads the profile-namespaced key when checking what is already unlocked', () => {
    // The bare device-wide key is set, but this profile own key is not — so it is still new here.
    const unlocked = { first_game: 1 }
    expect(newlyUnlocked(TEST_CATALOG, statsAfter('win'), unlocked, 'profile-1').map((a) => a.id)).toContain('first_game')
  })
})

describe('isAchievementUnlocked / achievementUnlockedAt', () => {
  const unlocked = { first_game: 1756800000000, 'profile-1:first_game': 1756800000001 }

  it('reads the device-wide key by default', () => {
    expect(isAchievementUnlocked(unlocked, 'first_game')).toBe(true)
    expect(achievementUnlockedAt(unlocked, 'first_game')).toBe(1756800000000)
  })

  it('reads a profile own key when given a profile id', () => {
    expect(isAchievementUnlocked(unlocked, 'first_game', 'profile-1')).toBe(true)
    expect(achievementUnlockedAt(unlocked, 'first_game', 'profile-1')).toBe(1756800000001)
  })

  it('reports a profile that has not unlocked it as locked, without falling back to device-wide', () => {
    expect(isAchievementUnlocked(unlocked, 'first_game', 'profile-2')).toBe(false)
    expect(achievementUnlockedAt(unlocked, 'first_game', 'profile-2')).toBeNull()
  })
})
