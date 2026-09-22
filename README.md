# Sahi SMS

A one-page tool that builds the Pakistani petrol relief registration SMS correctly
the first time.

Registration is a single message to 9771 in a rigid format:

```
REG <13-digit CNIC> <plate> <province letter> <DDMMYYYY>
```

One wrong character fails, and repeated failures block the number for 24 hours. This
page validates every field, assembles the message, and hands it over ready to send.
It also covers the field nobody knows off the top of their head, the vehicle
registration date, either by reading it off a photo of the certificate or by pointing
the user at the free 8785 lookup.

Built as a free public utility, not a product.

## What it does not do

- No backend. `output: 'export'`, so the whole thing is static files.
- No account, no analytics, no storage of anything a user types.
- No CNIC scanning. The CNIC printed on a vehicle certificate belongs to the
  registered owner, who is frequently not the person registering a motorcycle, and a
  CNIC number is Sensitive Personal Data under Pakistan's data protection regime.
  The scanner reads the plate and the date, and nothing else.
- No scraping of provincial excise portals. Sindh's runs behind reCAPTCHA, a CSRF
  token and a honeypot field; we link out to it instead.

## Running it

```sh
npm install
npm run dev        # http://localhost:3000
npm run build      # static export into ./out
```

## Verifying it

```sh
npm test           # unit suite
npm run typecheck
```

The suite's anchor is a golden test: the message the builder produces for a known
set of inputs must match, byte for byte, a message that was actually sent to 9771
and accepted. If that test fails, the tool is shipping a broken format.

Two guarantees are asserted rather than assumed:

- `buildRegSms` throws rather than return a string that does not match
  `REG_SMS_PATTERN`, so a malformed message cannot reach a user.
- The scanner never surfaces anything but the plate and the date, proven against a
  full-page scan that includes the owner's NIC.

### Scanner accuracy

Measured, not asserted: **91.2% on both fields with 0 silently-wrong reads** for the
guided capture path, across 34 degraded variants of one real certificate. The whole-page
fallback manages 55.9%. The fixture set is one document so far, so treat those figures as
"this layout, these conditions" rather than as general accuracy.

`silently wrong` counts reads that were wrong *and* shown as high confidence. It is the
only failure that can cost someone a registration attempt, so it is the number to defend:
everything else is either refused outright or flagged amber for the user to check.

To measure your own, put certificate photos in `tests/fixtures/`,
each beside a JSON file naming what it should read:

```json
{ "plate": "CHK9513", "date": "15082026", "note": "Sindh Form G 2015, laminated" }
```

Then:

```sh
npm run augment                                    # ~34 degraded variants per photo
npm run bench tests/fixtures/generated             # whole-page fallback
npm run bench tests/fixtures/generated -- --strip  # guided capture
npm run bench tests/fixtures/generated -- --sweep  # search the tuning grid
```

`--sweep` searches resample width, Sauvola window and Sauvola k, and prints the best
setting found. Copy it into the matching preset in `lib/ocr/preprocess.ts` and re-run
without `--sweep` to confirm.

**The two capture paths have separate presets and they are not interchangeable.**
`TUNING_STRIP` suits a cropped line, `TUNING_PAGE` a whole certificate. Applying the
strip's constant to whole pages was measured at 2.9% against 55.9%. Sweep each path
against its own fixtures, and re-measure *both* after any tuning change.

**Fixture photos are real vehicle papers with real names, addresses and ID numbers
on them.** They are gitignored and must stay that way.

## How the scanner works

The target is one line, the top row of a Sindh Form G, which carries both fields:

```
REGN.No:  CHK-9513   DT : 15/08/2026
```

1. **Constrain the capture.** A guide box over the live camera, and the crop comes
   straight from it. This is the biggest single accuracy lever: it removes the rest
   of the page, forces the user close enough for real resolution, and keeps the
   framing roughly parallel.
2. **Fire the shutter automatically.** A full OCR pass costs over a second, far too
   slow for every frame, so a cheap gate (`lib/ocr/framecheck.ts`) measures edge
   sharpness, frame-to-frame motion and how much ink is in the box, and only then
   spends the engine. Two consecutive good frames are required, which stops it firing
   mid-swing. The guide box turns green at the moment it fires, so the user can see
   why. Manual capture and the file picker both stay.
3. **Pick a channel.** The security guilloche is green ink, so in the green channel
   it reads near-white while black print stays dark. Luma is scored too, and
   whichever separates ink from paper better for that photo wins.
4. **Flat-field.** Divide out a large-radius blur of the background, which removes
   lamination glare and the light gradient of a hand-held shot.
5. **Sauvola,** not Otsu. One global threshold cannot serve the guilloche, the fold
   shadow and the glare at once. Its `k` is per capture path, because glyph size
   after resampling differs enormously between a cropped line and a whole page.
6. **Strip ruling.** Horizontal ink runs longer than any glyph.
7. **Deskew** by projection profile, shearing columns vertically so pixels move
   between rows. Straight is the default and has to be beaten by a margin, so a
   low-texture strip is never sheared by the edge of the search range.
8. **Two tesseract passes**, always both: a single-line pass with a tight character
   whitelist, and a block pass that recovers layouts which do not put the plate and
   the date on one line.
9. **Repair by character class.** `0->O` inside a letter run, `O->0` inside a digit
   run, and so on. Where OCR kept the separator in `CHK-9513` the split is trusted;
   where it did not, the split is inferred and the field is flagged as a guess,
   because `CHK9513` and a misread `CH69513` are indistinguishable.
10. **Cross-check the passes.** Two independent segmentations landing on the same
   string is better evidence than any confidence threshold. Disagreement flags the
   field whatever the confidence, which is what keeps a plausible-but-wrong date
   like `15082029` from being presented as correct.
11. **Confirm.** The user sees the processed strip above two editable fields and has
    to accept them. The scan never sends anything by itself.

## Known limits

- The `sms:` body parameter is reliable on Android. On iOS it is not, and Apple's
  documentation says the URL should not carry message text, so the copy button is
  always present and is the primary control there.
- Excise links are only shown for provinces where a working URL was confirmed
  (Sindh, Punjab, KPK, Islamabad). Balochistan, AJK and GB get the 8785 route
  instead. Re-check those links before each deploy.
- Scanner tuning generalises to the certificate layouts in the fixture set, which is
  one Sindh Form G. Other provinces' books and newer cards are untested until photos
  of them are added.
- The scanner downloads its wasm engine and English training data from
  `cdn.jsdelivr.net` on first use, around 15 MB, and the page says so before the
  camera opens. That is a public CDN serving the OCR engine; your photo is not part
  of it, is never uploaded, and there is no server here to upload it to.
- Tesseract accepts `string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement`.
  **Not `ImageData`** — passing one fails inside the wasm core with "Image file /input
  cannot be read". The browser path paints into a canvas first.
