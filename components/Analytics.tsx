'use client';

import { useEffect } from 'react';

/**
 * Vercel Web Analytics, added as the plain script tag rather than the npm
 * package. The package pulls a SvelteKit peer dependency that conflicts with
 * this project's vite, and on a static export it would buy nothing: there is
 * one page and no client routing to track.
 *
 * The script path is served by Vercel itself once Web Analytics is switched on
 * for the project. Anywhere else, including localhost, it 404s harmlessly.
 *
 * What it records: a page view with referrer, country and device class. No
 * cookies, no identifiers, and nothing a visitor types or photographs. The
 * privacy copy on the page says exactly this and must keep saying it.
 */

const SCRIPT_SRC = '/_vercel/insights/script.js';

/** Set in a browser that should not be counted. Per device, per browser. */
export const OPT_OUT_KEY = 'fuelsms.dontcountme';

/** Visiting the page with this in the URL stops counting this browser. */
const OPT_OUT_PARAM = 'notme';

function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    // Private mode or blocked storage. Counting one extra visit is a smaller
    // problem than throwing on page load, so carry on.
    return false;
  }
}

export default function Analytics() {
  useEffect(() => {
    // "Is anyone other than me using this?" only has an answer if your own
    // visits are excluded. Open the page once with ?notme on each device you
    // test from and it stops reporting from that browser for good.
    if (new URLSearchParams(window.location.search).has(OPT_OUT_PARAM)) {
      try {
        localStorage.setItem(OPT_OUT_KEY, '1');
      } catch {
        /* nothing to do: the flag simply will not stick */
      }
      // Drop the parameter so the URL is not passed around with it attached.
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (isOptedOut()) return;
    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;

    // The queue shim, so events fired before the script lands are not lost.
    const w = window as unknown as { va?: unknown; vaq?: unknown[] };
    if (!w.va) {
      w.va = function (...args: unknown[]) {
        (w.vaq = w.vaq || []).push(args);
      };
    }

    const script = document.createElement('script');
    script.defer = true;
    script.src = SCRIPT_SRC;
    document.head.appendChild(script);
  }, []);

  return null;
}
