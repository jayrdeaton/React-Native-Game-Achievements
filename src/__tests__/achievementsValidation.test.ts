import { DEFAULT_UNLOCKED_ACHIEVEMENTS, isValidUnlockedAchievements } from '../index'

describe('isValidUnlockedAchievements', () => {
  it('accepts the empty default', () => {
    expect(isValidUnlockedAchievements(DEFAULT_UNLOCKED_ACHIEVEMENTS)).toBe(true)
  })

  it('accepts both key formats with finite timestamps', () => {
    expect(isValidUnlockedAchievements({ first_game: 1756800000000, 'profile-1:first_game': 1756800000001 })).toBe(true)
  })

  it('accepts an id no catalog defines anymore — an inert extra entry is not a corrupt blob', () => {
    expect(isValidUnlockedAchievements({ since_removed_achievement: 1756800000000 })).toBe(true)
  })

  it('rejects non-numeric and non-finite timestamps', () => {
    expect(isValidUnlockedAchievements({ first_game: 'yesterday' })).toBe(false)
    expect(isValidUnlockedAchievements({ first_game: Infinity })).toBe(false)
    expect(isValidUnlockedAchievements({ first_game: NaN })).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isValidUnlockedAchievements(null)).toBe(false)
    expect(isValidUnlockedAchievements(undefined)).toBe(false)
    expect(isValidUnlockedAchievements('{}')).toBe(false)
    expect(isValidUnlockedAchievements(42)).toBe(false)
  })

  it('rejects an array, which would otherwise pass a bare typeof check', () => {
    expect(isValidUnlockedAchievements([])).toBe(false)
  })
})
