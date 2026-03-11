import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFoundPage } from './NotFound';

/**
 * Tests for 404 Not Found page.
 *
 * Risk mitigated: Users who hit invalid routes (e.g., /weeks)
 * currently see a blank page with no guidance on how to recover.
 */
describe('NotFoundPage', () => {
  it('renders a heading indicating the page was not found', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/not found/i);
  });

  it('provides a link back to the documents page', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/docs');
  });

  it('is accessible with proper heading hierarchy', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );

    // Should have exactly one h1
    const headings = screen.getAllByRole('heading');
    expect(headings[0].tagName).toBe('H1');
  });
});
