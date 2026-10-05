// Small real-image test set; no access to a running PhotonVision instance.
import { mkdir, copyFile, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const dataset = 'test-resources/calibrationCharucoImg/lifecam/2024-05-07_lifecam_1280';
await mkdir(path.join(root, '.build/fixtures'), { recursive: true });
for (let i = 0; i < 12; i++) {
  const name = `img${i * 10}.png`,
    out = path.join(root, '.build/fixtures', name);
  try {
    await access(out);
    continue;
  } catch {}
  try {
    await copyFile(path.resolve(root, '../photonvision', dataset, name), out);
  } catch {
    const response = await fetch(
      `https://raw.githubusercontent.com/PhotonVision/photonvision/82f7f4c38cd6d2676cdbcb28762e1693c54e96e0/${dataset}/${name}`,
    );
    if (!response.ok)
      throw new Error(`Could not download test fixture ${name}: ${response.status}`);
    await writeFile(out, new Uint8Array(await response.arrayBuffer()));
  }
}
console.log('12 PhotonVision LifeCam test images ready.');
