import { RoundResult } from './outcomeRecord'

// Streak bookkeeping — the second half of the stats primitives (see outcomeRecord.ts for the first).
// This package deliberately does NOT define a StatsState of its own: what a game tracks
// (per-difficulty records, goals conceded, best completion time) is game-specific, and baking any of
// it in here would mean every other game carries fields it doesn't use. What IS the same everywhere
// is a consecutive-win streak and a consecutive-calendar-day streak. A game composes its own stats
// shape out of these pieces and updates it in one funnel (see the README's applyRoundOutcome pattern).

export interface WinStreakState {
  currentWinStreak: number
  bestWinStreak: number
}

export const DEFAULT_WIN_STREAK: WinStreakState = { currentWinStreak: 0, bestWinStreak: 0 }

// A draw resets the streak, same as a loss — a draw isn't a win either, and a "5 wins in a row"
// achievement that silently tolerates draws in the middle isn't what its copy promises.
export function applyWinStreak(prev: WinStreakState, result: RoundResult): WinStreakState {
  const currentWinStreak = result === 'win' ? prev.currentWinStreak + 1 : 0
  return { currentWinStreak, bestWinStreak: Math.max(prev.bestWinStreak, currentWinStreak) }
}

export interface DayStreakState {
  distinctDaysPlayed: number
  // Consecutive local calendar days played, ending on the last day played — resets to 1 (not 0) on
  // any gap of a full day or more, since the day just played is always day one of a new streak.
  currentDayStreak: number
  bestDayStreak: number
  // Local YYYY-MM-DD bookkeeping — never meant to be rendered directly.
  lastPlayedDate: string | null
}

export const DEFAULT_DAY_STREAK: DayStreakState = { distinctDaysPlayed: 0, currentDayStreak: 0, bestDayStreak: 0, lastPlayedDate: null }

// Local calendar date, NOT UTC — a player's "days in a row" should roll over at their own midnight,
// not at some offset from it.
export function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// One calendar day before `dateString`, computed via Date's own month/year rollover rather than
// string math, so this stays correct across month and year boundaries (and across a DST shift,
// since it goes through local-time Date construction the same way localDateString does).
export function previousDateString(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() - 1)
  return localDateString(date)
}

// Idempotent within a single day: the second and later calls on the same calendar day return an
// EQUAL state, so a game can call this on every round without inflating distinctDaysPlayed.
//
// Always returns a fresh object holding exactly the four DayStreakState fields — never the argument
// itself, even on the same-day path. That matters because `prev` is typed structurally: a game
// composing its stats as `{...stats, ...applyDayPlayed(stats)}` (the README's own pattern) passes
// its WHOLE stats object in, and returning it verbatim would spread every other field back over
// itself, silently reverting the round that was just recorded.
//
// `now` defaults to the real clock — overridable so tests (and a game's own tests) can exercise
// day-boundary logic without mocking the global Date.
export function applyDayPlayed(prev: DayStreakState, now: Date = new Date()): DayStreakState {
  const today = localDateString(now)
  if (prev.lastPlayedDate === today) {
    return { distinctDaysPlayed: prev.distinctDaysPlayed, currentDayStreak: prev.currentDayStreak, bestDayStreak: prev.bestDayStreak, lastPlayedDate: prev.lastPlayedDate }
  }

  // A new day extends the streak only if it directly follows the last day played — any bigger gap
  // (or the very first day ever) restarts it at 1.
  const currentDayStreak = prev.lastPlayedDate === previousDateString(today) ? prev.currentDayStreak + 1 : 1
  return {
    distinctDaysPlayed: prev.distinctDaysPlayed + 1,
    currentDayStreak,
    bestDayStreak: Math.max(prev.bestDayStreak, currentDayStreak),
    lastPlayedDate: today
  }
}
