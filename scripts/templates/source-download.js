const button = document.querySelector('#download');
const status = document.querySelector('#status');
const digest = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    status.textContent = 'Loading source manifest…';
    const response = await fetch('./manifest.json');
    if (!response.ok) throw new Error(`Manifest download failed (HTTP ${response.status}).`);
    const manifest = await response.json();
    const chunks = [];
    let total = 0;
    for (const [index, part] of manifest.parts.entries()) {
      // Only same-directory generated asset names are accepted.
      if (!/^photoncal-source\.tar\.gz\.\d{3,}\.[a-f0-9]{64}\.part$/.test(part.file))
        throw new Error('Invalid source part name.');
      status.textContent = `Downloading part ${index + 1} of ${manifest.parts.length}…`;
      const response = await fetch(`./${part.file}`);
      if (!response.ok) throw new Error(`Part ${index + 1} failed (HTTP ${response.status}).`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== part.size || (await digest(bytes)) !== part.sha256)
        throw new Error(`Part ${index + 1} failed its checksum. Please retry.`);
      chunks.push(bytes);
      total += bytes.byteLength;
    }
    if (!total || total !== manifest.size) throw new Error('The source download is incomplete.');
    status.textContent = 'Verifying the complete archive…';
    const archive = new Blob(chunks, { type: 'application/gzip' });
    chunks.length = 0;
    if ((await digest(await archive.arrayBuffer())) !== manifest.sha256)
      throw new Error('The archive checksum did not match. Please retry.');
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'photoncal-source.tar.gz';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    status.textContent = 'Source archive verified. Your download is ready.';
  } catch (error) {
    status.textContent = `${error.message} Retry or use the manual download links below.`;
  } finally {
    button.disabled = false;
  }
});
// Do not accept clicks while the module is still loading from a cold CDN edge.
button.disabled = false;
