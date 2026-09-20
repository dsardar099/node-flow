export type Verifier = 'GITHUB' | 'STRIPE' | 'SLACK' | 'SHOPIFY' | 'HMAC' | 'HEADER' | 'NONE';

/**
 * What each preset checks, and where to find the matching setting on the
 * sending platform — the step people get stuck on, so it is said right there.
 */
export const VERIFIERS: Record<
  Verifier,
  { label: string; mark: string; tone: string; summary: string; setup: string; needsHeader?: boolean; hmac?: boolean }
> = {
  GITHUB: {
    label: 'GitHub',
    mark: 'GH',
    tone: 'bg-default text-foreground',
    summary: 'X-Hub-Signature-256, HMAC-SHA256 of the body.',
    setup: 'Repository → Settings → Webhooks: paste the URL, set content type to application/json, and use the same secret.',
  },
  STRIPE: {
    label: 'Stripe',
    mark: 'St',
    tone: 'bg-accent-soft text-accent',
    summary: 'Stripe-Signature with a timestamp; deliveries older than five minutes are refused.',
    setup: 'Developers → Webhooks → Add endpoint. Store the endpoint’s signing secret (whsec_…) as the secret.',
  },
  SLACK: {
    label: 'Slack',
    mark: 'Sl',
    tone: 'bg-warning-soft text-warning',
    summary: 'X-Slack-Signature over v0:timestamp:body; answers the URL verification challenge.',
    setup: 'Your app → Basic Information → Signing Secret. Use the URL as the Event Subscriptions request URL.',
  },
  SHOPIFY: {
    label: 'Shopify',
    mark: 'Sh',
    tone: 'bg-success-soft text-success',
    summary: 'X-Shopify-Hmac-Sha256, base64 HMAC-SHA256 of the body.',
    setup: 'Settings → Notifications → Webhooks, or the app’s API secret for app webhooks.',
  },
  HMAC: {
    label: 'Custom HMAC',
    mark: '#',
    tone: 'bg-default text-foreground',
    summary: 'An HMAC of the raw body in a header you name, with your choice of hash and encoding.',
    setup: 'Match the header, hash, encoding and any prefix (such as sha256=) your sender uses.',
    needsHeader: true,
    hmac: true,
  },
  HEADER: {
    label: 'Shared token',
    mark: '🔑',
    tone: 'bg-default text-foreground',
    summary: 'A header whose value must equal the secret exactly.',
    setup: 'For senders that can only add a static header. Weaker than a signature: anyone who sees one request can replay it.',
    needsHeader: true,
  },
  NONE: {
    label: 'No verification',
    mark: '!',
    tone: 'bg-danger-soft text-danger',
    summary: 'Anyone who learns the URL can trigger it.',
    setup: 'Only for testing, or behind a network boundary you trust.',
  },
};
