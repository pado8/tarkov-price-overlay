'use client';

import { useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import { saveAsZip, saveBlob } from '@/lib/download';
import { buildIcoFromPngs, squarePng } from '@/lib/ico';
import { formatBytes, loadImage } from '@/lib/image';

const HTML_SNIPPET = `<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">`;

type OutFile = { name: string; blob: Blob };

export default function FaviconGenerator() {
  const [files, setFiles] = useState<OutFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onFiles = async ([file]: File[]) => {
    setBusy(true);
    setError(null);
    setFiles([]);
    try {
      const img = await loadImage(file);
      if (Math.min(img.naturalWidth, img.naturalHeight) < 48) {
        throw new Error('이미지가 너무 작습니다. 최소 48px, 권장 512px 이상을 넣어주세요.');
      }
      const icoPngs = await Promise.all(
        [16, 32, 48].map(async (size) => ({ size, data: await squarePng(img, size) })),
      );
      const pngOf = async (size: number) =>
        new Blob([await squarePng(img, size)], { type: 'image/png' });

      setFiles([
        { name: 'favicon.ico', blob: buildIcoFromPngs(icoPngs) },
        { name: 'apple-touch-icon.png', blob: await pngOf(180) },
        { name: 'android-chrome-192x192.png', blob: await pngOf(192) },
        { name: 'android-chrome-512x512.png', blob: await pngOf(512) },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '파비콘 생성에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <FileDropzone
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        label="로고·아이콘 이미지를 여기에 놓으세요"
        sublabel="정사각형 512px 이상 PNG 권장 (투명 배경 가능)"
        onFiles={onFiles}
      />
      {busy && <p className="mt-3 text-center text-sm text-gray-600">생성 중…</p>}
      {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}

      {files.length > 0 && (
        <div className="mt-6" data-testid="favicon-results">
          <ul className="space-y-2">
            {files.map((f) => (
              <li
                key={f.name}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3"
              >
                <p className="min-w-0 truncate font-medium text-gray-900">
                  {f.name} <span className="text-sm text-gray-500">({formatBytes(f.blob.size)})</span>
                </p>
                <button
                  type="button"
                  onClick={() => saveBlob(f.blob, f.name)}
                  className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
                >
                  저장
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => saveAsZip(files, 'favicon.zip')}
            className="mt-3 w-full rounded-xl bg-gray-900 px-4 py-3 font-semibold text-white hover:bg-gray-700"
          >
            전체 ZIP 다운로드
          </button>

          <div className="mt-6 rounded-xl bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">사이트 &lt;head&gt;에 붙여넣을 코드</p>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(HTML_SNIPPET);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded-lg bg-gray-200 px-3 py-1 text-sm font-semibold text-gray-700 hover:bg-gray-300"
              >
                {copied ? '복사됨 ✓' : '복사'}
              </button>
            </div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-gray-700">
              {HTML_SNIPPET}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
