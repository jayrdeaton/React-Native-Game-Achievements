import { UnlockedAchievementsState } from './types'

export const DEFAULT_UNLOCKED_ACHIEVEMENTS: UnlockedAchievementsState = {}

// Deliberately does NOT cross-check keys against a catalog — an id from a since-removed achievement
// is just an inert extra entry, not a reason to discard the whole stored blob. Nor does it
// distinguish the two key formats (see UnlockedAchievementsState), since both are just "some string
// key -> a finite timestamp".
export function isValidUnlockedAchievements(value: unknown): value is UnlockedAchievementsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v))
}
