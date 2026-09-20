'use client';

import { Alert, Button, Form, Input, Label, Separator, TextField } from '@heroui/react';
import { useState, type FormEvent } from 'react';

/**
 * Password sign-in, and any SSO providers.
 *
 * A full navigation afterwards rather than a client-side route change, because
 * the layout reads the user on the server and needs a fresh request to see it.
 */
export function LoginForm({
  returnTo,
  defaultNamespace,
  providers,
}: {
  returnTo: string;
  defaultNamespace: string;
  providers: { name: string; protocol?: 'oidc' | 'saml' }[];
}) {
  const [namespace, setNamespace] = useState(defaultNamespace);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      const response = await fetch(`/v1/ns/${encodeURIComponent(namespace.trim())}/users/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        // Deliberately not distinguishing "no such account" from "wrong
        // password": the difference tells an attacker which addresses exist.
        setError(
          response.status === 401 || response.status === 404
            ? 'Those details do not match an account in this namespace.'
            : response.status === 429
              ? 'Too many attempts. Wait a minute and try again.'
              : (body.message ?? 'Sign in failed.')
        );
        return;
      }

      window.location.href = returnTo;
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Form onSubmit={submit} className="space-y-4">
        {/* Asked for, not guessed: an email is unique only within a namespace. */}
        <TextField value={namespace} onChange={setNamespace} isRequired name="namespace">
          <Label>Namespace</Label>
          <Input autoComplete="organization" />
        </TextField>
        <TextField value={email} onChange={setEmail} isRequired type="email" name="email">
          <Label>Email</Label>
          <Input autoComplete="username" placeholder="you@company.com" />
        </TextField>
        <TextField value={password} onChange={setPassword} isRequired type="password" name="password">
          <Label>Password</Label>
          <Input autoComplete="current-password" />
        </TextField>

        {error && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        <Button type="submit" className="w-full" isPending={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </Form>

      {providers.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted">
            <Separator className="flex-1" />
            or
            <Separator className="flex-1" />
          </div>
          <div className="space-y-2">
            {providers.map((provider) => (
              <a
                key={provider.name}
                // The two protocols have separate routes because they are
                // separate flows; the button only has to know which.
                href={`/v1/auth/${provider.protocol === 'saml' ? 'saml' : 'sso'}/${encodeURIComponent(provider.name)}/login?returnTo=${encodeURIComponent(returnTo)}`}
                className="button button--secondary w-full"
              >
                Continue with {provider.name}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
