# @tastic/achievements

Achievement and stats engine for local-multiplayer React Native games. A tiered achievement catalog
evaluated as pure predicates over whatever stats shape your game defines, per-profile unlock
namespacing, AsyncStorage-backed persistence with a self-healing re-sweep, and the win/day-streak
primitives your own outcome funnel composes.

Deliberately headless: nothing here renders. The achievements *screen* is built from
[`@tastic/hud`](https://github.com/jayrdeaton/react-native-hud)'s `BaseStatsScreen`, `StatSection`,
`StatRow` and `AchievementRow`, which take precomputed values and hold no opinion about how they
were derived. This package is the other half — the deriving.

## Why generic over your own stats type?

Every game tracks different things. LightCycles wants per-color win records and a CPU-difficulty
breakdown; a solitaire app wants best completion time and a per-variant streak; an air-hockey game
wants goals conceded. Baking any one of those into a shared `StatsState` would mean every *other*
game carries fields it never sets.

So there is no `StatsState` here. `AchievementDefinition<TStats>` is generic, and an achievement is
just a pure predicate over your own shape:

```ts
interface AchievementDefinition<TStats> {
  id: string
  title: string
  description: string
  tier: 'bronze' | 'silver' | 'gold'
  icon: string
  scope?: 'device' | 'profile'
  isUnlocked: (stats: TStats) => boolean
  progress?: (stats: TStats) => number
}
```

This package never inspects `TStats`. You keep full control of what you track; you share all the
evaluation, namespacing and persistence machinery.

## What's in here

- **`OutcomeRecord` + `applyResult` / `applyResultToBucket` / `resultFor`** — the
  played/wins/losses/draws quadruple every game re-declares half a dozen times over (overall, per
  difficulty, per color, per mode, per profile), and the keyed-bucket form for the "per X" cases.
  `resultFor(winner, subject)` turns a round's winner into one participant's own win/loss/draw.
- **`getWinRate` / `getMostPlayedKey` / `getBestWinRateKey` / `getMaxWinsInAnyBucket` /
  `countBucketsWithAWin`** — the bucket summaries an achievements screen actually displays
  ("favorite color", "best performing color") and that tiered families measure ("win with N
  different colors"). `getBestWinRateKey` ignores buckets under a sample floor, so one lucky win
  doesn't read as a flawless 100%.
- **`applyWinStreak` / `applyDayPlayed`** — consecutive-win and consecutive-calendar-day
  bookkeeping. A draw resets a win streak (a draw isn't a win either). Day streaks use the player's
  *local* calendar, are idempotent within a day, and restart at 1 after a gap.
- **`tieredFamily`** — generates a bronze/silver/gold triple from one accessor and three thresholds,
  filling in `progress` automatically. The single most repeated shape in any catalog.
- **`evaluateUnlockedIds` / `newlyUnlocked` / `unlockedKey` / `parseUnlockedKey`** — the engine.
  Given a catalog and a stats object, what's unlocked, and what's *newly* unlocked relative to a
  stored map.
- **`useAchievements`** — the persistence hook: loads both blobs, runs the self-healing re-sweep,
  and gives you one `recordOutcome` funnel that persists and reports what just unlocked.

## Defining a catalog

```ts
import { AchievementDefinition, getMaxWinsInAnyBucket, tieredFamily } from '@tastic/achievements'

import { GameStats } from '@/types'

export const ACHIEVEMENT_CATALOG: AchievementDefinition<GameStats>[] = [
  {
    id: 'first_game_played',
    title: 'First Cycle',
    description: 'Play your first game.',
    tier: 'bronze',
    icon: 'flag-checkered',
    isUnlocked: (stats) => stats.overall.played >= 1
  },
  ...tieredFamily<GameStats>({
    id: 'total_wins',
    titles: { bronze: 'Winner', silver: 'Big Winner', gold: 'Champion' },
    description: (n) => `Win ${n} total games.`,
    icon: 'trophy',
    thresholds: { bronze: 10, silver: 50, gold: 200 },
    value: (stats) => stats.overall.wins
  }),
  ...tieredFamily<GameStats>({
    id: 'color_mastery',
    titles: { bronze: 'Color Novice', silver: 'Color Expert', gold: 'Color Master' },
    description: (n) => `Win ${n} games with a single color.`,
    icon: 'palette',
    thresholds: { bronze: 10, silver: 25, gold: 50 },
    value: (stats) => getMaxWinsInAnyBucket(stats.colors)
  })
]
```

Catalog ids become stored unlock keys, so renaming a family after release orphans players' existing
unlocks. Order matters too: `newlyUnlocked` preserves it, so "first in the catalog" is "first shown".

A lower-is-better goal (fastest round, fewest moves) fits a tiered family by returning a negated
value with negated thresholds — the comparison is always `>=`. **Pass `progress: false` when you do**:
the automatic fraction is `value / threshold`, which for `-1200 / -600` gives `2` and clamps to a
full bar for a player who is twice as slow as bronze asks. A lower-is-better goal has no natural
zero to measure from, so there's no correct general formula — supply your own `progress` function
(it receives that tier's threshold) or omit it.

## Writing your own outcome funnel

This package has no opinion about how a round becomes stats. You write one pure function; it's the
only place your stats shape is updated. Compose it from the primitives:

```ts
import { applyDayPlayed, applyResult, applyResultToBucket, applyWinStreak, resultFor } from '@tastic/achievements'

export function applyRoundOutcome(prev: GameStats, winner: Player | null, context: RoundContext, now = new Date()): GameStats {
  const result = resultFor(winner, 1) // from seat 1's point of view

  return {
    ...prev,
    overall: applyResult(prev.overall, result),
    streak: applyWinStreak(prev.streak, result),
    colors: applyResultToBucket(prev.colors, context.color.toLowerCase(), result),
    ...applyDayPlayed(prev, now)
  }
}
```

`applyDayPlayed` always returns a fresh object holding exactly its own four fields, never the
argument, so the `...applyDayPlayed(prev)` spread above can't revert anything else you just set.

Keep this function pure and take `now` as a parameter — that's what lets you test day-boundary and
streak behavior without mocking the global `Date`.

## Wiring up persistence

Mount `useAchievements` once, high enough in the tree to outlive individual screens (an expo-router
app keeps prior screens mounted, so a per-screen copy could go stale or clobber a concurrent
update), and share it through a context of your own.

```tsx
const { stats, unlockedAchievements, loaded, recordOutcome, resetAll, removeProfile } = useAchievements({
  namespace: 'lightcycles', // -> 'lightcycles.stats' and 'lightcycles.achievements'
  catalog: ACHIEVEMENT_CATALOG,
  defaultStats: DEFAULT_STATS,
  isValidStats,
  profileViews: (stats) => mapValues(stats.profiles, toStatsView)
})

// After a round:
const { device, profiles } = recordOutcome((prev) => applyRoundOutcome(prev, winner, context))
if (device.length > 0) toast(`Unlocked: ${device[0].title}`)
```

`recordOutcome` takes *your* updater, evaluates the catalog against the result, persists both blobs,
and returns what newly unlocked — device-wide in `device`, and per profile id in `profiles`. A game
that thinks in seats maps its own seat → profile id.

Two storage keys, not one blob, so a corrupt or rejected stats blob can't take unlock history down
with it. Both are validated on load; a corrupt one silently falls back to defaults. `isValidStats`
is yours to supply because this package can't know `TStats` well enough to check it. `migrateStats`
runs once per load on a validated blob — the place to backfill a purely-additive new field without
any schema-versioning machinery.

### The self-healing re-sweep

On load, after both blobs are read, every achievement the stored stats *already clear* but that
isn't recorded yet gets backfilled and persisted. This covers two real cases: a catalog gaining a
new achievement that existing players already qualify for, and the write-skew where the stats write
landed but the achievements write didn't. Nothing is written back when the map is already complete.

## Per-profile achievements

Unlocks are namespaced by profile id. A device-wide unlock is keyed as a bare achievement id; a
profile's own unlock as `${profileId}:${achievementId}` (see `unlockedKey` / `parseUnlockedKey`).
That's the whole coupling to [`@tastic/profile`](https://github.com/jayrdeaton/react-native-game-profile)
— a `string` id. Neither package imports the other.

Supply `profileViews` to map your stats blob to the per-profile views achievements should *also* be
evaluated against — typically by synthesizing a full `TStats`-shaped view from each profile's own
bucket, so the exact same predicates work unchanged for both.

`scope: 'device'` marks the exception: an achievement with no profile identity at all, like "your
very first game ever was a win". Those are skipped entirely under profile evaluation, so a device-
only achievement can never produce a `profileId:` key. A profile that hasn't earned something itself
reads as locked even if someone else on the device has — `isAchievementUnlocked` deliberately does
not fall back to the device-wide key.

When a profile is deleted, call `removeProfile(id, updater)` so it leaves no orphaned unlock history
behind. Prefix matching is exact, so a profile whose id is a prefix of another's is unaffected.

## Install (local dev via yalc)

Not published to the public npm registry yet.

```bash
npm run build && npx yalc publish   # in this repo
npx yalc add @tastic/achievements   # in the consuming app
```

## Peer dependencies

- `react` >=19.0.0 — required (the hook; the engine itself is plain functions)
- `@react-native-async-storage/async-storage` >=1.18.0 — **optional**
  (`peerDependenciesMeta`). Resolved lazily inside `resolveStorage`, so importing this package never
  throws in a plain-Node context (Jest, a web build). Omit it entirely if you pass your own
  `storage`, or only use the pure engine — without it, persistence silently no-ops and the game
  still runs.

No React Native, Paper, Skia or Reanimated peers: nothing here renders.
