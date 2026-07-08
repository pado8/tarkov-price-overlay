// 브라우저 Canvas 기반 이미지 파이프 — image-convert / jpg-to-pdf 등에서 공유

export type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp';

export const FORMAT_EXT: Record<ImageFormat, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`이미지를 열 수 없습니다: ${file.name}`));
      img.src = url;
    });
    return img;
  } finally {
    // 디코드 완료 후 revoke해도 draw는 가능
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function convertImage(
  file: File,
  format: ImageFormat,
  quality = 0.92,
): Promise<Blob> {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('브라우저가 캔버스를 지원하지 않습니다.');
  if (format === 'image/jpeg') {
    // JPG는 투명도 미지원 — 흰색 배경으로 합성
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format, quality),
  );
  if (!blob) throw new Error('변환에 실패했습니다. 다른 형식을 시도해 보세요.');
  return blob;
}

export function replaceExt(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return `${base}.${ext}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
