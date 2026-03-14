import {
  type ComponentType,
  type SVGProps,
  lazy,
  Suspense,
  useMemo,
} from 'react';
import { type IconName, isValidIconName } from './types';

export interface IconProps {
  /** The name of the USWDS icon to render */
  name: IconName;
  /** CSS class names for styling (use Tailwind classes like "h-4 w-4") */
  className?: string;
  /** Accessible title for the icon. If provided, the icon will be accessible to screen readers. */
  title?: string;
}

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Static icon loaders — only the icons actually used in the app.
 *
 * Previously used import.meta.glob() which created a JS chunk for every
 * USWDS icon (245 chunks, ~99KB). Since we only use 4 icons, static
 * dynamic imports eliminate 241 unnecessary chunks from the build output.
 *
 * To add a new icon:
 * 1. Add the name to types.ts (IconName union + ICON_NAMES array)
 * 2. Add a lazy import entry here
 */
// Use /node_modules/ filesystem path (not package specifier) to bypass
// @uswds/uswds exports map which doesn't expose individual SVG files.
const iconLoaders: Record<string, () => Promise<{ default: SvgComponent }>> = {
  check: () => import('/node_modules/@uswds/uswds/dist/img/usa-icons/check.svg?react'),
  close: () => import('/node_modules/@uswds/uswds/dist/img/usa-icons/close.svg?react'),
  info: () => import('/node_modules/@uswds/uswds/dist/img/usa-icons/info.svg?react'),
  warning: () => import('/node_modules/@uswds/uswds/dist/img/usa-icons/warning.svg?react'),
};

// Cache for lazy-loaded icon components
const iconCache = new Map<string, ReturnType<typeof lazy<SvgComponent>>>();

/** Get or create a lazy-loaded icon component */
function getLazyIcon(name: string) {
  if (!iconCache.has(name)) {
    const loader = iconLoaders[name];
    if (!loader) return null;

    const LazyIcon = lazy<SvgComponent>(loader);
    iconCache.set(name, LazyIcon);
  }

  return iconCache.get(name)!;
}

/**
 * USWDS Icon Component
 *
 * Renders icons from the U.S. Web Design System icon library.
 * Icons use `currentColor` for fill, so they inherit the text color of their parent.
 *
 * @example
 * // Basic usage with Tailwind sizing
 * <Icon name="check" className="h-4 w-4" />
 *
 * @example
 * // With accessible title
 * <Icon name="warning" className="h-5 w-5 text-yellow-500" title="Warning" />
 *
 * @example
 * // Inheriting text color
 * <span className="text-blue-600">
 *   <Icon name="info" className="h-4 w-4" />
 * </span>
 */
export function Icon({
  name,
  className,
  title,
}: IconProps): JSX.Element | null {
  // Validate icon name at runtime
  if (!isValidIconName(name)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `Icon: Invalid icon name "${name}". Check available icons in types.ts.`,
      );
    }

    return null;
  }

  // Memoize the lazy icon component lookup
  const LazyIcon = useMemo(() => getLazyIcon(name), [name]);

  // Handle case where icon loader wasn't found
  if (!LazyIcon) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `Icon: Could not load icon "${name}". Add it to iconLoaders in Icon.tsx.`,
      );
    }

    return null;
  }

  // Accessibility attributes following USWDS patterns
  const accessibilityProps = title
    ? {
        role: 'img' as const,
        'aria-label': title,
      }
    : {
        'aria-hidden': true as const,
        focusable: false as const,
        role: 'img' as const,
      };

  return (
    <Suspense fallback={<span className={className} />}>
      <LazyIcon
        className={className}
        fill="currentColor"
        {...accessibilityProps}
      />
    </Suspense>
  );
}

export default Icon;
