# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

# @tastic/achievements

Achievement and stats engine for local-multiplayer React Native games — a generic tiered achievement catalog evaluated as pure predicates over whatever stats shape a game defines, per-profile unlock namespacing, AsyncStorage-backed persistence with a self-healing re-sweep, and the outcome-record/streak primitives a game's own funnel composes.

Headless by design: nothing here renders. The achievements *screen* is built from `@tastic/hud`'s `BaseStatsScreen`/`StatSection`/`StatRow`/`AchievementRow`, which take precomputed values (`badgeColor`, `unlockedLabel`, `progress`) and hold no opinion about how they were derived. This package is the deriving half. The two are deliberately not merged — see the extraction rationale below.

Part of the `@tastic`/`@rific` package ecosystem. Not yet published to npm.

## Commands

```bash
npm run build        # tsup, outputs CJS + ESM + types to dist/
npm run build:watch  # tsup --watch
npm run lint         # ESLint
npm run fix          # ESLint --fix
npm test             # Jest (101 tests)
npm run test:watch   # Jest in watch mode
npm run typecheck    # TypeScript type check (tsc --noEmit)
npm run verify       # lint + test + typecheck + build, in that order
```

Always run `npm run lint` before finishing any task.

## Release

Tag-based, using npm trusted publishing (OIDC, no token required):

```bash
npm run release:patch   # npm version patch && git push --follow-tags (or release:minor / release:major)
```

`preversion` runs `npm ci && npm run verify` first. The `publish.yml` workflow fires on `v*` tags and delegates to the shared reusable workflow (`infinitetoken/Workflows/.github/workflows/npm-publish.yml@v1`) with `id-token: write` permission for OIDC trusted publishing.

## Why a separate package (not folded into hud or profile)

