'use client';

import { useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import ResultList, { type ResultItem } from '@/components/tools/ResultList';

let seq = 0;
let workerBlobUrl: string | null = null;

// 워커는 same-origin이어야 해서 CDN 스크립트를 blob URL로 감싼다 (ffmpeg와 동일 패턴)
async function ensureWorker(pdfjs: typeof import('pdfjs-dist')) {
  if (!workerBlobUrl) {
    const src = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    const code = await (await fetch(src)).blob();
    workerBlobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }
  pdfjs.GlobalWorkerOptions.workerSrc = workerBlobUrl;
}

export default function PdfToImage() {
  const [items, setItems] = useState<ResultItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (id: string, patch: Partial<ResultItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const onFiles = async ([file]: File[]) => {
    setBusy(true);
    setError(null);
    setItems([]);
    try {
      const pdfjs = await import('pdfjs-dist');
      await ensureWorker(pdfjs);
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const base = file.name.replace(/\.pdf$/i, '');
      const pad = String(doc.numPages).length;

      for (let p = 1; p <= doc.numPages; p += 1) {
        const id = `p${seq++}`;
        const name = `${base}_p${String(p).padStart(pad, '0')}.jpg`;
        setItems((prev) => [...prev, { id, name, status: 'working', note: '변환 중…' }]);
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 2 }); // 2배 해상도 렌더 (FAQ 참조)
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        // intent: 'print' — display 인텐트는 rAF 스케줄링을 써서 탭이 백그라운드면 멈춘다
        await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
        if (blob) {
          update(id, { status: 'done', blob, note: `${Math.round(viewport.width)}×${Math.round(viewport.height)}px` });
        } else {
          update(id, { status: 'error', note: '페이지 렌더링에 실패했습니다.' });
        }
        page.cleanup();
      }
    } catch {
      setError('PDF를 열 수 없습니다. 암호가 걸렸거나 손상된 파일일 수 있습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <FileDropzone
        accept="application/pdf,.pdf"
        label="이미지로 변환할 PDF를 여기에 놓으세요"
        onFiles={onFiles}
      />
      {busy && <p className="mt-3 text-center text-sm text-gray-600">페이지를 변환하는 중…</p>}
      {error && <p className="mt-3 text-center text-sm text-red-600" data-testid="pdf2img-error">{error}</p>}
      <ResultList items={items} zipName="pdf-이미지.zip" />
    </section>
  );
}
