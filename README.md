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
- **`createAchievementBindings`** — pre-binds `evaluateUnlockedIds` / `evaluateUnlockedIdsForProfile`
  / `unlockedKey` to your own catalog and profile-stats-view function, so your app's own
  `achievementEngine.ts` shrinks to a five-line re-export instead of hand-rolling the same binding
  every game needs. See "Per-profile achievements" below.
- **`useAchievements`** — the persistence hook: loads both blobs, runs the self-healing re-sweep,
  and gives you one `recordOutcome` funnel that persists and reports what just unlocked.
- **`mapUnlocksBySeat` / `broadcastDeviceUnlocks`** — `recordOutcome`'s `profiles` result is keyed by
  profile id; a local-multiplayer screen thinks in seats. These translate one into the other and
  layer a device-wide unlock onto every seat.
- **`getAchievementCatalogRows` / `defaultFormatUnlockedLabel`** — the per-achievement
  scope/`unlockedAt`/`progress`/tier-color computation an achievements-catalog screen's own
  `ACHIEVEMENT_CATALOG.map()` loop hand-rolls, plus the "Unlocked N days ago" label formatter.

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
import { ACHIEVEMENT_TIER_COLORS } from '@tastic/achievements'

const { stats, unlockedAchievements, loaded, recordOutcome, resetAll, removeProfile } = useAchievements({
  namespace: 'lightcycles', // -> 'lightcycles.stats' and 'lightcycles.achievements'
  catalog: ACHIEVEMENT_CATALOG,
  defaultStats: DEFAULT_STATS,
  isValidStats,
  profileViews: (stats) => mapValues(stats.profiles, toStatsView)
})

// After a round — every newly-unlocked achievement gets its own toast, in its own tier color and
// icon (never a single summary toast); a seat's own profile unlocks join the device-wide ones.
const { device, profiles } = recordOutcome((prev) => applyRoundOutcome(prev, winner, context))
;[...device, ...(profiles[1] ?? [])].forEach((achievement) => {
  toast(achievement.title, { color: ACHIEVEMENT_TIER_COLORS[achievement.tier], icon: achievement.icon })
})
```

`recordOutcome` takes *your* updater, evaluates the catalog against the result, persists both blobs,
and returns what newly unlocked — device-wide in `device`, and per profile id in `profiles`. A game
that thinks in seats maps its own seat → profile id.

Two storage keys, not one blob, so a corrupt or rejected stats blob can't take unlock history down
with it. Both are validated on load; a corrupt one silently falls back to defaults. `isValidStats`
is yours to supply because this package can't know `TStats` well enough to check it. `migrateStats`
runs once per load on a validated blob — the place to backfill a purely-additive new field without
any schema-versioning machinery.

### Seat-keyed unlocks for local multiplayer

`recordOutcome`'s result has no notion of seats — its `profiles` map is keyed by profile id — but a
two-player screen thinks in seats. `mapUnlocksBySeat` translates one into the other, and
`broadcastDeviceUnlocks` layers a device-wide unlock (like "first game ever", which no single seat
owns) onto every seat afterward:

```ts
import { broadcastDeviceUnlocks, mapUnlocksBySeat } from '@tastic/achievements'

const { device, profiles } = recordOutcome((prev) => applyRoundOutcome(prev, winner, context))

const seats = [1, 2] as const
const bySeat = mapUnlocksBySeat(seats, seatProfileIds, profiles) // seatProfileIds: Partial<Record<1 | 2, string>>
const withDevice = broadcastDeviceUnlocks(seats, bySeat, device)

