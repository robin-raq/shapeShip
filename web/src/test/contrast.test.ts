import { describe, it, expect } from 'vitest';

/**
 * WCAG 2.1 contrast ratio calculation.
 * Used to validate that our Tailwind color tokens meet AA requirements.
 */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ];
}

function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Colors from web/tailwind.config.js — keep in sync
const colors = {
  background: '#0d0d0d',
  foreground: '#f5f5f5',
  muted: '#8a8a8a',
  accent: '#2e8bc9',
  'accent-hover': '#3d97d3',
};

describe('WCAG 2.1 AA color contrast', () => {
  it('accent on background meets 4.5:1 minimum', () => {
    const ratio = contrastRatio(colors.accent, colors.background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('accent-hover on background meets 4.5:1 minimum', () => {
    const ratio = contrastRatio(colors['accent-hover'], colors.background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('muted on background meets 4.5:1 minimum', () => {
    const ratio = contrastRatio(colors.muted, colors.background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('foreground on background meets 4.5:1 minimum', () => {
    const ratio = contrastRatio(colors.foreground, colors.background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
