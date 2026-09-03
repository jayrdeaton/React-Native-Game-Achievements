// The slice of AsyncStorage's API this package actually uses. Declared structurally rather than
// imported so the engine and the hook both stay usable in a plain-Node context (Jest, a web build,
// a game that persists somewhere else entirely) with no native module linked.
export interface AchievementsStorage {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

// Reads/writes that quietly do nothing — what resolveStorage falls back to when AsyncStorage isn't
// installed. A game still runs, it just doesn't persist, exactly as it behaves when a real
// AsyncStorage call rejects (see useAchievements.ts's own catch handlers).
const NOOP_STORAGE: AchievementsStorage = {
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve()
}

let resolved: AchievementsStorage | null = null

// Lazily/optionally resolved, same pattern as @tastic/profile's expo-modules-core bridge:
// @react-native-async-storage/async-storage is an OPTIONAL peer here, so a consumer that supplies
// its own `storage` (or only uses the pure engine) never has to install it. Requiring it lazily —
// not at module scope — is what keeps importing this package from throwing under Jest's plain-Node
// environment, where the native module is never linked.
export function resolveStorage(override?: AchievementsStorage): AchievementsStorage {
  if (override) return override
  if (resolved) return resolved
  try {
    const mod = require('@react-native-async-storage/async-storage')
    resolved = (mod.default ?? mod) as AchievementsStorage
  } catch {
    resolved = NOOP_STORAGE
  }
  return resolved
}
