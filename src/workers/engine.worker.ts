/// <reference lib="webworker" />
import type { Analysis, BoardConfig, Region, SolveRequest, CalibrationResult } from '../core/types';
declare const self: DedicatedWorkerGlobalScope;
let enginePromise: Promise<any> | undefined;
let retained: OffscreenCanvas | undefined;
let retainedToken = 0;
async function engine(base: string) {
  return (enginePromise ??= (async () => {
    self.postMessage({ progress: 'Loading the local calibration engine…' });
    const url = new URL('engine/photoncal.js', base).href;
    const factory = (await import(/* @vite-ignore */ url)).default;
    return factory({
      locateFile: (name: string) => new URL(`engine/${name}`, base).href,
      print: (line: string) => {
        if (/Initial solve|Optimizing|Final, full/.test(line))
          self.postMessage({
            progress: line.replace('LENSMODEL_STEREOGRAPHIC', 'initial lens model'),
          });
      },
      printErr: (line: string) => console.warn('[mrcal]', line),
    });
  })());
}
function parse<T>(text: string): T {
  const data = JSON.parse(text);
  if (data.error) throw new Error(data.error);
  return data;
}
async function pixels(mod: any, canvas: OffscreenCanvas, operation: (ptr: number) => any) {
  const bytes = canvas
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, canvas.width, canvas.height).data;
  const ptr = mod._malloc(bytes.length);
  if (!ptr) throw new Error('Not enough memory to process this image.');
  try {
    mod.HEAPU8.set(bytes, ptr);
    return await operation(ptr);
  } finally {
    mod._free(ptr);
  }
}
async function perform(op: string, args: any, base: string) {
  const mod = await engine(base);
  if (op === 'load') return { ready: true };
  if (op === 'analyze') {
    const bitmap: ImageBitmap = args.bitmap,
      full = new OffscreenCanvas(bitmap.width, bitmap.height);
    full.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const scale = Math.min(1, (args.fullResolution ? Infinity : 1280) / full.width);
    const working =
      scale === 1
        ? full
        : new OffscreenCanvas(Math.round(full.width * scale), Math.round(full.height * scale));
    if (working !== full)
      working.getContext('2d')!.drawImage(full, 0, 0, working.width, working.height);
    const result = await pixels(mod, working, (p) =>
      parse<Analysis>(
        mod.analyze(
          p,
          working.width,
          working.height,
          JSON.stringify({ board: args.board, detect: args.detect, roi: args.roi }),
        ),
      ),
    );
    if (scale !== 1)
      for (const c of result.corners) {
        c.x = (c.x + 0.5) / scale - 0.5;
        c.y = (c.y + 0.5) / scale - 0.5;
      }
    retained = full;
    retainedToken++;
    return { ...result, token: retainedToken, width: full.width, height: full.height };
  }
  if (op === 'capture') {
    if (!retained || args.token !== retainedToken)
      throw new Error('The capture frame expired. Hold the board still and try again.');
    const canvas = retained;
    const analysis = await pixels(mod, canvas, (p) =>
      parse<Analysis>(
        mod.analyze(
          p,
          canvas.width,
          canvas.height,
          JSON.stringify({ board: args.board, detect: true }),
        ),
      ),
    );
    if (!analysis.valid) return { accepted: false, analysis };
    return { accepted: true, analysis, blob: await canvas.convertToBlob({ type: 'image/png' }) };
  }
  if (op === 'solve') return parse<CalibrationResult>(mod.solve(JSON.stringify(args)));
  if (op === 'uncertainty') return parse(mod.uncertainty(JSON.stringify(args)));
  if (op === 'compare') return parse(mod.compare(JSON.stringify(args)));
  if (op === 'board') {
    const size = args.size ?? 1600,
      ptr = mod._malloc(size * size * 4);
    try {
      parse(mod.renderBoard(ptr, size, JSON.stringify(args.board)));
      const canvas = new OffscreenCanvas(size, size),
        ctx = canvas.getContext('2d')!;
      ctx.putImageData(
        new ImageData(
          new Uint8ClampedArray(mod.HEAPU8.slice(ptr, ptr + size * size * 4)),
          size,
          size,
        ),
        0,
        0,
      );
      return await canvas.convertToBlob({ type: 'image/png' });
    } finally {
      mod._free(ptr);
    }
  }
  if (op === 'undistort') {
    const bitmap = await createImageBitmap(args.blob),
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return pixels(mod, canvas, async (source) => {
      const length = canvas.width * canvas.height * 4,
        dest = mod._malloc(length);
      try {
        parse(
          mod.undistort(source, dest, canvas.width, canvas.height, JSON.stringify(args.intrinsics)),
        );
        canvas
          .getContext('2d')!
          .putImageData(
            new ImageData(
              new Uint8ClampedArray(mod.HEAPU8.slice(dest, dest + length)),
              canvas.width,
              canvas.height,
            ),
            0,
            0,
          );
        return await canvas.convertToBlob({ type: 'image/png' });
      } finally {
        mod._free(dest);
      }
    });
  }
  throw new Error('Unknown calibration operation.');
}
// Each worker processes requests serially: retained images and WASM memory have
// a single owner, even when async image encoding yields to the event loop.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const result = await perform(data.op, data.args, data.base);
      self.postMessage({ id: data.id, result });
    } catch (error) {
      if (data.args?.bitmap)
        try {
          data.args.bitmap.close();
        } catch {}
      self.postMessage({
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
