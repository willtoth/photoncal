<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import {
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
  ShieldCheck,
  Usb,
  RefreshCw,
  AlertTriangle,
  X,
  Pause,
  Play,
  ImagePlus,
  Move,
  Info,
  LoaderCircle,
} from 'lucide-vue-next';
import { useCalibration } from './useCalibration';
import CameraControls from './components/CameraControls.vue';
import BoardSettings from './components/BoardSettings.vue';
import CaptureOverlay from './components/CaptureOverlay.vue';
import FrameGallery from './components/FrameGallery.vue';
import FrameViewer from './components/FrameViewer.vue';
import ResultsPanel from './components/ResultsPanel.vue';
const {
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
} = useCalibration();
const fileInput = ref<HTMLInputElement>(),
  archiveInput = ref<HTMLInputElement>(),
  sessionMenu = ref(false);
const steps = [
  { title: 'Camera', subtitle: 'Choose your setup', icon: CameraIcon },
  { title: 'Focus', subtitle: 'Find the sharpest view', icon: Focus },
  { title: 'Capture', subtitle: 'Build your dataset', icon: ScanLine },
  { title: 'Results', subtitle: 'Inspect & export', icon: ChartNoAxesCombined },
];
const titles = [
  'Start with your camera.',
  'Bring every detail into focus.',
  'Move. Hold. Capture.',
  'See how your calibration performs.',
];
const descriptions = [
  'Choose the resolution you’ll use in PhotonVision, then adjust your camera’s image.',
  'Focus at your working distance, check the edges, then lock the lens in place.',
  'Fill the image with varied views of your board. We’ll capture when you hold it still.',
  'Inspect coverage, residuals, and uncertainty before downloading your camera model.',
];
const resolution = computed({
  get: () => `${session.value.width}x${session.value.height}`,
  set: (value: string) => {
    const [w, h] = value.split('x').map(Number);
    session.value.width = w!;
    session.value.height = h!;
    resetFocus();
  },
});
const commonRes = [
  '640x480',
  '800x600',
  '960x720',
  '1280x720',
  '1280x800',
  '1280x960',
  '1920x1080',
  '1920x1200',
  '2560x1440',
  '3840x2160',
];
const resolutions = computed(() => Array.from(new Set([...commonRes, resolution.value])));
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
const unavailable = computed(() =>
  ['brightness', 'contrast', 'exposureTime', 'focusDistance'].filter(
    (key) => !controls.value.some((c) => c.key === key),
  ),
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
  if ((event.target as HTMLElement).closest('input,select,textarea,button,dialog')) return;
  if (event.code === 'Space' && step.value === 2 && connected.value) {
    event.preventDefault();
    capture();
  }
  if (event.key === 'Escape') auto.value = false;
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
        ><span class="brand-tag">CAMERA LAB</span></a
      >
      <div class="topbar-actions">
        <span class="privacy"><ShieldCheck :size="15" />On your device</span
        ><button class="header-button" :disabled="working" @click="archiveInput?.click()">
          <FolderOpen :size="16" /><span>Open archive</span></button
        ><button
          class="header-button"
          :disabled="working || archiveProgress !== undefined"
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
      <div class="sidebar-label">YOUR CALIBRATION</div>
      <nav aria-label="Calibration steps">
        <button
          v-for="(item, index) in steps"
          :key="item.title"
          class="step-item"
          :class="{ active: step === index, complete: step > index }"
          :aria-current="step === index ? 'step' : undefined"
          :disabled="working"
          @click="setStep(index)"
        >
          <span class="step-icon"
            ><Check v-if="step > index" :size="19" /><component
              :is="item.icon"
              v-else
              :size="19" /></span
          ><span class="step-copy"
            ><strong>{{ item.title }}</strong
            ><small>{{ item.subtitle }}</small></span
          ><span class="step-index">0{{ index + 1 }}</span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="session-summary">
          <span class="sidebar-label">THIS SESSION</span
          ><strong>{{ session.cameraLabel || 'No camera selected' }}</strong
          ><span>{{ session.width }} × {{ session.height }} · {{ included.length }} images</span>
          <div class="mini-progress"><span :style="{ width: coverageData.percent + '%' }" /></div>
          <small>{{ coverageData.percent.toFixed(0) }}% image coverage</small>
        </div>
        <button class="button full-width" :disabled="working" @click="startNew">
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
            :disabled="working"
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
          <p v-if="!sessions.length" class="small muted">Your sessions will be saved here.</p>
        </div>
        <p class="local-note">
          Images and calibration data stay in your browser. Save an archive before clearing site
          data.
        </p>
      </div>
    </aside>
    <main class="main-content">
      <div class="mobile-session-actions">
        <button class="button small-button" :disabled="working || connecting" @click="startNew">
          <Plus :size="15" />New calibration
        </button>
        <select
          aria-label="Saved sessions"
          :disabled="working || connecting"
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
          <div class="eyebrow">
            STEP 0{{ step + 1 }} <span>/</span> {{ steps[step]!.title.toUpperCase() }}
          </div>
          <h1>{{ titles[step] }}</h1>
          <p>{{ descriptions[step] }}</p>
        </div>
        <div class="engine-pill" :class="engineState">
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
          <p>
            {{ engineError }} If the WASM assets are missing, run
            <code>npm run build:wasm</code> from the project folder.
          </p>
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

      <div v-show="step < 3" class="workspace">
        <div class="workspace-main">
          <section class="preview-panel">
            <div class="preview-heading">
              <span
                ><span class="live-dot" :class="{ on: connected }" />{{
                  connected
                    ? 'LIVE VIEW'
                    : session.source === 'import'
                      ? 'IMAGE DATASET'
                      : 'CAMERA PREVIEW'
                }}</span
              ><span
                >{{ session.width }} × {{ session.height
                }}<template v-if="connected">
                  · {{ Number(settings.frameRate ?? 0).toFixed(0) }} fps</template
                ></span
              >
            </div>
            <div
              class="viewport-media"
              :class="{ flash: captureFlash, selectable: step === 1 && connected }"
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
                <div class="empty-reticle"><CameraIcon :size="40" :stroke-width="1.2" /></div>
                <h2>
                  {{
                    session.source === 'import'
                      ? 'Your images, your calibration.'
                      : 'A better view starts here.'
                  }}
                </h2>
                <p>
                  {{
                    session.source === 'import'
                      ? 'Check the board settings, then analyze your images.'
                      : 'Connect a camera to see its live image and available controls.'
                  }}
                </p>
                <button
                  v-if="step === 0 && session.source !== 'import'"
                  class="button mint-button"
                  :disabled="connecting"
                  @click="connect"
                >
                  <Usb :size="17" />{{ connecting ? 'Connecting…' : 'Connect camera' }}</button
                ><button
                  v-if="session.source === 'import'"
                  class="button mint-button"
                  :disabled="working"
                  @click="fileInput?.click()"
                >
                  <ImagePlus :size="17" />Choose images</button
                ><button
                  v-if="step === 2 && session.source === 'camera'"
                  class="button mint-button"
                  :disabled="working || connecting"
                  @click="connect"
                >
                  Reconnect camera</button
                ><span class="preview-private"
                  ><ShieldCheck :size="14" />Processed locally. Nothing uploaded.</span
                >
              </div>
              <div v-if="connected && step === 2" class="capture-hud" role="status">
                <span class="detection-dot" :class="{ found: analysis?.valid }" /><span>{{
                  auto
                    ? captureReason
                    : analysis?.valid
                      ? 'Board detected · ready to capture'
                      : analysis?.reason || 'Looking for your board…'
                }}</span
                ><span v-if="analysis?.corners.length" class="hud-count"
                  >{{ analysis.corners.length }} corners</span
                >
                <div v-if="auto" class="hold-progress">
                  <span :style="{ width: captureProgress * 100 + '%' }" />
                </div>
              </div>
              <div v-if="connected && step === 1" class="focus-hint">
                Click the image to move the focus area
              </div>
            </div>
            <div class="preview-footer">
              <template v-if="step === 2"
                ><label class="check-label"
                  ><input v-model="showDots" type="checkbox" />Captured corners</label
                ><label class="check-label"
                  ><input v-model="showCoverage" type="checkbox" />Coverage grid</label
                ><span class="preview-footer-right"
                  >{{ coverageData.percent.toFixed(0) }}% covered</span
                ></template
              ><template v-else
                ><span><ShieldCheck :size="14" />Private by design</span
                ><span>{{
                  connected ? session.cameraLabel : 'USB and built-in cameras supported'
                }}</span></template
              >
            </div>
          </section>

          <div v-if="step === 0" class="tip-strip">
            <Info :size="20" />
            <div>
              <strong>One camera. One resolution. One calibration.</strong>
              <p>
                Use the same physical camera, resolution, focus, and zoom when you import the result
                into PhotonVision.
              </p>
            </div>
          </div>
          <template v-if="step === 1">
            <section class="panel focus-dashboard">
              <div class="focus-magnifier">
                <canvas
                  ref="magnifier"
                  width="320"
                  height="200"
                  aria-label="Magnified focus area"
                /><span>Pixel detail · selected area</span>
              </div>
              <div class="focus-metrics">
                <span class="eyebrow">LIVE SHARPNESS</span>
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
                    Reset peak
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
                  Compare while the scene and exposure stay fixed. This is an adjustment aid, not an
                  absolute quality score.
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
            <div class="capture-toolbar">
              <div class="auto-capture">
                <button
                  class="toggle"
                  :class="{ enabled: auto }"
                  role="switch"
                  :aria-checked="auto"
                  aria-label="Automatic capture"
                  :disabled="!connected || working || engineState !== 'ready'"
                  @click="auto = !auto"
                >
                  <span />
                </button>
                <div>
                  <strong>Automatic capture</strong
                  ><small>{{
                    auto ? 'Hold still. We’ll take the shot.' : 'Capture useful views as you move.'
                  }}</small>
                </div>
              </div>
              <button
                class="button"
                :disabled="!connected || working || !analysis?.valid"
                @click="capture"
              >
                <CameraIcon :size="17" />Capture now <kbd>Space</kbd>
              </button>
            </div>
            <div class="capture-guidance">
              <Move :size="22" />
              <p>{{ guidance }}</p>
            </div>
            <div v-if="pendingImports.length" class="panel import-review">
              <h3>{{ pendingImports.length }} images ready to analyze</h3>
              <p class="small muted">
                Check your target settings first. Images with different dimensions or insufficient
                board detections will be skipped.
              </p>
              <label class="check-label"
                ><input v-model="importAgreement" type="checkbox" />All images use the same camera,
                resolution, focus, and zoom.</label
              ><button
                class="button primary"
                :disabled="working || !importAgreement || engineState !== 'ready'"
                @click="importImages"
              >
                Analyze images
              </button>
            </div>
            <details v-if="importErrors.length" class="panel">
              <summary>{{ importErrors.length }} images were not accepted</summary>
              <ul class="import-errors">
                <li v-for="item in importErrors" :key="item">{{ item }}</li>
              </ul>
            </details>
            <FrameGallery
              :session="session"
              :disabled="working || archiveProgress !== undefined"
              @inspect="activeFrame = $event"
              @toggle="toggleFrame"
              @remove="deleteFrame"
            />
          </template>
        </div>
        <div class="workspace-side">
          <template v-if="step === 0">
            <section class="panel camera-setup">
              <div class="panel-heading">
                <h3>Camera setup</h3>
                <Usb :size="18" class="muted" />
              </div>
              <fieldset :disabled="connecting || working">
                <label
                  >Camera<select v-model="deviceId">
                    <option value="">Default camera</option>
                    <option
                      v-for="(device, index) in devices"
                      :key="device.deviceId"
                      :value="device.deviceId"
                    >
                      {{ device.label || `Camera ${index + 1}` }}
                    </option>
                  </select></label
                ><label
                  >Resolution<select v-model="resolution" :disabled="session.frames.length > 0">
                    <option v-for="res in resolutions" :key="res" :value="res">
                      {{ res.replace('x', ' × ') }}
                    </option>
                  </select></label
                >
                <details class="custom-resolution">
                  <summary>Custom resolution</summary>
                  <div class="field-pair">
                    <label
                      >Width<input
                        v-model.number="session.width"
                        :disabled="session.frames.length > 0"
                        type="number"
                        min="16"
                        max="8192" /></label
                    ><label
                      >Height<input
                        v-model.number="session.height"
                        :disabled="session.frames.length > 0"
                        type="number"
                        min="16"
                        max="8192"
                    /></label>
                  </div>
                </details>
              </fieldset>
              <p class="small muted">
                Modes are verified when connecting. Your camera may support only some of these
                resolutions.
              </p>
              <button
                class="button primary full-width"
                :disabled="connecting || working"
                @click="connect"
              >
                <RefreshCw v-if="connected" :size="16" /><CameraIcon v-else :size="16" />{{
                  connecting ? 'Connecting…' : connected ? 'Apply & reconnect' : 'Connect camera'
                }}</button
              ><button v-if="connected" class="text-button full-width" @click="stopCamera">
                Disconnect
              </button>
              <div class="or-divider"><span>or</span></div>
              <button class="button full-width" :disabled="working" @click="fileInput?.click()">
                <ImagePlus :size="17" />Use saved images
              </button>
            </section>
            <CameraControls
              v-if="connected"
              :controls="controls"
              :settings="settings"
              :locked="!!session.frames.length"
              @change="changeControl"
            />
            <section v-if="connected" class="panel">
              <h3>Camera details</h3>
              <dl class="camera-details">
                <div>
                  <dt>Device</dt>
                  <dd>{{ session.cameraLabel }}</dd>
                </div>
                <div>
                  <dt>Delivered mode</dt>
                  <dd>
                    {{ settings.width }} × {{ settings.height }} @
                    {{ Number(settings.frameRate).toFixed(1) }} fps
                  </dd>
                </div>
                <div>
                  <dt>Resize mode</dt>
                  <dd>{{ settings.resizeMode ?? 'Not reported' }}</dd>
                </div>
                <div>
                  <dt>Aspect ratio</dt>
                  <dd>
                    {{ Number(settings.aspectRatio ?? session.width / session.height).toFixed(3) }}
                  </dd>
                </div>
              </dl>
              <p v-if="unavailable.length" class="small muted">
                Not exposed:
                {{
                  unavailable
                    .map(
                      (s) =>
                        ({
                          brightness: 'brightness',
                          contrast: 'contrast',
                          exposureTime: 'shutter speed',
                          focusDistance: 'focus distance',
                        })[s],
                    )
                    .join(', ')
                }}.
              </p>
            </section>
          </template>
          <template v-if="step === 1"
            ><section class="panel guidance-panel">
              <div class="panel-heading">
                <h3>A sharp starting point</h3>
                <Focus :size="20" />
              </div>
              <ol class="instruction-list">
                <li>
                  <strong>Use your working distance.</strong>
                  <p>
                    Place a detailed target where you’ll normally track objects. Keep the camera and
                    target still.
                  </p>
                </li>
                <li>
                  <strong>Adjust slowly.</strong>
                  <p>
                    Use bright, diffuse light and fixed exposure. Turn the lens through the sharpest
                    point, then return to the best score.
                  </p>
                </li>
                <li>
                  <strong>Check the whole image.</strong>
                  <p>
                    Inspect the center and edges without refocusing between them. Find a useful
                    balance.
                  </p>
                </li>
                <li>
                  <strong>Lock it in.</strong>
                  <p>
                    Secure the lens and disable autofocus. Keep that setting throughout calibration
                    and use.
                  </p>
                </li>
              </ol>
              <p class="small muted">
                Close-up calibration views can look softer. Don’t refocus for each board position.
              </p>
              <a
                class="small"
                href="https://www.edmundoptics.com/knowledge-center/application-notes/imaging/testing-and-targets/"
                target="_blank"
                rel="noopener"
                >Why edge focus matters</a
              >
            </section>
            <CameraControls
              :controls="
                controls.filter((c) =>
                  ['focusMode', 'focusDistance', 'exposureMode', 'exposureTime'].includes(c.key),
                )
              "
              :settings="settings"
              :locked="!!session.frames.length"
              @change="changeControl"
            />
            <div v-if="!controls.some((c) => c.key === 'focusMode')" class="tip-strip small">
              <Info :size="20" />
              <p>
                Focus locking isn’t exposed by this camera. Adjust and lock the lens physically, or
                confirm that it is fixed-focus.
              </p>
            </div></template
          >
          <template v-if="step === 2"
            ><BoardSettings
              v-model="session.board"
              :disabled="working || session.frames.length > 0"
              @update:model-value="persist"
              @print="downloadTarget"
            />
            <section class="panel">
              <div class="panel-heading">
                <h3>A useful set of views</h3>
                <span class="count">{{ included.length }}</span>
              </div>
              <div class="capture-count">
                <strong>{{ included.length }}</strong
                ><span>/ about 100 views</span>
              </div>
              <div class="dataset-progress">
                <span :style="{ width: Math.min(included.length, 100) + '%' }" />
              </div>
              <p class="small muted">
                12 images enable a first solve. Around 100 varied views are a useful goal; quality
                and coverage matter more than the count.
              </p>
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
              <details>
                <summary>Advanced solve settings</summary>
                <label
                  >Approximate horizontal FOV · degrees<input
                    v-model.number="session.fov"
                    type="number"
                    min="10"
                    max="170"
                    :disabled="working"
                    @change="
                      session.revision++;
                      persist();
                    "
                /></label>
                <p class="small muted">
                  An initial estimate, not a measured result. Use the lens specification if known.
                </p>
              </details>
            </section>
            <button
              v-if="session.source === 'import'"
              class="button full-width"
              :disabled="working"
              @click="fileInput?.click()"
            >
              <ImagePlus :size="17" />Add more images
            </button></template
          >
        </div>
      </div>
      <ResultsPanel
        v-if="step === 3 && session.result"
        :session="session"
        :working="working"
        @download="exportJson"
        @archive="exportArchive"
        @capture="setStep(2)"
        @consistency="consistency"
        @recalibrate="calibrate"
      />
      <FrameGallery
        v-if="step === 3 && session.frames.length"
        :session="session"
        :disabled="working || archiveProgress !== undefined"
        @inspect="activeFrame = $event"
        @toggle="toggleFrame"
        @remove="deleteFrame"
      />
      <footer v-if="step < 3" class="workflow-footer">
        <span v-if="step === 0" class="small muted">{{
          connected
            ? 'Live camera connected. Your next step is focus.'
            : 'Connect your camera or select an image set to begin.'
        }}</span
        ><span v-if="step === 1" class="small muted"
          >Continuing confirms your lens is focused and will remain fixed.</span
        ><span v-if="step === 2" class="small muted">{{
          included.length < 12
            ? `Capture ${12 - included.length} more useful views to enable calibration.`
            : 'You can calibrate now or keep collecting more views.'
        }}</span
        ><button
          v-if="step === 0"
          class="button primary"
          :disabled="!connected || working || engineState !== 'ready'"
          @click="setStep(1)"
        >
          Continue to focus<ChevronRight :size="17" /></button
        ><button
          v-if="step === 1"
          class="button primary"
          :disabled="!connected || working"
          @click="confirmFocus"
        >
          Focus is set<ChevronRight :size="17" /></button
        ><button v-if="step === 2" class="button primary" :disabled="!canSolve" @click="calibrate">
          <Aperture :size="18" />Calibrate {{ included.length }} images
        </button>
      </footer>
      <div class="page-footnote">
        <span
          >PhotonCal · mrcal + OpenCV ·
          <a href="./LICENSE.txt" target="_blank" rel="noopener">GPL-3.0-or-later</a></span
        >
        <span
          ><a href="./source/photoncal-source.tar.gz">Source code</a> ·
          <a href="./THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener">Notices</a></span
        >
      </div>
    </main>
    <FrameViewer
      v-if="activeFrame"
      :key="activeFrame"
      :session="session"
      :frame-id="activeFrame"
      @close="activeFrame = undefined"
    />
  </div>
</template>
