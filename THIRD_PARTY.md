# Third-party code and source distribution

PhotonCal's own code is GPL-3.0-or-later, without warranty. Copyright remains with the respective contributors. See `LICENSE`. Original upstream notices are retained in fetched sources and collected in `public/THIRD_PARTY_NOTICES.txt` by `scripts/notices.mjs`.

| Component                                     | Reference                                               | License                                                                       |
| --------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| PhotonVision mrcal-java wrapper + uncertainty | `dc31176f670a216e44b5e47600e6b8dc9afd91dc`              | GPL-3.0-or-later, Photon Vision                                               |
| mrcal                                         | `c311b0acdb29d3f6c1a5abeaf17dc6a7e2ab10d9`              | Apache-2.0; embedded OpenCV portions retain their BSD notices                 |
| libdogleg                                     | `1f88d01148fd1677b24b4deb0d1d6a13efeb9b1e`              | GNU LGPL                                                                      |
| OpenCV                                        | 4.13.0                                                  | Apache-2.0; embedded third-party notices apply                                |
| SuiteSparse                                   | 7.11.0                                                  | CHOLMOD enabled modules: LGPL-2.1-or-later; AMD, COLAMD, config: BSD-3-Clause |
| OpenBLAS                                      | `2e8a9520aca83bc16d06ee0ca850acfcd9d365d1`              | BSD-3-Clause; bundled LAPACK: modified BSD                                    |
| Eigen                                         | 3.4.0                                                   | MPL-2.0 and file-specific permissive/LGPL licenses                            |
| nlohmann/json                                 | 3.11.3                                                  | MIT                                                                           |
| Vue, idb, fflate, Three.js                    | See package-lock.json                                   | MIT                                                                           |
| Lucide icons                                  | 0.468.0                                                 | ISC and MIT, as specified in its LICENSE                                      |
| PhotonVision real-image/corner fixtures       | PhotonVision `82f7f4c38cd6d2676cdbcb28762e1693c54e96e0` | PhotonVision GPL-3.0-or-later repository                                      |

Exact native commits are recorded in `scripts/native-sources.mjs` and the engine manifest. The static bundle uses only the required OpenCV modules and SuiteSparse components; GPU, IPP, OpenCL, OpenMP, and CHOLMOD supernodal/partition/GPL modules are disabled. Emscripten's runtime uses its own MIT/University of Illinois notices.

## Adaptations

The build creates modified copies in `.build`; it does not modify the PhotonVision checkout or the fetched wrapper files. `native/CMakeLists.txt` contains each adaptation:

1. Seed distortion deterministically, check finite solver status, and stop between stages if a solve fails.
2. Allocate the uncertainty Jacobian using mrcal's actual sparse nonzero count instead of a dense state-by-measurement upper bound. This avoids unnecessary multi-gigabyte allocations with many frames.
3. Replace hard-coded six-frame counts in uncertainty setup with actual frame counts.
4. Estimate observation noise from observed inlier residuals, excluding the zero placeholders for missing/rejected corners.
5. Include mrcal's internal declarations needed for the sparse allocation count.
6. Append `native/uncertainty-distance.inc` for finite-distance mean-pcam propagation, following the pinned mrcal Python implementation. This reuses the wrapper's sparse covariance calculation with full rotation/translation derivatives.

`native/lapack-abi.c` adapts libdogleg's Fortran packed-Cholesky ABI to OpenBLAS's translated C LAPACK entry points (hidden character-length parameter and integer return). It is needed for WASM indirect-call type safety. The native reference build uses system LAPACK; numerical tests compare both implementations.

The app-specific C++ bridge, worker transport, browser workflow, capture gating, session format, and export adapter are in this repository. There is no substitute/mock optimizer in the shipping code. Camera hardware is simulated only in browser tests.

## Releasing

Run `npm run build:source` after every source change and before `npm run build`. It creates a same-origin corresponding-source download containing this app, its build scripts, licenses, pinned native upstream trees, and the nlohmann header. Build caches, private browser data, test downloads, `.git` history and generated binaries are excluded. The archive is not fetched during calibration.

The normal compiler/SDK and OS toolchain must be installed separately as documented in README. JavaScript dependencies are pinned by the lockfile and their original notices are included. If modifying/distributing upstream dependencies or the built site, preserve their notices and provide the matching modified source. Do not publish a binary-only site without making its corresponding source available.
