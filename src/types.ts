// Bronze/silver/gold, in ascending order of difficulty — the one ordering every tiered family in
// every consuming game shares. Exported as a runtime array (not just a union type) because
// tieredFamily.ts iterates it, and a host app's own achievements screen usually wants to sort or
// group by it too.
export const ACHIEVEMENT_TIERS = ['bronze', 'silver', 'gold'] as const

export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number]

// Badge colors for each tier. Data, not UI: this package owns the tier concept, so it owns the
// canonical color for each one — but nothing here renders. @tastic/hud's AchievementRow takes a
// precomputed `badgeColor` prop precisely so it holds no opinion of its own, and a host app is free
// to ignore this map entirely and supply its own palette.
export const ACHIEVEMENT_TIER_COLORS: Record<AchievementTier, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C8',
  gold: '#FFD54F'
}

// Which stats view an achievement is evaluated against.
//
// 'profile' (the default, when omitted) evaluates against whichever view the caller passes in —
// device-wide for an "All Profiles" tab, or one profile's own synthesized view for a specific
// profile tab. 'device' always evaluates against the real device-wide stats regardless of which
// tab is active, and is reserved for an achievement with no profile identity at all (a one-off
// "your very first game ever was a win" flag, say, which isn't derivable from cumulative totals
// and can't be meaningfully attributed to one player on a shared device).
export type AchievementScope = 'device' | 'profile'

// Generic over TStats — whatever shape the consuming game defines for its own stats blob. This
// package never inspects TStats itself: an achievement is just a pure predicate over it, so every
// game keeps full control of what it tracks while sharing all the evaluation/persistence machinery.
export interface AchievementDefinition<TStats> {
  id: string
  title: string
  description: string
  tier: AchievementTier
  // Icon name, passed straight through to whatever icon set the host app renders with (e.g. a
  // MaterialCommunityIcons name for @tastic/hud's AchievementRow). Never resolved here.
  icon: string
  // Defaults to 'profile' when omitted — see AchievementScope above.
  scope?: AchievementScope
  isUnlocked: (stats: TStats) => boolean
  // 0-1 fraction toward unlocking, for an achievements screen's progress bars — omitted for
  // one-off/binary achievements where "progress" isn't a meaningful concept.
  progress?: (stats: TStats) => number
}

// Unlock key -> unlock timestamp (Date.now() ms). Keys come in two formats, both produced by
// achievementEngine.ts's unlockedKey: a bare achievement id for a device-wide unlock, or
// `profileId:achievementId` for one profile's own unlock.
export type UnlockedAchievementsState = Record<string, number>
