import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  cameraControlDefinitions,
  Camera,
  matchesMode,
  type CameraMode,
  type Control,
} from './core/camera';
import { discoverCamera, modeKey, type CameraDiscovery } from './core/cameraModes';
import { EngineClient } from './core/engine';
import {
  AutoCapture,
  CaptureTimer,
  duplicateView,
  coverage,
  coveragePrompt,
  type CaptureMode,
  type CaptureSteadiness,
} from './core/capture';
import {
  newSession,
  currentResult,
  solveRequest,
  type Session,
  type BoardConfig,
  type CaptureResult,
  type Analysis,
  type Region,
  type CalibrationResult,
  type Grid,
} from './core/types';
import {
  readPreferences,
  writePreferences,
  defaultCameraPreferences,
  validBoard,
} from './core/preferences';
import { previewPoint } from './core/preview';
import * as storage from './core/storage';
import { download, filename, photonVisionCalibration } from './core/export';

export function useCalibration() {
  const preferences = readPreferences();
  const initialCamera = preferences.cameras[preferences.lastDevice] ?? defaultCameraPreferences();
  const boardUnit = ref(preferences.unit),
    previewRotated = ref(initialCamera.rotated);
  const session = ref<Session>({
      ...newSession(),
      board: { ...preferences.board },
      fov: initialCamera.fov,
    }),
    step = ref(0),
    video = ref<HTMLVideoElement>(),
    magnifier = ref<HTMLCanvasElement>();
  const sessions = ref<Session[]>([]),
    devices = ref<MediaDeviceInfo[]>([]),
    deviceId = ref(preferences.lastDevice);
  const connected = ref(false),
    connecting = ref(false),
    changingControl = ref(false),
    savingFrame = ref(false),
    controls = ref<Control[]>([]),
    settings = ref<Record<string, any>>({});
  const checkingCamera = ref(false),
    cameraCheckProgress = ref(''),
    cameraDiscovery = ref<CameraDiscovery>(),
    cameraMode = ref('');
  let cameraCheck: AbortController | undefined;
  const cameraBusy = computed(
    () => connecting.value || checkingCamera.value || changingControl.value || savingFrame.value,
  );
  const selectedCameraMode = computed(() =>
    cameraDiscovery.value?.modes.find((mode) => modeKey(mode) === cameraMode.value),
  );
  const cameraSettingsPending = computed(
    () =>
      connected.value &&
      !session.value.frames.length &&
      !!selectedCameraMode.value &&
      !matchesMode(settings.value, selectedCameraMode.value),
  );
  const engineState = ref<'loading' | 'ready' | 'error'>('loading'),
    engineError = ref('');
  const error = ref(''),
    notice = ref(''),
    working = ref(false),
    progress = ref(''),
    captureRunning = ref(false),
    captureMode = ref<CaptureMode>(preferences.captureMode),
    timerSeconds = ref(preferences.timerSeconds),
    captureSteadiness = ref<CaptureSteadiness>(initialCamera.steadiness),
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
    gate = new AutoCapture(initialCamera.steadiness);
  const timer = new CaptureTimer(),
    timerClock = ref(performance.now());
  const timerCountdown = computed(() =>
    captureRunning.value && captureMode.value === 'timer'
      ? timer.remaining(timerClock.value)
      : timerSeconds.value,
  );
  const auto = computed(() => captureRunning.value && captureMode.value === 'auto');
  let loadingPreferences = false;
  let clockId: ReturnType<typeof setInterval> | undefined;
  let loopId = 0,
    loopGeneration = 0,
    operationGeneration = 0,
    controlGeneration = 0,
    manual = false,
    disposed = false;
  watch(
    captureSteadiness,
    (value) => {
      gate.setSteadiness(value);
      captureProgress.value = 0;
      controlGeneration++;
      rememberCamera(false);
    },
    { flush: 'sync' },
  );
  function savePreferences() {
    if (!writePreferences(preferences))
      notice.value =
        'Browser preferences could not be saved. Current settings remain available for this run.';
  }
  function rememberCamera(includeControls = true) {
    if (loadingPreferences || !deviceId.value || session.value.source !== 'camera') return;
    const profile = preferences.cameras[deviceId.value] ?? defaultCameraPreferences();
    profile.rotated = previewRotated.value;
    profile.steadiness = captureSteadiness.value;
    if (Number.isFinite(session.value.fov) && session.value.fov >= 10 && session.value.fov <= 170)
      profile.fov = session.value.fov;
    if (includeControls && connected.value) {
      profile.mode =
        !session.value.frames.length && selectedCameraMode.value
          ? { ...selectedCameraMode.value }
          : {
              width: session.value.width,
              height: session.value.height,
              frameRate: settings.value.frameRate,
            };
      for (const { key } of cameraControlDefinitions) {
        const value = settings.value[key];
        if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
          profile.controls[key] = value;
      }
    }
    preferences.cameras[deviceId.value] = profile;
    preferences.lastDevice = deviceId.value;
    savePreferences();
  }
  function loadCameraPreferences() {
    loadingPreferences = true;
    const profile = preferences.cameras[deviceId.value] ?? defaultCameraPreferences();
    previewRotated.value = profile.rotated;
    captureSteadiness.value = profile.steadiness;
    if (!session.value.frames.length) session.value.fov = profile.fov;
    loadingPreferences = false;
  }
  function updateBoard(board: BoardConfig) {
    if (session.value.frames.length || working.value || cameraBusy.value) return;
    session.value.board = board;
    controlGeneration++;
    gate.reset();
    if (validBoard(board)) {
      preferences.board = { ...board };
      savePreferences();
    }
    void persist();
  }
  function restartTimer() {
    if (captureRunning.value && captureMode.value === 'timer')
      timer.restart(performance.now(), timerSeconds.value);
    timerClock.value = performance.now();
  }
  function stopCapture() {
    captureRunning.value = false;
    manual = false;
    controlGeneration++;
    gate.reset();
    timer.stop();
  }
  function toggleCapture() {
    if (captureRunning.value) {
      stopCapture();
      return;
    }
    if (
      !connected.value ||
      step.value !== 2 ||
      working.value ||
      cameraBusy.value ||
      engineState.value !== 'ready'
    )
      return;
    captureRunning.value = !captureRunning.value;
  }
  watch(
    captureRunning,
    () => {
      controlGeneration++;
      manual = false;
      gate.reset();
      if (captureRunning.value) {
        captureReason.value =
          captureMode.value === 'timer'
            ? 'Timer running. Move to a new view.'
            : 'Estimating motion…';
        restartTimer();
      } else timer.stop();
    },
    { flush: 'sync' },
  );
  watch(
    captureMode,
    (value) => {
      stopCapture();
      preferences.captureMode = value;
      savePreferences();
    },
    { flush: 'sync' },
  );
  watch(
    timerSeconds,
    (value) => {
      if (!Number.isInteger(value) || value < 1 || value > 30) {
        timerSeconds.value = preferences.timerSeconds;
        return;
      }
      preferences.timerSeconds = value;
      restartTimer();
      savePreferences();
    },
    { flush: 'sync' },
  );
  watch(previewRotated, () => rememberCamera(false), { flush: 'sync' });
  watch(boardUnit, (value) => {
    preferences.unit = value;
    savePreferences();
  });
  watch(
    () => session.value.fov,
    () => {
      if (!loadingPreferences) rememberCamera(false);
    },
    { flush: 'sync' },
  );
  watch(selectedCameraMode, (mode) => {
    if (!mode || session.value.frames.length || !deviceId.value) return;
    const profile = preferences.cameras[deviceId.value] ?? defaultCameraPreferences();
    profile.mode = { ...mode };
    preferences.cameras[deviceId.value] = profile;
    preferences.lastDevice = deviceId.value;
    savePreferences();
  });
  function visibilityChanged() {
    if (document.hidden) stopCapture();
  }
  const included = computed(() => session.value.frames.filter((f) => f.included));
  const result = computed(() => currentResult(session.value));
  const coverageData = computed(() =>
    coverage(session.value.frames, session.value.width, session.value.height),
  );
  const guidance = computed(() =>
    coveragePrompt(
      session.value.frames,
      session.value.width,
      session.value.height,
      previewRotated.value,
    ),
  );
  const focusScore = computed(() => analysis.value?.sharpness ?? 0);
  const canSolve = computed(
    () =>
      included.value.length >= 12 &&
      !working.value &&
      !cameraBusy.value &&
      engineState.value === 'ready',
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
  function cancelCameraCheck() {
    cameraCheck?.abort();
    cameraCheck = undefined;
    checkingCamera.value = false;
    cameraCheckProgress.value = '';
  }
  function clearCameraSetup() {
    cameraDiscovery.value = undefined;
    cameraMode.value = '';
    controls.value = [];
    settings.value = {};
  }
  function selectCamera(id: string) {
    if (working.value || cameraBusy.value) return;
    stopCamera();
    deviceId.value = id;
    loadCameraPreferences();
    preferences.lastDevice = id;
    savePreferences();
    clearCameraSetup();
    if (!session.value.frames.length) resetFocus();
  }
  async function checkCamera() {
    if (working.value || cameraBusy.value || session.value.frames.length) return;
    stopCamera();
    clearCameraSetup();
    error.value = '';
    checkingCamera.value = true;
    cameraCheckProgress.value = 'Opening camera…';
    const controller = new AbortController();
    cameraCheck = controller;
    try {
      const found = await discoverCamera(deviceId.value, {
        signal: controller.signal,
        preferred: preferences.cameras[deviceId.value]?.mode ?? {
          width: session.value.width,
          height: session.value.height,
        },
        onProgress: (checked, total) => {
          if (cameraCheck === controller)
            cameraCheckProgress.value = `Checking settings ${checked} of ${total}…`;
        },
      });
      if (cameraCheck !== controller || disposed) return;
      cameraDiscovery.value = found;
      const preferred = preferences.cameras[found.deviceId]?.mode;
      cameraMode.value = modeKey(
        found.modes.find((m) => preferred && matchesMode(m, preferred)) ?? found.defaultMode,
      );
      if (preferred && !found.modes.some((m) => matchesMode(m, preferred)))
        notice.value =
          'The remembered resolution/FPS is unavailable. Select a verified configuration.';
      deviceId.value = found.deviceId;
      loadCameraPreferences();
      preferences.lastDevice = found.deviceId;
      savePreferences();
      devices.value = found.devices;
      controls.value = found.controls;
      settings.value = found.settings;
    } catch (e) {
      if (cameraCheck === controller && !controller.signal.aborted) message(e);
    } finally {
      if (cameraCheck === controller) {
        cameraCheck = undefined;
        checkingCamera.value = false;
        cameraCheckProgress.value = '';
      }
    }
  }
  function stopCamera() {
    loopGeneration++;
    video.value?.cancelVideoFrameCallback?.(loopId);
    camera.stop();
    connected.value = false;
    stopCapture();
    if (video.value) video.value.srcObject = null;
  }
  async function connect() {
    if (working.value || cameraBusy.value) return;
    error.value = '';
    connecting.value = true;
    try {
      if (session.value.frames.length && session.value.source === 'import')
        throw new Error('Start a new calibration to switch from imported images to a live camera.');
      const savedRate = session.value.settings.frameRate;
      const mode: CameraMode | undefined = session.value.frames.length
        ? {
            width: session.value.width,
            height: session.value.height,
            ...(typeof savedRate === 'number' && savedRate > 0 ? { frameRate: savedRate } : {}),
          }
        : cameraDiscovery.value?.deviceId === deviceId.value
          ? selectedCameraMode.value
          : undefined;
      if (!mode)
        throw new Error('Check available settings and select a resolution and frame rate first.');
      if (
        session.value.frames.length &&
        !window.confirm(
          'Reconnect the same physical camera at the same focus and zoom used for this session? Changing those settings requires a new calibration.',
        )
      )
        return;
      stopCamera();
      const stream = await camera.connect(deviceId.value, mode);
      if (disposed) {
        camera.stop();
        return;
      }
      const savedControls = session.value.frames.length
        ? { ...session.value.settings }
        : (preferences.cameras[camera.settings.deviceId ?? deviceId.value]?.controls ?? {});
      const restoreMessages: string[] = [];
      // Restore modes before their values, with shutter included in manual requests.
      for (const { key } of cameraControlDefinitions) {
        const value = savedControls[key];
        if (typeof value !== 'number' && typeof value !== 'string') continue;
        if (key === 'exposureTime' && savedControls.exposureMode !== 'manual') continue;
        if (key === 'focusDistance' && savedControls.focusMode !== 'manual') continue;
        if (key === 'colorTemperature' && savedControls.whiteBalanceMode !== 'manual') continue;
        const cap = camera.capabilities[key];
        try {
          if (
            cap === undefined ||
            (Array.isArray(cap) && !cap.includes(value)) ||
            (typeof value === 'number' && (value < cap.min || value > cap.max))
          )
            throw new Error(`Remembered ${key} is unavailable for this camera.`);
          const feedback = await camera.set(key, value);
          if (feedback) restoreMessages.push(feedback);
        } catch (e) {
          if (session.value.frames.length && ['focusMode', 'focusDistance', 'zoom'].includes(key))
            throw e;
          restoreMessages.push((e as Error).message);
        }
      }
      if (restoreMessages.length) notice.value = restoreMessages.join(' ');
      if (!session.value.frames.length) {
        session.value.width = camera.settings.width;
        session.value.height = camera.settings.height;
        resetFocus();
      }
      connected.value = true;
      settings.value = { ...camera.settings };
      controls.value = camera.controls();
      session.value.cameraLabel = stream.getVideoTracks()[0]!.label;
      session.value.name = session.value.cameraLabel || 'Camera calibration';
      session.value.settings = { ...camera.settings };
      session.value.source = 'camera';
      await enumerate();
      deviceId.value = camera.settings.deviceId ?? deviceId.value;
      if (!session.value.frames.length) rememberCamera();
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
  const pendingControls = new Map<string, string | number>();
  async function changeControl(key: string, value: string | number) {
    if (!connected.value || connecting.value || checkingCamera.value || savingFrame.value) return;
    pendingControls.set(key, value);
    if (changingControl.value) return;
    changingControl.value = true;
    controlGeneration++;
    manual = false;
    gate.reset();
    captureProgress.value = 0;
    error.value = '';
    captureReason.value = 'Applying camera settings…';
    const generation = loopGeneration;
    try {
      while (pendingControls.size && connected.value && generation === loopGeneration) {
        const [key, value] = pendingControls.entries().next().value!;
        pendingControls.delete(key);
        try {
          if (session.value.frames.length && ['zoom', 'focusDistance', 'focusMode'].includes(key))
            throw new Error('Start a new calibration before changing focus or zoom.');
          const feedback = await camera.set(key, value);
          if (generation !== loopGeneration || disposed) break;
          notice.value = feedback;
          settings.value = { ...camera.settings };
          controls.value = camera.controls();
          session.value.settings = { ...camera.settings };
          bestFocus.value = 0;
          focusHistory.value = [];
          if (['zoom', 'focusDistance', 'focusMode'].includes(key)) {
            session.value.focusConfirmed = false;
            if (step.value === 2) {
              stopCapture();
              step.value = 1;
              notice.value = 'Confirm focus before capturing with the new lens settings.';
            }
          }
          rememberCamera();
        } catch (e) {
          if (generation === loopGeneration && !disposed) {
            settings.value = { ...camera.settings };
            message(e);
          }
        }
      }
      if (generation === loopGeneration) await persist();
    } finally {
      pendingControls.clear();
      changingControl.value = false;
      gate.reset();
      restartTimer();
      if (captureRunning.value)
        captureReason.value =
          captureMode.value === 'timer'
            ? 'Timer running. Move to a new view.'
            : 'Estimating motion…';
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
        if (engineState.value !== 'ready' || working.value || cameraBusy.value) {
          schedule();
          return;
        }
        if (metadata.width !== session.value.width || metadata.height !== session.value.height) {
          stopCamera();
          throw new Error('The camera changed resolution. Reconnect before capturing more images.');
        }
        const frameControlGeneration = controlGeneration;
        // requestVideoFrameCallback signals a newly presented frame. Live streams
        // may report mediaTime = 0, so time the gate with the monotonic callback clock.
        const frameTime = now;
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
        if (frameControlGeneration !== controlGeneration) {
          schedule();
          return;
        }
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
          const status = gate.update(a, frameTime, session.value.width, settings.value);
          if (captureMode.value !== 'timer') captureReason.value = status.reason;
          captureProgress.value = auto.value ? status.progress : 0;
          const timed =
            captureRunning.value && captureMode.value === 'timer' && timer.due(frameTime);
          if ((auto.value && status.capture) || timed || manual) {
            const override = manual;
            manual = false;
            try {
              const previous = session.value.frames.at(-1)?.corners ?? [];
              if (!a.valid) captureReason.value = `Skipped: ${a.reason}`;
              else if (!override && duplicateView(previous, a.corners, session.value.width))
                captureReason.value = 'Skipped: move or tilt the board for a different view';
              else {
                const shot = await vision.call<CaptureResult>('capture', {
                  token: a.token,
                  board: { ...session.value.board },
                });
                if (generation !== loopGeneration) return;
                if (frameControlGeneration !== controlGeneration) {
                  schedule();
                  return;
                }
                if (!shot.accepted) captureReason.value = `Skipped: ${shot.analysis.reason}`;
                else if (
                  !override &&
                  duplicateView(previous, shot.analysis.corners, session.value.width)
                )
                  captureReason.value = 'Skipped: move or tilt the board for a different view';
                else {
                  savingFrame.value = true;
                  try {
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
                    gate.captured(shot.analysis.corners, performance.now());
                    captureFlash.value = true;
                    setTimeout(() => (captureFlash.value = false), 180);
                    captureReason.value = 'Captured. Move to a new view.';
                    await refreshSessions();
                  } finally {
                    savingFrame.value = false;
                  }
                }
              }
            } finally {
              restartTimer();
            }
          }
        }
      } catch (e) {
        stopCapture();
        manual = false;
        message(e);
        gate.reset();
      }
      schedule();
    };
    schedule();
  }
  function capture() {
    if (!connected.value || step.value !== 2 || working.value || cameraBusy.value) return;
    manual = true;
  }
  function setStep(value: number) {
    if (working.value || cameraBusy.value) return;
    if ((value === 1 || value === 2) && cameraSettingsPending.value) {
      notice.value = 'Restart preview to apply the selected camera settings.';
      return;
    }
    if (value === 1 && session.value.source === 'import') {
      notice.value = 'Imported images must use fixed focus and zoom. Open Capture to analyze them.';
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
      notice.value = 'Capture at least 12 images, then calibrate.';
      return;
    }
    stopCapture();
    manual = false;
    gate.reset();
    step.value = value;
    notice.value = '';
    analysis.value = undefined;
  }
  async function confirmFocus() {
    if (cameraBusy.value || working.value) return;
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
      controls.value = camera.controls();
      session.value.settings = { ...camera.settings };
      session.value.focusConfirmed = true;
      rememberCamera();
      await persist();
      step.value = 2;
      gate.reset();
    } catch (e) {
      message(e);
    }
  }
  function selectRegion(x: number, y: number) {
    ({ x, y } = previewPoint(x, y, previewRotated.value));
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
    if (!files.length || working.value || cameraBusy.value) return;
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
    stopCapture();
    error.value = '';
    importErrors.value = [];
    try {
      for (let i = 0; i < pendingImports.value.length; i++) {
        const file = pendingImports.value[i]!;
        progress.value = `Analyzing image ${i + 1} of ${pendingImports.value.length}`;
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
          const shot = await vision.call<CaptureResult>('capture', {
            token: a.token,
            board: { ...session.value.board },
          });
          if (!shot.accepted) throw new Error(shot.analysis.reason);
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
    stopCapture();
    error.value = '';
    progress.value = 'Preparing calibration…';
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
    stopCapture();
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
        progress.value = `Calibrating image set ${i + 1} of 2…`;
        const r = await solver.call<CalibrationResult>('solve', datasets[i]);
        progress.value = `Estimating uncertainty for image set ${i + 1}…`;
        r.uncertainty = await solver.call<Grid>('uncertainty', { ...datasets[i], result: r });
        results.push(r);
        if (operation !== operationGeneration) return;
      }
      progress.value = 'Comparing projections…';
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
      gate.reset(true);
      const previous = session.value.frames.at(-1);
      if (previous) gate.captured(previous.corners, -Infinity);
      await refreshSessions();
    } catch (e) {
      message(e);
    }
  }
  async function startNew() {
    if (working.value || cameraBusy.value) return;
    stopCamera();
    await persist();
    loadingPreferences = true;
    session.value = {
      ...newSession(),
      board: { ...preferences.board },
      fov: preferences.cameras[deviceId.value]?.fov ?? 90,
    };
    loadingPreferences = false;
    gate.reset(true);
    loadCameraPreferences();
    step.value = 0;
    analysis.value = undefined;
    pendingImports.value = [];
    error.value = '';
    notice.value = 'Previous sessions remain saved in this browser.';
    resetFocus();
    await persist();
  }
  async function resume(saved: Session) {
    if (working.value || cameraBusy.value) return;
    stopCamera();
    clearCameraSetup();
    loadingPreferences = true;
    session.value = JSON.parse(JSON.stringify(saved));
    deviceId.value = typeof saved.settings.deviceId === 'string' ? saved.settings.deviceId : '';
    loadingPreferences = false;
    loadCameraPreferences();
    gate.reset(true);
    if (saved.frames.length) {
      gate.captured(saved.frames.at(-1)!.corners, -Infinity);
    }
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
      stopCapture();
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
    if (working.value || cameraBusy.value) return;
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
      const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>PhotonCal calibration target</title><style>@page{size:auto;margin:5mm}body{margin:0;font:12px sans-serif}img{display:block;width:${mm}mm;height:${mm}mm}p{max-width:180mm}@media print{button{display:none}}</style><button onclick="window.print()">Print at 100%</button><img alt="Calibration target" src="${data}"><p>PhotonCal ${b.kind}, ${b.rows} rows × ${b.columns} columns of squares. Measure the printed square: ${(b.squareSize * 1000).toFixed(3)} mm. ${b.kind === 'charuco' ? `Marker: ${(b.markerSize * 1000).toFixed(3)} mm, dictionary ${b.dictionary}, legacy ${b.legacy}.` : ''} Print at actual size (100%), disable fit-to-page, and mount on a flat rigid backing. Use larger paper if needed.</p></html>`;
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
      if (
        deviceId.value &&
        devices.value.some((d) => d.deviceId) &&
        !devices.value.some((d) => d.deviceId === deviceId.value)
      ) {
        deviceId.value = '';
        loadCameraPreferences();
      }
    } catch (e) {
      message(e);
    }
    void loadEngine();
    navigator.mediaDevices?.addEventListener('devicechange', enumerate);
    document.addEventListener('visibilitychange', visibilityChanged);
    clockId = setInterval(() => {
      timerClock.value = performance.now();
    }, 100);
  });
  onUnmounted(() => {
    disposed = true;
    clearInterval(clockId);
    document.removeEventListener('visibilitychange', visibilityChanged);
    cancelCameraCheck();
    stopCamera();
    vision.cancel();
    solver.cancel();
    navigator.mediaDevices?.removeEventListener('devicechange', enumerate);
  });
  return {
    session,
    boardUnit,
    previewRotated,
    updateBoard,
    captureMode,
    captureRunning,
    timerSeconds,
    timerCountdown,
    toggleCapture,
    stopCapture,
    changingControl,
    step,
    video,
    magnifier,
    sessions,
    devices,
    deviceId,
    connected,
    connecting,
    checkingCamera,
    cameraBusy,
    cameraCheckProgress,
    cameraDiscovery,
    cameraMode,
    selectedCameraMode,
    cameraSettingsPending,
    checkCamera,
    cancelCameraCheck,
    selectCamera,
    controls,
    settings,
    engineState,
    engineError,
    error,
    notice,
    working,
    progress,
    auto,
    captureSteadiness,
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
