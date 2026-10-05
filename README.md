# PhotonCal

A private, browser-only calibration lab for PhotonVision. The actual **mrcal C/C++ solver** and OpenCV detector run in WebAssembly workers; there is no calibration server, image upload, telemetry, CDN dependency, or connection to a running PhotonVision instance.

## Run

```sh
npm ci
npm run dev
```

Open **http://localhost:5173** in desktop Chrome or Edge. Node.js 22.12+ is recommended. The compiled engine is included in `public/engine`; Emscripten is only needed to rebuild it.

Camera access requires **localhost or HTTPS**. An ordinary HTTP LAN address will not work. Use a locally attached USB/built-in camera, close other camera applications, and grant camera permission. Firefox/Safari/mobile are not acceptance-tested camera platforms.

## Workflow

1. **Camera:** choose the physical device and exact resolution. View its delivered settings and adjust only controls exposed by the browser/driver. Resizing is explicitly disabled when supported. Missing controls are identified; the app cannot bypass the browser to access arbitrary UVC controls.
2. **Focus:** focus at the intended working distance, under steady light and exposure. Click the preview or select center/corner regions to compare live full-resolution gradient sharpness, its recent history, and the best score seen. This is a relative adjustment aid, not MTF or a universal pass/fail score. Secure the lens, fix zoom, and disable autofocus before continuing. A manual focus mode is requested when available.
3. **Capture:** configure the measured board, then move it through large, tilted views across the image, including edges/corners. Enable automatic capture: it requires a valid detection, at least five distinct analyzed frames and 250 ms of stability, with a 100 ms post-capture cooldown and duplicate-view suppression. Both displacement and fitted corner speed are checked; the speed cap is 2 pixels/second at 640px width, scaled with resolution. Slow analysis or detected movement can extend the wait. These are motion heuristics, not a guarantee against exposure blur or rolling-shutter distortion. Full-resolution detection is repeated on the exact retained frame before saving. Manual capture/Space is also available. Captured-corner dots, a view-count coverage grid, and guidance show neglected regions.
4. **Results:** solve with mrcal OpenCV8, then inspect per-image errors/outliers, residual magnitude/direction, undistorted previews, and a projection-uncertainty map. With 24+ images, an optional independently fitted alternating-subset comparison is available. Download the PhotonVision JSON and a separate ZIP session archive.

Twelve usable views unlock a solve; this is a minimum, not a quality guarantee. Aim for roughly **100 useful, varied views** and use diagnostics to decide when there is sufficient data. The engine accepts up to 5,000 views subject to device memory/storage; the tested large case is 300 views, not a guarantee for every camera or device.

### Targets and image imports

- ChArUco (including partial observations) and full chessboards are supported. Dimensions count **squares**, not internal corners. Default: 8×8 ChArUco, 25.4 mm squares, 19.05 mm markers, `DICT_4X4_1000`, modern pattern.
- Match dictionary, marker size and legacy-pattern setting to the actual printed board. Print target downloads a locally generated, physically sized HTML document; open it and print at **100% / actual size**, or use the browser's Save as PDF. Measure the result and enter actual sizes. Use sufficiently large paper and a flat, rigid backing.
- Use saved images from one camera, sensor mode, focus and zoom. Confirm the target settings before analysis. Mismatched dimensions and insufficient detections are reported and skipped. No images are sent anywhere.
- Do not refocus between close-up and distant board positions. Avoid severe defocus, glare, clipping, motion blur, and flexible targets. Moderate close-up softness is not automatically rejected: that would discard valuable close-range observations.

### Saving and recovery

Accepted full-resolution PNG images and metadata are saved to IndexedDB before a capture is marked accepted. Gallery thumbnails are generated lazily, with 12 per page. **Browse saved sessions** restores local work; reconnecting requires confirmation that the physical camera and optics have not changed.

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

The last two fields intentionally omit PhotonVision server-local snapshot paths and optimization state. This is a **portable coefficient import**, not a restoration of PhotonVision's calibration gallery/uncertainty UI. The separate PhotonCal archive retains the richer data. Import the JSON into PhotonVision's calibration UI for the same camera and exact mode. Nothing here writes to PhotonVision itself.

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

Host the entire `dist/` directory, including `source/`, `engine/`, and notices. The app's footer links the source archive. The source archive is large and is only fetched when explicitly downloaded, not at startup. Regenerate it after source changes. No hosting/deployment has been performed.

Use HTTPS, `.wasm` MIME type `application/wasm`, and serve JS module workers from the same origin. Relative asset paths support a static subdirectory deployment. No COOP/COEP or SharedArrayBuffer is required: workers own single-threaded WASM instances. Do not open `index.html` via `file://`. A static host serves assets only; calibration remains client-side. Initial asset loading needs connectivity; this is not an installed/offline-cached PWA.

## Design references

- [PhotonVision calibration guide](https://docs.photonvision.org/en/latest/docs/calibration/calibration.html) and the sibling Java/C++ implementation shaped compatibility, target settings and coverage feedback.
- [mrcal source](https://github.com/dkogan/mrcal), [calibration guidance](https://mrcal.secretsauce.net/how-to-calibrate.html), and [cross-validation](https://mrcal.secretsauce.net/cross-validation.html) informed fixed optics, varied tilted close-ups, broad coverage, uncertainty and independent-subset diagnostics.
- [Edmund Optics: testing and targets](https://www.edmundoptics.com/knowledge-center/application-notes/imaging/testing-and-targets/) informed focus-target and center/edge inspection guidance.

The live focus score, stillness thresholds and coverage prompts are PhotonCal heuristics, not prescribed mrcal quality thresholds. Physical camera controls, lens focusing and final real-world pose accuracy still need a hardware acceptance check with your camera.
