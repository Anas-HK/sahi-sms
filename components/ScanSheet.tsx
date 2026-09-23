'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCnicDisplay } from '../lib/format';
import { STRINGS, dirFor, type Lang } from '../lib/i18n';
import { gateFrame, toSmallGray, type GateResult } from '../lib/ocr/framecheck';
import { gradeConfidence, type Grade } from '../lib/ocr/parse';
import type { RgbaImage } from '../lib/ocr/preprocess';

export interface ScanFields {
  /** Normalised plate, or null when nothing readable was found. */
  plate: string | null;
  /** DD/MM/YYYY for the form, or null. */
  date: string | null;
  /**
   * Only ever set when the user ticked the box confirming the CNIC on the
   * certificate is theirs and their SIM is registered to it. Null otherwise,
   * including when one was read but not confirmed.
   */
  cnic: string | null;
}

/**
 * The guide rectangle, as fractions of the video's own frame. The overlay is
 * drawn over the exact rendered video rect so what the user lines up is what
 * gets cropped, and the crop is taken straight from these numbers.
 */
const GUIDE = { x: 0.04, y: 0.41, w: 0.92, h: 0.18 };
const CROP_PAD = 0.15;

/** How long to wait for the camera's first frame before offering the file picker. */
const FIRST_FRAME_TIMEOUT_MS = 6000;
/** How often the cheap frame gate runs while hunting for a readable line. */
const GATE_INTERVAL_MS = 220;
/** Consecutive good frames required before spending an OCR pass. */
const GOOD_FRAMES_TO_FIRE = 2;
/** Auto attempts before handing over to the manual button. */
const MAX_AUTO_ATTEMPTS = 4;
/** A scan that has not finished by now is stuck; never spin forever. */
const SCAN_TIMEOUT_MS = 45000;

type Phase = 'camera' | 'working' | 'result' | 'failed' | 'nocamera';

interface Readout {
  plate: { value: string; grade: Grade } | null;
  date: { value: string; grade: Grade } | null;
  /** The registered owner's number, offered but never applied on its own. */
  ownerNic: string | null;
  stripUrl: string | null;
}

