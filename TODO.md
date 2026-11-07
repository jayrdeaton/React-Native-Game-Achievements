# TODO

## Game Center (2026-10-19)

Report unlocks (and maybe best scores) to Apple's Game Center as well as keeping them here. Raised during SolitaireTastic's first App Store submission; not needed for a release, come back to it once SolitaireTastic, LightCycles and Snake are live.

- **Bridge:** Game Center is a native iOS framework, so it needs a native module (a community package or a small Expo module of our own) plus the Game Center capability. Any app that adopts it needs a new native build, not an OTA.
- **Hook point:** when `@tastic/achievements` unlocks an achievement or a tier, also report it to Game Center. Optional and off by default, so apps that don't use Game Center are unchanged.
- **App Store Connect setup, per app:** each achievement needs an ID, a title, pre- and post-unlock text, points (Apple caps a game at 1,000 in total) and a 512 or 1024px image. Tiered achievements (bronze/silver/gold) become three Game Center achievements, or one reporting a percentage.
- **Decide first: profiles vs. Apple accounts.** Game Center belongs to the Apple account signed in on the device, while Tastic profiles are family members sharing one device, so a kid's unlock would land on the parent's Game Center. Options: report for one chosen profile only, report every profile to whoever is signed in, or a per-profile "this is me" switch.
- **Leaderboards (maybe the better half):** a best-score leaderboard per variant (Solitaire's score is lower-is-better, which Game Center supports) gives players something the built-in stats can't, comparing with friends. Same profile question applies.
