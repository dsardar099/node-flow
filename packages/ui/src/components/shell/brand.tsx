/**
 * The node-flow mark and wordmark.
 *
 * The asset is one wide lockup — the swirl, then "Node Flow" — so the square
 * mark is cropped out of it in CSS rather than shipped as a second file. One
 * file to replace when the brand changes, and no image pipeline in a build that
 * otherwise has none.
 *
 * The crop works because the swirl occupies the leftmost square of the lockup:
 * scaling the background to the box height and pinning it left shows exactly
 * that square. If the lockup is ever redrawn with different proportions this is
 * the thing that will look wrong.
 */

const LOCKUP = '/brand/node-flow.png';

/** Just the swirl. For the collapsed rail and the mobile header. */
export function BrandMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${LOCKUP})`,
        // Scale to the box height, then take the leftmost square of it.
        backgroundSize: `auto ${size+10}px`,
        backgroundPosition: 'left center',
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}

/** The full lockup. For the expanded sidebar. */
export function BrandLockup({
  height = 26,
  className = '',
}: {
  height?: number;
  className?: string;
}) {
  return <img src={LOCKUP} alt="node-flow" className={`w-auto shrink-0 ${className}`} style={{ height }} />;
}
