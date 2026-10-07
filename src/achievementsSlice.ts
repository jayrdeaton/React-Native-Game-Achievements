import { createSettingsSlice, type SettingsAction } from '@rific/core'

import { DEFAULT_UNLOCKED_ACHIEVEMENTS, isValidUnlockedAchievements } from './achievementsValidation'
import { UnlockedAchievementsState } from './types'

// redux-persist's REHYDRATE action type, inlined (as @rific/core does) so this package needs no
// dependency on redux-persist itself.
const REHYDRATE = 'persist/REHYDRATE'

// Everything one game persists for achievements: its own stats shape plus the unlock map (achievement
// id, or `${id}@${profileId}` for a per-profile unlock, to the time it unlocked).
export interface AchievementsState<TStats> {
  stats: TStats
  unlocked: UnlockedAchievementsState
}

export interface CreateAchievementsSliceOptions<TStats> {
  defaultStats: TStats
  // Checked against the persisted stats on rehydrate; a blob it rejects (or that isn't an object at
  // all) falls back to defaultStats instead of crashing a stats screen. Omit to accept any object.
  isValidStats?: (value: unknown) => boolean
  // Upgrades persisted stats saved by an older build (e.g. backfilling a field added since), applied on
  // rehydrate after isValidStats. Must be safe to run on stats that are already current.
  migrateStats?: (stats: TStats) => TStats
  // The key this reducer is mounted at in the app's root reducer. It is also the action-type prefix and
  // the key rehydration reads, so it must match. Defaults to 'achievements'.
  key?: string
}

export interface AchievementsActions<TStats> {
  // Replaces stats and/or the unlock map with whatever the patch provides.
  update: (patch: Partial<AchievementsState<TStats>>) => SettingsAction<Partial<AchievementsState<TStats>>>
  // Back to defaultStats with nothing unlocked.
  reset: () => SettingsAction<Partial<AchievementsState<TStats>>>
}

export interface AchievementsSlice<TStats> {
  actions: AchievementsActions<TStats>
  reducer: (state: AchievementsState<TStats> | undefined, action: { type: string }) => AchievementsState<TStats>
}

// A game's achievements state as a Redux slice, persisted with the rest of its store. Read and written
// through useAchievements, which owns the unlock evaluation; this only holds the data and keeps what
// rehydrates sane. Built on @rific/core's createSettingsSlice ('merge' initialize as the one write path),
// the same factory every game's settings slice uses.
export function createAchievementsSlice<TStats>(options: CreateAchievementsSliceOptions<TStats>): AchievementsSlice<TStats> {
  const { defaultStats, isValidStats, migrateStats, key = 'achievements' } = options
  const initialState: AchievementsState<TStats> = { stats: defaultStats, unlocked: DEFAULT_UNLOCKED_ACHIEVEMENTS }
  const slice = createSettingsSlice<AchievementsState<TStats>, 'merge', never>(key, { initialState, initializeMode: 'merge', fieldSetters: [] })

  // The persisted value is whatever an earlier build wrote, so it gets the same checks the old
  // AsyncStorage load did: invalid stats fall back to the defaults, valid ones are migrated, and a
  // corrupt unlock map is dropped without taking valid stats down with it.
  function sanitize(state: AchievementsState<TStats>): AchievementsState<TStats> {
    const raw: unknown = state.stats
    const statsOk = raw !== null && typeof raw === 'object' && (isValidStats ? isValidStats(raw) : true)
    const stats = statsOk ? (migrateStats ? migrateStats(state.stats) : state.stats) : defaultStats
    const unlocked = isValidUnlockedAchievements(state.unlocked) ? state.unlocked : DEFAULT_UNLOCKED_ACHIEVEMENTS
    return stats === state.stats && unlocked === state.unlocked ? state : { stats, unlocked }
  }

  function reducer(state: AchievementsState<TStats> | undefined, action: { type: string }): AchievementsState<TStats> {
    const next = slice.reducer(state, action)
    return action.type === REHYDRATE ? sanitize(next) : next
  }

  return {
    actions: {
      update: (patch) => slice.actions.initialize(patch),
      reset: () => slice.actions.initialize({ stats: defaultStats, unlocked: DEFAULT_UNLOCKED_ACHIEVEMENTS })
    },
    reducer
  }
}