seats.forEach((seat) => {
  ;(withDevice[seat] ?? []).forEach((achievement) => {
    toast(achievement.title, { color: ACHIEVEMENT_TIER_COLORS[achievement.tier], icon: achievement.icon })
  })
})
```

`mapUnlocksBySeat` only sets a key for a seat that both has a profile selected *and* actually
unlocked something this round — a seat that unlocked nothing gets no entry at all, not an empty
array. `broadcastDeviceUnlocks` always appends `device` after a seat's own unlocks (`[...own,
...device]`), never the reverse, since that's the toast order a player actually sees — and it
returns a new object rather than mutating `bySeat`.

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

### Binding the engine to your own catalog

Every game ends up writing the same thin `src/utils/achievementEngine.ts`: `evaluateUnlockedIds` and
`evaluateUnlockedIdsForProfile` pre-bound to its own catalog constant and its own
`getProfileStatsView`, plus `unlockedKey` re-exported unchanged. `createAchievementBindings` is that
module, generic over your `TStats`/`TProfileStats`:

```ts
import { createAchievementBindings } from '@tastic/achievements'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { getProfileStatsView } from '@/utils/statsEngine'

export const { evaluateUnlockedIds, evaluateUnlockedIdsForProfile, unlockedKey } = createAchievementBindings(ACHIEVEMENT_CATALOG, getProfileStatsView)
```

`getProfileStatsView` is your own `(profileStats: TProfileStats) => TStats` — typically
`{ ...profileStats, profiles: {}, firstGameResult: null }` or whatever synthesizes a full
`TStats`-shaped view from one profile's own bucket. The returned `evaluateUnlockedIdsForProfile`
runs that view through profile-scoped evaluation for you, so a `scope: 'device'` achievement still
can't leak into a profile's own unlock namespace.

## Building an achievements-catalog screen

`getAchievementCatalogRows` computes the exact per-achievement row data an achievements-catalog
screen renders — scope resolution, `unlockedAt`, `progress`, tier color, and a "device-wide
achievement viewed from inside a profile's own tab" marker — so the screen's own
`ACHIEVEMENT_CATALOG.map()` loop shrinks to handing the result straight to
[`@tastic/hud`](https://github.com/jayrdeaton/react-native-hud)'s `AchievementRow`:

```ts
import { getAchievementCatalogRows } from '@tastic/achievements'

const rows = getAchievementCatalogRows(
  ACHIEVEMENT_CATALOG,
  stats, // device-wide stats — used for any scope: 'device' achievement, regardless of which tab is open
  effectiveStats, // this screen's own selected view: device-wide on "All Profiles", else one profile's view
  unlockedAchievements,
  selectedProfileId // null on the "All Profiles" tab
)

rows.forEach((row) => {
  const locked = row.unlockedAt === undefined
  render(<AchievementRow key={row.id} {...row} badgeColor={locked ? colors.outline : row.tierColor} />)
})
```

Each row leaves the locked/unlocked badge color for the caller to resolve — that's a rendering
decision, not something the engine picks. `unlockedLabel` (`'Unlocked today'` / `'Unlocked 1 day
ago'` / `'Unlocked N days ago'`) comes from `defaultFormatUnlockedLabel`, a calendar-day diff so
something unlocked at 11pm reads as "1 day ago" once the date rolls over rather than a full 24
hours later; pass your own `formatUnlockedLabel` (and/or a `tierColors` map in place of
`ACHIEVEMENT_TIER_COLORS`) as the options object to override either. `deviceMarker` is only ever
true for a `scope: 'device'` achievement viewed from inside a specific profile's own tab — never on
"All Profiles" itself, since there's no other tab there to distinguish it from.

## Install

```bash
npm install @tastic/achievements
```

## Peer dependencies

- `react` >=19.0.0 — required (the hook; the engine itself is plain functions)
- `@react-native-async-storage/async-storage` >=1.18.0 — **optional**
  (`peerDependenciesMeta`). Resolved lazily inside `resolveStorage`, so importing this package never
  throws in a plain-Node context (Jest, a web build). Omit it entirely if you pass your own
  `storage`, or only use the pure engine — without it, persistence silently no-ops and the game
  still runs.

No React Native, Paper, Skia or Reanimated peers: nothing here renders.
