import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { isValidIconName, ICON_NAMES } from './types';

describe('Icon types module', () => {
  it('exports only the icons actually used in the app', () => {
    // We only ship icons that are referenced in source code
    // This prevents bundling 245 unused USWDS icon chunks
    expect(ICON_NAMES).toEqual(['check', 'close', 'info', 'warning']);
  });

  it('isValidIconName returns true for used icons', () => {
    expect(isValidIconName('check')).toBe(true);
    expect(isValidIconName('close')).toBe(true);
    expect(isValidIconName('warning')).toBe(true);
    expect(isValidIconName('info')).toBe(true);
  });

  it('isValidIconName returns false for unused USWDS icons', () => {
    // These exist in the USWDS library but are not used in Ship
    expect(isValidIconName('search')).toBe(false);
    expect(isValidIconName('arrow_back')).toBe(false);
    expect(isValidIconName('home')).toBe(false);
  });

  it('isValidIconName returns false for invalid icons', () => {
    expect(isValidIconName('not-a-real-icon')).toBe(false);
    expect(isValidIconName('')).toBe(false);
  });

  it('all ICON_NAMES pass validation', () => {
    ICON_NAMES.forEach((name) => {
      expect(isValidIconName(name)).toBe(true);
    });
  });
});

describe('Icon component behavior', () => {
  it('exports Icon component from index', async () => {
    const { Icon: ExportedIcon } = await import('./index');
    expect(ExportedIcon).toBeDefined();
    expect(typeof ExportedIcon).toBe('function');
  });

  it('Icon component renders without crashing for invalid icon', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { Icon } = await import('./Icon');

    // @ts-expect-error - Testing invalid icon name
    const { container } = render(<Icon name="definitely-not-real" className="h-4 w-4" />);

    // Should render nothing for invalid icon
    expect(container.firstChild).toBeNull();

    // Should warn about invalid icon name
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid icon name')
    );

    consoleSpy.mockRestore();
  });
});
