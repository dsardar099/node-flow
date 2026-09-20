import { BranchesRight, Pulse, ShieldCheck } from '@gravity-ui/icons';
import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/api';
import { safeReturnTo } from '../../lib/safe-return-to';
import { LoginForm } from './login-form';
import { BrandLockup } from '@/components/shell/brand';

interface Provider {
  name: string;
  namespace: string;
  protocol?: 'oidc' | 'saml';
}

/**
 * Sign in.
 *
 * The providers are fetched on the server so the page renders with its buttons
 * already present — a login page that flashes an empty state before revealing
 * how to sign in is the first thing anyone sees of the product.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  if (await currentUser()) redirect('/executions');

  const returnTo = safeReturnTo((await searchParams).returnTo);

  let providers: Provider[] = [];
  try {
    const response = await fetch(`${process.env.NODE_FLOW_API_URL ?? 'http://localhost:3000'}/v1/auth/sso/providers`, {
      cache: 'no-store',
    });
    providers = response.ok ? ((await response.json()) as { providers: Provider[] }).providers : [];
  } catch {
    // An unreachable API must still render a login form: the password path may
    // be the only way in, and a blank page tells nobody anything.
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[radial-gradient(68%_70%_at_-3%_0%,rgba(8,214,238,.38),transparent_65%),linear-gradient(135deg,#07152b,#0c1d40_48%,#110d2c)] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-black/10" />
        <div className="relative flex items-center gap-3">
          <BrandLockup height={55} />
        </div>
        <div className="relative mt-auto max-w-md space-y-8">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Orchestrate every workflow, and see exactly what happened.
          </h2>
          <ul className="space-y-4 text-sm text-white/85">
            {[
              { icon: BranchesRight, text: 'Design workflows visually, version them, run them anywhere.' },
              { icon: Pulse, text: 'Follow executions live — every task’s input, output and logs.' },
              { icon: ShieldCheck, text: 'Retries, timeouts and limits enforced on the server, not hoped for.' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-muted">Sign in to your namespace to continue.</p>
          </div>

          <LoginForm returnTo={returnTo} defaultNamespace={process.env.NODE_FLOW_UI_NAMESPACE ?? 'default'} providers={providers} />
        </div>
      </main>
    </div>
  );
}