- **`@tastic/hud`** is self-described as a *"visual component kit"*, and its peer set is UI-only and heavy (Paper, Skia, Reanimated, `@rific/auto-paper`, `@rific/feedback-press`, `@rific/updater`). Folding persistence and predicate evaluation in would drag all of that onto anything wanting just the engine.
- **`@tastic/profile`** documents itself as *"deliberately blind to any app-specific fields (control scheme, stats)"* — twice, in `types.ts` and `ProfilesManager.tsx`. Putting a stats engine there directly contradicts its stated boundary. It also depends *on* hud, so the dependency direction is wrong.
- The actual coupling to profile is one `string` id (`unlockedKey`'s `profileId`). Neither package imports the other.

## Architecture

```
src/
  index.ts                  - all public exports
  types.ts                  - ACHIEVEMENT_TIERS/AchievementTier, ACHIEVEMENT_TIER_COLORS, AchievementScope, AchievementDefinition<TStats>, UnlockedAchievementsState
  outcomeRecord.ts          - OutcomeRecord (played/wins/losses/draws) + resultFor/applyResult/applyResultToBucket, and the bucket summaries (getWinRate, getMostPlayedKey, getBestWinRateKey, getMaxWinsInAnyBucket, countBucketsWithAWin)
  streaks.ts                - WinStreakState/applyWinStreak, DayStreakState/applyDayPlayed, localDateString/previousDateString
  tieredFamily.ts           - tieredFamily() bronze/silver/gold generator, progressToward()
  achievementEngine.ts      - evaluateUnlockedIds, newlyUnlocked, unlockedKey/parseUnlockedKey, isAchievementUnlocked, achievementUnlockedAt, removeProfileUnlocks, mapUnlocksBySeat/broadcastDeviceUnlocks (see 2026-09-18 below)
  catalogRows.ts            - getAchievementCatalogRows/defaultFormatUnlockedLabel/AchievementCatalogRow — pure per-row computation for an achievements-screen catalog list, no JSX (see 2026-09-18 below)
  achievementsValidation.ts - DEFAULT_UNLOCKED_ACHIEVEMENTS, isValidUnlockedAchievements
  storage.ts                - AchievementsStorage interface + resolveStorage (lazy, optional AsyncStorage)
  useAchievements.ts        - the persistence hook: load + self-healing backfill + recordOutcome/resetAll/removeProfile
  __tests__/
    fixtures.ts             - TestStats/TEST_CATALOG/applyTestOutcome — a miniature consumer, exercising the exact composition pattern the README documents
    achievementEngine.test.ts, achievementsValidation.test.ts, catalogRows.test.ts, outcomeRecord.test.ts, storage.test.ts, streaks.test.ts, tieredFamily.test.ts, useAchievements.test.ts
```

Generalized from LightCycles' own `src/constants/achievements.ts`, `src/utils/achievementEngine.ts`, `src/utils/statsEngine.ts` and `src/hooks/useGameStats.tsx`. LightCycles' `StatsState` was used only as an *example* of a game-supplied shape — deliberately not copied, since its `vsCpu`/`twoPlayer`/`colors` fields are LightCycles-specific.

## Key design decisions

- **No `StatsState` in this package.** `AchievementDefinition<TStats>` is generic and nothing here ever inspects `TStats`. What a game tracks varies too much to share; what's identical is the bookkeeping (an outcome record, a win streak, a day streak) and the machinery (evaluation, namespacing, persistence).
- **`applyDayPlayed` never returns its argument**, even on the same-day no-op path — it always builds a fresh object with exactly its own four fields. `prev` is typed structurally, so the README's `{...stats, ...applyDayPlayed(stats)}` composition passes the *whole* stats object in; returning it verbatim spread every other field back over itself and silently reverted the round just recorded. This was caught by the test fixture's own funnel and is guarded by a dedicated test in `streaks.test.ts`.
- **Two storage keys, not one blob** (`<namespace>.stats` / `<namespace>.achievements`), so a corrupt or rejected stats blob can't take unlock history down with it.
- **AsyncStorage is an optional peer**, resolved lazily inside `resolveStorage` rather than imported at module scope — same pattern as `@tastic/profile`'s `expo-modules-core` bridge. That's what keeps importing this package from throwing under Jest's plain-Node environment. Absent, it falls back to a no-op store: the game runs, it just doesn't persist.
- **`scope: 'device'` achievements are skipped entirely under profile evaluation**, so a device-only achievement can never produce a bogus `profileId:` key — callers can treat "in this set" as immediately eligible for a profile-scoped `unlockedKey` with no further scope-checking.
- **`isAchievementUnlocked` does not fall back to the device-wide key for a profile.** A profile that hasn't earned something reads as locked even if someone else on the device has.
- **Options are read through a ref inside the hook's callbacks**, so a host passing an inline catalog or closure doesn't get a new `recordOutcome` identity every render, and the one-shot load effect never re-runs.

## 2026-09-18 — two extractions from a fleet-wide sibling-app drift audit

Both landed together in the 0.1.2 patch release. Each was found duplicated (byte-identical, or logic-identical with per-app naming differences) across AirHockey/BoxHockey/Pong/LightCycles/Snake's own achievement-adjacent code by a cross-repo audit; neither changed any existing export's signature.

- **`mapUnlocksBySeat` + `broadcastDeviceUnlocks`** (`src/achievementEngine.ts`, appended after `removeProfileUnlocks`) — the "achievement-state-pipeline" design. `useAchievements`' own `recordOutcome` result has no notion of seats — its `profiles` map is keyed by profile id — but every consuming game thinks in seats, so each one's `useGameStats.tsx`/`game.tsx` was hand-translating that result twice per round: once to look up each seat's own profile-scoped unlocks (`mapUnlocksBySeat`), once to broadcast a device-wide unlock (e.g. an "All Profiles" achievement, which no single seat owns) onto every human seat (`broadcastDeviceUnlocks`). Landed as plain exported functions alongside `unlockedKey`/`newlyUnlocked` — **deliberately not** a `createSeatUnlockBindings(seats)` factory: the original design reasoned that with only one call site per app (two in Pong), a factory would add an import/indirection layer for no real benefit over passing `seats` inline the way every app already does today; revisit that judgment call only if a third call site per app shows up.
  - Order is load-bearing, not incidental: `broadcastDeviceUnlocks` appends `device` onto a seat's own unlocks (`[...own, ...device]`), never the reverse, because it's the toast/display order a player actually sees.
  - `seats: readonly Seat[]` stays a caller-supplied argument on both functions rather than something inferred — `Partial<Record<Seat, X>>` can't be walked back into its own key set at runtime under type erasure, so there's no way for either function to discover a game's seat list on its own; every app already computes `[1, 2] as Player[]` (or `SnakeId[]`) today, so this costs nothing extra at the call site.
  - Real, worth-knowing behavior note for anything migrating off a hand-rolled equivalent: on a round where nothing unlocked, `mapUnlocksBySeat` returns `{}` — it only ever sets a key when `unlocked.length > 0` — not e.g. `{1: [], 2: []}`. A consumer whose old code always materialized empty-array entries per seat (this is exactly what Snake's pre-extraction ternary did) will see that shape change on adoption. The original audit traced this through to actual UI read sites (`arr?.length ?? 0`, `(arr ?? []).map(...)`) and found it behaviorally inert everywhere — but it IS an observable difference in the returned object, not a pure no-op refactor, so it belongs in that app's own migration notes rather than being assumed silent.
  - `src/__tests__/achievementEngine.test.ts`'s `mapUnlocksBySeat` / `broadcastDeviceUnlocks` / composed `describe` blocks cover: undefined `seatProfileIds`, a seat with no profile selected, a seat whose profile unlocked nothing, non-numeric seat keys, no-mutation of the `bySeat` argument, and the two functions composed together in the real call-site shape (own-profile unlocks ordered before device-wide ones).

- **`getAchievementCatalogRows` + `defaultFormatUnlockedLabel` + `AchievementCatalogRow`** (new `src/catalogRows.ts`) — the achievements-*package* half of the "achievements-scaffolding" design. The presentational half (`AchievementCatalogSection`/`ActivityStatSection`) belongs in `@tastic/hud`, not here, by design — this package stays headless (see "Why a separate package" above), and a JSX-returning component can't live in a package with zero react-native/Paper peers without contradicting that boundary. `getAchievementCatalogRows` replaces the identical `ACHIEVEMENT_CATALOG.map()` loop all 5 apps' `achievements.tsx` hand-rolled — scope resolution, which stats view to evaluate against (device-wide vs. the caller's own selected profile view), `unlockedAt` lookup, `progress`, tier color, and the "viewing a device-wide achievement from inside a specific profile's tab" marker. `defaultFormatUnlockedLabel` is the calendar-day-diff formatter ("Unlocked today" / "Unlocked 1 day ago" / "Unlocked N days ago") ported verbatim from all 5 apps' identical `startOfDay`/`unlockedLabel` pair — it diffs calendar days, not raw elapsed milliseconds, so something unlocked at 11pm reads as "1 day ago" once the date rolls over rather than a full 24 hours later. Like the rest of this package, it does **not** decide the locked-vs-unlocked badge color — that stays a rendering choice made by whatever renders the rows, mirroring `AchievementRow`'s own existing `badgeColor` prop contract.
  - One real deviation from the original design doc, flagged here so it isn't mistaken for drift: the proposal's `proposedApi` wrote the options parameter as an inline anonymous type (`options?: { tierColors?: ...; formatUnlockedLabel?: ... }`). The landed signature instead exports a named `GetAchievementCatalogRowsOptions` interface, passed with a default value (`options: GetAchievementCatalogRowsOptions = {}`, not `options?:`) — matching this package's existing convention of naming every configurable function's options type (`UseAchievementsOptions`, `TieredFamilyOptions`). Behaviorally identical for a caller that omits the argument; a caller building its own wrapper can now reference the shape by name.
  - `deviceMarker` is `profileId !== null && scope === 'device'` — true only when a `scope: 'device'` achievement is being viewed from *inside* a specific profile's own tab, so that tab can render an "applies to everyone" marker on it. It's never true on the "All Profiles" tab (`profileId === null`), since there's no other tab there to distinguish it from.
  - `src/__tests__/catalogRows.test.ts` is an entirely new suite, covering the formatter's day-boundary cases (today / exactly 1 day / N days), device-vs-profile scope resolution (including "All Profiles" never setting `deviceMarker`), locked-vs-unlocked `progress`, tier color resolution (default map and override), and catalog-order preservation.

## Public API

From `src/index.ts` — see the README for usage of each.

- Types/constants: `AchievementDefinition`, `AchievementTier`, `AchievementScope`, `ACHIEVEMENT_TIERS`, `ACHIEVEMENT_TIER_COLORS`, `UnlockedAchievementsState`
- Records/buckets: `OutcomeRecord`, `RoundResult`, `DEFAULT_OUTCOME_RECORD`, `resultFor`, `applyResult`, `applyResultToBucket`, `getWinRate`, `DEFAULT_MIN_SAMPLE`, `getMostPlayedKey`, `getBestWinRateKey`, `getMaxWinsInAnyBucket`, `countBucketsWithAWin`
- Streaks: `WinStreakState`, `DEFAULT_WIN_STREAK`, `applyWinStreak`, `DayStreakState`, `DEFAULT_DAY_STREAK`, `applyDayPlayed`, `localDateString`, `previousDateString`
- Catalog: `tieredFamily`, `TieredFamilyOptions`, `TieredThresholds`, `progressToward`
- Engine: `evaluateUnlockedIds`, `newlyUnlocked`, `unlockedKey`, `parseUnlockedKey`, `isAchievementUnlocked`, `achievementUnlockedAt`, `removeProfileUnlocks`, `mapUnlocksBySeat`, `broadcastDeviceUnlocks`
- Catalog rows: `AchievementCatalogRow`, `FormatUnlockedLabel`, `defaultFormatUnlockedLabel`, `getAchievementCatalogRows`, `GetAchievementCatalogRowsOptions`
- Validation: `DEFAULT_UNLOCKED_ACHIEVEMENTS`, `isValidUnlockedAchievements`
- Persistence: `useAchievements`, `UseAchievementsOptions`, `UseAchievementsResult`, `RecordOutcomeResult`, `AchievementsStorage`

## Peer Dependencies

- `react` >=19.0.0 — required (only `useAchievements` needs it; the engine is plain functions)
- `@react-native-async-storage/async-storage` >=1.18.0 — **optional** (`peerDependenciesMeta`), lazily required; also carried in `devDependencies` to satisfy the shared config's `package-json/specify-peers-locally` rule

No React Native, Paper, Skia or Reanimated peers — nothing here renders.

## Testing

- Framework: Jest (`@infinitetoken/jest-config/react-native`), jsdom environment
- 8 suites (test count last measured at 101 across 7, before `catalogRows.test.ts` landed — see 2026-09-18 above); no `__mocks__/` directory is needed (nothing imports a native module eagerly — `storage.test.ts` uses `jest.isolateModules` + `jest.doMock` to exercise both the resolved and absent AsyncStorage paths)
- Coverage (measured 2026-09-02): **99.55 / 95.09 / 89.06 / 100** (statements/branches/functions/lines), against the shared preset's 70% floor — no local `coverageThreshold` override
- `src/__tests__/fixtures.ts` is a miniature consumer of the whole package (its own `TestStats`, catalog and `applyTestOutcome` funnel), so the tests exercise the exact composition the README documents rather than a synthetic shape

## Code Style

Enforced by ESLint + Prettier, run `npm run lint` before finishing any task. Single quotes, no semicolons, no trailing commas, print width 1000; `simple-import-sort` on imports/exports; `package-json/order-properties` and `sort-collections` on `package.json` itself.

`tsconfig.json` is `extends: "@infinitetoken/tsconfig/react-native"` with `include: ["src"]`, no local compiler-option overrides (no `exclude` needed — there's no `src/__mocks__`). `eslint.config.cjs` and `jest.config.cjs` are both bare one-line re-exports of the shared presets, with no options. `tsup.config.cjs` is `require('@infinitetoken/tsconfig/tsup/lib')()`.
