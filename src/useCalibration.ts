import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Camera, type Control } from './core/camera';
import { EngineClient } from './core/engine';
import { AutoCapture, coverage, coveragePrompt } from './core/capture';
import {
  newSession,
  currentResult,
  solveRequest,
  type Session,
  type Analysis,
  type Region,
  type CalibrationResult,
  type Grid,
} from './core/types';
import * as storage from './core/storage';
import { download, filename, photonVisionCalibration } from './core/export';

export function useCalibration() {
  const session = ref<Session>(newSession()),
    step = ref(0),
    video = ref<HTMLVideoElement>(),
    magnifier = ref<HTMLCanvasElement>();
  const sessions = ref<Session[]>([]),
    devices = ref<MediaDeviceInfo[]>([]),
    deviceId = ref('');
  const connected = ref(false),
    connecting = ref(false),
    controls = ref<Control[]>([]),
    settings = ref<Record<string, any>>({});
  const engineState = ref<'loading' | 'ready' | 'error'>('loading'),
    engineError = ref('');
  const error = ref(''),
    notice = ref(''),
    working = ref(false),
    progress = ref(''),
    auto = ref(false),
    captureProgress = ref(0),
    captureReason = ref('Connect a camera to begin');
  const analysis = ref<Analysis>(),
    roi = ref<Region>({ x: 0.35, y: 0.35, w: 0.3, h: 0.3 }),
    focusHistory = ref<number[]>([]),
    bestFocus = ref(0);
  const pendingImports = ref<File[]>([]),
    importErrors = ref<string[]>([]),
    importAgreement = ref(false),
    archiveProgress = ref<number>();
  const captureFlash = ref(false),
    activeFrame = ref<string>(),
    showCoverage = ref(true),
    showDots = ref(true);
  const camera = new Camera(),
    vision = new EngineClient(),
    solver = new EngineClient(),
    gate = new AutoCapture();
  let loopId = 0,
    loopGeneration = 0,
    operationGeneration = 0,
    manual = false,
    disposed = false;
  const included = computed(() => session.value.frames.filter((f) => f.included));
  const result = computed(() => currentResult(session.value));
  const coverageData = computed(() =>
    coverage(session.value.frames, session.value.width, session.value.height),
  );
  const guidance = computed(() =>
    coveragePrompt(session.value.frames, session.value.width, session.value.height),
  );
  const focusScore = computed(() => analysis.value?.sharpness ?? 0);
  const canSolve = computed(
    () => included.value.length >= 12 && !working.value && engineState.value === 'ready',
  );
  function message(e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  }
  function resetFocus() {
    bestFocus.value = 0;
    focusHistory.value = [];
    session.value.focusConfirmed = false;
  }
  async function persist() {
    try {
      await storage.saveSession(session.value);
      await refreshSessions();
    } catch (e) {
      message(e);
    }
  }
  async function refreshSessions() {
    sessions.value = await storage.listSessions();
  }
  async function loadEngine() {
    engineState.value = 'loading';
    engineError.value = '';
    try {
      await vision.call('load');
      engineState.value = 'ready';
    } catch (e) {
      engineState.value = 'error';
      engineError.value = (e as Error).message;
      vision.cancel();
    }
  }
  async function enumerate() {
    if (navigator.mediaDevices)
      devices.value = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'videoinput',
      );
  }
  function stopCamera() {
    loopGeneration++;
    video.value?.cancelVideoFrameCallback?.(loopId);
    camera.stop();
    connected.value = false;
    auto.value = false;
    gate.reset();
    if (video.value) video.value.srcObject = null;
  }
  async function connect() {
    if (working.value || connecting.value) return;
    error.value = '';
    connecting.value = true;
    try {
      if (session.value.frames.length && session.value.source === 'import')
        throw new Error('Start a new calibration to switch from imported images to a live camera.');
      if (
        session.value.frames.length &&
        !window.confirm(
          'Reconnect the same physical camera at the same focus and zoom used for this session? Changing those settings requires a new calibration.',
        )
      )
        return;
      stopCamera();
      const stream = await camera.connect(
        deviceId.value,
        session.value.width,
        session.value.height,
      );
      if (session.value.frames.length) {
        // A reopened track can reset its lens controls. Restore fixed optics
        // before accepting another image from an existing calibration session.
        for (const key of ['focusMode', 'focusDistance', 'zoom']) {
          const value = session.value.settings[key];
          if (
            camera.capabilities[key] !== undefined &&
            (typeof value === 'number' || typeof value === 'string')
          )
            await camera.set(key, value);
        }
      } else resetFocus();
      connected.value = true;
      settings.value = { ...camera.settings };
      controls.value = camera.controls();
      session.value.cameraLabel = stream.getVideoTracks()[0]!.label;
      session.value.name = session.value.cameraLabel || 'Camera calibration';
      session.value.settings = { ...camera.settings };
      session.value.source = 'camera';
      await enumerate();
      deviceId.value = camera.settings.deviceId ?? deviceId.value;
      if (video.value) {
        video.value.srcObject = stream;
        await video.value.play();
      }
      await persist();
      startLoop();
    } catch (e) {
      stopCamera();
      message(e);
    } finally {
      connecting.value = false;
    }
  }
  async function changeControl(key: string, value: string | number) {
    error.value = '';
    try {
      if (session.value.frames.length && ['zoom', 'focusDistance', 'focusMode'].includes(key))
        throw new Error('Start a new calibration before changing focus or zoom.');
      await camera.set(key, value);
      settings.value = { ...camera.settings };
      session.value.settings = { ...camera.settings };
      resetFocus();
      await persist();
    } catch (e) {
      settings.value = { ...camera.settings };
      message(e);
    }
  }
  function startLoop() {
    const generation = ++loopGeneration;
    const schedule = () => {
      if (disposed || generation !== loopGeneration || !connected.value || !video.value) return;
      loopId = video.value.requestVideoFrameCallback((time, metadata) => void tick(time, metadata));
    };
    const tick = async (now: number, metadata: VideoFrameCallbackMetadata) => {
      if (disposed || generation !== loopGeneration || !video.value) return;
      try {
        if (engineState.value !== 'ready' || working.value || step.value === 3) {
          schedule();
          return;
        }
        if (metadata.width !== session.value.width || metadata.height !== session.value.height) {
          stopCamera();
          throw new Error('The camera changed resolution. Reconnect before capturing more images.');
        }
        const bitmap = await createImageBitmap(video.value);
        const a = await vision.call<Analysis & { token: number }>(
          'analyze',
          {
            bitmap,
            board: { ...session.value.board },
            detect: step.value === 2,
            roi: { ...roi.value },
            fullResolution: step.value === 1,
          },
          [bitmap],
        );
        if (generation !== loopGeneration) return;
        analysis.value = a;
        if (step.value === 1) {
          const previous = focusHistory.value.at(-1) ?? a.sharpness,
            smoothed = 0.3 * a.sharpness + 0.7 * previous;
          focusHistory.value = [...focusHistory.value.slice(-119), smoothed];
          bestFocus.value = Math.max(bestFocus.value, smoothed);
          const cv = magnifier.value,
            ctx = cv?.getContext('2d');
          if (cv && ctx) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(
              video.value,
              roi.value.x * session.value.width,
              roi.value.y * session.value.height,
              roi.value.w * session.value.width,
              roi.value.h * session.value.height,
              0,
              0,
              cv.width,
              cv.height,
            );
          }
        }
        if (step.value === 2) {
          const status = gate.update(a, now, session.value.width);
          captureReason.value = status.reason;
          captureProgress.value = auto.value ? status.progress : 0;
          if ((auto.value && status.capture) || manual) {
            manual = false;
            if (!a.valid) {
              notice.value = a.reason;
            } else {
              const shot = await vision.call<{ analysis: Analysis; blob: Blob }>('capture', {
                token: a.token,
                board: { ...session.value.board },
              });
              if (generation !== loopGeneration) return;
              await storage.addFrame(
                session.value,
                {
                  id: crypto.randomUUID(),
                  name: `Capture ${session.value.frames.length + 1}`,
                  capturedAt: Date.now(),
                  corners: shot.analysis.corners,
                  included: true,
                  source: 'camera',
                  sharpness: shot.analysis.sharpness,
                },
                shot.blob,
              );
              gate.captured(shot.analysis.corners, now);
              captureFlash.value = true;
              setTimeout(() => (captureFlash.value = false), 180);
              captureReason.value = 'Captured. Move to a new view.';
              await refreshSessions();
            }
          }
        }
      } catch (e) {
        auto.value = false;
        manual = false;
        message(e);
        gate.reset();
      }
      schedule();
    };
    schedule();
  }
  function capture() {
    if (!connected.value || step.value !== 2 || working.value) return;
    manual = true;
  }
  function setStep(value: number) {
    if (working.value) return;
    if (value === 1 && session.value.source === 'import') {
      notice.value =
        'Imported images must already be focused at fixed lens settings. Continue with Capture to analyze them.';
      return;
    }
    if (value === 1 && !connected.value && session.value.source !== 'import') {
      notice.value = 'Connect your camera before checking focus.';
      return;
    }
    if (
      value === 2 &&
      session.value.source === 'camera' &&
      !session.value.focusConfirmed &&
      !session.value.frames.length
    ) {
      notice.value = 'Finish the focus check first.';
      return;
    }
    if (value === 3 && !session.value.result) {
      notice.value = 'Capture at least 12 useful images, then run calibration.';
      return;
    }
    auto.value = false;
    manual = false;
    gate.reset();
    step.value = value;
    notice.value = '';
    analysis.value = undefined;
  }
  async function confirmFocus() {
    if (session.value.source === 'import') {
      step.value = 2;
      return;
    }
    try {
      if (
        camera.capabilities.focusMode?.includes('manual') &&
        camera.settings.focusMode !== 'manual'
      )
        await camera.set('focusMode', 'manual');
      settings.value = { ...camera.settings };
      session.value.settings = { ...camera.settings };
      session.value.focusConfirmed = true;
      await persist();
      step.value = 2;
      gate.reset();
    } catch (e) {
      message(e);
    }
  }
  function selectRegion(x: number, y: number) {
    roi.value = {
      x: Math.max(0, Math.min(0.7, x - 0.15)),
      y: Math.max(0, Math.min(0.7, y - 0.15)),
      w: 0.3,
      h: 0.3,
    };
    bestFocus.value = 0;
    focusHistory.value = [];
  }
  async function chooseImages(files: File[]) {
    if (!files.length) return;
    error.value = '';
    try {
      if (session.value.frames.length && session.value.source === 'camera')
        throw new Error('Start a new calibration to use an imported image set.');
      stopCamera();
      const bitmap = await createImageBitmap(files[0]!);
      if (
        session.value.frames.length &&
        (bitmap.width !== session.value.width || bitmap.height !== session.value.height)
      ) {
        bitmap.close();
        throw new Error('The images do not match this session’s resolution.');
      }
      if (bitmap.width * bitmap.height > 33554432) {
        bitmap.close();
        throw new Error('Images larger than 32 megapixels are not supported.');
      }
      session.value.width = bitmap.width;
      session.value.height = bitmap.height;
      bitmap.close();
      session.value.source = 'import';
      session.value.name = 'Imported camera images';
      session.value.cameraLabel = 'Imported camera';
      session.value.focusConfirmed = true;
      pendingImports.value = files;
      importAgreement.value = false;
      importErrors.value = [];
      step.value = 2;
      await persist();
    } catch (e) {
      message(e);
    }
  }
  async function importImages() {
    if (!importAgreement.value || !pendingImports.value.length) return;
    working.value = true;
    auto.value = false;
    error.value = '';
    importErrors.value = [];
    try {
      for (let i = 0; i < pendingImports.value.length; i++) {
        const file = pendingImports.value[i]!;
        progress.value = `Detecting image ${i + 1} of ${pendingImports.value.length}`;
        try {
          const bitmap = await createImageBitmap(file);
          if (bitmap.width !== session.value.width || bitmap.height !== session.value.height) {
            bitmap.close();
            throw new Error('Resolution differs from this session.');
          }
          const a = await vision.call<Analysis & { token: number }>(
            'analyze',
            { bitmap, board: { ...session.value.board }, detect: true, fullResolution: true },
            [bitmap],
          );
          if (!a.valid) throw new Error(a.reason);
          const shot = await vision.call<{ analysis: Analysis; blob: Blob }>('capture', {
            token: a.token,
            board: { ...session.value.board },
          });
          await storage.addFrame(
            session.value,
            {
              id: crypto.randomUUID(),
              name: file.name,
              capturedAt: Date.now(),
              corners: a.corners,
              included: true,
              source: 'import',
              sharpness: a.sharpness,
            },
            shot.blob,
          );
        } catch (e) {
          if ((e as DOMException).name === 'QuotaExceededError') throw e;
          importErrors.value.push(`${file.name}: ${(e as Error).message}`);
        }
      }
      pendingImports.value = [];
      await refreshSessions();
    } catch (e) {
      message(e);
    } finally {
      working.value = false;
      progress.value = '';
    }
  }
  async function calibrate() {
    if (!canSolve.value) return;
    working.value = true;
    auto.value = false;
    error.value = '';
    progress.value = 'Preparing the calibration…';
    const operation = ++operationGeneration;
    const revision = session.value.revision,
      request = solveRequest(session.value);
    solver.onProgress = (text) => (progress.value = text);
    try {
      const calibrated = await solver.call<CalibrationResult>('solve', request);
      if (operation !== operationGeneration) return;
      session.value.result = calibrated;
      session.value.resultRevision = revision;
      await persist();
      step.value = 3;
      progress.value = 'Estimating projection uncertainty…';
      try {
        calibrated.uncertainty = await solver.call<Grid>('uncertainty', {
          ...request,
          result: calibrated,
        });
      } catch (e) {
        calibrated.uncertaintyError = (e as Error).message;
      }
      if (operation !== operationGeneration) return;
      session.value.result = { ...calibrated };
      await persist();
    } catch (e) {
      if (operation === operationGeneration) message(e);
    } finally {
      if (operation === operationGeneration) {
        working.value = false;
        progress.value = '';
      }
    }
  }
  async function consistency() {
    if (!result.value || included.value.length < 24 || working.value) return;
    working.value = true;
    error.value = '';
    auto.value = false;
    const request = solveRequest(session.value);
    const operation = ++operationGeneration;
    try {
      const datasets = [
        { ...request, frames: request.frames.filter((_, i) => i % 2 === 0) },
        { ...request, frames: request.frames.filter((_, i) => i % 2 === 1) },
      ];
      const totalCoverage = coverage(included.value, request.width, request.height).percent;
      if (
        datasets.some(
          (d) =>
            coverage(
              d.frames.map((f) => ({ ...f, included: true })),
              request.width,
              request.height,
            ).percent <
            totalCoverage * 0.8,
        )
      )
        throw new Error(
          'One subset covers too little of the image. Capture another varied pass across the frame, then rerun the check.',
        );
      const results: CalibrationResult[] = [];
      for (let i = 0; i < 2; i++) {
        progress.value = `Solving independent subset ${i + 1} of 2…`;
        const r = await solver.call<CalibrationResult>('solve', datasets[i]);
        progress.value = `Estimating uncertainty for subset ${i + 1}…`;
        r.uncertainty = await solver.call<Grid>('uncertainty', { ...datasets[i], result: r });
        results.push(r);
        if (operation !== operationGeneration) return;
      }
      progress.value = 'Comparing independently fitted projections…';
      const comparison = await solver.call<Grid & { mean: number; p95: number }>('compare', {
        width: request.width,
        height: request.height,
        a: results[0],
        b: results[1],
        ua: results[0]!.uncertainty!.values,
        ub: results[1]!.uncertainty!.values,
      });
      if (operation !== operationGeneration) return;
      session.value.result!.consistency = comparison;
      delete session.value.result!.consistencyError;
    } catch (e) {
      if (operation === operationGeneration)
        session.value.result!.consistencyError = (e as Error).message;
    } finally {
      if (operation === operationGeneration) {
        working.value = false;
        progress.value = '';
        await persist();
      }
    }
  }
  function cancelSolve() {
    operationGeneration++;
    solver.cancel();
    progress.value = '';
    working.value = false;
    notice.value = 'Calculation cancelled. Your captured images are saved.';
  }
  async function toggleFrame(id: string) {
    const f = session.value.frames.find((f) => f.id === id);
    if (!f || working.value) return;
    f.included = !f.included;
    session.value.revision++;
    await persist();
  }
  async function deleteFrame(id: string) {
    if (working.value) return;
    try {
      await storage.removeFrame(session.value, id);
      await refreshSessions();
    } catch (e) {
      message(e);
    }
  }
  async function startNew() {
    if (working.value || connecting.value) return;
    stopCamera();
    await persist();
    session.value = newSession();
    step.value = 0;
    analysis.value = undefined;
    pendingImports.value = [];
    error.value = '';
    notice.value = 'Previous sessions remain saved in this browser.';
    resetFocus();
    await persist();
  }
  async function resume(saved: Session) {
    if (working.value || connecting.value) return;
    stopCamera();
    session.value = JSON.parse(JSON.stringify(saved));
    deviceId.value = typeof saved.settings.deviceId === 'string' ? saved.settings.deviceId : '';
    step.value = saved.result ? 3 : saved.frames.length ? 2 : 0;
    analysis.value = undefined;
    pendingImports.value = [];
    notice.value = 'Session restored. Reconnect the same camera and lens settings to capture more.';
  }
  async function exportJson() {
    try {
      download(
        new Blob([JSON.stringify(photonVisionCalibration(session.value), null, 2)], {
          type: 'application/json',
        }),
        `photon_calibration_${filename(session.value)}.json`,
      );
    } catch (e) {
      message(e);
    }
  }
  async function exportArchive() {
    try {
      auto.value = false;
      archiveProgress.value = 0;
      const saved = JSON.parse(JSON.stringify(session.value));
      download(
        await storage.archiveSession(saved, (n) => (archiveProgress.value = n)),
        `photoncal_${filename(saved)}.zip`,
      );
    } catch (e) {
      message(e);
    } finally {
      archiveProgress.value = undefined;
    }
  }
  async function restoreArchive(file: File) {
    stopCamera();
    try {
      archiveProgress.value = 0;
      const restored = await storage.importArchive(file, (n) => (archiveProgress.value = n));
      await resume(restored);
      await refreshSessions();
    } catch (e) {
      message(e);
    } finally {
      archiveProgress.value = undefined;
    }
  }
  async function downloadTarget() {
    try {
      const b = session.value.board;
      const blob = await vision.call<Blob>('board', { board: { ...b }, size: 2400 });
      // A printable HTML document sets physical dimensions explicitly. The border
      // occupies 1/80 of the generated square image; print at 100%, without fitting.
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const mm = (Math.max(b.columns, b.rows) * b.squareSize * 1000) / 0.9875;
      const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>PhotonCal calibration target</title><style>@page{size:auto;margin:5mm}body{margin:0;font:12px sans-serif}img{display:block;width:${mm}mm;height:${mm}mm}p{max-width:180mm}@media print{button{display:none}}</style><button onclick="window.print()">Print at 100%</button><img alt="Calibration target" src="${data}"><p>PhotonCal ${b.kind}, ${b.columns} × ${b.rows} squares. Measure the printed square: ${(b.squareSize * 1000).toFixed(3)} mm. ${b.kind === 'charuco' ? `Marker: ${(b.markerSize * 1000).toFixed(3)} mm, dictionary ${b.dictionary}, legacy ${b.legacy}.` : ''} Print at actual size (100%), disable fit-to-page, and mount on a flat rigid backing. Use larger paper if needed.</p></html>`;
      download(new Blob([html], { type: 'text/html' }), 'photoncal_target_print.html');
    } catch (e) {
      message(e);
    }
  }
  onMounted(async () => {
    camera.onEnded = () => {
      stopCamera();
      error.value = 'The camera disconnected. Your captures are saved.';
    };
    try {
      await refreshSessions();
      await enumerate();
    } catch (e) {
      message(e);
    }
    void loadEngine();
    navigator.mediaDevices?.addEventListener('devicechange', enumerate);
  });
  onUnmounted(() => {
    disposed = true;
    stopCamera();
    vision.cancel();
    solver.cancel();
    navigator.mediaDevices?.removeEventListener('devicechange', enumerate);
  });
  return {
    session,
    step,
    video,
    magnifier,
    sessions,
    devices,
    deviceId,
    connected,
    connecting,
    controls,
    settings,
    engineState,
    engineError,
    error,
    notice,
    working,
    progress,
    auto,
    captureProgress,
    captureReason,
    analysis,
    roi,
    focusHistory,
    bestFocus,
    pendingImports,
    importErrors,
    importAgreement,
    archiveProgress,
    captureFlash,
    activeFrame,
    showCoverage,
    showDots,
    included,
    result,
    coverageData,
    guidance,
    focusScore,
    canSolve,
    persist,
    loadEngine,
    connect,
    stopCamera,
    changeControl,
    resetFocus,
    capture,
    setStep,
    confirmFocus,
    selectRegion,
    chooseImages,
    importImages,
    calibrate,
    consistency,
    cancelSolve,
    toggleFrame,
    deleteFrame,
    startNew,
    resume,
    exportJson,
    exportArchive,
    restoreArchive,
    downloadTarget,
  };
}
