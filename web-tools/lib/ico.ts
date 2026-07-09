// PNG 엔트리 기반 ICO 컨테이너 인코더.
// 현행 브라우저·윈도우 10+는 ICO 내부의 PNG 압축 엔트리를 지원한다.
export function buildIcoFromPngs(pngs: { size: number; data: ArrayBuffer }[]): Blob {
  const count = pngs.length;
  const headerSize = 6 + 16 * count;
  const totalSize = headerSize + pngs.reduce((s, p) => s + p.data.byteLength, 0);
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: 1 = icon
  view.setUint16(4, count, true);

  let offset = headerSize;
  pngs.forEach((p, i) => {
    const entry = 6 + i * 16;
    view.setUint8(entry, p.size >= 256 ? 0 : p.size); // width (0 = 256)
    view.setUint8(entry + 1, p.size >= 256 ? 0 : p.size); // height
    view.setUint8(entry + 2, 0); // palette count
    view.setUint8(entry + 3, 0); // reserved
    view.setUint16(entry + 4, 1, true); // color planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, p.data.byteLength, true);
    view.setUint32(entry + 12, offset, true);
    bytes.set(new Uint8Array(p.data), offset);
    offset += p.data.byteLength;
  });

  return new Blob([buf], { type: 'image/x-icon' });
}

// 이미지를 가운데 기준 정사각형으로 잘라 size×size PNG로 변환
export async function squarePng(img: HTMLImageElement, size: number): Promise<ArrayBuffer> {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('PNG 생성 실패');
  return blob.arrayBuffer();
}
