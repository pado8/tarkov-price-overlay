// TS 5.7+에서 라이브러리가 반환하는 Uint8Array<ArrayBufferLike>는 BlobPart에 바로 안 들어감
export function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as unknown as BlobPart], { type });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function saveAsZip(
  entries: { name: string; blob: Blob }[],
  zipName: string,
) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const { name, blob } of entries) {
    // 중복 파일명 회피
    let n = name;
    let i = 1;
    while (used.has(n)) {
      n = name.replace(/(\.[^.]+)?$/, (ext) => ` (${i})${ext ?? ''}`);
      i += 1;
    }
    used.add(n);
    zip.file(n, blob);
  }
  const out = await zip.generateAsync({ type: 'blob' });
  saveBlob(out, zipName);
}
