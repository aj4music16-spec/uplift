# Decisions and assumptions

Product and engineering choices made while building the MVP. The specification
(`docs/UPLIFT_SPEC.md`) says build defaults are "product choices, not claims that
these choices were previously approved" — the same applies here. Anything marked
**Assumption** should be confirmed by the product owner.

## Design

### D-001 — The original brand kit is rejected (2026-11-10)

The product owner's design brief of 2026-11-10 supersedes the specification's
"Design system" section. **Not approved, never to be reintroduced:** the
purple-and-lime palette (`#885BFF`, `#6635D9`, `#F1EBFF`, `#B5FF69`), the angular
"U" symbol, the italic uppercase sports wordmark, Space Grotesk headings, and the
esports / fantasy-league aesthetic.

Kept: the name Uplift, white backgrounds, and all functional requirements.

Authority order for future work: (1) the 2026-11-10 brief for visual direction,
(2) the specification for functionality, (3) the "Friday crew" reference image for
visual style, (4) the earlier five-screen Uplift mockup for content and flows only.

Guard: `tests/unit/contrast.test.ts` fails if the rejected colors reappear in
`src/theme/tokens.ts`. `CLAUDE.md` repeats this at the top.

### D-002 — Three directions explored; "Crew" chosen

Three lightweight directions were built on an in-app screen (`/design-lab`,
linked from Profile) showing the same heading, challenge card, avatar group and
primary action:

| | Direction | Idea | Why not / why |
| - | - | - | - |
| A | **Crew** (chosen) | Ink on warm white. Inter Tight headings, black selected pills and actions, soft white floating controls, color only on people and habits. | Closest translation of the reference; highest contrast; rewards stay visually quiet. |
| B | Almanac | Soft serif (Fraunces), ivory paper, hairlines, one evergreen accent. | Warm, but drifts toward the rejected "soft wellness" look and loses the black selected states. |
| C | Sticker | Bricolage Grotesque, color-blocked cards, outlines, hard shadows, cobalt action. | Fun, but spends color on chrome and puts borders on everything — the opposite of the brief. |

Screenshot: `docs/design/design-lab-directions.png`. The alternatives stay in
the app for review; only Crew's tokens (`src/theme/`) are used by product screens.

### D-003 — Wordmark instead of a symbol

The brief says a simple wordmark beats a forced symbol. The mark is lowercase
"uplift" in Inter Tight ExtraBold with the dot of the "i" enlarged and lifted.
It is a **temporary original vector mark**, generated from the font's outlines by
`scripts/build-wordmark.mjs` into `src/components/brand/wordmark.generated.ts`
(Inter Tight is under the SIL Open Font License). In the app the dot takes the
signed-in person's avatar color. There is no separate logo symbol; the app icon
is the wordmark's "u" and lifted dot.

### D-004 — Generated avatars, no photo upload in the MVP

The reference relies on expressive avatars with individually colored
backgrounds. The spec forbids scraped real people and asks for initials or
generated avatars. Avatars are original ink faces on a colored circle (10 colors
× 10 faces), chosen in profile setup. They need no photo permission and make
people the most colorful thing on screen. `profiles.avatar_path` exists in the
schema for a future photo avatar, which is **deferred**.

### D-005 — Emoji as the playful detail

Habits are marked with a large emoji on a soft tinted tile (the reference's pizza
slice). Emoji are decoration: a text label always sits next to them and they are
hidden from screen readers. UI controls use line icons (`lucide-react-native`).

### D-006 — Routes live in `src/app/`

The spec suggests `app/` at the repository root. The current official Expo
template (SDK 58) puts routes in `src/app/`, and the spec says to follow current
Expo guidance, so routes are in `src/app/`. Everything else matches the suggested
folders.

## Product rules

Filled in as features land — see the sections below in this file.
