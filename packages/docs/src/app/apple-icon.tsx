import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * The home-screen icon for iOS and iPadOS.
 *
 * Generated rather than a file because it needs something the brand mark does
 * not have: an opaque background. iOS renders transparency as black, and the
 * mark's deep blue on black is the one combination that loses it. The white
 * square also gets the rounded corners iOS masks onto it, so the circle sits
 * inside them with the margin Apple's templates use.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default async function AppleIcon() {
  const mark = await readFile(
    join(process.cwd(), 'public/brand/node-flow-mark.png'),
  );
  const src = `data:image/png;base64,${mark.toString('base64')}`;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
      }}
    >
      <img src={src} width={148} height={148} alt="" />
    </div>,
    size,
  );
}
