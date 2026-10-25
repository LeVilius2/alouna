import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

describe('app routes', () => {
  it('home offers navigator and editor', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /navigator/i })).toHaveAttribute('href', '/navigate');
    expect(screen.getByRole('link', { name: /map editor/i })).toHaveAttribute('href', '/editor');
  });

  it('renders the navigator page', () => {
    renderAt('/navigate');
    expect(screen.getByRole('heading', { name: 'Navigator' })).toBeInTheDocument();
  });

  it('renders the editor page', () => {
    renderAt('/editor');
    expect(screen.getByRole('heading', { name: 'Map editor' })).toBeInTheDocument();
  });

  it('shows not found for unknown paths', () => {
    renderAt('/nope');
    expect(screen.getByRole('alert')).toHaveTextContent(/not found/i);
  });
});
