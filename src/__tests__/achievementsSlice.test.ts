import { createAchievementsSlice, CreateAchievementsSliceOptions } from '../index'
import { applyTestOutcome, DEFAULT_TEST_STATS, TestStats } from './fixtures'

const REHYDRATE = 'persist/REHYDRATE'

function slice(overrides: Partial<CreateAchievementsSliceOptions<TestStats>> = {}) {
  return createAchievementsSlice<TestStats>({ defaultStats: DEFAULT_TEST_STATS, ...overrides })
}

// What redux-persist dispatches once it has read the stored root state.
const rehydrate = (persisted?: unknown, key = 'achievements') => ({ type: REHYDRATE, payload: persisted === undefined ? {} : { [key]: persisted } }) as { type: string }

describe('createAchievementsSlice', () => {
  it('starts at the default stats with nothing unlocked', () => {
    expect(slice().reducer(undefined, { type: '@@INIT' })).toEqual({ stats: DEFAULT_TEST_STATS, unlocked: {} })
  })

  it('restores previously persisted stats and unlocks on rehydrate', () => {
    const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'win')
    const unlocked = { first_game: 5, flawless_debut: 5 }
    expect(slice().reducer(undefined, rehydrate({ stats, unlocked }))).toEqual({ stats, unlocked })
  })

  it('keeps the defaults when nothing was persisted', () => {
    expect(slice().reducer(undefined, rehydrate())).toEqual({ stats: DEFAULT_TEST_STATS, unlocked: {} })
  })

  it('falls back to the default stats when the persisted stats are not an object', () => {
    expect(slice().reducer(undefined, rehydrate({ stats: 'not stats', unlocked: { first_game: 5 } }))).toEqual({ stats: DEFAULT_TEST_STATS, unlocked: { first_game: 5 } })
  })

  it("falls back to the default stats when the game's own validator rejects them", () => {
    const isValidStats = (value: unknown) => typeof (value as TestStats).record === 'object'
    expect(slice({ isValidStats }).reducer(undefined, rehydrate({ stats: { nonsense: true }, unlocked: {} })).stats).toEqual(DEFAULT_TEST_STATS)
  })

  it('discards a corrupt unlock map without taking valid stats down with it', () => {
    const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'win')
    expect(slice().reducer(undefined, rehydrate({ stats, unlocked: { first_game: 'yesterday' } }))).toEqual({ stats, unlocked: {} })
  })

  it('runs migrateStats over validated persisted stats', () => {
    const migrateStats = (stats: TestStats) => ({ ...stats, profiles: stats.profiles ?? {} })
    const { profiles: _profiles, ...older } = DEFAULT_TEST_STATS
    expect(slice({ migrateStats }).reducer(undefined, rehydrate({ stats: older, unlocked: {} })).stats.profiles).toEqual({})
  })

  it('update replaces only what the patch provides', () => {
    const { actions, reducer } = slice()
    const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'win')
    const withStats = reducer(undefined, actions.update({ stats }))
    expect(withStats).toEqual({ stats, unlocked: {} })
    expect(reducer(withStats, actions.update({ unlocked: { first_game: 1 } }))).toEqual({ stats, unlocked: { first_game: 1 } })
  })

  it('reset returns to the default stats with nothing unlocked', () => {
    const { actions, reducer } = slice()
    const played = reducer(undefined, actions.update({ stats: applyTestOutcome(DEFAULT_TEST_STATS, 'win'), unlocked: { first_game: 1 } }))
    expect(reducer(played, actions.reset())).toEqual({ stats: DEFAULT_TEST_STATS, unlocked: {} })
  })

  it('reads its persisted value from a custom key', () => {
    const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'loss')
    expect(slice({ key: 'stats' }).reducer(undefined, rehydrate({ stats, unlocked: {} }, 'stats')).stats).toEqual(stats)
  })
})
