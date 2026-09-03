import { useCallback, useEffect, useRef, useState } from 'react'

import { newlyUnlocked, removeProfileUnlocks, unlockedKey } from './achievementEngine'
import { DEFAULT_UNLOCKED_ACHIEVEMENTS, isValidUnlockedAchievements } from './achievementsValidation'
import { AchievementsStorage, resolveStorage } from './storage'
import { AchievementDefinition, UnlockedAchievementsState } from './types'

export interface UseAchievementsOptions<TStats> {
  // Storage-key prefix, one per game (e.g. 'lightcycles' -> 'lightcycles.stats' and
  // 'lightcycles.achievements'). Two separate keys, not one blob, so a corrupt or rejected stats
  // blob can't take the unlock history down with it.
  namespace: string
  catalog: AchievementDefinition<TStats>[]
  defaultStats: TStats
  // The game's own validator for its own stats shape — this package can't know TStats well enough
  // to check it. A blob that fails this is discarded in favor of defaultStats, same as a corrupt
  // one. Omit to accept any parsed JSON object.
  isValidStats?: (value: unknown) => boolean
  // Maps a stats blob to the per-profile views achievements should ALSO be evaluated against, keyed
  // by profile id. Omit entirely for a game with no profile-scoped achievements — everything then
  // lives in the device-wide namespace. See the README's per-profile section.
  profileViews?: (stats: TStats) => Record<string, TStats>
  // Overrides the AsyncStorage-backed default — for tests, or a game persisting somewhere else.
  storage?: AchievementsStorage
  // Runs once per load, after a stored blob is validated and before anything is evaluated against
  // it. The place to backfill a purely-additive new field onto an older stored shape, which avoids
  // any schema-versioning machinery for the common case.
  migrateStats?: (stats: TStats) => TStats
}

export interface RecordOutcomeResult<TStats> {
  // The updated stats, already persisted — returned so a caller doesn't have to wait a render to
  // read what it just recorded.
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
  // False until the stored blobs have been read (or failed to read) — an achievements screen can
  // hold off rendering "0 games played" over real, still-loading data.
  loaded: boolean
  // The single funnel: hand it the game's own pure stats updater, and it evaluates the catalog
  // against the result, persists both blobs, and reports what newly unlocked.
  recordOutcome: (update: (prev: TStats) => TStats) => RecordOutcomeResult<TStats>
  // Wipes both stored keys back to defaults. Irreversible — callers are expected to confirm first.
  resetAll: () => void
  // Drops one profile's unlock keys, so a deleted profile leaves no orphaned unlock history behind.
  // The game's own stats blob is the game's to prune, via the optional updater — pass one that
  // removes the profile's bucket from TStats, or omit it if TStats has no per-profile nesting.
  removeProfile: (profileId: string, update?: (prev: TStats) => TStats) => void
}

// Achievements `stats` clears that aren't recorded yet, device-wide and across every profile view,
// merged into one map. Covers a catalog gaining a new achievement that existing stats already
// clear, and the case where the stats write succeeded but the achievements write didn't. Returns
// the SAME reference back when nothing was missing, so callers can skip a pointless write.
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

