import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { ogImageSize } from './metadata';
import { site } from './site';

/**
 * The preview card a link shows when it is shared — Slack, X, LinkedIn,
 * WhatsApp, Discord, iMessage.
 *
 * ## Light, although the landing page is dark
 *
 * The wordmark is a cyan-to-violet gradient that bottoms out in a deep blue.
 * On the landing page's near-black that deep blue drops to roughly 2.5:1
 * contrast and the middle of the word goes muddy; on white it reads exactly as
 * designed. A preview is seen at thumbnail size in someone else's feed, so the
 * logo reading at a glance matters more than matching the site's theme.
 *
 * ## Why files and not fetches
 *
 * Fonts come from `@fontsource/inter` and the logo from `public/`, both read
 * from disk. Fetching either from a CDN would make `next build` depend on the
 * network — and the built-in `ImageResponse` font has a single regular weight,
 * which renders a headline limp enough to undo the point of having a card.
 * Paths are relative to `process.cwd()`, which is the package directory: Nx
 * runs `next build` with `cwd: packages/docs`.
 */

interface CardProps {
  /** Small label above the title — the section, or what the product is. */
  eyebrow: string;
  title: string;
  description?: string;
}

interface Assets {
  logo: string;
  fonts: {
    name: string;
    data: Buffer;
    weight: 400 | 600 | 800;
    style: 'normal';
  }[];
}

let assets: Promise<Assets> | undefined;

/** Read once per process, not once per image: a build renders one card per page. */
function loadAssets(): Promise<Assets> {
  const root = process.cwd();
  const font = (weight: 400 | 600 | 800) =>
    readFile(
      join(
        root,
        `node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff`,
      ),
    ).then((data) => ({
      name: 'Inter',
      data,
      weight,
      style: 'normal' as const,
    }));

  assets ??= Promise.all([
    readFile(join(root, 'public/brand/node-flow.png')),
    font(400),
    font(600),
    font(800),
  ]).then(([logo, ...fonts]) => ({
    logo: `data:image/png;base64,${logo.toString('base64')}`,
    fonts,
  }));

  return assets;
}

/**
 * Shortens at a word boundary.
 *
 * The card cannot scroll and the renderer has no reliable line clamp, so
 * anything that would overflow is cut here — at a word, never mid-word, and
 * with an ellipsis so it reads as shortened rather than broken.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  const kept = space > max * 0.6 ? cut.slice(0, space) : cut.slice(0, max);
  // A cut that lands after a comma or a dash reads as `condition,…` — strip
  // the punctuation so the ellipsis follows a word.
  return `${kept.replace(/[\s,;:—–-]+$/u, '')}…`;
}

/**
 * A soft wash of `color`, fading to nothing well inside a `size`-pixel box.
 *
 * The stops are in pixels on purpose. With percentage stops the renderer's
 * gradient does not reach full transparency before the box ends, and the card
 * shows a hard rectangular edge where the wash is clipped — the most visible
 * flaw a preview can have, because it looks like a rendering bug.
 */
const wash = (color: string, alpha: string, size: number) =>
  `radial-gradient(circle at center, ${color}${alpha} 0px, ${color}00 ${Math.round(size * 0.46)}px)`;

/** The logo is 2172×724, a 3:1 wordmark; this keeps it at that ratio. */
const LOGO = { width: 264, height: 88 };

export async function renderCard({
  eyebrow,
  title,
  description,
}: CardProps): Promise<ImageResponse> {
  const { logo, fonts } = await loadAssets();
  const { ink, muted, cyan, blue, violet } = site.colors;
  const host = new URL(site.url).host;

  const heading = truncate(title, 80);
  // Long titles step down a size rather than wrapping to a third line.
  const headingSize = heading.length > 42 ? 58 : 72;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        backgroundColor: '#ffffff',
        fontFamily: 'Inter',
      }}
    >
      {/* The brand's two ends, as washes behind the text. */}
      <div
        style={{
          position: 'absolute',
          top: -260,
          right: -200,
          width: 720,
          height: 720,
          display: 'flex',
          backgroundImage: wash(cyan, '38', 720),
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -320,
          left: -220,
          width: 760,
          height: 760,
          display: 'flex',
          backgroundImage: wash(violet, '2a', 760),
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          padding: '64px 80px 56px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <img src={logo} width={LOGO.width} height={LOGO.height} alt="" />
          <div
            style={{
              display: 'flex',
              padding: '10px 22px',
              borderRadius: 999,
              border: `2px solid ${blue}33`,
              backgroundColor: '#ffffffcc',
              color: blue,
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            {eyebrow}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flexGrow: 1,
          }}
        >
          <div
            style={{
              display: 'flex',
              color: ink,
              fontSize: headingSize,
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: -2,
            }}
          >
            {heading}
          </div>
          {description ? (
            <div
              style={{
                display: 'flex',
                marginTop: 24,
                color: muted,
                fontSize: 30,
                fontWeight: 400,
                lineHeight: 1.4,
              }}
            >
              {truncate(description, 150)}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              color: ink,
              fontSize: 26,
              fontWeight: 600,
            }}
          >
            {host}
          </div>
          <div style={{ display: 'flex', color: muted, fontSize: 24 }}>
            {site.tagline}
          </div>
        </div>
      </div>

      {/* The logo's gradient, carried across the bottom edge. */}
      <div
        style={{
          display: 'flex',
          height: 14,
          width: '100%',
          backgroundImage: `linear-gradient(90deg, ${cyan}, ${blue}, ${violet})`,
        }}
      />
    </div>,
    { ...ogImageSize, fonts },
  );
}
