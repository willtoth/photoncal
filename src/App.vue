<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import {
  RotateCw,
  Aperture,
  Camera as CameraIcon,
  Focus,
  ScanLine,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Download,
  FolderOpen,
  Plus,
  Usb,
  RefreshCw,
  AlertTriangle,
  X,
  ImagePlus,
  Move,
  Info,
  LoaderCircle,
} from 'lucide-vue-next';
import { useCalibration } from './useCalibration';
import { modeLabel } from './core/camera';
import { modeKey } from './core/cameraModes';
import CameraControls from './components/CameraControls.vue';
import BoardSettings from './components/BoardSettings.vue';
import CaptureOverlay from './components/CaptureOverlay.vue';
import FrameGallery from './components/FrameGallery.vue';
import FrameViewer from './components/FrameViewer.vue';
import ResultsPanel from './components/ResultsPanel.vue';
import LensModelSettings from './components/LensModelSettings.vue';
const {
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
  capture,
  setStep,
  confirmFocus,
  selectRegion,
  chooseImages,
  importImages,
  calibrate,
  calibrateBoth,
  selectModel,
  exportMrcal,
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
} = useCalibration();
const fileInput = ref<HTMLInputElement>(),
  archiveInput = ref<HTMLInputElement>(),
  sessionMenu = ref(false);
