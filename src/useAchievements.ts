import { useCallback, useEffect, useRef } from 'react'
import { useDispatch, useSelector, useStore } from 'react-redux'

import { newlyUnlocked, removeProfileUnlocks, unlockedKey } from './achievementEngine'
import { AchievementsActions, AchievementsState } from './achievementsSlice'
import { AchievementDefinition, UnlockedAchievementsState } from './types'

export interface UseAchievementsOptions<TStats, TRoot> {
  catalog: AchievementDefinition<TStats>[]
  // Where this game's achievements slice (createAchievementsSlice) lives in its root state, e.g.
  // `(state: RootState) => state.achievements`.
  select: (state: TRoot) => AchievementsState<TStats>
  // That slice's own actions.
  actions: AchievementsActions<TStats>
  // Maps a stats blob to the per-profile views achievements should ALSO be evaluated against, keyed
  // by profile id. Omit entirely for a game with no profile-scoped achievements — everything then
  // lives in the device-wide namespace. See the README's per-profile section.
  profileViews?: (stats: TStats) => Record<string, TStats>
}

export interface RecordOutcomeResult<TStats> {
  // The updated stats, already in the store — returned so a caller doesn't have to wait a render
  // to read what it just recorded.
  stats: TStats
  // Achievements that unlocked device-wide on this update, in catalog order. Empty if none did.
  device: AchievementDefinition<TStats>[]
  // Per-profile newly-unlocked lists, keyed by profile id — only profiles that actually unlocked
  // something appear at all. A game that thinks in seats maps its own seat -> profile id.
  profiles: Record<string, AchievementDefinition<TStats>[]>
}

export interface UseAchievementsResult<TStats> {
  stats: TStats
  unlockedAchievements: UnlockedAchievementsState
  // The single funnel: hand it the game's own pure stats updater, and it evaluates the catalog
  // against the result, stores both, and reports what newly unlocked.
  recordOutcome: (update: (prev: TStats) => TStats) => RecordOutcomeResult<TStats>
  // Wipes stats and unlocks back to defaults. Irreversible — callers are expected to confirm first.
  resetAll: () => void
  // Drops one profile's unlock keys, so a deleted profile leaves no orphaned unlock history behind.
  // The game's own stats blob is the game's to prune, via the optional updater — pass one that
  // removes the profile's bucket from TStats, or omit it if TStats has no per-profile nesting.
  removeProfile: (profileId: string, update?: (prev: TStats) => TStats) => void
}

// Achievements `stats` clears that aren't recorded yet, device-wide and across every profile view,
// merged into one map. Covers a catalog gaining a new achievement that existing stats already
// clear. Returns the SAME reference back when nothing was missing, so callers can skip a pointless
// write.
function backfillUnlocked<TStats>(catalog: AchievementDefinition<TStats>[], stats: TStats, unlocked: UnlockedAchievementsState, profileViews: Record<string, TStats>, now: number): UnlockedAchievementsState {
  const additions: UnlockedAchievementsState = {}

  newlyUnlocked(catalog, stats, unlocked).forEach((achievement) => {
    additions[achievement.id] = now
  })

  for (const [profileId, view] of Object.entries(profileViews)) {
    newlyUnlocked(catalog, view, unlocked, profileId).forEach((achievement) => {
      additions[unlockedKey(achievement.id, profileId)] = now
    })
  }

  return Object.keys(additions).length === 0 ? unlocked : { ...unlocked, ...additions }
}

// One game's stats + achievement unlocks, read from and written to its createAchievementsSlice slice.
// Mount it once, high enough in the tree to outlive individual screens (a game's GameStatsProvider),
// so the mount-time re-sweep below runs once. Every write reads the store's CURRENT state at call
// time (not this render's snapshot), so two outcomes recorded back to back can't overwrite each other.
export function useAchievements<TStats, TRoot = unknown>(options: UseAchievementsOptions<TStats, TRoot>): UseAchievementsResult<TStats> {
  const { stats, unlocked } = useSelector(options.select)
  const store = useStore<TRoot>()
  const dispatch = useDispatch()
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  const current = useCallback(() => latest.current.select(store.getState()), [store])

  // Self-healing re-sweep, once per mount: a catalog that gained an achievement existing stats
  // already clear records it now, rather than waiting for the next outcome to notice.
  useEffect(() => {
    const { catalog, profileViews, actions } = latest.current
    const state = current()
    const views = profileViews ? profileViews(state.stats) : {}
    const reconciled = backfillUnlocked(catalog, state.stats, state.unlocked, views, Date.now())
    if (reconciled !== state.unlocked) dispatch(actions.update({ unlocked: reconciled }))
  }, [current, dispatch])

  const recordOutcome = useCallback(
    (update: (prev: TStats) => TStats): RecordOutcomeResult<TStats> => {
      const { catalog, profileViews, actions } = latest.current
      const state = current()
      const nextStats = update(state.stats)
      const now = Date.now()

      const device = newlyUnlocked(catalog, nextStats, state.unlocked)
      const views = profileViews ? profileViews(nextStats) : {}

      const additions: UnlockedAchievementsState = {}
      device.forEach((achievement) => {
        additions[achievement.id] = now
      })

      const profiles: Record<string, AchievementDefinition<TStats>[]> = {}
      for (const [profileId, view] of Object.entries(views)) {
        const unlockedForProfile = newlyUnlocked(catalog, view, state.unlocked, profileId)
        if (unlockedForProfile.length === 0) continue
        profiles[profileId] = unlockedForProfile
        unlockedForProfile.forEach((achievement) => {
          additions[unlockedKey(achievement.id, profileId)] = now
        })
      }

      dispatch(actions.update(Object.keys(additions).length > 0 ? { stats: nextStats, unlocked: { ...state.unlocked, ...additions } } : { stats: nextStats }))
      return { stats: nextStats, device, profiles }
    },
    [current, dispatch]
  )

  const resetAll = useCallback(() => {
    dispatch(latest.current.actions.reset())
  }, [dispatch])

  const removeProfile = useCallback(
    (profileId: string, update?: (prev: TStats) => TStats) => {
      const state = current()
      const patch: Partial<AchievementsState<TStats>> = {}
      if (update) patch.stats = update(state.stats)
      const nextUnlocked = removeProfileUnlocks(state.unlocked, profileId)
      if (nextUnlocked !== state.unlocked) patch.unlocked = nextUnlocked
      if (patch.stats !== undefined || patch.unlocked !== undefined) dispatch(latest.current.actions.update(patch))
    },
    [current, dispatch]
  )

  return { stats, unlockedAchievements: unlocked, recordOutcome, resetAll, removeProfile }
}
