import { applyDayPlayed, applyWinStreak, DEFAULT_DAY_STREAK, DEFAULT_WIN_STREAK, localDateString, previousDateString } from '../index'

describe('applyWinStreak', () => {
  it('extends the current streak on a win and tracks the best', () => {
    let streak = applyWinStreak(DEFAULT_WIN_STREAK, 'win')
    streak = applyWinStreak(streak, 'win')
    streak = applyWinStreak(streak, 'win')
    expect(streak).toEqual({ currentWinStreak: 3, bestWinStreak: 3 })
  })

  it('resets the current streak on a loss but keeps the best', () => {
    const streak = applyWinStreak(applyWinStreak(applyWinStreak(DEFAULT_WIN_STREAK, 'win'), 'win'), 'loss')
    expect(streak).toEqual({ currentWinStreak: 0, bestWinStreak: 2 })
  })

  it('resets on a draw too — a draw is not a win either', () => {
    const streak = applyWinStreak(applyWinStreak(DEFAULT_WIN_STREAK, 'win'), 'draw')
    expect(streak).toEqual({ currentWinStreak: 0, bestWinStreak: 1 })
  })

  it('recovers the best across a broken streak', () => {
    const results = ['win', 'win', 'win', 'loss', 'win'] as const
    const streak = results.reduce(applyWinStreak, DEFAULT_WIN_STREAK)
    expect(streak).toEqual({ currentWinStreak: 1, bestWinStreak: 3 })
  })
})

describe('localDateString', () => {
  it('zero-pads month and day', () => {
    expect(localDateString(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localDateString(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('uses local calendar fields, not UTC', () => {
    // Just after local midnight — in any timezone behind UTC this instant is still the previous day
    // in UTC, and a "days in a row" streak must follow the player's own calendar.
    expect(localDateString(new Date(2026, 2, 1, 0, 30))).toBe('2026-03-01')
  })
})

describe('previousDateString', () => {
  it('steps back one day within a month', () => {
    expect(previousDateString('2026-09-02')).toBe('2026-09-01')
  })

  it('rolls back across a month boundary', () => {
    expect(previousDateString('2026-09-01')).toBe('2026-08-31')
  })

  it('rolls back across a year boundary', () => {
    expect(previousDateString('2026-01-01')).toBe('2025-12-31')
  })

  it('handles a leap day', () => {
    expect(previousDateString('2028-03-01')).toBe('2028-02-29')
  })
})

describe('applyDayPlayed', () => {
  it('starts a streak at 1 on the very first day ever', () => {
    expect(applyDayPlayed(DEFAULT_DAY_STREAK, new Date(2026, 8, 2))).toEqual({ distinctDaysPlayed: 1, currentDayStreak: 1, bestDayStreak: 1, lastPlayedDate: '2026-09-02' })
  })

  it('is idempotent within one calendar day', () => {
    const first = applyDayPlayed(DEFAULT_DAY_STREAK, new Date(2026, 8, 2, 9))
    const second = applyDayPlayed(first, new Date(2026, 8, 2, 23))
    expect(second).toEqual(first)
  })

  it('never returns the argument itself, so spreading it cannot revert a caller own fields', () => {
    // The composition the README recommends: `prev` here is a WIDER object than DayStreakState, and
    // a same-day call that returned it verbatim would spread `record` back over the just-recorded
    // round. Guards that regression directly.
    const wider = { ...DEFAULT_DAY_STREAK, lastPlayedDate: '2026-09-02', record: { played: 7 } }
    const next = applyDayPlayed(wider, new Date(2026, 8, 2))
    expect(next).not.toBe(wider)
    expect(Object.keys(next).sort()).toEqual(['bestDayStreak', 'currentDayStreak', 'distinctDaysPlayed', 'lastPlayedDate'])
    expect({ ...wider, ...next }.record).toEqual({ played: 7 })
  })

  it('extends the streak on directly consecutive days', () => {
    const day1 = applyDayPlayed(DEFAULT_DAY_STREAK, new Date(2026, 8, 1))
    const day2 = applyDayPlayed(day1, new Date(2026, 8, 2))
    const day3 = applyDayPlayed(day2, new Date(2026, 8, 3))
    expect(day3).toEqual({ distinctDaysPlayed: 3, currentDayStreak: 3, bestDayStreak: 3, lastPlayedDate: '2026-09-03' })
  })

  it('restarts the streak at 1 after a gap, keeping the best and the distinct-day count', () => {
    const day1 = applyDayPlayed(DEFAULT_DAY_STREAK, new Date(2026, 8, 1))
    const day2 = applyDayPlayed(day1, new Date(2026, 8, 2))
    const afterGap = applyDayPlayed(day2, new Date(2026, 8, 10))
    expect(afterGap).toEqual({ distinctDaysPlayed: 3, currentDayStreak: 1, bestDayStreak: 2, lastPlayedDate: '2026-09-10' })
  })

  it('extends a streak across a month boundary', () => {
    const lastOfMonth = applyDayPlayed(DEFAULT_DAY_STREAK, new Date(2026, 7, 31))
    expect(applyDayPlayed(lastOfMonth, new Date(2026, 8, 1)).currentDayStreak).toBe(2)
  })

  it('does not treat a same-day replay as a gap', () => {
    const day1 = applyDayPlayed(DEFAULT_DAY_STREAK, new Date(2026, 8, 1, 8))
    const day2 = applyDayPlayed(day1, new Date(2026, 8, 2, 8))
    const sameDayAgain = applyDayPlayed(day2, new Date(2026, 8, 2, 20))
    expect(sameDayAgain.currentDayStreak).toBe(2)
    expect(sameDayAgain.distinctDaysPlayed).toBe(2)
  })
})