const targetOpen = ref(true);
watch(
  () => session.value.id,
  () => (targetOpen.value = true),
  { immediate: true },
);
const steps = [
  { title: 'Camera', icon: CameraIcon },
  { title: 'Focus', icon: Focus },
  { title: 'Capture', icon: ScanLine },
  { title: 'Results', icon: ChartNoAxesCombined },
];
const captureDisabledReason = computed(() => {
  if (!connected.value) return 'Start the camera preview to capture an image.';
  if (working.value) return 'Wait for the current operation to finish.';
  if (cameraBusy.value) return 'Wait for the camera settings to finish updating.';
  if (!analysis.value?.valid)
    return analysis.value?.reason || 'No target corners detected. Show the target to the camera.';
  return '';
});
const titles = ['Camera setup', 'Adjust focus', 'Capture images', 'Calibration results'];
const descriptions = [
  'Check your camera’s settings, then choose a resolution and frame rate.',
  'Focus at your working distance, then check the center and edges.',
  'Capture the board at different positions, distances, and angles.',
  'Check coverage, residuals, and uncertainty before exporting.',
];
const spark = computed(() => {
  const points = focusHistory.value,
    max = Math.max(bestFocus.value, 1);
  return points
    .map((p, i) => `${(i / Math.max(points.length - 1, 1)) * 300},${52 - (p / max) * 45}`)
    .join(' ');
});
const focusPercent = computed(() =>
  bestFocus.value > 0
    ? Math.min(100, ((focusHistory.value.at(-1) ?? 0) / bestFocus.value) * 100)
    : 0,
);
function previewClick(event: PointerEvent) {
  if (step.value !== 1 || !connected.value) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const scale = Math.min(rect.width / session.value.width, rect.height / session.value.height);
  const width = session.value.width * scale,
    height = session.value.height * scale;
  selectRegion(
    (event.clientX - rect.left - (rect.width - width) / 2) / width,
    (event.clientY - rect.top - (rect.height - height) / 2) / height,
  );
}
function imported(event: Event) {
  const el = event.target as HTMLInputElement;
  void chooseImages(Array.from(el.files ?? []));
  el.value = '';
}
function restored(event: Event) {
  const el = event.target as HTMLInputElement;
  const file = el.files?.[0];
  if (file) void restoreArchive(file);
  el.value = '';
}
function restoreSelected(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const saved = sessions.value.find((s) => s.id === id);
  if (saved) void resume(saved);
  (event.target as HTMLSelectElement).value = '';
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') stopCapture();
  if ((event.target as HTMLElement).closest('input,select,textarea,button,dialog')) return;
  if (event.code === 'Space' && step.value === 2 && connected.value) {
    event.preventDefault();
    capture();
  }
}
onMounted(() => window.addEventListener('keydown', keyboard));
onUnmounted(() => window.removeEventListener('keydown', keyboard));
</script>
<template>
  <div class="app-shell">
    <header class="topbar">
      <a href="./" class="brand" aria-label="PhotonCal home"
        ><span class="brand-mark"><Aperture :size="25" :stroke-width="1.6" /></span>photon<span
          >cal</span
        ></a
      >
      <div class="topbar-actions">
        <button
          class="header-button"
          aria-label="Open archive"
          :disabled="working || cameraBusy"
          @click="archiveInput?.click()"
        >
          <FolderOpen :size="16" /><span>Open archive</span></button
        ><button
          class="header-button"
          aria-label="Save session"
          :disabled="working || cameraBusy || archiveProgress !== undefined"
          @click="exportArchive"
        >
          <Download :size="16" /><span>Save session</span>
        </button>
      </div>
    </header>
    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/bmp"
      multiple
      @change="imported"
    />
    <input
      ref="archiveInput"
      class="visually-hidden"
      type="file"
      accept=".zip,application/zip"
      @change="restored"
    />
    <aside class="sidebar">
      <div class="sidebar-label">Calibration</div>
      <nav aria-label="Calibration steps">
        <button
          v-for="(item, index) in steps"
          :key="item.title"
          class="step-item"
          :class="{ active: step === index, complete: step > index }"
          :aria-current="step === index ? 'step' : undefined"
          :disabled="working || cameraBusy"
          @click="setStep(index)"
        >
          <span class="step-icon"
            ><Check v-if="step > index" :size="19" /><component
              :is="item.icon"
              v-else
              :size="19" /></span
          ><span class="step-copy"
            ><strong>{{ item.title }}</strong></span
          ><span class="step-index">{{ index + 1 }}</span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="session-summary">
          <span class="sidebar-label">Session</span
          ><strong>{{ session.cameraLabel || 'No camera selected' }}</strong
          ><span v-if="session.cameraLabel"
            >{{ session.width }} × {{ session.height }} · {{ included.length }} images</span
          >
          <div class="mini-progress"><span :style="{ width: coverageData.percent + '%' }" /></div>
          <small>{{ coverageData.percent.toFixed(0) }}% image coverage</small>
        </div>
        <button class="button full-width" :disabled="working || cameraBusy" @click="startNew">
          <Plus :size="16" />New calibration</button
        ><button
          class="text-button full-width saved-sessions-button"
          @click="sessionMenu = !sessionMenu"
        >
          {{ sessionMenu ? 'Hide' : 'Browse' }} saved sessions ({{ sessions.length }})
        </button>
        <div v-if="sessionMenu" class="saved-sessions">
          <button
            v-for="saved in sessions"
            :key="saved.id"
            :disabled="working || cameraBusy"
            @click="
              resume(saved);
              sessionMenu = false;
            "
          >
            <strong>{{ saved.cameraLabel || saved.name }}</strong
            ><small
              >{{ saved.width }} × {{ saved.height }} · {{ saved.frames.length }} images<br />{{
                new Date(saved.updatedAt).toLocaleDateString()
              }}</small
            >
          </button>
          <p v-if="!sessions.length" class="small muted">No saved sessions.</p>
        </div>
        <p class="local-note">Save a session archive before clearing browser data.</p>
      </div>
    </aside>
    <main class="main-content" :class="{ 'live-stage': step < 3 && session.source === 'camera' }">
      <div class="mobile-session-actions">
        <button class="button small-button" :disabled="working || cameraBusy" @click="startNew">
          <Plus :size="15" />New calibration
        </button>
        <select
          aria-label="Saved sessions"
          :disabled="working || cameraBusy"
          @change="restoreSelected"
        >
          <option value="">Saved sessions ({{ sessions.length }})</option>
          <option v-for="saved in sessions" :key="saved.id" :value="saved.id">
            {{ saved.cameraLabel || saved.name }} · {{ saved.frames.length }} images
          </option>
        </select>
      </div>
      <div class="page-heading">
        <div>
          <h1>{{ titles[step] }}</h1>
          <p>{{ descriptions[step] }}</p>
        </div>
        <div class="engine-status" :class="engineState" role="status">
          <span class="status-dot" />{{
            engineState === 'ready'
              ? 'mrcal ready'
              : engineState === 'error'
                ? 'Engine unavailable'
                : 'Loading mrcal'
          }}
        </div>
      </div>
      <div v-if="engineState === 'error'" class="message error-message" role="alert">
        <AlertTriangle :size="20" />
        <div>
          <strong>The calibration engine couldn’t load.</strong>
          <p>Check your connection and retry.</p>
          <details>
            <summary>Technical details</summary>
            <p>{{ engineError }}</p>
          </details>
        </div>
        <button class="button small-button" @click="loadEngine">Retry</button>
      </div>
      <div v-if="error" class="message error-message" role="alert">
        <AlertTriangle :size="20" />
        <p>{{ error }}</p>
        <button class="icon-button" aria-label="Dismiss error" @click="error = ''">
          <X :size="18" />
        </button>
      </div>
      <div v-if="notice" class="message notice-message" role="status">
        <Info :size="18" />
        <p>{{ notice }}</p>
        <button class="icon-button" aria-label="Dismiss notice" @click="notice = ''">
          <X :size="18" />
        </button>
      </div>
      <div v-if="working" class="work-progress" role="status">
        <LoaderCircle class="spin" :size="19" /><span>{{ progress }}</span
        ><button v-if="!pendingImports.length" class="text-button" @click="cancelSolve">
          Cancel calculation
        </button>
      </div>
      <div v-if="archiveProgress !== undefined" class="work-progress" role="status">
        <LoaderCircle class="spin" :size="18" />Preparing session archive ·
        {{ Math.round(archiveProgress * 100) }}%
      </div>

      <div
        class="stage-workspace"
        :class="{
          'focus-stage': step === 1,
          'capture-stage': step === 2,
          'has-captures': session.frames.length > 0,
        }"
      >
        <div
          v-show="step < 3"
          class="live-workspace"
          :class="{ 'live-workspace-wide': session.source === 'import' }"
        >
          <section v-show="step < 3" class="preview-panel">
            <div class="preview-heading">
              <span
                ><span class="live-dot" :class="{ on: connected }" />{{
                  connected
                    ? 'Live view'
                    : session.source === 'import'
                      ? 'Imported images'
                      : 'Camera preview'
                }}</span
              ><span v-if="connected">{{
                modeLabel({
                  width: settings.width,
                  height: settings.height,
                  frameRate: settings.frameRate,
                })
              }}</span>
              <span v-else-if="session.source === 'import' || session.frames.length"
                >{{ session.width }} × {{ session.height }}</span
              >
              <span v-else-if="selectedCameraMode">{{ modeLabel(selectedCameraMode) }}</span>
              <button
                v-if="session.source === 'camera'"
                class="preview-rotate"
                :aria-pressed="previewRotated"
                :disabled="!connected"
                title="Display only. Captured images and calibration stay unchanged."
                @click="previewRotated = !previewRotated"
              >
                <RotateCw :size="16" />Rotate preview 180°
              </button>
            </div>
            <div
              class="viewport-media"
              :class="{
                flash: captureFlash,
                selectable: step === 1 && connected,
                rotated: previewRotated,
              }"
              :style="{ aspectRatio: session.width + '/' + session.height }"
              @pointerdown="previewClick"
            >
              <video
                ref="video"
                v-show="connected"
                autoplay
                playsinline
                muted
                aria-label="Live camera preview"
              />
              <CaptureOverlay
                v-if="connected"
                :width="session.width"
                :height="session.height"
                :frames="session.frames"
                :corners="step === 2 ? (analysis?.corners ?? []) : []"
                :dots="step === 2 && showDots"
                :grid="step === 2 && showCoverage"
                :roi="step === 1 ? roi : undefined"
              />
              <div v-if="!connected" class="preview-empty">
                <CameraIcon :size="32" :stroke-width="1.4" aria-hidden="true" />
                <h2>
                  {{
                    session.source === 'import'
                      ? 'Use saved images'
                      : checkingCamera
                        ? 'Checking camera settings'
                        : cameraDiscovery
                          ? 'Preview stopped'
                          : 'Camera not connected'
                  }}
                </h2>
                <p>
                  {{
                    session.source === 'import'
                      ? 'Check the board settings before analyzing images.'
                      : checkingCamera
                        ? 'The camera is on while settings are checked.'
                        : cameraDiscovery
                          ? 'Choose a resolution and frame rate, then start preview.'
                          : 'Choose a camera and check its available settings.'
                  }}
                </p>
                <button
                  v-if="step === 0 && session.source !== 'import'"
                  class="button mint-button"
                  :disabled="cameraBusy || working"
                  @click="cameraDiscovery || session.frames.length ? connect() : checkCamera()"
                >
                  <Usb :size="17" />{{
                    connecting
                      ? 'Starting preview…'
                      : checkingCamera
                        ? 'Checking camera…'
                        : cameraDiscovery || session.frames.length
                          ? 'Start preview'
                          : 'Check available settings'
                  }}</button
                ><button
                  v-if="session.source === 'import'"
                  class="button mint-button"
                  :disabled="working || cameraBusy"
                  @click="fileInput?.click()"
                >
                  <ImagePlus :size="17" />Choose images</button
                ><button
                  v-if="step === 2 && session.source === 'camera'"
                  class="button mint-button"
                  :disabled="working || cameraBusy"
                  @click="connect"
                >
                  Reconnect camera
                </button>
              </div>
              <div v-if="connected && step === 2" class="capture-hud" role="status">
                <span class="detection-dot" :class="{ found: analysis?.valid }" /><span>{{
                  captureRunning
                    ? captureReason
                    : analysis?.valid
                      ? 'Board detected'
                      : analysis?.reason || 'Looking for board…'
                }}</span
                ><span v-if="analysis?.corners.length" class="hud-count"
                  >{{ analysis.corners.length }} corners</span
                >
                <strong v-if="captureRunning && captureMode === 'timer'" class="timer-countdown"
                  >{{ timerCountdown }}s</strong
                >
                <div v-if="auto" class="hold-progress">
                  <span :style="{ width: captureProgress * 100 + '%' }" />
                </div>
              </div>
              <div v-if="connected && step === 1" class="focus-hint">
                Click the image to move the focus area
              </div>
            </div>
            <div v-if="step === 2" class="preview-footer">
              <label class="check-label"
                ><input v-model="showDots" type="checkbox" />Captured corners</label
              ><label class="check-label"
                ><input v-model="showCoverage" type="checkbox" />Coverage grid</label
              ><span class="preview-footer-right"
                >{{ coverageData.percent.toFixed(0) }}% covered</span
              >
            </div>
          </section>
          <CameraControls
            v-if="step < 3 && session.source === 'camera'"
            :controls="controls"
            :settings="settings"
            :locked="!!session.frames.length"
            :checked="!!cameraDiscovery || connected"
            :inactive="!connected"
            :disabled="cameraBusy && !changingControl"
            @change="changeControl"
          />
          <div v-if="step === 2 && session.source === 'camera'" class="capture-toolbar">
            <label
              >Capture mode<select v-model="captureMode" :disabled="working || cameraBusy">
                <option value="manual">Manual</option>
                <option value="auto">Automatic</option>
                <option value="timer">Timer</option>
              </select></label
            >
            <label v-if="captureMode === 'auto'"
              >Capture steadiness<select
                v-model="captureSteadiness"
                :disabled="working || cameraBusy"
              >
                <option value="handheld">Handheld · global shutter</option>
                <option value="strict">Strict · rolling / unknown shutter</option>
              </select></label
            >
            <label v-if="captureMode === 'timer'"
              >Interval · seconds<input
                v-model.lazy.number="timerSeconds"
                type="number"
                min="1"
                max="30"
                step="1"
                :disabled="working"
            /></label>
            <div v-if="captureMode === 'auto'" class="auto-capture">
              <button
                class="toggle"
                :class="{ enabled: captureRunning }"
                role="switch"
                :aria-checked="captureRunning"
                aria-label="Automatic capture"
                :disabled="
                  !captureRunning &&
                  (!connected || working || cameraBusy || engineState !== 'ready')
                "
                @click="toggleCapture"
              >
                <span /></button
              ><strong>{{ captureRunning ? 'Running' : 'Start auto' }}</strong>
            </div>
            <button
              v-if="captureMode === 'timer'"
              class="button primary"
              :disabled="
                !captureRunning && (!connected || working || cameraBusy || engineState !== 'ready')
              "
              @click="toggleCapture"
            >
              {{ captureRunning ? 'Stop timer' : 'Start timer' }}
            </button>
            <span
              class="capture-action"
              :tabindex="captureDisabledReason ? 0 : undefined"
              :aria-label="captureDisabledReason || undefined"
            >
              <button
                class="button"
                :aria-describedby="captureDisabledReason ? 'capture-disabled-reason' : undefined"
                :disabled="!!captureDisabledReason"
                @click="capture"
              >
                <CameraIcon :size="17" />Capture now <kbd>Space</kbd>
              </button>
              <span v-if="captureDisabledReason" id="capture-disabled-reason" role="tooltip">{{
                captureDisabledReason
              }}</span>
            </span>
            <p class="small muted capture-mode-help">
              {{
                captureMode === 'timer'
                  ? 'Repeating countdown. Skips missing targets and duplicate views; no steadiness check.'
                  : captureMode === 'auto'
                    ? captureSteadiness === 'handheld'
                      ? 'Natural movement is OK with a short exposure and global shutter.'
                      : 'Hold the target steady for rolling or unknown shutter cameras.'
                    : 'Capture a detected target with the button or Space.'
              }}
            </p>
          </div>
        </div>
        <div
          class="workspace"
          :class="{
            'workspace-results': step === 3,
            'workspace-wide': step === 3,
          }"
        >
          <div class="workspace-main">
            <div v-if="step === 0" class="tip-strip">
              <Info :size="20" />
              <p>Use the same camera, resolution, focus, and zoom in PhotonVision.</p>
            </div>
            <template v-if="step === 1">
              <section class="panel focus-dashboard">
                <div class="focus-magnifier">
                  <canvas
                    ref="magnifier"
                    :class="{ 'preview-rotated': previewRotated }"
                    width="320"
                    height="200"
                    aria-label="Magnified focus area"
                  /><span>Selected focus area</span>
                </div>
                <div class="focus-metrics">
                  <span class="eyebrow">Sharpness</span>
                  <div class="focus-number">
                    {{ (focusHistory.at(-1) ?? 0).toFixed(1) }}<small>relative</small>
                  </div>
                  <div class="focus-meter"><span :style="{ width: focusPercent + '%' }" /></div>
                  <div class="panel-heading small">
                    <span>{{ focusPercent.toFixed(0) }}% of best seen</span
                    ><button
                      class="text-button"
                      @click="
                        bestFocus = 0;
                        focusHistory = [];
                      "
                    >
                      Reset best score
                    </button>
                  </div>
                  <svg
                    viewBox="0 0 300 58"
                    class="focus-spark"
                    role="img"
                    aria-label="Recent focus score"
                  >
                    <polyline :points="spark" fill="none" stroke="currentColor" stroke-width="2" />
                  </svg>
                  <p class="small muted">
                    Relative focus score. Keep the scene and exposure fixed when comparing values.
                  </p>
                </div>
              </section>
              <div class="focus-areas">
                <span class="small muted">Inspect:</span
                ><button class="button small-button" @click="selectRegion(0.5, 0.5)">Center</button
                ><button class="button small-button" @click="selectRegion(0.15, 0.15)">
                  Top left</button
                ><button class="button small-button" @click="selectRegion(0.85, 0.15)">
                  Top right</button
                ><button class="button small-button" @click="selectRegion(0.15, 0.85)">
                  Bottom left</button
                ><button class="button small-button" @click="selectRegion(0.85, 0.85)">
                  Bottom right
                </button>
              </div>
            </template>
            <template v-if="step === 2">
              <div class="capture-guidance">
                <Move :size="22" />
                <p>{{ guidance }}</p>
              </div>
              <div v-if="pendingImports.length" class="panel import-review">
                <h3>{{ pendingImports.length }} images ready to analyze</h3>
                <p class="small muted">
                  Check the board settings. Images with different dimensions or too few detected
                  corners will be skipped.
                </p>
                <label class="check-label"
                  ><input v-model="importAgreement" type="checkbox" />All images use the same
                  camera, resolution, focus, and zoom.</label
                ><button
                  class="button primary"
                  :disabled="working || !importAgreement || engineState !== 'ready'"
                  @click="importImages"
                >
                  Analyze images
                </button>
              </div>
              <details v-if="importErrors.length" class="panel">
                <summary>{{ importErrors.length }} images skipped</summary>
                <ul class="import-errors">
                  <li v-for="item in importErrors" :key="item">{{ item }}</li>
                </ul>
              </details>
              <FrameGallery
                v-if="session.source === 'import' || !session.frames.length"
                :session="session"
                :disabled="working || cameraBusy || archiveProgress !== undefined"
                @inspect="activeFrame = $event"
                @toggle="toggleFrame"
                @remove="deleteFrame"
              />
            </template>
            <ResultsPanel
              v-if="step === 3 && session.result"
              :session="session"
              :working="working"
              @download="exportJson"
              @mrcal="exportMrcal"
              @model="selectModel"
              @both="calibrateBoth"
              @archive="exportArchive"
              @capture="setStep(2)"
              @consistency="consistency"
              @recalibrate="calibrate"
              @inspect="activeFrame = $event"
            />
            <FrameGallery
              v-if="step === 3 && session.frames.length"
              :session="session"
              :disabled="working || cameraBusy || archiveProgress !== undefined"
              @inspect="activeFrame = $event"
              @toggle="toggleFrame"
              @remove="deleteFrame"
            />
          </div>
          <div v-if="step < 3" class="workspace-side">
            <template v-if="step === 0">
              <section class="panel camera-setup">
                <div class="panel-heading">
                  <h3>Camera settings</h3>
                </div>
                <fieldset :disabled="cameraBusy || working">
                  <label>
                    Camera
                    <select
                      :value="deviceId"
                      @change="selectCamera(($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">Default camera</option>
                      <option
                        v-for="(device, index) in devices"
                        :key="device.deviceId"
                        :value="device.deviceId"
                      >
                        {{ device.label || `Camera ${index + 1}` }}
                      </option>
                    </select>
                  </label>
                  <template v-if="!session.frames.length">
                    <button
                      class="button full-width"
                      :class="{ primary: !cameraDiscovery }"
                      @click="checkCamera"
                    >
                      <RefreshCw :size="16" />{{
                        cameraDiscovery ? 'Check settings again' : 'Check available settings'
                      }}
                    </button>
                    <label v-if="cameraDiscovery" class="camera-mode">
                      Resolution and frame rate
                      <select v-model="cameraMode">
                        <option
                          v-for="mode in cameraDiscovery.modes"
                          :key="modeKey(mode)"
                          :value="modeKey(mode)"
                        >
                          {{ modeLabel(mode) }}
                        </option>
                      </select>
                    </label>
                  </template>
                  <p v-else class="small muted camera-check-note">
                    Session resolution: {{ session.width }} × {{ session.height }}. Start a new
                    calibration to change it.
                  </p>
                </fieldset>
                <div v-if="checkingCamera" class="camera-check-status">
                  <p class="small" role="status">
                    <LoaderCircle class="spin" :size="16" />{{ cameraCheckProgress }}
                  </p>
                  <button class="text-button" @click="cancelCameraCheck">Cancel check</button>
                </div>
                <template v-if="cameraDiscovery && !session.frames.length">
                  <details class="camera-check-details">
                    <summary>About these settings</summary>
                    <p class="small muted">
                      {{ cameraDiscovery.modes.length }}
                      {{ cameraDiscovery.modes.length === 1 ? 'configuration' : 'configurations' }}
                      verified. The browser controls encoding.
                    </p>

                    <p class="small muted camera-check-note">
                      Checking settings briefly turns on the camera. Preview starts separately.
                    </p>

                    <p class="small muted">
                      This checks common resolutions and frame rates, plus the browser’s default.
                      Browsers do not provide a complete list of native camera modes or an encoding
                      selector.
                    </p>
                  </details>
                  <p v-if="!cameraDiscovery.unscaled" class="small error-text">
                    This browser cannot confirm unscaled capture. Check that the image framing
                    matches PhotonVision.
                  </p>
                </template>
                <button
                  v-if="
                    selectedCameraMode || (session.frames.length && session.source !== 'import')
                  "
                  class="button primary full-width"
                  :disabled="cameraBusy || working"
                  @click="connect"
                >
                  <CameraIcon :size="16" />{{
                    connecting
                      ? 'Starting preview…'
                      : connected
                        ? 'Restart preview'
                        : 'Start preview'
                  }}
                </button>
                <p v-if="cameraSettingsPending" class="small muted" role="status">
                  Restart preview to apply the selected settings.
                </p>
                <button
                  v-if="connected"
                  class="text-button full-width"
                  :disabled="cameraBusy || working"
                  @click="stopCamera"
                >
                  Stop preview
                </button>
                <div class="or-divider"><span>or</span></div>
                <button
                  class="button full-width"
                  :disabled="working || cameraBusy"
                  @click="fileInput?.click()"
                >
                  <ImagePlus :size="17" />Use saved images
                </button>
              </section>
            </template>
            <template v-if="step === 0">
              <details v-if="connected" class="panel">
                <summary>Camera details</summary>
                <dl class="camera-details">
                  <div>
                    <dt>Device</dt>
                    <dd>{{ session.cameraLabel }}</dd>
                  </div>
                  <div>
                    <dt>Active settings</dt>
                    <dd>
                      {{
                        modeLabel({
                          width: settings.width,
                          height: settings.height,
                          frameRate: settings.frameRate,
                        })
                      }}
                    </dd>
                  </div>
                  <div>
                    <dt>Resize mode</dt>
                    <dd>{{ settings.resizeMode ?? 'Not reported' }}</dd>
                  </div>
                  <div>
                    <dt>Aspect ratio</dt>
                    <dd>
                      {{
                        Number(settings.aspectRatio ?? session.width / session.height).toFixed(3)
                      }}
                    </dd>
                  </div>
                </dl>
              </details>
            </template>
            <template v-if="step === 1"
              ><section class="panel guidance-panel">
                <div class="panel-heading">
                  <h3>Focus instructions</h3>
                </div>
                <ol class="instruction-list">
                  <li>
                    Place a detailed target at your working distance. Keep it and the camera still.
                  </li>
                  <li>
                    Use bright, diffuse light and fixed exposure. Adjust focus slowly to find the
                    highest sharpness score.
                  </li>
                  <li>Compare the center and edges without refocusing between them.</li>
                  <li>
                    Secure the lens and disable autofocus. Keep focus and zoom fixed during
                    calibration and use.
                  </li>
                </ol>
                <p class="small muted">
                  Close-up views may look softer. Keep focus fixed as you move the board.
                </p>
                <a
                  class="small"
                  href="https://www.edmundoptics.com/knowledge-center/application-notes/imaging/testing-and-targets/"
                  target="_blank"
                  rel="noopener"
                  >Why edge focus matters</a
                >
              </section>
              <div
                v-if="!controls.some((c) => ['focusMode', 'focusDistance'].includes(c.key))"
                class="tip-strip small"
              >
                <Info :size="20" />
                <p>
                  This camera has no browser focus control. Lock the lens manually or check that it
                  has fixed focus.
                </p>
              </div></template
            >
            <template v-if="step === 2">
              <details
                class="target-disclosure"
                :open="targetOpen || session.source === 'import'"
                @toggle="targetOpen = ($event.target as HTMLDetailsElement).open"
              >
                <summary>
                  Target settings
                  <span class="small muted"
                    >{{ session.board.rows }} × {{ session.board.columns }} ·
                    {{ session.board.kind === 'charuco' ? 'ChArUco' : 'Chessboard' }}</span
                  >
                </summary>
                <BoardSettings
                  :model-value="session.board"
                  v-model:unit="boardUnit"
                  :disabled="working || cameraBusy || session.frames.length > 0"
                  @update:model-value="updateBoard"
                  @print="downloadTarget"
                />
              </details>
              <FrameGallery
                v-if="session.source === 'camera' && session.frames.length"
                live
                :session="session"
                :disabled="working || cameraBusy || archiveProgress !== undefined"
                @inspect="activeFrame = $event"
                @toggle="toggleFrame"
                @remove="deleteFrame"
              />
              <details class="panel capture-details">
                <summary>Capture guidance &amp; solve settings</summary>
                <div class="capture-count">
                  <strong>{{ included.length }}</strong
                  ><span>/ about 100 views</span>
                </div>
                <div class="dataset-progress">
                  <span :style="{ width: Math.min(included.length, 100) + '%' }" />
                </div>
                <p class="small muted">
                  Calibration requires 12 images. Aim for about 100 varied views, then check
                  coverage and errors.
                </p>
                <details>
                  <summary>Tips for good coverage</summary>
                  <ul class="capture-checklist">
                    <li>Cover the edges and all four corners.</li>
                    <li>Use large close-ups and varied distances.</li>
                    <li>Tilt forward/back and left/right, up to about 45°.</li>
                    <li>Keep the camera still and the board rigid.</li>
                    <li>Use even light; avoid glare and motion blur.</li>
                  </ul>
                  <a
                    class="small"
                    href="https://mrcal.secretsauce.net/how-to-calibrate.html"
                    target="_blank"
                    rel="noopener"
                    >mrcal capture guidance</a
                  >
                </details>
                <details>
                  <summary>Advanced solve settings</summary>
                  <LensModelSettings
                    :model="session.lensModel"
                    :spline="session.splineModel"
                    :disabled="working || cameraBusy"
                    @change="selectModel"
                  />
                  <label
                    >Approximate horizontal FOV · degrees<input
                      v-model.number="session.fov"
                      type="number"
                      min="10"
                      max="170"
                      :disabled="working || cameraBusy"
                      @change="
                        session.revision++;
                        persist();
                      "
                  /></label>
                  <p class="small muted">
                    Starting estimate for calibration. Use the lens specification if known.
                  </p>
                </details>
              </details>
              <button
                v-if="session.source === 'import'"
                class="button full-width"
                :disabled="working || cameraBusy"
                @click="fileInput?.click()"
              >
                <ImagePlus :size="17" />Add more images
              </button></template
            >
          </div>
        </div>
      </div>
      <footer v-if="step < 3" class="workflow-footer">
        <span v-if="step === 1" class="small muted"
          >Confirm that focus and zoom will stay fixed.</span
        ><span v-if="step === 2" class="small muted">{{
          included.length < 12
            ? `${12 - included.length} more images needed to calibrate.`
            : 'Ready to calibrate. You can still add images.'
        }}</span
        ><button
          v-if="step === 0"
          class="button primary"
          :disabled="
            !connected || working || cameraBusy || cameraSettingsPending || engineState !== 'ready'
          "
          @click="setStep(1)"
        >
          Continue to focus<ChevronRight :size="17" /></button
        ><button
          v-if="step === 1"
          class="button primary"
          :disabled="!connected || working || cameraBusy"
          @click="confirmFocus"
        >
          Focus is set<ChevronRight :size="17" /></button
        ><button v-if="step === 2" class="button primary" :disabled="!canSolve" @click="calibrate">
          <Aperture :size="18" />Calibrate {{ included.length }} images
        </button>
      </footer>
      <div class="page-footnote">
        <span>Images are processed and saved in this browser.</span>
        <span
          >PhotonCal · mrcal + OpenCV ·
          <a href="./LICENSE.txt" target="_blank" rel="noopener">GPL-3.0-or-later</a></span
        >
        <span
          ><a href="https://github.com/willtoth/photoncal">Source code</a> ·
          <a href="./THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener">Notices</a></span
        >
      </div>
    </main>
    <FrameViewer
      v-if="activeFrame"
      :key="`${activeFrame}/${session.lensModel}`"
      :session="session"
      :frame-id="activeFrame"
      @close="activeFrame = undefined"
    />
  </div>
</template>
