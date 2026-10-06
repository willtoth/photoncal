# PhotonCal

Camera calibration for PhotonVision, running in your browser. PhotonCal uses mrcal to solve calibrations and OpenCV to detect boards. Images and calibration data stay on your device; the app needs no calibration server or connection to PhotonVision.

## Run

```sh
npm ci
npm run dev
```

Open **http://localhost:5173** in desktop Chrome or Edge. Node.js 22.12+ is recommended. The compiled engine is included in `public/engine`; Emscripten is only needed to rebuild it.

Camera access requires **localhost or HTTPS**. An ordinary HTTP LAN address will not work. Use a locally attached USB/built-in camera, close other camera applications, and grant camera permission. Firefox/Safari/mobile are not acceptance-tested camera platforms.

## Workflow

1. **Camera:** select a device and click **Check available settings**. This briefly opens the camera to test resolution/FPS combinations, then closes it. Choose a verified pair and click **Start preview**. Adjust any available camera controls while preview is running.
2. **Focus:** focus at your working distance with steady light and exposure. Click the preview or choose a center/corner region to compare sharpness scores. Secure the lens, fix zoom, and disable autofocus before continuing.
3. **Capture:** enter the measured board settings. Capture large, tilted views at different positions and distances, including the image edges and corners. Pause briefly at each view for automatic capture. **Handheld** steadiness allows small movements; **Strict** requires a steadier view. **Capture now** or Space saves manually. Use the coverage grid to find areas that need more views.
4. **Results:** calibrate, then inspect per-image errors, outliers, residuals, undistorted previews, and projection uncertainty. With at least 24 images, you can compare calibrations from two image subsets. Download the PhotonVision JSON and a ZIP session archive.

Calibration requires 12 usable images. Aim for about 100 varied views, then use coverage and diagnostics to decide whether to add more. The engine accepts up to 5,000 views within device memory and storage limits; tests cover up to 300 views.

### Camera and capture behavior

