import { unlockedKey } from './achievementEngine'
import { ACHIEVEMENT_TIER_COLORS, AchievementDefinition, AchievementTier, UnlockedAchievementsState } from './types'

// One row's worth of already-resolved data for an achievements-catalog list — everything a
// presentational row component needs EXCEPT the locked/unlocked badge color, which stays a
// rendering decision made by whatever renders these rows (see AchievementRow's own doc comment on
// why `badgeColor` is a caller-supplied prop, not something the engine decides).
export interface AchievementCatalogRow {
  id: string
  icon: string
  title: string
  description: string
  // ACHIEVEMENT_TIER_COLORS[achievement.tier] (or the caller's own override), already resolved.
  // NOT the rendered badge color — that also depends on whether the row is locked.
  tierColor: string
  // Raw unlock timestamp, or undefined if still locked.
  unlockedAt?: number
  // formatUnlockedLabel(unlockedAt), or undefined if still locked.
  unlockedLabel?: string
  // Only set while locked, mirroring AchievementRow's own contract — an unlocked row never shows a
  // progress bar, so there's nothing to compute once unlockedAt is set.
  progress?: number
  // Whether this row is a device-wide achievement being viewed from inside a specific profile's own
  // tab — every app's identical `effectiveProfileId !== null && scope === 'device'` check.
  deviceMarker: boolean
}

export type FormatUnlockedLabel = (unlockedAt: number) => string

const MS_PER_DAY = 24 * 60 * 60 * 1000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

// Calendar-day difference, not raw elapsed time, so something unlocked at 11pm reads as "1 day ago"
// once the date rolls over rather than a full 24 hours later. Ported verbatim from every consuming
// app's own identical startOfDay/unlockedLabel pair.
export function defaultFormatUnlockedLabel(unlockedAt: number): string {
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(unlockedAt))) / MS_PER_DAY)
  if (days <= 0) return 'Unlocked today'
  if (days === 1) return 'Unlocked 1 day ago'
  return `Unlocked ${days} days ago`
}

export interface GetAchievementCatalogRowsOptions {
  tierColors?: Record<AchievementTier, string>
  formatUnlockedLabel?: FormatUnlockedLabel
}

// The exact per-achievement scope/evalStats/unlockedAt/progress/tierColor/deviceMarker computation
// every app's ACHIEVEMENT_CATALOG.map() loop hand-rolls today. `deviceStats` is the raw device-wide
// stats blob (used only for scope:'device' achievements); `effectiveStats` is whatever the caller's
// own screen already computed as its `statsView` (device-wide for an "All Profiles" tab, or that
// profile's own synthesized view). Does NOT resolve locked-vs-unlocked badgeColor — that stays a
// rendering decision, made by whatever presentational layer consumes these rows.
export function getAchievementCatalogRows<TStats>(catalog: AchievementDefinition<TStats>[], deviceStats: TStats, effectiveStats: TStats, unlocked: UnlockedAchievementsState, profileId: string | null, options: GetAchievementCatalogRowsOptions = {}): AchievementCatalogRow[] {
  const tierColors = options.tierColors ?? ACHIEVEMENT_TIER_COLORS
  const formatUnlockedLabel = options.formatUnlockedLabel ?? defaultFormatUnlockedLabel

  return catalog.map((achievement) => {
    // scope:'device' always evaluates against the real device stats and its bare-id key, regardless
    // of which tab is active; everything else follows the caller's own selected view. On
    // "All Profiles" (profileId === null) both branches collapse to the same thing.
    const scope = achievement.scope ?? 'profile'
    const evalStats = scope === 'device' ? deviceStats : effectiveStats
    const unlockedAt: number | undefined = unlocked[unlockedKey(achievement.id, scope === 'device' ? null : profileId)]
    const progress = unlockedAt === undefined ? achievement.progress?.(evalStats) : undefined

    return {
      id: achievement.id,
      icon: achievement.icon,
      title: achievement.title,
      description: achievement.description,
      tierColor: tierColors[achievement.tier],
      unlockedAt,
      unlockedLabel: unlockedAt !== undefined ? formatUnlockedLabel(unlockedAt) : undefined,
      progress,
      deviceMarker: profileId !== null && scope === 'device'
    }
  })
}
