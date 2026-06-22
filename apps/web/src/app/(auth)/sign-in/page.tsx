'use client';

import { useActionState } from 'react';
import { signInAction, type SignInState } from '../actions';

const initialState: SignInState = {};

export default function SignInPage() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-app px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-sm">
        <div className="mb-6">
          <div className="mb-2 h-8 w-8 rounded-md bg-forest" aria-hidden />
          <h1 className="text-xl font-semibold text-text-primary">Sign in</h1>
          <p className="mt-1 text-sm text-text-secondary">Access your sales workspace.</p>
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-text-primary">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-forest"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-text-primary">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-forest"
            />
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-terracotta">
              {state.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-forest px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-forest-deep disabled:opacity-60"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
