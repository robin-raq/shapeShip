import { Link } from 'react-router-dom';

/**
 * 404 Not Found page.
 *
 * Rendered when no route matches the current URL.
 * Provides a clear message and a way back to the app.
 */
export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <h1 className="text-xl font-medium text-foreground">Page not found</h1>
      <p className="mt-2 text-sm text-muted">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        to="/docs"
        className="mt-4 text-sm text-accent hover:underline"
      >
        Go to Documents
      </Link>
    </div>
  );
}
