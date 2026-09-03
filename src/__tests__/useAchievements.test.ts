import { act, renderHook, waitFor } from '@testing-library/react'

import { AchievementsStorage, useAchievements, UseAchievementsOptions } from '../index'
import { applyTestOutcome, DEFAULT_TEST_STATS, TEST_CATALOG, testProfileViews, TestStats } from './fixtures'

// An in-memory stand-in for AsyncStorage, so nothing here touches a native module. Exposes the
// backing map so a test can both seed it and assert what got written back.
function makeStorage(seed: Record<string, string> = {}): AchievementsStorage & { items: Record<string, string> } {
  const items: Record<string, string> = { ...seed }
  return {
    items,
    getItem: (key) => Promise.resolve(items[key] ?? null),
    setItem: (key, value) => {
      items[key] = value
      return Promise.resolve()
    },
    removeItem: (key) => {
      delete items[key]
      return Promise.resolve()
    }
  }
}

function options(storage: AchievementsStorage, overrides: Partial<UseAchievementsOptions<TestStats>> = {}): UseAchievementsOptions<TestStats> {
  return { namespace: 'testgame', catalog: TEST_CATALOG, defaultStats: DEFAULT_TEST_STATS, profileViews: testProfileViews, storage, ...overrides }
}

async function renderLoaded(storage: AchievementsStorage, overrides: Partial<UseAchievementsOptions<TestStats>> = {}) {
  const view = renderHook(() => useAchievements(options(storage, overrides)))
  await waitFor(() => expect(view.result.current.loaded).toBe(true))
  return view
}

describe('useAchievements loading', () => {
  it('starts with the supplied defaults and flips loaded once storage has been read', async () => {
    const { result } = await renderLoaded(makeStorage())
    expect(result.current.stats).toEqual(DEFAULT_TEST_STATS)
    expect(result.current.unlockedAchievements).toEqual({})
  })

  it('restores a previously stored stats blob and unlock map', async () => {
    const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'win')
    const storage = makeStorage({ 'testgame.stats': JSON.stringify(stats), 'testgame.achievements': JSON.stringify({ first_game: 5, flawless_debut: 5, total_wins_bronze: 5 }) })
    const { result } = await renderLoaded(storage)
    expect(result.current.stats).toEqual(stats)
    expect(result.current.unlockedAchievements).toEqual({ first_game: 5, flawless_debut: 5, total_wins_bronze: 5 })
  })

  it('falls back to defaults for a corrupt stats blob', async () => {
    const { result } = await renderLoaded(makeStorage({ 'testgame.stats': 'not json at all' }))
    expect(result.current.stats).toEqual(DEFAULT_TEST_STATS)
  })

  it('falls back to defaults for a stats blob the game own validator rejects', async () => {
    const storage = makeStorage({ 'testgame.stats': JSON.stringify({ nonsense: true }) })
    const { result } = await renderLoaded(storage, { isValidStats: (value) => typeof (value as TestStats).record === 'object' })
    expect(result.current.stats).toEqual(DEFAULT_TEST_STATS)
  })

  it('discards a corrupt unlock map without taking valid stats down with it', async () => {
    const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'loss')
    const storage = makeStorage({ 'testgame.stats': JSON.stringify(stats), 'testgame.achievements': '{{{' })
    const { result } = await renderLoaded(storage)
    expect(result.current.stats).toEqual(stats)
    // Rebuilt from scratch by the backfill sweep rather than left empty.
    expect(result.current.unlockedAchievements).toHaveProperty('first_game')
  })

  it('runs migrateStats over a validated stored blob before evaluating anything', async () => {
    const stored = applyTestOutcome(DEFAULT_TEST_STATS, 'loss')
    const storage = makeStorage({ 'testgame.stats': JSON.stringify(stored) })
    const { result } = await renderLoaded(storage, { migrateStats: (stats) => ({ ...stats, profiles: stats.profiles ?? {} }) })
    expect(result.current.stats.profiles).toEqual({})
  })

  it('survives storage that rejects outright, keeping defaults and still flipping loaded', async () => {
    const failing: AchievementsStorage = { getItem: () => Promise.reject(new Error('unavailable')), setItem: () => Promise.resolve(), removeItem: () => Promise.resolve() }
    const { result } = await renderLoaded(failing)
    expect(result.current.stats).toEqual(DEFAULT_TEST_STATS)
  })
})