The settings check tests common resolution/FPS pairs, the browser’s default, and combinations from reported capability limits. Only configurations confirmed by the browser are offered. The check has progress and cancellation, releases the camera when finished, and does not save images. It cannot enumerate every native camera mode: browser capabilities describe separate ranges, not a table of supported combinations. Camera encoding (such as MJPEG or YUYV) is selected by the browser and cannot be chosen here. See the [browser capture specification](https://www.w3.org/TR/mediacapture-streams/#terminology).

Starting preview requests the selected resolution and FPS together and verifies the returned settings. Resizing is disabled where supported; the app reports when it cannot confirm unscaled capture. Changing the selection leaves the active stream unchanged until **Restart preview**. After images are captured, the session resolution is locked. Reconnecting uses the saved resolution and reported FPS; older sessions without an FPS value leave frame rate to the browser.

Brightness, contrast, exposure, focus, and other camera controls depend on the browser, OS, and driver. The settings check lists adjustable controls and identifies those unavailable in the browser. Start preview to adjust them. Changing a control retains the selected resolution/FPS constraints. The focus score compares full-resolution gradient sharpness, with recent history and a best score. It measures relative changes under a fixed scene and exposure, not MTF or an absolute quality threshold. Confirming focus requests manual focus mode when available.

Firefox and Firefox-based browsers such as Zen do not currently expose these image controls; [Mozilla’s implementation issue](https://bugzilla.mozilla.org/show_bug.cgi?id=888177) remains open. Video capture can still work without them. The app checks browser support separately from the camera’s reported controls. Try desktop Chrome or Edge for camera adjustments, though a camera or driver may still expose none.

Selecting manual exposure sends the current reported shutter value with the mode, which Chromium’s Windows camera backend requires to turn off auto exposure. Shutter adjustments also request manual mode. The app displays the returned camera settings and reports when a requested change was not applied.

Camera controls sit in a collapsible panel below each screen’s instructions and settings on Camera, Focus, Capture, and Results, including while calibration is running. The panel starts collapsed and keeps its open or closed state as you move between screens. Brightness, contrast, and exposure adjustments keep the focus confirmation and existing images. Capture waits while a setting is applied, then checks stillness again. Focus and zoom lock after the first capture; changing them before capturing requires confirming focus again.

Automatic capture requires a valid board detection, at least five analyzed frames, and a 250 ms steady window measured using the browser’s monotonic frame-callback clock. Live streams may report zero media timestamps, so those are not used to identify new frames or time the window. **Handheld** is the default: it allows up to 4 pixels of displacement and 12 pixels/second at 640px width, scaled with resolution. **Strict** retains the tighter 1.5-pixel and 2-pixel/second limits. Both check fitted corner speed and movement between analyzed frames, with a small allowance for detection noise so alternating shake cannot simply average to zero. Longer exposures tighten the speed limit to target at most 0.5 full-resolution pixels of travel during exposure. Manual shutter values use the browser’s [100-microsecond units](https://w3c.github.io/mediacapture-image/#exposure-time); with auto or unknown exposure, a frame period of at least 1/30 second is used as a fallback estimate. This is a motion heuristic, not a blur measurement; the browser does not report sensor readout time, and frame rate does not establish actual exposure.

After capture, a 100 ms cooldown and duplicate-view check prevent repeated saves of the same view. Slow analysis or movement can extend the wait. The exact qualifying frame is retained and checked again at full resolution. These checks cannot guarantee freedom from blur or rolling-shutter distortion. Shorter exposure reduces motion blur, but rolling-shutter cameras still need a steady view; see [mrcal’s capture guidance](https://mrcal.secretsauce.net/how-to-calibrate.html#rolling-shutter). Manual capture continues to bypass the motion gate while requiring a valid board detection.

### Targets and image imports

- ChArUco (including partial observations) and full chessboards are supported. Dimensions count **squares**, not internal corners. Default: 8×8 ChArUco, 25.4 mm squares, 19.05 mm markers, `DICT_4X4_1000`, modern pattern.
- Match dictionary, marker size and legacy-pattern setting to the actual printed board. Print target downloads a locally generated, physically sized HTML document; open it and print at **100% / actual size**, or use the browser's Save as PDF. Measure the result and enter actual sizes. Use sufficiently large paper and a flat, rigid backing.
- Use saved images from one camera, sensor mode, focus and zoom. Confirm the target settings before analysis. Mismatched dimensions and insufficient detections are reported and skipped.
- Do not refocus between close-up and distant board positions. Avoid severe defocus, glare, clipping, motion blur, and flexible targets. Moderate close-up softness is not automatically rejected: that would discard valuable close-range observations.

### Saving and recovery

Browser saving starts with the first accepted capture or imported image. Camera setup, focus checks, and target settings stay in memory until then. Empty sessions are omitted from the saved list; deleting a session’s last image removes its saved entry. Accepted full-resolution PNG images and metadata are saved to IndexedDB before a capture is marked accepted. Gallery thumbnails are generated lazily, with 12 per page. **Browse saved sessions** restores local work; reconnecting requires confirmation that the physical camera and optics have not changed.

**Save session** produces a ZIP containing `session.json` plus `images/<frame-id>.png`. It preserves original-resolution pixels, detected corner IDs, target settings, inclusion flags, coefficients, residuals, poses, outlier weights, and diagnostics. Import creates a new session atomically. Clearing browser/site storage deletes local sessions, so keep an archive. Browser quotas and private browsing can limit storage; quota failures stop capture without discarding previously saved work.

## PhotonVision compatibility

The export matches `CameraCalibrationCoefficients` in the sibling PhotonVision source inspected at commit `82f7f4c38cd6d2676cdbcb28762e1693c54e96e0`:

| Field                                | Meaning                                        |
| ------------------------------------ | ---------------------------------------------- |
| `resolution`                         | Exact, unrotated image width/height            |
| `cameraIntrinsics`                   | 3×3 `CV_64FC1` matrix: `fx,0,cx,0,fy,cy,0,0,1` |
| `distCoeffs`                         | 1×8 `CV_64FC1`: `k1,k2,p1,p2,k3,k4,k5,k6`      |
| `lensmodel`                          | `LENSMODEL_OPENCV`                             |
| `calobjectSize`                      | Internal-corner grid dimensions                |
| `calobjectSpacing`, `calobjectWarp`  | Meters                                         |
| `observations`, `optimizationInputs` | `[]`, `null`                                   |

The export omits PhotonVision snapshot paths and optimization state, so importing it restores calibration coefficients only. Use a PhotonCal archive to retain images and diagnostics. Import the JSON through PhotonVision's calibration UI for the same camera and resolution.

Changing image inclusion invalidates the result and disables export until recalibration. JSON schema/unit/order tests run with the unit suite. An additional offline check passed using the actual **2025 Jackson-based PhotonVision Java importer** in the existing sibling build. That older binary check is separate from the current source-schema review; no current PhotonVision server was launched.

## What the diagnostics mean

- Reprojection RMS uses the magnitude of each inlier's 2D residual; it is not mrcal's per-coordinate internal RMS. A small training error alone does not establish accuracy.
- The 60×40 uncertainty grid uses PhotonVision's port of mrcal's **mean-pcam, at-infinity projection uncertainty**, using observed inlier noise. It does not bound systematic error or establish accuracy at every working distance.
- Subset comparison independently solves alternating views, estimates their uncertainty, aligns their rays rotationally using uncertainty weights, and compares projections. Each subset must retain at least 80% of the full dataset's observed coverage. Both halves can still share systematic errors.
- The OpenCV8 rational lens model is used for PhotonVision compatibility. mrcal's splined models and mrgingham are **not** included. Difficult fisheye optics may need a more flexible model or different acquisition approach; inspect residual structure and uncertainty rather than relying on a green status.

## Build and test

```sh
npm test                  # Capture gating, camera errors, schema, archives
npm run build             # Typecheck + static production site in dist/
npx playwright install chromium
npm run test:e2e           # Real images + real WASM; simulated camera hardware
PHOTONCAL_PRODUCTION=1 npm run test:e2e  # Same checks against dist/ via static preview
```

Browser tests download 12 public PhotonVision test images if they are not available in the sibling checkout. They do not contact a running device. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium install.

To rebuild the numerical engines on Linux, install Git, CMake 3.25+, Ninja, Make, a C/C++ compiler, Perl, Python 3, and native BLAS/LAPACK/Fortran development support (for example `libblas-dev liblapack-dev gfortran`). Install and activate **Emscripten SDK 4.0.8** for the reference WASM build:

```sh
export EMSDK=/absolute/path/to/emsdk
npm run build:wasm        # Fetch pinned native sources and build local WASM
npm run build:native      # Build the same source for native numerical comparison
npm run test:engine -- --large
```

The script also recognizes `../emsdk`. Set `BUILD_JOBS=2` on memory-constrained machines. Native sources are cached in `.deps`, outputs in `.build`; the initial build can take several minutes. Engine rebuilds update `public/engine/manifest.json` with upstream revisions and the WASM hash. Neither `../photonvision`, `../mrcal`, nor `../mrcal-java` is modified.

The numerical suite checks detector patterns, deterministic synthetic ground truth, partial observations, outlier handling, native/WASM agreement, real PhotonVision corner fixtures, uncertainty, independent subsets, and a 300-view dataset. Observed here: synthetic RMS ≈0.16 px; 31-view real fixture RMS ≈0.63 px; 300-view solve + uncertainty ≈6 seconds / 120 MiB WASM heap. These are test-machine measurements, not performance promises.

Optional offline legacy importer check, with a built 2025 PhotonVision core JAR and JDK 17+:

```sh
PHOTONVISION_JAR=/path/to/photon-core.jar node scripts/test-photonvision.mjs /path/to/exported-1280px-calibration.json
```

This downloads only Java dependencies and deserializes the file; it never starts PhotonVision.

## Static hosting and licensing

The app is GPL-3.0-or-later; see [LICENSE](LICENSE) and [THIRD_PARTY.md](THIRD_PARTY.md). Because the browser downloads compiled GPL code, distribute corresponding source with a hosted release. Prepare the release with:

```sh
npm run build:source      # Bundle exact app + native sources and notices
npm run build
```

For a host that accepts large files, host the entire `dist/` directory, including `source/`, `engine/`, and notices. The app's footer links the source archive. The source archive is large and is only fetched when explicitly downloaded, not at startup. Regenerate it after source changes.

Use HTTPS, `.wasm` MIME type `application/wasm`, and serve JS module workers from the same origin. Relative asset paths support a static subdirectory deployment. No COOP/COEP or SharedArrayBuffer is required: workers own single-threaded WASM instances. Do not open `index.html` via `file://`. A static host serves assets only; calibration remains client-side. Initial asset loading needs connectivity; this is not an installed/offline-cached PWA.

### Cloudflare Pages with Wrangler

Install or update the global Wrangler CLI, then sign in to the intended Cloudflare account:

```sh
npm install -g wrangler@latest
wrangler login --scopes account:read user:read pages:write
wrangler whoami
wrangler pages project create photoncal --production-branch main  # first deployment only
npm run deploy
```

In WSL2, if browser approval succeeds but the `localhost:8976` callback fails or login times out, use [device login](https://developers.cloudflare.com/workers/wrangler/commands/general/#use-wrangler-login-without-a-local-callback-server) instead:

```sh
wrangler login --device --browser=false --scopes account:read user:read pages:write
wrangler whoami
```

Open the printed verification URL in your Windows browser and enter the displayed code while Wrangler is still running. Device login avoids the Windows-to-WSL localhost callback and replaces stale OAuth credentials after approval.

These commands request only the account, user, and Pages permissions needed here. `wrangler whoami` may warn about missing scopes for other Cloudflare services; verify that it reports a logged-in account and `pages (write)`.

If you have multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` to the intended account's ID before creating or deploying the project. Do not put credentials in the repository.

`npm run deploy` fetches any missing pinned native source trees into `.deps`, verifies the committed WASM manifest, regenerates corresponding source, builds the site, prepares `.build/cloudflare/`, and uploads it using `wrangler.toml`. It does not recompile WASM or require Emscripten. `npm run build:cloudflare` performs the same preparation without uploading. `npm run test:deploy` checks the packaging. Changes to native code require a local `npm run build:wasm` and committing the updated engine and manifest before publishing.

Pages has a [25 MiB per-asset limit](https://developers.cloudflare.com/pages/platform/limits/), so the deployment package splits the complete source archive into at most 20 MiB parts. The source link redirects to a same-origin download page that joins and checks SHA-256 hashes in the browser. Individual part links and manual reconstruction instructions also work without JavaScript. Nothing from the archive is omitted. The original unsplit archive remains in `public/source/` and `dist/source/`; only the staged Cloudflare copy uses parts. Source downloads are never loaded during calibration.

This is a [Direct Upload project](https://developers.cloudflare.com/pages/get-started/direct-upload/) deployed by GitHub Actions (below), not Pages' built-in Git integration. `npm run deploy` is also available for manual updates. Camera permissions and saved sessions are scoped to the deployed origin; use the stable production URL rather than changing preview URLs.

### Automatic deployment from GitHub

The **Check and deploy** workflow in `.github/workflows/test.yml` runs checks on pushes and pull requests. After all unit, packaging, engine-integrity and browser checks pass, a push to `main` in `willtoth/photoncal` publishes to **https://photoncal.pages.dev**. Pull requests and other branches never receive deployment credentials or publish. You can also use **Actions → Check and deploy → Run workflow**, selecting `main`.

One-time setup: create a [Cloudflare API token](https://dash.cloudflare.com/profile/api-tokens) with **Account → Cloudflare Pages → Edit**, limited to `will@redhawkrobotics.org`'s account. Add it as the repository Actions secret **`CLOUDFLARE_API_TOKEN`** in [GitHub settings](https://github.com/willtoth/photoncal/settings/secrets/actions). The public account ID is already configured in the workflow. Do not copy Wrangler's short-lived browser OAuth credentials into CI. A missing secret produces an explicit failed deployment job; after adding it, rerun the failed job or push another commit. Rotate the secret when the token expires or is revoked.

Deployments fetch/cache the pinned native sources, regenerate the full matching source download, then upload static assets with pinned Wrangler 4.147.0. Publication is serialized, and superseded main commits are skipped so an older queued run does not replace a newer build. A post-deployment check verifies the served WASM hash, source manifest, source redirect, and availability of every source part. No Cloudflare API token is exposed to the build steps, browser bundle, source archive, or pull-request jobs.

## Design references

- [PhotonVision calibration guide](https://docs.photonvision.org/en/latest/docs/calibration/calibration.html) and the sibling Java/C++ implementation shaped compatibility, target settings and coverage feedback.
- [mrcal source](https://github.com/dkogan/mrcal), [calibration guidance](https://mrcal.secretsauce.net/how-to-calibrate.html), and [cross-validation](https://mrcal.secretsauce.net/cross-validation.html) informed fixed optics, varied tilted close-ups, broad coverage, uncertainty and independent-subset diagnostics.
- [Edmund Optics: testing and targets](https://www.edmundoptics.com/knowledge-center/application-notes/imaging/testing-and-targets/) informed focus-target and center/edge inspection guidance.

The live focus score, stillness thresholds and coverage prompts are PhotonCal heuristics, not prescribed mrcal quality thresholds. Physical camera controls, lens focusing and final real-world pose accuracy still need a hardware acceptance check with your camera.

## Interface writing

Use these guidelines for UI copy and user documentation:

- Name the task or state directly: “Camera setup” and “Camera not connected.” Avoid slogans such as “A better view starts here.”
- Label buttons with their action. Keep names consistent across controls, messages, and instructions.
- Give each instruction once where it helps the next decision. Remove repeated headings, reassurance, and introductions.
- Keep technical terms that explain a result, such as reprojection RMS and uncertainty. Preserve units, requirements, and limitations that affect calibration decisions.
- State errors plainly and give a recovery action. Put implementation details in an optional disclosure or developer documentation.
- Use sentence case and restrained emphasis. Reserve color for actions, state, and diagnostic data; avoid decorative badges and repeated callouts.

For AI-assisted edits, supply these rules and a short example of the desired copy. Review the full screen for repetition and clarity instead of relying on a banned-word list.

Research reviewed on 2026-10-05:

- [OpenAI’s GPT-6 writing guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra#personality-and-writing-style) describes Astra’s tendency toward detailed formatting and recurring phrases, and recommends explicit style and structure instructions.
- [OpenAI’s guidance on Astra skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) recommends keeping instructions concise and relevant to the task.
- [NN/g on plain language for experts](https://www.nngroup.com/articles/plain-language-experts/) supports direct wording for technical audiences. Its [minimalist design guidance](https://www.nngroup.com/articles/aesthetic-minimalist-design/) explains how unnecessary interface content competes with useful information.
- [Kobak et al. on excess vocabulary in scientific writing](https://arxiv.org/abs/2406.07016) studies population-level shifts in word use associated with LLMs. Its scope is biomedical abstracts, not GPT-6 interface copy; the editorial rules above are a product choice, not an AI detector.
