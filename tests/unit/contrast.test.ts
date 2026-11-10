import { avatarColors, colors, habitTints } from '@/theme/tokens';
import { contrastRatio } from '@/theme/contrast';

/**
 * "Measure text contrast; do not assume a palette is accessible."
 * WCAG AA: 4.5:1 for body text, 3:1 for large text and meaningful glyphs.
 */
describe('palette contrast', () => {
  const AA = 4.5;
  const AA_LARGE = 3;

  it.each([
    ['ink on background', colors.ink, colors.bg],
    ['ink on surface', colors.ink, colors.surface],
    ['ink on strong surface', colors.ink, colors.surfaceStrong],
    ['ink on sunken surface', colors.ink, colors.surfaceSunken],
    ['secondary text on background', colors.textSecondary, colors.bg],
    ['secondary text on surface', colors.textSecondary, colors.surface],
    ['secondary text on strong surface', colors.textSecondary, colors.surfaceStrong],
    ['secondary text on sunken surface', colors.textSecondary, colors.surfaceSunken],
    ['text on ink', colors.onInk, colors.ink],
    ['secondary text on ink', colors.onInkSecondary, colors.ink],
    ['positive on its soft fill', colors.positive, colors.positiveSoft],
    ['warning on its soft fill', colors.warning, colors.warningSoft],
    ['danger on its soft fill', colors.danger, colors.dangerSoft],
    ['danger on background', colors.danger, colors.bg],
    ['danger on surface', colors.danger, colors.surface],
    ['info on its soft fill', colors.info, colors.infoSoft],
    ['ink on the signal color', colors.ink, colors.signal],
  ])('%s meets AA for body text', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  it('tertiary text is only good enough for large or incidental text', () => {
    expect(contrastRatio(colors.textTertiary, colors.bg)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(colors.textTertiary, colors.bg)).toBeLessThan(AA);
  });

  it('white text is never placed on the signal color', () => {
    // Documented constraint: it would fail AA, so badges use ink text.
    expect(contrastRatio(colors.onInk, colors.signal)).toBeLessThan(AA);
  });

  it.each(Object.entries(avatarColors))('ink faces and initials are legible on the %s avatar', (_name, hex) => {
    expect(contrastRatio(colors.ink, hex)).toBeGreaterThanOrEqual(AA);
  });

  it.each(Object.entries(habitTints))('ink and secondary text are legible on the %s habit tile', (_name, hex) => {
    expect(contrastRatio(colors.ink, hex)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(colors.textSecondary, hex)).toBeGreaterThanOrEqual(AA);
  });

  it('does not contain the rejected purple/lime brand colors', () => {
    const rejected = ['#885BFF', '#6635D9', '#F1EBFF', '#B5FF69'];
    const all = [...Object.values(colors), ...Object.values(avatarColors), ...Object.values(habitTints)].map((c) => c.toUpperCase());
    for (const hex of rejected) expect(all).not.toContain(hex);
  });
});
