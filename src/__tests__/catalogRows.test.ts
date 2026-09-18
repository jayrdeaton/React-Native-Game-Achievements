import { ACHIEVEMENT_TIER_COLORS, defaultFormatUnlockedLabel, evaluateUnlockedIds, getAchievementCatalogRows, type UnlockedAchievementsState, unlockedKey } from '../index'
import { applyTestOutcome, DEFAULT_TEST_STATS, TEST_CATALOG, testProfileStatsView } from './fixtures'

describe('defaultFormatUnlockedLabel', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(2026, 8, 15, 10))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('reads an unlock from earlier today as "Unlocked today"', () => {
    expect(defaultFormatUnlockedLabel(new Date(2026, 8, 15, 2).getTime())).toBe('Unlocked today')
  })

  it('reads an unlock from exactly one calendar day ago as "Unlocked 1 day ago"', () => {
    expect(defaultFormatUnlockedLabel(new Date(2026, 8, 14, 23).getTime())).toBe('Unlocked 1 day ago')
  })

  it('reads an unlock from several calendar days ago with a plural count', () => {
    expect(defaultFormatUnlockedLabel(new Date(2026, 8, 10).getTime())).toBe('Unlocked 5 days ago')
  })
})

describe('getAchievementCatalogRows', () => {
  // A profile that has played and won its first game — unlocks first_game/total_wins_bronze under
  // its own profile-scoped view, and the device-scoped flawless_debut device-wide.
  const stats = applyTestOutcome(DEFAULT_TEST_STATS, 'win', ['profile-1'])
  const profileView = testProfileStatsView(stats.profiles['profile-1'])

  // Built the same way useAchievements' own recordOutcome/backfillUnlocked would: a profile-scoped
  // key per profile-scope unlock, and a bare key for the device-wide one.
  const unlocked: UnlockedAchievementsState = {
    ...Object.fromEntries([...evaluateUnlockedIds(TEST_CATALOG, profileView, { scope: 'profile' })].map((id) => [unlockedKey(id, 'profile-1'), 1000])),
    [unlockedKey('flawless_debut', null)]: 2000
  }

  it('evaluates a device-scope achievement against deviceStats even while viewing a profile tab', () => {
    const rows = getAchievementCatalogRows(TEST_CATALOG, stats, profileView, unlocked, 'profile-1')
    const flawless = rows.find((row) => row.id === 'flawless_debut')
    expect(flawless?.unlockedAt).toBe(2000)
    expect(flawless?.unlockedLabel).toBeDefined()
  })

  it('sets deviceMarker for a device-scope achievement viewed from inside a profile tab', () => {
    const rows = getAchievementCatalogRows(TEST_CATALOG, stats, profileView, unlocked, 'profile-1')
    expect(rows.find((row) => row.id === 'flawless_debut')?.deviceMarker).toBe(true)
  })

  it('never sets deviceMarker on the "All Profiles" (profileId null) tab', () => {
    const rows = getAchievementCatalogRows(TEST_CATALOG, stats, stats, unlocked, null)
    expect(rows.find((row) => row.id === 'flawless_debut')?.deviceMarker).toBe(false)
  })

  it('leaves a profile-scoped achievement locked under "All Profiles" even if unlocked under a specific profile', () => {
    const rows = getAchievementCatalogRows(TEST_CATALOG, stats, stats, unlocked, null)
    // 'total_wins_bronze' is only recorded under the 'profile-1:' namespace above, not bare — the
    // "All Profiles" view has its own, separate device-wide key.
    expect(rows.find((row) => row.id === 'total_wins_bronze')?.unlockedAt).toBeUndefined()
  })

  it('omits progress once unlocked, and reports a fractional progress while locked', () => {
    const rows = getAchievementCatalogRows(TEST_CATALOG, stats, profileView, unlocked, 'profile-1')
    const bronze = rows.find((row) => row.id === 'total_wins_bronze')
    const silver = rows.find((row) => row.id === 'total_wins_silver')
    expect(bronze?.unlockedAt).toBeDefined()
    expect(bronze?.progress).toBeUndefined()
    expect(silver?.unlockedAt).toBeUndefined()
    expect(silver?.progress).toBeCloseTo(1 / 3)
  })

  it('resolves tierColor from ACHIEVEMENT_TIER_COLORS by default', () => {
    const rows = getAchievementCatalogRows(TEST_CATALOG, stats, profileView, unlocked, 'profile-1')
    expect(rows.find((row) => row.id === 'total_wins_bronze')?.tierColor).toBe(ACHIEVEMENT_TIER_COLORS.bronze)
  })

  it('accepts a tierColors override', () => {
    const rows = getAchievementCatalogRows(TEST_CATALOG, stats, profileView, unlocked, 'profile-1', { tierColors: { bronze: '#111111', silver: '#222222', gold: '#333333' } })
    expect(rows.find((row) => row.id === 'total_wins_bronze')?.tierColor).toBe('#111111')
  })

  it('accepts a formatUnlockedLabel override', () => {
    const rows = getAchievementCatalogRows(TEST_CATALOG, stats, profileView, unlocked, 'profile-1', { formatUnlockedLabel: () => 'CUSTOM LABEL' })
    expect(rows.find((row) => row.id === 'total_wins_bronze')?.unlockedLabel).toBe('CUSTOM LABEL')
  })

  it('preserves catalog order', () => {
    const rows = getAchievementCatalogRows(TEST_CATALOG, stats, profileView, unlocked, 'profile-1')
    expect(rows.map((row) => row.id)).toEqual(TEST_CATALOG.map((achievement) => achievement.id))
  })

  it('carries icon/title/description straight through from the catalog', () => {
    const rows = getAchievementCatalogRows(TEST_CATALOG, stats, profileView, unlocked, 'profile-1')
    const firstGame = TEST_CATALOG.find((achievement) => achievement.id === 'first_game')!
    const row = rows.find((r) => r.id === 'first_game')!
    expect(row.icon).toBe(firstGame.icon)
    expect(row.title).toBe(firstGame.title)
    expect(row.description).toBe(firstGame.description)
  })
})
