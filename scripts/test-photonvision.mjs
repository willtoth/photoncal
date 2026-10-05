import { mkdir, access, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'),
  dir = path.join(root, '.build/compat');
const jar =
  process.env.PHOTONVISION_JAR ??
  path.resolve(root, '../photonvision/photon-core/build/libs/photon-core.jar');
const input = process.argv[2];
if (!input)
  throw new Error(
    'Pass a browser-exported 1280px calibration JSON filename. PHOTONVISION_JAR must point to a built Jackson-based PhotonVision (2025) core jar.',
  );
await access(jar);
await mkdir(dir, { recursive: true });
const dependencies = [
  ...['io', 'util'].map((a) => [
    `jetty-${a}`,
    `https://repo.maven.apache.org/maven2/org/eclipse/jetty/jetty-${a}/11.0.24/jetty-${a}-11.0.24.jar`,
  ]),
  [
    'slf4j-api',
    'https://repo.maven.apache.org/maven2/org/slf4j/slf4j-api/2.0.16/slf4j-api-2.0.16.jar',
  ],
  ...['annotations', 'core', 'databind'].map((a) => [
    `jackson-${a}`,
    `https://repo.maven.apache.org/maven2/com/fasterxml/jackson/core/jackson-${a}/2.17.2/jackson-${a}-2.17.2.jar`,
  ]),
  ...['wpimath', 'wpiutil', 'wpiunits'].map((a) => [
    a,
    `https://frcmaven.wpi.edu/artifactory/api/download/release/edu/wpi/first/${a}/${a}-java/2025.2.1/${a}-java-2025.2.1.jar`,
  ]),
  [
    'opencv',
    'https://frcmaven.wpi.edu/artifactory/api/download/release/edu/wpi/first/thirdparty/frc2025/opencv/opencv-java/4.10.0-3/opencv-java-4.10.0-3.jar',
  ],
  ...['core', 'simple', 'ddense', 'dsparse', 'fdense', 'fsparse', 'cdense', 'zdense'].map((a) => [
    `ejml-${a}`,
    `https://repo.maven.apache.org/maven2/org/ejml/ejml-${a}/0.43.1/ejml-${a}-0.43.1.jar`,
  ]),
  [
    'quickbuf',
    'https://repo.maven.apache.org/maven2/us/hebi/quickbuf/quickbuf-runtime/1.3.3/quickbuf-runtime-1.3.3.jar',
  ],
];
for (const [name, url] of dependencies) {
  const file = path.join(dir, `${name}.jar`);
  try {
    await access(file);
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    await writeFile(file, new Uint8Array(await response.arrayBuffer()));
  }
}
function run(cmd, args) {
  const p = spawnSync(cmd, args, { stdio: 'inherit', cwd: root });
  if (p.status !== 0) throw new Error(`${cmd} failed`);
}
run('javac', ['-d', dir, 'tests/compat/PhotonVisionImport.java']);
run('java', [
  '-cp',
  [dir, jar, path.join(dir, '*')].join(path.delimiter),
  'PhotonVisionImport',
  path.resolve(input),
]);
