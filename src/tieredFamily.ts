import { ACHIEVEMENT_TIERS, AchievementDefinition, AchievementScope, AchievementTier } from './types'

// The bronze/silver/gold cut-offs for one family. Normally ascending, though nothing here enforces
// that — see `value` below for the one case (a lower-is-better goal) where they're inverted.
export interface TieredThresholds {
  bronze: number
  silver: number
  gold: number
}

export interface TieredFamilyOptions<TStats> {
  // Family id prefix — each generated achievement is `${id}_${tier}`, e.g. `total_wins_bronze`.
  // Stored unlock keys are built from these ids (see achievementEngine.ts's unlockedKey), so
  // renaming a family after release orphans its players' existing unlocks.
  id: string
  titles: Record<AchievementTier, string>
  // Called once per tier to build that tier's copy — `tier` is passed alongside the threshold for
  // the occasional family whose wording changes by tier, but most only use the number
  // ("Win {n} total games.").
  description: (threshold: number, tier: AchievementTier) => string
  // One icon for the whole family — a family is the same achievement at three difficulties, so
  // three different icons would read as three unrelated entries on an achievements screen.
  icon: string
  thresholds: TieredThresholds
  // The single number every tier compares against its own threshold. This is the whole point of a
  // family: one accessor, three achievements. A lower-is-better goal (fastest round, fewest moves)
  // fits by returning a negated value with negated thresholds, since the comparison is always `>=`.
  value: (stats: TStats) => number
  // Applied to all three tiers — omit for the usual per-profile default. A device-scoped FAMILY is
  // unusual (device scope is for one-off flags with no profile identity, which are rarely tiered);
  // it's here so the option isn't silently unavailable, not because it's the expected case.
  scope?: AchievementScope
  // How each tier reports progress. Omitted, every tier gets the automatic
  // progressToward(value, threshold) below.
  //
  // Pass `false` for a family whose progress isn't meaningful — in particular any LOWER-is-better
  // family (a fastest time, a fewest-moves count), which is expressed by negating both the value
  // and the thresholds so the `>=` comparison still works. The automatic fraction is actively WRONG
  // there: with value -1200 against threshold -600, value/threshold is 2, which clamps to a
  // full bar for a player who is twice as slow as the bronze tier asks. There is no correct
  // general formula, because a lower-is-better goal has no natural zero to measure from — so this
  // takes it out of the picture rather than guessing.
  //
  // Pass a function to compute it yourself; it receives that tier's own threshold alongside the
  // stats, and its result is clamped to 0-1 for you.
  progress?: false | ((stats: TStats, threshold: number) => number)
}

// 0-1 fraction of the way from zero to `threshold`. A non-positive threshold is already cleared by
// any value, so it reads as 100% complete rather than the Infinity/NaN a raw division would give.
export function progressToward(value: number, threshold: number): number {
  if (threshold <= 0) return 1
  return Math.min(1, Math.max(0, value / threshold))
}

// Generates the bronze/silver/gold triple for one tiered family — the single most repeated shape in
// any game's catalog, and the reason a catalog stays readable at 25+ achievements. Each tier gets a
// `>=` predicate against its own threshold plus a `progress` toward it, so a partially-complete gold
// tier still renders a meaningful progress bar while its bronze/silver siblings read as done.
export function tieredFamily<TStats>({ id, titles, description, icon, thresholds, value, scope, progress }: TieredFamilyOptions<TStats>): AchievementDefinition<TStats>[] {
  return ACHIEVEMENT_TIERS.map((tier) => {
    const threshold = thresholds[tier]
    return {
      id: `${id}_${tier}`,
      title: titles[tier],
      description: description(threshold, tier),
      tier,
      icon,
      ...(scope ? { scope } : {}),
      isUnlocked: (stats: TStats) => value(stats) >= threshold,
      // `progress: false` omits the key entirely rather than emitting a no-op function, so a
      // consumer's `achievement.progress?.(stats)` stays undefined and its UI renders no bar.
      ...(progress === false ? {} : { progress: (stats: TStats) => (progress ? Math.min(1, Math.max(0, progress(stats, threshold))) : progressToward(value(stats), threshold)) })
    }
  })
}