function ddmmyyyyToSlashed(v: string): string {
  return `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
}

function rgbaToDataUrl(image: RgbaImage): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas.toDataURL('image/png');
}

/** Races a promise against a deadline so a wedged worker cannot hang the UI. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('scan timed out')), ms)),
  ]);
}

/**
 * One scanned field, always editable.
 *
 * Anything the engine is not sure about is shown amber rather than hidden or
 * silently accepted, because the user has the certificate in their hand and is
 * a far better judge of a doubtful glyph than any confidence score.
 */
function ScanField({
  id,
  label,
  grade,
  uncertainLabel,
  value,
  onChange,
  numeric,
}: {
  id: string;
  label: string;
  grade: Grade | null;
  uncertainLabel: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  const sure = grade === 'high';
  return (
    <div className="field" data-state={sure ? undefined : 'warn'} data-grade={grade ?? 'low'}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode={numeric ? 'numeric' : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {!sure && <p className="msg msg-warn">{uncertainLabel}</p>}
    </div>
  );
}

export default function ScanSheet({
  lang,
  onCancel,
  onAccept,
}: {
  lang: Lang;
  onCancel: () => void;
  onAccept: (fields: ScanFields) => void;
}) {
  const t = STRINGS[lang];
  const dir = dirFor(lang);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [readout, setReadout] = useState<Readout>({
    plate: null,
    date: null,
    ownerNic: null,
    stripUrl: null,
  });
  const [nicConfirmed, setNicConfirmed] = useState(false);
  const [plateEdit, setPlateEdit] = useState('');
  const [dateEdit, setDateEdit] = useState('');
  const [guideBox, setGuideBox] = useState<React.CSSProperties | null>(null);
  const [hint, setHint] = useState<GateResult['reason']>('empty');
  /** null while unknown, false when the camera has no controllable torch. */
  const [torchSupported, setTorchSupported] = useState<boolean | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [autoExhausted, setAutoExhausted] = useState(false);

  /** Whether the OCR module was ever loaded, so closing does not pull it in. */
  const engineLoaded = useRef(false);
  /** True while an OCR pass is in flight, so the gate does not stack them up. */
  const scanning = useRef(false);
  const goodFrames = useRef(0);
  const autoAttempts = useRef(0);
  const prevFrame = useRef<{ data: Uint8ClampedArray } | null>(null);

  /* ------------------------------------------------------------ camera */

  const stopCamera = useCallback(() => {
    // Stopping the track releases the torch too, so there is nothing to undo.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setTorchOn(false);
  }, []);

  /**
   * The torch lives on the video track, not on the camera as a whole, so it
   * can only be driven once a stream exists.
   *
   * `torch` is not in the standard MediaTrack typings and plenty of devices
   * and browsers do not expose it at all, iOS Safari included, so every step
   * is guarded and failure just means no torch button.
   */
  const setTorch = useCallback(async (on: boolean): Promise<boolean> => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return false;
    try {
      const caps = track.getCapabilities?.() as { torch?: boolean } | undefined;
      if (!caps?.torch) return false;
      await track.applyConstraints({
        advanced: [{ torch: on } as unknown as MediaTrackConstraintSet],
      });
      setTorchOn(on);
      return true;
    } catch {
      return false;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('nocamera');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setPhase('camera');

      // Light on by default. A laminated certificate under a ceiling light is
      // the common case and it reads far better lit. The button turns it off
      // for anyone holding the paper under glare, where the torch hurts.
      const lit = await setTorch(true);
      setTorchSupported(lit);
    } catch {
      setPhase('nocamera');
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      stopCamera();
      // Free the engine's memory when the sheet closes; cheap phones notice.
      // Only if a scan actually ran: importing the module here just to dispose
      // it would download the very chunk the lazy import exists to avoid.
      if (engineLoaded.current) {
        void import('../lib/ocr/recognize').then((m) => m.disposeWorker());
      }
    };
  }, [startCamera, stopCamera]);

  /**
   * object-fit: contain letterboxes the video inside its container, so the
   * guide has to be positioned over the rendered video rect rather than the
   * container. Otherwise the box the user aims with is not the region cropped.
   */
  const layoutGuide = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const box = video.getBoundingClientRect();
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const renderW = video.videoWidth * scale;
    const renderH = video.videoHeight * scale;
    const offsetX = (box.width - renderW) / 2;
    const offsetY = (box.height - renderH) / 2;
    setGuideBox({
      position: 'absolute',
      left: offsetX + GUIDE.x * renderW,
      top: offsetY + GUIDE.y * renderH,
      width: GUIDE.w * renderW,
      height: GUIDE.h * renderH,
    });
  }, []);

  /**
   * The guide is the only thing telling the user what to aim at, so it must
   * appear even if the video reports its dimensions late. loadedmetadata is
   * the usual signal, but it can fire before the element is laid out, and on
   * some Android browsers it does not fire at all until the first frame. Poll
   * until there are real dimensions, then stop.
   */
  useEffect(() => {
    if (phase !== 'camera') return;
    let frame = 0;
    const deadline = Date.now() + FIRST_FRAME_TIMEOUT_MS;
    const tick = () => {
      const video = videoRef.current;
      if (video?.videoWidth) {
        layoutGuide();
        return;
      }
      if (Date.now() > deadline) {
        // getUserMedia can resolve with a stream that never produces a frame.
        // Without this the user stares at a black rectangle and a Capture
        // button that does nothing, with no way to tell what went wrong.
        stopCamera();
        setPhase('nocamera');
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('resize', layoutGuide);
    window.addEventListener('orientationchange', layoutGuide);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', layoutGuide);
      window.removeEventListener('orientationchange', layoutGuide);
    };
  }, [layoutGuide, phase, stopCamera]);

  /* -------------------------------------------------------------- scan */

  /** Pulls the guide region out of the live video at full sensor resolution. */
  const grabGuideStrip = useCallback((): ImageData | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = Math.max(0, Math.round((GUIDE.x - CROP_PAD * GUIDE.w) * vw));
    const sy = Math.max(0, Math.round((GUIDE.y - CROP_PAD * GUIDE.h) * vh));
    const sw = Math.min(vw - sx, Math.round(GUIDE.w * (1 + 2 * CROP_PAD) * vw));
    const sh = Math.min(vh - sy, Math.round(GUIDE.h * (1 + 2 * CROP_PAD) * vh));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    return ctx.getImageData(0, 0, sw, sh);
  }, []);

  /**
   * Runs one OCR pass.
   *
   * `auto` attempts keep the camera alive and fail quietly, so a bad frame
   * just means the hunt continues. A manual capture commits: it shows
   * whatever came back, including failure.
   */
  const attemptScan = useCallback(
    async (image: RgbaImage, mode: 'strip' | 'page', auto: boolean): Promise<boolean> => {
      if (scanning.current) return false;
      scanning.current = true;
      if (!auto) setPhase('working');

      try {
        const { scanCertificate } = await import('../lib/ocr/recognize');
        engineLoaded.current = true;
        const result = await withTimeout(scanCertificate(image, { mode }), SCAN_TIMEOUT_MS);

        const plate = result.plate
          ? {
              value: result.plate.value,
              grade: gradeConfidence(result.plate.confidence, result.plate.uncertain),
            }
          : null;
        const date = result.date
          ? {
              value: ddmmyyyyToSlashed(result.date.value),
              grade: gradeConfidence(result.date.confidence, result.date.uncertain),
            }
          : null;

        // An auto attempt only commits when it got the whole job done. Half a
        // reading is not worth interrupting the user's aim for.
        if (auto && !(plate && date)) return false;

        if (!plate && !date) {
          setPhase('failed');
          return false;
        }

        stopCamera();
        setPlateEdit(plate?.value ?? '');
        setDateEdit(date?.value ?? '');
        // Never carried over from a previous scan: confirming whose CNIC it is
        // has to be a fresh decision every time.
        setNicConfirmed(false);
        setReadout({
          plate,
          date,
          ownerNic: result.ownerNic?.value ?? null,
          stripUrl: rgbaToDataUrl(result.processed),
        });
        setPhase('result');
        return true;
      } catch {
        // A timeout, a failed engine download, a wasm error. Never leave the
        // spinner running: say so and offer the ways out.
        if (!auto) setPhase('failed');
        return false;
      } finally {
        scanning.current = false;
      }
    },
    [stopCamera],
  );

  /**
   * Auto-capture.
   *
   * A full OCR pass costs over a second, so it cannot run on every frame.
   * Instead a cheap gate looks for a sharp, still frame with something
   * ink-like in the box, and only then spends the engine. Two consecutive
   * good frames are required, which is what stops it firing mid-swing.
   */
  useEffect(() => {
    if (phase !== 'camera' || autoExhausted) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled || scanning.current) return;

      const strip = grabGuideStrip();
      if (!strip) return;

      const small = toSmallGray(strip);
      const gate = gateFrame(small, prevFrame.current);
      prevFrame.current = small;
      setHint(gate.reason);

      if (!gate.ready) {
        goodFrames.current = 0;
        return;
      }
      goodFrames.current += 1;
      if (goodFrames.current < GOOD_FRAMES_TO_FIRE) return;

      goodFrames.current = 0;
      autoAttempts.current += 1;
      const ok = await attemptScan(strip, 'strip', true);
      if (!ok && autoAttempts.current >= MAX_AUTO_ATTEMPTS && !cancelled) {
        // Stop burning battery on a document it cannot read. The manual
        // button and the file picker are both still there.
        setAutoExhausted(true);
      }
    }, GATE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, autoExhausted, grabGuideStrip, attemptScan]);

  const captureNow = useCallback(async () => {
    const strip = grabGuideStrip();
    if (!strip) return;
    await attemptScan(strip, 'strip', false);
  }, [attemptScan, grabGuideStrip]);

  /** Fallback path: a photo from the gallery or the system camera app. */
  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        // A picked file is the whole certificate, not a framed line.
        await attemptScan(ctx.getImageData(0, 0, canvas.width, canvas.height), 'page', false);
      } catch {
        setPhase('failed');
      }
    },
    [attemptScan],
  );

  const retake = useCallback(() => {
    setReadout({ plate: null, date: null, ownerNic: null, stripUrl: null });
    setNicConfirmed(false);
    goodFrames.current = 0;
    autoAttempts.current = 0;
    prevFrame.current = null;
    setAutoExhausted(false);
    void startCamera();
  }, [startCamera]);

  /* -------------------------------------------------------------- view */

  const hintText = autoExhausted
    ? t.scanAutoGaveUp
    : hint === 'empty'
      ? t.scanHintEmpty
      : hint === 'blurry'
        ? t.scanHintBlurry
        : hint === 'moving'
          ? t.scanHintMoving
          : t.scanHintReady;

  return (
    <div className="sheet" dir={dir} role="dialog" aria-modal="true" aria-label={t.scanTitle}>
      <div className="sheet-body">
        {phase === 'camera' && (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              onLoadedMetadata={layoutGuide}
              onPlaying={layoutGuide}
              onResize={layoutGuide}
              aria-label={t.scanTitle}
            />
            {guideBox && (
              <div
                className="guide"
                style={guideBox}
                data-ready={hint === 'ok' ? 'true' : undefined}
              />
            )}
          </>
        )}

        {phase === 'working' && (
          <div style={{ color: '#fff', display: 'grid', justifyItems: 'center', gap: '1rem' }}>
            <div className="spinner" />
            <p>{t.scanWorking}</p>
          </div>
        )}

        {(phase === 'result' || phase === 'failed' || phase === 'nocamera') && (
          <div
            style={{
              background: 'var(--paper)',
              color: 'var(--ink)',
              width: '100%',
              height: '100%',
              overflowY: 'auto',
              padding: '1rem',
            }}
          >
            {phase === 'result' && (
              <>
                <h2 style={{ marginTop: 0 }}>{t.scanFoundTitle}</h2>
                <p className="help">{t.scanCompare}</p>
                {readout.stripUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img className="strip" src={readout.stripUrl} alt={t.scanCompare} />
                )}

                <div className="readout">
                  <ScanField
                    id="scan-plate"
                    label={t.plateLabel}
                    grade={readout.plate?.grade ?? null}
                    uncertainLabel={t.scanUncertain}
                    value={plateEdit}
                    onChange={(v) => setPlateEdit(v.toUpperCase())}
                  />
                  <ScanField
                    id="scan-date"
                    label={t.dateLabel}
                    grade={readout.date?.grade ?? null}
                    uncertainLabel={t.scanUncertain}
                    value={dateEdit}
                    onChange={setDateEdit}
                    numeric
                  />
                </div>

                {readout.ownerNic && (
                  <div className="nic-offer">
                    <span className="label-as-text">{t.scanNicFound}</span>
                    <p className="nic-value">{formatCnicDisplay(readout.ownerNic)}</p>
                    <p className="msg msg-warn">{t.scanNicWarning}</p>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={nicConfirmed}
                        onChange={(e) => setNicConfirmed(e.target.checked)}
                      />
                      <span>{t.scanNicUse}</span>
                    </label>
                    {!nicConfirmed && <p className="help">{t.scanNicTypeInstead}</p>}
                  </div>
                )}

                <p className="help">{t.scanNeverCnic}</p>
              </>
            )}

            {phase === 'failed' && (
              <>
                <h2 style={{ marginTop: 0 }}>{t.scanFailedTitle}</h2>
                <p>{t.scanFailedBody}</p>
              </>
            )}

            {phase === 'nocamera' && (
              <>
                <h2 style={{ marginTop: 0 }}>{t.scanNoCamera}</h2>
                <p>{t.scanInstruction}</p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="sheet-bar">
        {phase === 'camera' && (
          <>
            <p className="livehint" data-ready={hint === 'ok' ? 'true' : undefined}>
              {hintText}
            </p>
            <button type="button" className="btn btn-primary" onClick={captureNow}>
              {t.scanCapture}
            </button>
            {torchSupported && (
              <button
                type="button"
                className="btn btn-quiet"
                aria-pressed={torchOn}
                onClick={() => void setTorch(!torchOn)}
              >
                {torchOn ? t.torchOff : t.torchOn}
              </button>
            )}
            <p className="fineprint">{t.scanDownload}</p>
          </>
        )}

        {phase === 'result' && (
          <div className="btnrow">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                onAccept({
                  plate: plateEdit.trim() || null,
                  date: dateEdit.trim() || null,
                  // Only when explicitly confirmed. An unticked box means the
                  // user types their own CNIC on the form.
                  cnic: nicConfirmed ? readout.ownerNic : null,
                })
              }
            >
              {t.scanUse}
            </button>
            <button type="button" className="btn btn-quiet" onClick={retake}>
              {t.scanRetake}
            </button>
          </div>
        )}

        {(phase === 'failed' || phase === 'nocamera') && (
          <>
            <label className="btn btn-quiet">
              {t.scanChooseFile}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            {phase === 'failed' && (
              <button type="button" className="btn btn-quiet" onClick={retake}>
                {t.scanRetake}
              </button>
            )}
          </>
        )}

        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          {t.scanCancel}
        </button>
      </div>
    </div>
  );
}