describe('useAchievements self-healing backfill', () => {
  it('backfills achievements that stored stats already clear but the unlock map is missing', async () => {
    // Simulates the stats write landing while the achievements write did not.
    const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'win')
    const storage = makeStorage({ 'testgame.stats': JSON.stringify(stats) })
    const { result } = await renderLoaded(storage)
    expect(Object.keys(result.current.unlockedAchievements).sort()).toEqual(['first_game', 'flawless_debut', 'total_wins_bronze'])
  })

  it('persists the backfilled map so the sweep does not have to run again', async () => {
    const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'win')
    const storage = makeStorage({ 'testgame.stats': JSON.stringify(stats) })
    await renderLoaded(storage)
    await waitFor(() => expect(storage.items['testgame.achievements']).toBeDefined())
    expect(JSON.parse(storage.items['testgame.achievements'])).toHaveProperty('total_wins_bronze')
  })

  it('preserves the original timestamp of an already-recorded unlock', async () => {
    const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'win')
    const storage = makeStorage({ 'testgame.stats': JSON.stringify(stats), 'testgame.achievements': JSON.stringify({ first_game: 12345 }) })
    const { result } = await renderLoaded(storage)
    expect(result.current.unlockedAchievements.first_game).toBe(12345)
  })

  it('backfills per-profile unlocks under each profile own namespace', async () => {
    const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'win', ['profile-1'])
    const storage = makeStorage({ 'testgame.stats': JSON.stringify(stats) })
    const { result } = await renderLoaded(storage)
    expect(result.current.unlockedAchievements).toHaveProperty('profile-1:first_game')
    // The device-scoped one never gets a profile-namespaced key.
    expect(result.current.unlockedAchievements).not.toHaveProperty('profile-1:flawless_debut')
  })

  it('writes nothing back when the stored map is already complete', async () => {
    const storage = makeStorage({ 'testgame.stats': JSON.stringify(DEFAULT_TEST_STATS) })
    await renderLoaded(storage)
    expect(storage.items['testgame.achievements']).toBeUndefined()
  })
})

