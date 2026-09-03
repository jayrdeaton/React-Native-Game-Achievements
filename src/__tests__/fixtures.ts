import { AchievementDefinition, applyDayPlayed, applyResult, applyWinStreak, DayStreakState, DEFAULT_DAY_STREAK, DEFAULT_OUTCOME_RECORD, DEFAULT_WIN_STREAK, OutcomeRecord, RoundResult, tieredFamily, WinStreakState } from '../index'

// A deliberately small stand-in for a real game's own stats shape — this package is generic over
// TStats, so the tests need SOME concrete shape to instantiate it with. Composed out of the
// package's own primitives exactly the way the README tells a game to compose its own.
export interface TestProfileStats extends DayStreakState {
  record: OutcomeRecord
  streak: WinStreakState
}

export interface TestStats extends TestProfileStats {
  firstGameResult: RoundResult | null
  profiles: Record<string, TestProfileStats>
}

export const DEFAULT_TEST_PROFILE_STATS: TestProfileStats = { record: DEFAULT_OUTCOME_RECORD, streak: DEFAULT_WIN_STREAK, ...DEFAULT_DAY_STREAK }

export const DEFAULT_TEST_STATS: TestStats = { ...DEFAULT_TEST_PROFILE_STATS, firstGameResult: null, profiles: {} }

// The applyRoundOutcome-equivalent funnel the README describes, in miniature.
export function applyTestOutcome(prev: TestStats, result: RoundResult, profileIds: string[] = [], now: Date = new Date()): TestStats {
  const profiles = { ...prev.profiles }
  for (const profileId of profileIds) {
    const bucket = profiles[profileId] ?? DEFAULT_TEST_PROFILE_STATS
    profiles[profileId] = { record: applyResult(bucket.record, result), streak: applyWinStreak(bucket.streak, result), ...applyDayPlayed(bucket, now) }
  }
  return {
    record: applyResult(prev.record, result),
    streak: applyWinStreak(prev.streak, result),
    firstGameResult: prev.record.played === 0 ? result : prev.firstGameResult,
    profiles,
    ...applyDayPlayed(prev, now)
  }
}

// Synthesizes the full TStats-shaped view each profile's achievements are evaluated against — the
// generic equivalent of LightCycles' own getProfileStatsView.
export function testProfileViews(stats: TestStats): Record<string, TestStats> {
  return Object.fromEntries(Object.entries(stats.profiles).map(([id, bucket]) => [id, { ...bucket, firstGameResult: null, profiles: {} }]))
}

export const TEST_CATALOG: AchievementDefinition<TestStats>[] = [
  { id: 'first_game', title: 'First Game', description: 'Play your first game.', tier: 'bronze', icon: 'flag', isUnlocked: (stats) => stats.record.played >= 1 },
  {
    id: 'flawless_debut',
    title: 'Beginner Luck',
    description: 'Win the very first game you ever play.',
    tier: 'gold',
    icon: 'star',
    // The one device-scoped entry — deliberately present so every test that evaluates a profile
    // view proves this never leaks into a profile's own unlock namespace.
    scope: 'device',
    isUnlocked: (stats) => stats.firstGameResult === 'win'
  },
  ...tieredFamily<TestStats>({
    id: 'total_wins',
    titles: { bronze: 'Winner', silver: 'Big Winner', gold: 'Champion' },
    description: (n) => `Win ${n} total games.`,
    icon: 'trophy',
    thresholds: { bronze: 1, silver: 3, gold: 10 },
    value: (stats) => stats.record.wins
  })
]
