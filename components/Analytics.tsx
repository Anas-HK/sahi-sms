/**
 * Vercel Web Analytics.
 *
 * Emitted as an inline script in the static HTML rather than injected after
 * hydration, so the tag is present in out/index.html and runs on the first
 * paint. The npm package is avoided on purpose: it carries an optional
 * SvelteKit peer that collides with this project's vite, and the same
 * resolution would run on Vercel during install and break the deploy.
 *
 * The counter path is served by Vercel once Web Analytics is switched on for
 * the project. Anywhere else, including localhost, it 404s harmlessly.
 *
 * What it records: a page view with referrer, country and device class. No
 * cookies, no identifiers, and nothing a visitor types or photographs.
 */

/** Set in a browser that should not be counted. Per device, per browser. */
export const OPT_OUT_KEY = 'fuelsms.dontcountme';

/** Opening the page with this in the URL stops counting this browser for good. */
export const OPT_OUT_PARAM = 'notme';

const SNIPPET = `(function(){
  try {
    var q = new URLSearchParams(location.search);
    if (q.has('${OPT_OUT_PARAM}')) {
      localStorage.setItem('${OPT_OUT_KEY}', '1');
      history.replaceState({}, '', location.pathname);
    }
    if (localStorage.getItem('${OPT_OUT_KEY}') === '1') return;
  } catch (e) {}
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  var s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
})();`;

export default function Analytics() {
  return <script dangerouslySetInnerHTML={{ __html: SNIPPET }} />;
}
