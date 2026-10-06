import { openDB } from 'idb';
import { Zip, ZipPassThrough, Unzip, UnzipInflate, strToU8 } from 'fflate';
import type { Frame, Session } from './types';
const dbPromise = () =>
  openDB('photoncal', 1, {
    upgrade(db) {
      db.createObjectStore('sessions', { keyPath: 'id' });
      db.createObjectStore('images');
    },
  });
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export async function saveSession(session: Session) {
  const db = await dbPromise();
  if (!session.frames.length) return;
  session.updatedAt = Date.now();
  await db.put('sessions', plain(session));
}
export async function listSessions(): Promise<Session[]> {
  const db = await dbPromise();
  return (await db.getAll('sessions'))
    .filter((session: Session) => session.frames.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function addFrame(session: Session, frame: Frame, blob: Blob) {
  const db = await dbPromise(),
    tx = db.transaction(['sessions', 'images'], 'readwrite');
  const next = {
    ...plain(session),
    frames: [...plain(session.frames), frame],
    revision: session.revision + 1,
    updatedAt: Date.now(),
  };
  await tx.objectStore('images').put(blob, `${session.id}/${frame.id}`);
  await tx.objectStore('sessions').put(next);
  await tx.done;
  Object.assign(session, next);
}
export async function getImage(sessionId: string, frameId: string): Promise<Blob | undefined> {
  return (await dbPromise()).get('images', `${sessionId}/${frameId}`);
}
export async function removeFrame(session: Session, id: string) {
  const db = await dbPromise(),
    tx = db.transaction(['sessions', 'images'], 'readwrite');
  const next = {
    ...plain(session),
    frames: session.frames.filter((f) => f.id !== id).map(plain),
    revision: session.revision + 1,
    updatedAt: Date.now(),
  };
  await tx.objectStore('images').delete(`${session.id}/${id}`);
  if (next.frames.length) await tx.objectStore('sessions').put(next);
  else await tx.objectStore('sessions').delete(session.id);
  await tx.done;
  Object.assign(session, next);
}
export async function archiveSession(
  session: Session,
  onProgress: (n: number) => void,
): Promise<Blob> {
  const chunks: BlobPart[] = [];
  let error: Error | undefined;
  const zip = new Zip((err, data) => {
    if (err) error = err;
    else chunks.push(new Uint8Array(data).buffer);
  });
  const manifest = new ZipPassThrough('session.json');
  zip.add(manifest);
  manifest.push(strToU8(JSON.stringify(plain(session))), true);
  for (let i = 0; i < session.frames.length; i++) {
    const f = session.frames[i]!,
      blob = await getImage(session.id, f.id);
    if (!blob) throw new Error(`The image for ${f.name} is missing. Archive creation stopped.`);
    const member = new ZipPassThrough(`images/${f.id}.png`);
    zip.add(member);
    member.push(new Uint8Array(await blob.arrayBuffer()), true);
    onProgress((i + 1) / session.frames.length);
    if (error) throw error;
  }
  zip.end();
  if (error) throw error;
  return new Blob(chunks, { type: 'application/zip' });
}
export function validateSession(value: unknown): Session {
  const s = value as Session;
  if (
    !s ||
    s.version !== 1 ||
    !s.board ||
    !Array.isArray(s.frames) ||
    s.frames.length > 5000 ||
    !Number.isInteger(s.width) ||
    !Number.isInteger(s.height) ||
    s.width < 16 ||
    s.height < 16 ||
    s.width * s.height > 33554432
  )
    throw new Error('This is not a supported PhotonCal session.');
  const b = s.board;
  if (
    !['charuco', 'chessboard'].includes(b.kind) ||
    !Number.isInteger(b.columns) ||
    !Number.isInteger(b.rows) ||
    b.columns < 3 ||
    b.rows < 3 ||
    b.columns > 40 ||
    b.rows > 40 ||
    !Number.isFinite(b.squareSize) ||
    b.squareSize <= 0 ||
    b.squareSize > 10
  )
    throw new Error('Invalid board settings in the archive.');
  if (
    b.kind === 'charuco' &&
    (!Number.isFinite(b.markerSize) ||
      b.markerSize <= 0 ||
      b.markerSize >= b.squareSize ||
      !Number.isInteger(b.dictionary) ||
      b.dictionary < 0 ||
      b.dictionary > 16 ||
      typeof b.legacy !== 'boolean')
  )
    throw new Error('Invalid marker settings in the archive.');
  if (
    !['camera', 'import'].includes(s.source) ||
    !Number.isInteger(s.revision) ||
    s.revision < 0 ||
    typeof s.name !== 'string' ||
    typeof s.cameraLabel !== 'string' ||
    !s.settings ||
    typeof s.settings !== 'object'
  )
    throw new Error('Invalid session metadata.');
  const ids = new Set<string>();
  for (const f of s.frames) {
    if (
      !f ||
      typeof f.id !== 'string' ||
      !/^[\w-]{1,80}$/.test(f.id) ||
      ids.has(f.id) ||
      !Array.isArray(f.corners) ||
      typeof f.included !== 'boolean' ||
      typeof f.name !== 'string'
    )
      throw new Error('Invalid frame in the archive.');
    ids.add(f.id);
    const corners = new Set<number>();
    for (const p of f.corners) {
      if (
        !Number.isInteger(p.id) ||
        p.id < 0 ||
        p.id >= (b.columns - 1) * (b.rows - 1) ||
        corners.has(p.id) ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x >= s.width ||
        p.y < 0 ||
        p.y >= s.height
      )
        throw new Error('Invalid corner in the archive.');
      corners.add(p.id);
    }
  }
  if (!Number.isFinite(s.fov) || s.fov < 10 || s.fov > 170)
    throw new Error('Invalid focal-length seed.');
  if (s.result) {
    const r = s.result,
      finite = (a: unknown, n: number): a is number[] =>
        Array.isArray(a) && a.length === n && a.every(Number.isFinite);
    if (
      !finite(r.intrinsics, 12) ||
      !finite(r.warp, 2) ||
      !Number.isFinite(r.rms) ||
      !Number.isFinite(r.mean) ||
      !Array.isArray(r.views) ||
      !Number.isInteger(s.resultRevision)
    )
      throw new Error('Invalid calibration result.');
    for (const v of r.views)
      if (
        typeof v.id !== 'string' ||
        !Number.isFinite(v.mean) ||
        !Number.isFinite(v.rms) ||
        !Array.isArray(v.residuals) ||
        v.residuals.some((p) => ![p.x, p.y, p.dx, p.dy].every(Number.isFinite))
      )
        throw new Error('Invalid residual data.');
    for (const g of [r.uncertainty, r.consistency])
      if (
        g &&
        (!Number.isInteger(g.width) ||
          !Number.isInteger(g.height) ||
          g.width < 2 ||
          g.height < 2 ||
          g.width > 100 ||
          g.height > 100 ||
          !Array.isArray(g.values) ||
          g.values.length !== g.width * g.height ||
          g.values.some((v) => v !== null && (!Number.isFinite(v) || v < 0)))
      )
        throw new Error('Invalid diagnostic grid.');
  }
  return s;
}
export async function importArchive(file: File, onProgress: (n: number) => void): Promise<Session> {
  if (file.size > 2_000_000_000) throw new Error('Archives larger than 2 GB are not supported.');
  const entries = new Map<string, Blob>();
  let total = 0,
    failure: Error | undefined;
  const unzip = new Unzip((entry) => {
    if (entry.name !== 'session.json' && !/^images\/[\w-]{1,80}\.png$/.test(entry.name)) {
      entry.terminate();
      return;
    }
    if (entries.has(entry.name)) {
      failure = new Error('Duplicate archive entry');
      return;
    }
    const parts: BlobPart[] = [];
    let size = 0;
    entry.ondata = (err, data, final) => {
      if (err) {
        failure = err;
        return;
      }
      total += data.length;
      size += data.length;
      const limit = entry.name === 'session.json' ? 100_000_000 : 140_000_000;
      if (total > 2_000_000_000 || size > limit) {
        failure = new Error('Archive expands beyond safe storage limits.');
        entry.terminate();
        return;
      }
      parts.push(new Uint8Array(data).buffer);
      if (final)
        entries.set(
          entry.name,
          new Blob(parts, { type: entry.name.endsWith('.png') ? 'image/png' : 'application/json' }),
        );
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  const reader = file.stream().getReader();
  let read = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      unzip.push(new Uint8Array(), true);
      break;
    }
    unzip.push(value);
    read += value.length;
    onProgress(read / file.size);
    if (failure) {
      await reader.cancel();
      throw failure;
    }
  }
  if (failure) throw failure;
  const manifest = entries.get('session.json');
  if (!manifest) throw new Error('Archive is missing session.json.');
  const session = validateSession(JSON.parse(await manifest.text()));
  for (const f of session.frames)
    if (!entries.has(`images/${f.id}.png`)) throw new Error(`Archive is missing ${f.name}.`);
  session.id = crypto.randomUUID();
  session.updatedAt = Date.now();
  if (!session.frames.length) return session;
  // Restore atomically: a corrupt or over-quota archive never replaces a session.
  const db = await dbPromise(),
    tx = db.transaction(['sessions', 'images'], 'readwrite');
  for (const f of session.frames)
    await tx.objectStore('images').put(entries.get(`images/${f.id}.png`)!, `${session.id}/${f.id}`);
  await tx.objectStore('sessions').put(session);
  await tx.done;
  return session;
}
