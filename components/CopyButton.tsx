'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The copy button is the primary control on iOS and desktop, where a prefilled
 * sms: body is unreliable, so it has to work even without the async clipboard
 * API. The textarea fallback covers older Android WebViews.
 */
export default function CopyButton({
  text,
  label,
  copiedLabel,
  disabled,
}: {
  text: string | null;
  label: string;
  copiedLabel: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand('copy');
      } catch {
        return;
      } finally {
        document.body.removeChild(el);
      }
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button type="button" className="btn btn-quiet" onClick={copy} disabled={disabled}>
      {copied ? copiedLabel : label}
      <span aria-live="polite" className="visually-hidden">
        {copied ? copiedLabel : ''}
      </span>
    </button>
  );
}
