import { configureStore } from '@reduxjs/toolkit'
import { act, renderHook } from '@testing-library/react'
import { ReactNode } from 'react'
import { Provider } from 'react-redux'

import { AchievementsState, createAchievementsSlice, useAchievements, UseAchievementsOptions } from '../index'
import { applyTestOutcome, DEFAULT_TEST_STATS, TEST_CATALOG, testProfileViews, TestStats } from './fixtures'

const REHYDRATE = 'persist/REHYDRATE'

type Root = { achievements: AchievementsState<TestStats> }

const slice = createAchievementsSlice<TestStats>({ defaultStats: DEFAULT_TEST_STATS })

// A store holding just the achievements slice, optionally seeded the way redux-persist would seed it
// (a REHYDRATE carrying what an earlier session saved).
function makeStore(persisted?: Partial<AchievementsState<TestStats>>) {
  const store = configureStore({ reducer: { achievements: slice.reducer } })
  if (persisted) store.dispatch({ type: REHYDRATE, payload: { achievements: persisted } })
  return store
}

function options(overrides: Partial<UseAchievementsOptions<TestStats, Root>> = {}): UseAchievementsOptions<TestStats, Root> {
  return { catalog: TEST_CATALOG, select: (state) => state.achievements, actions: slice.actions, profileViews: testProfileViews, ...overrides }
}

function render(store = makeStore(), overrides: Partial<UseAchievementsOptions<TestStats, Root>> = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  return { store, ...renderHook(() => useAchievements(options(overrides)), { wrapper }) }
}

describe('useAchievements reading the store', () => {
  it('exposes the slice state, always loaded', () => {
    const { result } = render()
    expect(result.current.stats).toEqual(DEFAULT_TEST_STATS)
    expect(result.current.unlockedAchievements).toEqual({})
    expect(result.current.loaded).toBe(true)
  })
})

describe('useAchievements self-healing backfill', () => {
  it('records achievements the stored stats already clear but the unlock map is missing', () => {
    const { result } = render(makeStore({ stats: applyTestOutcome(DEFAULT_TEST_STATS, 'win'), unlocked: {} }))
    expect(Object.keys(result.current.unlockedAchievements).sort()).toEqual(['first_game', 'flawless_debut', 'total_wins_bronze'])
  })

  it('preserves the original timestamp of an already-recorded unlock', () => {
    const { result } = render(makeStore({ stats: applyTestOutcome(DEFAULT_TEST_STATS, 'win'), unlocked: { first_game: 12345 } }))
    expect(result.current.unlockedAchievements.first_game).toBe(12345)
  })

  it("backfills per-profile unlocks under each profile's own namespace", () => {
    const { result } = render(makeStore({ stats: applyTestOutcome(DEFAULT_TEST_STATS, 'win', ['profile-1']), unlocked: {} }))
    expect(result.current.unlockedAchievements).toHaveProperty('profile-1:first_game')
    // The device-scoped one never gets a profile-namespaced key.
    expect(result.current.unlockedAchievements).not.toHaveProperty('profile-1:flawless_debut')
  })

  it('writes nothing when the unlock map is already complete', () => {
    const store = makeStore()
    const before = store.getState().achievements
    render(store)
    expect(store.getState().achievements).toBe(before)
  })
})

describe('useAchievements recordOutcome', () => {
  it('applies the supplied updater and returns the newly unlocked achievements', () => {
    const { result } = render()
    let unlocked: string[] = []
    act(() => {
      unlocked = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win')).device.map((a) => a.id)
    })
    expect(unlocked).toEqual(['first_game', 'flawless_debut', 'total_wins_bronze'])
    expect(result.current.stats.record).toEqual({ played: 1, wins: 1, losses: 0, draws: 0 })
  })

  it('returns the updated stats directly, without waiting a render', () => {
    const { result } = render()
    let returned: TestStats = DEFAULT_TEST_STATS
    act(() => {
      returned = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'loss')).stats
    })
    expect(returned.record.losses).toBe(1)
  })

  it('reports an achievement only on the round it actually unlocks, not on later ones', () => {
    const { result } = render()
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
    })
    let second: string[] = []
    act(() => {
      second = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win')).device.map((a) => a.id)
    })
    expect(second).toEqual([])
  })

  it('reports a higher tier on the round that clears it', () => {
    const { result } = render()
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

  it('stores both the stats and the unlocks', () => {
    const { result, store } = render()
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
    })
    expect(store.getState().achievements.stats.record.wins).toBe(1)
    expect(store.getState().achievements.unlocked).toHaveProperty('first_game')
  })

  // Reads the store's current state at call time, so two outcomes recorded in the same tick (before
  // any re-render) both count.
  it('never loses an outcome recorded before the previous one re-rendered', () => {
    const { result } = render()
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'loss'))
    })
    expect(result.current.stats.record).toEqual({ played: 2, wins: 1, losses: 1, draws: 0 })
  })

  it('reports per-profile unlocks keyed by profile id, excluding device-scoped ones', () => {
    const { result } = render()
    let profiles: Record<string, string[]> = {}
    act(() => {
      const outcome = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win', ['profile-1']))
      profiles = Object.fromEntries(Object.entries(outcome.profiles).map(([id, list]) => [id, list.map((a) => a.id)]))
    })
    expect(profiles).toEqual({ 'profile-1': ['first_game', 'total_wins_bronze'] })
  })

  it('tracks two profiles independently', () => {
    const { result } = render()
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

  it('leaves the unlock map untouched when a round unlocks nothing', () => {
    const { result } = render()
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
    })
    const before = result.current.unlockedAchievements
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'loss'))
    })
    expect(result.current.unlockedAchievements).toBe(before)
  })

  it('works with no profileViews at all, keeping everything device-wide', () => {
    const { result } = render(makeStore(), { profileViews: undefined })
    let profiles: Record<string, unknown> = {}
    act(() => {
      profiles = result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win', ['profile-1'])).profiles
    })
    expect(profiles).toEqual({})
  })
})

describe('useAchievements resetAll', () => {
  it('returns stats and unlocks to defaults', () => {
    const { result } = render()
    act(() => {
      result.current.recordOutcome((prev) => applyTestOutcome(prev, 'win'))
    })
    act(() => {
      result.current.resetAll()
    })
    expect(result.current.stats).toEqual(DEFAULT_TEST_STATS)
    expect(result.current.unlockedAchievements).toEqual({})
  })
})

describe('useAchievements removeProfile', () => {
  it("drops only that profile's unlock keys, leaving device-wide and other profiles intact", () => {
    const { result } = render()
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

  it("applies the optional stats updater so the profile's own bucket goes too", () => {
    const { result } = render()
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

  it('does not touch a profile whose id merely shares a prefix with the removed one', () => {
    const { result } = render()
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
