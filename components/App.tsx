'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SHORTCODE_SCHEME,
  SHORTCODE_VEHICLE,
  buildRegSms,
  buildTokSms,
  formatCnicDisplay,
  normalizeCnic,
  normalizePlate,
  smsHref,
  type ProvinceCode,
} from '../lib/format';
import { STRINGS, dirFor, type Lang } from '../lib/i18n';
import { PROVINCES, findProvince } from '../lib/provinces';
import { EMPTY_FORM, validateForm, type FieldIssue, type FormState } from '../lib/validate';
import CopyButton from './CopyButton';
import ScanSheet, { type ScanFields } from './ScanSheet';

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [scanOpen, setScanOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [smsDidNotOpen, setSmsDidNotOpen] = useState(false);

  const t = STRINGS[lang];
  const dir = dirFor(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyScan = useCallback((fields: ScanFields) => {
    setForm((prev) => ({
      ...prev,
      plate: fields.plate ?? prev.plate,
      date: fields.date ?? prev.date,
    }));
    setScanOpen(false);
  }, []);

  /**
   * The sms: scheme is not universally honoured. Android handles it, iOS is
   * unreliable with a prefilled body, and in-app browsers (WhatsApp, Facebook)
   * can swallow it entirely, which matters here because that is how most
   * people will arrive at the page.
   *
   * There is no way to ask the browser whether it worked, so watch for the
   * page losing visibility, which is what happens when the messaging app
   * actually comes to the front. Still here a moment later means it did not.
   */
  const watchForHandoff = useCallback(() => {
    setSmsDidNotOpen(false);
    let settled = false;
    const onHidden = () => {
      if (document.visibilityState === 'hidden') settled = true;
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('blur', onHidden);
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('blur', onHidden);
      if (!settled && document.visibilityState === 'visible') setSmsDidNotOpen(true);
    }, 1500);
  }, []);

  const validation = useMemo(() => validateForm(form), [form]);

  const message = useMemo(() => {
    if (!validation.canSend || !form.province) return null;
    try {
      return buildRegSms({
        cnic: form.cnic,
        plate: form.plate,
        province: form.province as ProvinceCode,
        date: form.date,
      });
    } catch {
      // validateForm should make this unreachable. Never hand over a message
      // we could not assert the shape of.
      return null;
    }
  }, [form, validation.canSend]);

  const err = (issue: FieldIssue | null) => (issue ? t.errors[issue.code] ?? issue.code : null);

  /**
   * An untouched field is not a wrong field. Errors stay hidden until the user
   * has put something in the box, or has reached for the send button and needs
   * to be told what is missing.
   */
  const shown = (issue: FieldIssue | null, value: string) =>
    issue && (showErrors || value.trim().length > 0) ? issue : null;
  const state = (issue: FieldIssue | null) => (issue ? issue.severity : undefined);

  const province = findProvince(form.province);

  return (
    <div className="page" dir={dir}>
      <header className="masthead">
        <div>
          <h1>{t.appName}</h1>
          <p>{t.tagline}</p>
        </div>
        <div className="langtoggle" role="group" aria-label="Language">
          <button type="button" aria-pressed={lang === 'ur'} onClick={() => setLang('ur')}>
            اردو
          </button>
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
            English
          </button>
        </div>
      </header>

      <div className="note note-warn">
        <strong>{t.notOfficialTitle}</strong>
        {t.notOfficial}
      </div>

      {/* --------------------------------------------------- scan first */}

      <section className="card card-hero" aria-labelledby="h-scan">
        <h2 id="h-scan">{t.scanCtaTitle}</h2>
        <p>{t.scanCtaBody}</p>
        <button type="button" className="btn btn-primary" onClick={() => setScanOpen(true)}>
          {t.scanButton}
        </button>
        <p className="or-type">{t.scanOrType}</p>
      </section>

      {/* ------------------------------------------------------ details */}

      <section className="card" aria-labelledby="h-details">
        <h2 id="h-details">{t.stepDetails}</h2>

        <div className="field" data-state={state(shown(validation.fields.cnic, form.cnic))}>
          <label htmlFor="cnic">{t.cnicLabel}</label>
          <p className="help">{t.cnicHelp}</p>
          <input
            id="cnic"
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            placeholder="35202-1234567-1"
            maxLength={15}
            value={formatCnicDisplay(form.cnic)}
            onChange={(e) => set('cnic', normalizeCnic(e.target.value).slice(0, 13))}
            aria-describedby={shown(validation.fields.cnic, form.cnic) ? 'cnic-msg' : undefined}
          />
          {shown(validation.fields.cnic, form.cnic) && (
            <p className="msg msg-error" id="cnic-msg">
              {err(validation.fields.cnic)}
            </p>
          )}
        </div>

        <div className="field" data-state={state(shown(validation.fields.plate, form.plate))}>
          <label htmlFor="plate">{t.plateLabel}</label>
          <input
            id="plate"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="CHK-9513"
            maxLength={12}
            value={form.plate}
            onChange={(e) => set('plate', normalizePlate(e.target.value).slice(0, 10))}
          />
          {shown(validation.fields.plate, form.plate) && (
            <p className="msg msg-error">{err(validation.fields.plate)}</p>
          )}
        </div>

        <div className="field" data-state={state(shown(validation.fields.date, form.date))}>
          <label htmlFor="date">{t.dateLabel}</label>
          <input
            id="date"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="01/01/2020"
            maxLength={10}
            value={form.date}
            onChange={(e) => set('date', e.target.value)}
          />
          {shown(validation.fields.date, form.date) && (
            <p
              className={
                shown(validation.fields.date, form.date)?.severity === 'warn'
                  ? 'msg msg-warn'
                  : 'msg msg-error'
              }
            >
              {err(validation.fields.date)}
            </p>
          )}

          {/* Useful to the minority who cannot find it, out of the way for everyone else. */}
          <details className="aside">
            <summary>{t.dateHelpTitle}</summary>
            <p>{t.dateHelpSms}</p>
            <a
              className="btn btn-quiet"
              href={smsHref(SHORTCODE_VEHICLE, normalizePlate(form.plate))}
              aria-disabled={!form.plate ? 'true' : undefined}
              onClick={(e) => {
                if (!form.plate) e.preventDefault();
              }}
            >
              {t.dateHelpSmsButton}
            </a>
            {province?.verifyUrl && (
              <a
                className="btn btn-quiet"
                href={province.verifyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.dateHelpExciseLink}
              </a>
            )}
          </details>
        </div>

        {/*
          The province letter is part of the format the government published,
          and part of the only message confirmed to have registered, so it
          cannot be dropped. It can be one tap instead of a labelled form field.
        */}
        <div className="field" data-state={state(shown(validation.fields.province, form.province))}>
          <span className="label-as-text" id="province-label">
            {t.provinceLabel}
          </span>
          <div className="chips" role="group" aria-labelledby="province-label">
            {PROVINCES.map((p) => (
              <button
                key={p.code}
                type="button"
                className="chip"
                aria-pressed={form.province === p.code}
                onClick={() => set('province', p.code)}
              >
                {lang === 'ur' ? p.ur : p.enShort}
              </button>
            ))}
          </div>
          {shown(validation.fields.province, form.province) && (
            <p className="msg msg-error">{err(validation.fields.province)}</p>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------- send */}

      <section className="card" aria-labelledby="h-send">
        <h2 id="h-send">{t.previewTitle}</h2>

        {message ? (
          <>
            <p className="preview">{message}</p>
            <p className="sendto">{t.sendTo}</p>
          </>
        ) : (
          <p className="preview preview-empty">{t.previewIncomplete}</p>
        )}

        {showErrors && !validation.canSend && (
          <div className="note note-danger">
            <strong>{t.missingTitle}</strong>
            <ul style={{ margin: '0.3rem 0 0', paddingInlineStart: '1.2rem' }}>
              {Object.values(validation.fields)
                .filter((i): i is FieldIssue => i !== null && i.severity === 'error')
                .map((issue) => (
                  <li key={issue.code}>{err(issue)}</li>
                ))}
            </ul>
          </div>
        )}

        <a
          className="btn btn-primary"
          href={message ? smsHref(SHORTCODE_SCHEME, message) : undefined}
          aria-disabled={!message ? 'true' : undefined}
          onClick={(e) => {
            if (!message) {
              e.preventDefault();
              setShowErrors(true);
              return;
            }
            watchForHandoff();
          }}
        >
          {t.openSms}
        </a>
        <CopyButton text={message} label={t.copy} copiedLabel={t.copied} disabled={!message} />

        {smsDidNotOpen && (
          <p className="msg msg-warn" role="status" style={{ marginTop: '0.6rem' }}>
            {t.smsDidNotOpen}
          </p>
        )}

        <p className="help" style={{ marginTop: '1rem' }}>
          {t.ifItFails}
        </p>
      </section>

      {/* ----------------------------------------------------------- tok */}

      <section className="card" aria-labelledby="h-tok">
        <h2 id="h-tok">{t.tokTitle}</h2>
        <p>{t.tokBody}</p>
        <a className="btn btn-quiet" href={smsHref(SHORTCODE_SCHEME, buildTokSms())}>
          {t.tokButton}
        </a>
      </section>

      <div className="note note-quiet">{t.privacy}</div>

      <footer>{t.footer}</footer>

      {scanOpen && (
        <ScanSheet lang={lang} onCancel={() => setScanOpen(false)} onAccept={applyScan} />
      )}
    </div>
  );
}
