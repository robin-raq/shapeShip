/**
 * USWDS Icon Names
 *
 * Only icons actually used in the application are included.
 * Adding a new icon: import the SVG in Icon.tsx and add the name here.
 *
 * Previously, all 245 USWDS icons were listed here and loaded via
 * import.meta.glob(). That created 245 separate JS chunks in the build
 * output (~99KB total) even though only 4 icons are used. Switching to
 * static imports eliminates those chunks entirely.
 */

export type IconName =
  | 'check'
  | 'close'
  | 'info'
  | 'warning';

/**
 * Array of all available icon names for runtime validation
 */
export const ICON_NAMES: IconName[] = [
  'check',
  'close',
  'info',
  'warning',
] as const;

/**
 * Check if a string is a valid icon name
 */
export function isValidIconName(name: string): name is IconName {
  return ICON_NAMES.includes(name as IconName);
}
