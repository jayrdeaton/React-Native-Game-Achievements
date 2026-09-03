import { AchievementDefinition, UnlockedAchievementsState } from './types'

interface EvaluateOptions {
  // 'device' (the default) evaluates the whole catalog. 'profile' skips every scope:'device'
  // achievement, so the result can never produce a bogus `profileId:some_device_achievement` key —
  // every caller can treat "in this set" as immediately eligible for a profile-scoped unlockedKey
  // with no further scope-checking of its own.
  scope?: 'device' | 'profile'
}

// The definitions themselves, rather than just their ids — the shared primitive behind both
// evaluateUnlockedIds and newlyUnlocked below. Preserves catalog order, which is what lets a host
// app rely on "first unlocked" meaning "first in the catalog".
function matchingAchievements<TStats>(catalog: AchievementDefinition<TStats>[], stats: TStats, options: EvaluateOptions): AchievementDefinition<TStats>[] {
  const profileScoped = options.scope === 'profile'
  return catalog.filter((achievement) => (profileScoped ? achievement.scope !== 'device' : true) && achievement.isUnlocked(stats))
}

export function evaluateUnlockedIds<TStats>(catalog: AchievementDefinition<TStats>[], stats: TStats, options: EvaluateOptions = {}): Set<string> {
  return new Set(matchingAchievements(catalog, stats, options).map((achievement) => achievement.id))
}

// A device-wide unlock (profileId === null) is keyed as a bare achievement id; a profile-scoped one
// as `${profileId}:${achievementId}`. Safe to disambiguate on ':' alone as long as neither catalog
// ids nor generated profile ids contain one — catalog ids are fixed constants an app authors by
// hand, and every profile-id generator in this ecosystem produces ':'-free ids.
export function unlockedKey(achievementId: string, profileId: string | null): string {
  return profileId === null ? achievementId : `${profileId}:${achievementId}`
}

// The inverse of unlockedKey — splits on the FIRST ':' only, so an achievement id is recovered
// intact even in the (unsupported, but harmless) case of one containing a colon of its own.
export function parseUnlockedKey(key: string): { profileId: string | null; achievementId: string } {
  const separator = key.indexOf(':')
  if (separator === -1) return { profileId: null, achievementId: key }
  return { profileId: key.slice(0, separator), achievementId: key.slice(separator + 1) }
}

// Achievements `stats` clears that aren't already recorded in `unlocked` under this profileId's own
// key namespace. Used on both paths: computing what to toast after a round, and the self-healing
// re-sweep on load (see useAchievements.ts). Passing a profileId automatically switches evaluation
// to profile scope, so a device-only achievement never leaks into a profile's unlock list.
export function newlyUnlocked<TStats>(catalog: AchievementDefinition<TStats>[], stats: TStats, unlocked: UnlockedAchievementsState, profileId: string | null = null): AchievementDefinition<TStats>[] {
  const scope = profileId === null ? 'device' : 'profile'
  return matchingAchievements(catalog, stats, { scope }).filter((achievement) => !(unlockedKey(achievement.id, profileId) in unlocked))
}

// Whether one achievement is unlocked in a stored map, for a given profile (null = device-wide).
// Deliberately does NOT fall back to the device-wide key for a profile — a profile that hasn't
// earned something itself shows it as locked, even if someone else on the device has.
export function isAchievementUnlocked(unlocked: UnlockedAchievementsState, achievementId: string, profileId: string | null = null): boolean {
  return unlockedKey(achievementId, profileId) in unlocked
}

// The unlock timestamp, or null if not unlocked — an achievements screen reads this to render an
// "Unlocked N days ago" label. Date formatting stays the host app's own concern, since day-rollover
// conventions vary per app.
export function achievementUnlockedAt(unlocked: UnlockedAchievementsState, achievementId: string, profileId: string | null = null): number | null {
  return unlocked[unlockedKey(achievementId, profileId)] ?? null
}

// Drops every unlock key belonging to one profile — used when a profile is deleted, so it leaves no
// orphaned unlock history behind. Matches on the exact `${profileId}:` prefix, so a profile whose id
// is a prefix of another's ('abc' vs 'abcdef') is unaffected.
export function removeProfileUnlocks(unlocked: UnlockedAchievementsState, profileId: string): UnlockedAchievementsState {
  const prefix = `${profileId}:`
  const entries = Object.entries(unlocked).filter(([key]) => !key.startsWith(prefix))
  return entries.length === Object.keys(unlocked).length ? unlocked : Object.fromEntries(entries)
}
