# Uplift design — direction "Crew"

Chosen 2026-11-10 (see `docs/DECISIONS.md`, D-001 to D-005). The purple/lime kit
is rejected; never bring it back. Compare alternatives at `/design-lab`.

## The idea

Ink on warm white. Black is the only "brand color": large tight black headings,
black selected pills, one black primary action per screen. White controls float
on soft shadows. Color is scarce and belongs to **people** (generated avatars),
**habits** (soft emoji tiles) and **states that need attention**. Emoji are the
playful detail, used sparingly and never as the only carrier of meaning.

Translated from the "Friday crew" reference: confident headings, generous
spacing, pill controls with strong black selected states, floating circular
actions, rounded bottom sheets with a handle, a big number with a small unit
("5/7"), and expressive avatars. Not copied: the map, or its layout.

## Tokens (`src/theme`)

- Colors: `bg` white, `surface` warm paper (cards, fields), `ink`, `textSecondary`
  (AA on white and paper), `textTertiary` (placeholders only), `signal` (lifted
  dot, unread marks; ink text only on top), soft semantic pairs
  `positive/warning/danger/info` + `*Soft`. Contrast is measured in
  `tests/unit/contrast.test.ts`.
- Type: Inter Tight for headings (`display`, `title`, `headline`, `subhead`,
  `stat`, `score`), Inter for text (`body`, `callout`, `caption`, `micro`,
  `label`). Always through `<Text variant color>`. No all-caps, no italics.
- Space 4/8/12/16/20/24/32; screen gutter 20. Radius: fields 16, tiles 20,
  cards 28, sheets 32, pills 999. Touch targets ≥ 44pt.

## Components (`src/components`)

`Screen` (+ `NavHeader`, `TitleBlock`, `SectionHeading`), `Button`, `IconButton`,
`PillTabs`, `Card`, `ListRow`, `Divider`, `StatusBadge`, `ChallengeStatusBadge`,
`AdjustedBadge`, `DemoRewardBadge`, `HabitBadge`, `Banner`, `Avatar`,
`AvatarStack`, `DayDot`, `DayProgress`, `DayTally`, `TextField`, `Stepper`,
`SelectField`, `ChoiceRow`, `SwitchRow`, `Sheet`, `ConfirmationSheet`,
`ToastProvider/useToast`, `EmptyState`, `ErrorState`, `LoadingState`,
`QueryBoundary`, `Wordmark`, icons from `@/components/icons`.

## Rules for every screen

1. White background. Cards are warm fills without borders. No gradients.
2. One black primary button, pinned in the `Screen` footer when the screen has a
   main action. Secondary actions are `secondary`/`ghost`/`floating`.
3. Every visible control works, navigates, or is disabled with a sentence that
   says why. Never a dead or fake button.
4. Every data screen handles loading (`LoadingState`), error (`ErrorState` with
   retry) and empty (`EmptyState`) — use `QueryBoundary`.
5. State is never color alone: pair it with a label and/or icon.
6. Short actions go in a `Sheet`; consequential ones in a `ConfirmationSheet`
   (with a required reason where the rules demand one).
7. Text wraps instead of clipping; rows use `minHeight`, not `height`.
8. Screen-reader labels on anything that is not plain text; emoji tiles are
   hidden from assistive tech.
9. Demo rewards always carry "Demo reward — no money collected".