describe('useAchievements recordOutcome', () => {
  it('applies the supplied updater and returns the newly unlocked achievements', async () => {
    const { result } = await renderLoaded(makeStorage())
    let unlocked: string[] = []
    act(() => {
      unlocked = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win')).device.map((a) => a.id)
    })
    expect(unlocked).toEqual(['first_game', 'flawless_debut', 'total_wins_bronze'])
    expect(result.current.stats.record).toEqual({ played: 1, wins: 1, losses: 0, draws: 0 })
  })

  it('returns the updated stats directly, without waiting a render', async () => {
    const { result } = await renderLoaded(makeStorage())
    let returned: TestStats = DEFAULT_TEST_STATS
    act(() => {
      returned = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'loss')).stats
    })
    expect(returned.record.losses).toBe(1)
  })

  it('reports an achievement only on the round it actually unlocks, not on later ones', async () => {
    const { result } = await renderLoaded(makeStorage())
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
    })
    let second: string[] = []
    act(() => {
      second = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win')).device.map((a) => a.id)
    })
    expect(second).toEqual([])
  })

  it('reports a higher tier on the round that clears it', async () => {
    const { result } = await renderLoaded(makeStorage())
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
    })
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
    })
    let third: string[] = []
    act(() => {
      third = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win')).device.map((a) => a.id)
    })
    expect(third).toEqual(['total_wins_silver'])
  })

  it('persists both blobs', async () => {
    const storage = makeStorage()
    const { result } = await renderLoaded(storage)
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
    })
    await waitFor(() => expect(storage.items['testgame.stats']).toBeDefined())
    expect(JSON.parse(storage.items['testgame.stats']).record.wins).toBe(1)
    expect(JSON.parse(storage.items['testgame.achievements'])).toHaveProperty('first_game')
  })

  it('reports per-profile unlocks keyed by profile id, excluding device-scoped ones', async () => {
    const { result } = await renderLoaded(makeStorage())
    let profiles: Record<string, string[]> = {}
    act(() => {
      const outcome = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win', ['profile-1']))
      profiles = Object.fromEntries(Object.entries(outcome.profiles).map(([id, list]) => [id, list.map((a) => a.id)]))
    })
    expect(profiles).toEqual({ 'profile-1': ['first_game', 'total_wins_bronze'] })
  })

  it('tracks two profiles independently', async () => {
    const { result } = await renderLoaded(makeStorage())
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win', ['profile-1']))
    })
    let second: Record<string, string[]> = {}
    act(() => {
      const outcome = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win', ['profile-2']))
      second = Object.fromEntries(Object.entries(outcome.profiles).map(([id, list]) => [id, list.map((a) => a.id)]))
    })
    // profile-1 unlocked nothing new this round; profile-2 unlocked its own first-ever entries.
    expect(Object.keys(second)).toEqual(['profile-2'])
    expect(result.current.unlockedAchievements).toHaveProperty('profile-1:first_game')
    expect(result.current.unlockedAchievements).toHaveProperty('profile-2:first_game')
  })

  it('leaves the unlock map untouched when a round unlocks nothing', async () => {
    const { result } = await renderLoaded(makeStorage())
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
    })
    const before = result.current.unlockedAchievements
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'loss'))
    })
    expect(result.current.unlockedAchievements).toBe(before)
  })

  it('works with no profileViews at all, keeping everything device-wide', async () => {
    const { result } = await renderLoaded(makeStorage(), { profileViews: undefined })
    let profiles: Record<string, unknown> = {}
    act(() => {
      profiles = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win', ['profile-1'])).profiles
    })
    expect(profiles).toEqual({})
  })
})

describe('useAchievements resetAll', () => {
  it('returns stats and unlocks to defaults and clears both stored keys', async () => {
    const storage = makeStorage()
    const { result } = await renderLoaded(storage)
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
    })
    act(() => {
      result.current.resetAll()
    })
    expect(result.current.stats).toEqual(DEFAULT_TEST_STATS)
    expect(result.current.unlockedAchievements).toEqual({})
    await waitFor(() => expect(storage.items['testgame.stats']).toBeUndefined())
    expect(storage.items['testgame.achievements']).toBeUndefined()
  })
})

describe('useAchievements removeProfile', () => {
  it('drops only that profile unlock keys, leaving device-wide and other profiles intact', async () => {
    const { result } = await renderLoaded(makeStorage())
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win', ['profile-1', 'profile-2']))
    })
    act(() => {
      result.current.removeProfile('profile-1')
    })
    expect(result.current.unlockedAchievements).not.toHaveProperty('profile-1:first_game')
    expect(result.current.unlockedAchievements).toHaveProperty('profile-2:first_game')
    expect(result.current.unlockedAchievements).toHaveProperty('first_game')
  })

  it('applies the optional stats updater so the profile own bucket goes too', async () => {
    const { result } = await renderLoaded(makeStorage())
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win', ['profile-1']))
    })
    act(() => {
      result.current.removeProfile('profile-1', (prev) => {
        const { 'profile-1': _dropped, ...rest } = prev.profiles
        return { ...prev, profiles: rest }
      })
    })
    expect(result.current.stats.profiles).toEqual({})
  })

  it('does not touch a profile whose id merely shares a prefix with the removed one', async () => {
    const { result } = await renderLoaded(makeStorage())
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win', ['abc', 'abcdef']))
    })
    act(() => {
      result.current.removeProfile('abc')
    })
    expect(result.current.unlockedAchievements).not.toHaveProperty('abc:first_game')
    expect(result.current.unlockedAchievements).toHaveProperty('abcdef:first_game')
  })
})
