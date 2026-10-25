import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DataContext } from './context';
import { DataPanel } from './DataPanel';
import { strings } from '../strings';

describe('account entry', () => {
  it('uses email/password without signup or email delivery and clears the password after failure', async () => {
    const signInWithPassword = vi
      .fn()
      .mockResolvedValue({ error: { message: 'Invalid credentials' } });
    const client = { auth: { signInWithPassword } } as unknown as SupabaseClient;
    render(
      <DataContext
        value={{ configured: true, client, store: null, offline: false, signOut: async () => {} }}
      >
        <DataPanel />
      </DataContext>,
    );
    fireEvent.change(screen.getByLabelText(strings.data.email), {
      target: { value: 'test@example.test' },
    });
    fireEvent.change(screen.getByLabelText(strings.data.password), {
      target: { value: 'test-only-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: strings.data.signIn }));
    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.test',
        password: 'test-only-password',
      }),
    );
    expect(await screen.findByText(strings.data.signInFailed)).toBeInTheDocument();
    expect(screen.getByLabelText(strings.data.password)).toHaveValue('');
  });
  it('disables fresh login while offline', () => {
    render(
      <DataContext
        value={{
          configured: true,
          client: null,
          store: null,
          offline: true,
          signOut: async () => {},
        }}
      >
        <DataPanel />
      </DataContext>,
    );
    expect(screen.getByRole('button', { name: strings.data.signIn })).toBeDisabled();
  });
});
