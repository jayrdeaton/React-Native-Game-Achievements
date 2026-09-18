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

// The inverse translation of what useAchievements' recordOutcome returns: its `profiles` map is
// keyed by profile id (it has no notion of seats); every game here thinks in seats. Give it the
// app's own seat list, its seat -> profileId map for this round, and recordOutcome's profileId ->
// newly-unlocked map, and it hands back a seat -> newly-unlocked map — only seats that both have a
// profile selected AND actually unlocked something get an entry (mirrors the `if (unlocked &&
// unlocked.length > 0)` guard every app already hand-rolls today). `seats` is NOT hardcoded to
// [1, 2] internally — a Partial<Record<Seat, X>> doesn't let TypeScript recover Seat's possible
// values from the type alone at runtime, so the caller keeps supplying its own seat list exactly as
// every existing manual loop already does.
export function mapUnlocksBySeat<TStats, Seat extends string | number>(seats: readonly Seat[], seatProfileIds: Partial<Record<Seat, string>> | undefined, profileUnlocks: Record<string, AchievementDefinition<TStats>[]>): Partial<Record<Seat, AchievementDefinition<TStats>[]>> {
  const bySeat: Partial<Record<Seat, AchievementDefinition<TStats>[]>> = {}
  if (!seatProfileIds) return bySeat
  for (const seat of seats) {
    const profileId = seatProfileIds[seat]
    if (!profileId) continue
    const unlocked = profileUnlocks[profileId]
    if (unlocked && unlocked.length > 0) bySeat[seat] = unlocked
  }
  return bySeat
}

// A device-wide unlock (no per-seat owner, e.g. an "All Profiles"/first-ever-game achievement)
// still needs to reach every human seat's own facing UI in two-human-seat modes, since neither seat
// is more entitled to it than the other. Appends `device` onto EVERY seat in `seats`, after that
// seat's own already-profile-scoped unlocks — order matters, since it's the toast/display order a
// player sees, not just data: every existing call site concatenates a seat's own unlocks BEFORE the
// device-wide ones. Returns a new object; never mutates `bySeat`.
export function broadcastDeviceUnlocks<TStats, Seat extends string | number>(seats: readonly Seat[], bySeat: Partial<Record<Seat, AchievementDefinition<TStats>[]>>, device: AchievementDefinition<TStats>[]): Partial<Record<Seat, AchievementDefinition<TStats>[]>> {
  const broadcast = { ...bySeat }
  if (device.length > 0) {
    for (const seat of seats) {
      broadcast[seat] = [...(broadcast[seat] ?? []), ...device]
    }
  }
  return broadcast
}

export interface AchievementBindings<TStats, TProfileStats> {
  evaluateUnlockedIds: (stats: TStats) => Set<string>
  evaluateUnlockedIdsForProfile: (profileStats: TProfileStats) => Set<string>
  unlockedKey: typeof unlockedKey
}

// Every consuming game hand-rolls the exact same three-export module: evaluateUnlockedIds and
// evaluateUnlockedIdsForProfile pre-bound to that game's own catalog constant, plus unlockedKey
// re-exported unchanged. This is that module, generic over TStats/TProfileStats so a game's own
// binding file becomes a thin re-export of this call's result under the SAME names — no other call
// site in that app has to change its import path.
export function createAchievementBindings<TStats, TProfileStats>(catalog: AchievementDefinition<TStats>[], getProfileStatsView: (profileStats: TProfileStats) => TStats): AchievementBindings<TStats, TProfileStats> {
  return {
    evaluateUnlockedIds: (stats) => evaluateUnlockedIds(catalog, stats),
    // `scope: 'profile'` filters out scope:'device' achievements (see EvaluateOptions above), so
    // this can never produce a bogus `profileId:some_device_achievement` key.
    evaluateUnlockedIdsForProfile: (profileStats) => evaluateUnlockedIds(catalog, getProfileStatsView(profileStats), { scope: 'profile' }),
    unlockedKey
  }
}
