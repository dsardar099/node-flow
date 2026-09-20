import Script from 'next/script';

/**
 * Google Analytics and Microsoft Clarity, for the public site only.
 *
 * Both are loaded through `next/script` with `afterInteractive` rather than as
 * raw `<script>` tags. The tags as vendors publish them are written for a
 * hand-authored page: dropped into JSX they either run before hydration and
 * fight it, or get re-executed on every client navigation, which double-counts
 * every page view. `next/script` loads each one once per session and leaves the
 * SPA route changes to the tag's own history listener.
 *
 * `afterInteractive`, not `beforeInteractive`: neither of these is needed to
 * render anything, and putting analytics ahead of the content is how a docs
 * page ends up blocked on a third party that is having a bad day.
 *
 * ## Why this is a component rather than three lines in the layout
 *
 * The measurement ids are the *public* site's. They belong to the marketing and
 * documentation pages, and nowhere near the dashboard — an operator's URLs name
 * their workflows, their namespaces and their execution ids, and shipping those
 * to an analytics vendor would be a data leak wearing a page-view hat. Keeping
 * this in `packages/docs` and importing it from one layout is what makes that
 * boundary visible; `packages/ui` has no analytics and should not grow any.
 *
 * Both are disabled outside production, so a `next dev` session does not pollute
 * the numbers with the pages you are in the middle of writing.
 */

const GA_MEASUREMENT_ID = 'G-06DP7V4W8G';
const CLARITY_PROJECT_ID = 'yl8wtte0ir';

export function Analytics() {
  if (process.env.NODE_ENV !== 'production') return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}');
        `}
      </Script>

      <Script id="clarity-init" strategy="afterInteractive">
        {`
          (function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
          })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");
        `}
      </Script>
    </>
  );
}