// Single source of truth for one game's stats + achievement unlocks. Mount it once, high enough in
// the tree to outlive individual screens (an expo-router app keeps prior screens mounted, so a
// per-screen copy could go stale or clobber a concurrent update), and share it through a context of
// the app's own.
export function useAchievements<TStats>(options: UseAchievementsOptions<TStats>): UseAchievementsResult<TStats> {
  const { namespace, storage } = options

  const [stats, setStats] = useState<TStats>(options.defaultStats)
  const [unlockedAchievements, setUnlockedAchievements] = useState<UnlockedAchievementsState>(DEFAULT_UNLOCKED_ACHIEVEMENTS)
  const [loaded, setLoaded] = useState(false)

  // Every other option is read through this ref inside the callbacks below, so a host passing an
  // inline catalog/closure (rather than a module-level constant) doesn't get a new recordOutcome
  // identity every render — and, more importantly, so the one-shot load effect never re-runs on
  // such a change.
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  const statsKey = `${namespace}.stats`
  const achievementsKey = `${namespace}.achievements`

  const hasLoadedRef = useRef(false)
  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true
    const store = resolveStorage(storage)

    Promise.all([store.getItem(statsKey), store.getItem(achievementsKey)])
      .then(([storedStats, storedAchievements]) => {
        const current = latest.current
        let loadedStats = current.defaultStats
        if (storedStats) {
          try {
            const parsed: unknown = JSON.parse(storedStats)
            const valid = parsed !== null && typeof parsed === 'object' && (current.isValidStats ? current.isValidStats(parsed) : true)
            if (valid) loadedStats = current.migrateStats ? current.migrateStats(parsed as TStats) : (parsed as TStats)
          } catch {
            // Corrupt/stale blob — keep defaults.
          }
        }

        let loadedAchievements = DEFAULT_UNLOCKED_ACHIEVEMENTS
        if (storedAchievements) {
          try {
            const parsed: unknown = JSON.parse(storedAchievements)
            if (isValidUnlockedAchievements(parsed)) loadedAchievements = parsed
          } catch {
            // Corrupt/stale blob — keep defaults.
          }
        }

        const views = current.profileViews ? current.profileViews(loadedStats) : {}
        const reconciled = backfillUnlocked(current.catalog, loadedStats, loadedAchievements, views, Date.now())
        if (reconciled !== loadedAchievements) store.setItem(achievementsKey, JSON.stringify(reconciled)).catch(() => {})

        setStats(loadedStats)
        setUnlockedAchievements(reconciled)
        setLoaded(true)
      })
      .catch(() => {
        // Unavailable storage — the defaults already in state are a complete, silent fallback.
        setLoaded(true)
      })
  }, [statsKey, achievementsKey, storage])

  const recordOutcome = useCallback(
    (update: (prev: TStats) => TStats): RecordOutcomeResult<TStats> => {
      const current = latest.current
      const store = resolveStorage(current.storage)
      const nextStats = update(stats)
      const now = Date.now()

      const device = newlyUnlocked(current.catalog, nextStats, unlockedAchievements)
      const views = current.profileViews ? current.profileViews(nextStats) : {}

      const additions: UnlockedAchievementsState = {}
      device.forEach((achievement) => {
        additions[achievement.id] = now
      })

      const profiles: Record<string, AchievementDefinition<TStats>[]> = {}
      for (const [profileId, view] of Object.entries(views)) {
        const unlockedForProfile = newlyUnlocked(current.catalog, view, unlockedAchievements, profileId)
        if (unlockedForProfile.length === 0) continue
        profiles[profileId] = unlockedForProfile
        unlockedForProfile.forEach((achievement) => {
          additions[unlockedKey(achievement.id, profileId)] = now
        })
      }

      setStats(nextStats)
      store.setItem(statsKey, JSON.stringify(nextStats)).catch(() => {})

      if (Object.keys(additions).length > 0) {
        const nextUnlocked = { ...unlockedAchievements, ...additions }
        setUnlockedAchievements(nextUnlocked)
        store.setItem(achievementsKey, JSON.stringify(nextUnlocked)).catch(() => {})
      }

      return { stats: nextStats, device, profiles }
    },
    [stats, unlockedAchievements, statsKey, achievementsKey]
  )

  const resetAll = useCallback(() => {
    const store = resolveStorage(latest.current.storage)
    setStats(latest.current.defaultStats)
    setUnlockedAchievements(DEFAULT_UNLOCKED_ACHIEVEMENTS)
    store.removeItem(statsKey).catch(() => {})
    store.removeItem(achievementsKey).catch(() => {})
  }, [statsKey, achievementsKey])

  const removeProfile = useCallback(
    (profileId: string, update?: (prev: TStats) => TStats) => {
      const store = resolveStorage(latest.current.storage)

      if (update) {
        const nextStats = update(stats)
        setStats(nextStats)
        store.setItem(statsKey, JSON.stringify(nextStats)).catch(() => {})
      }

      const nextUnlocked = removeProfileUnlocks(unlockedAchievements, profileId)
      if (nextUnlocked !== unlockedAchievements) {
        setUnlockedAchievements(nextUnlocked)
        store.setItem(achievementsKey, JSON.stringify(nextUnlocked)).catch(() => {})
      }
    },
    [stats, unlockedAchievements, statsKey, achievementsKey]
  )

  return { stats, unlockedAchievements, loaded, recordOutcome, resetAll, removeProfile }
}
