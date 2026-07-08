'use client';

import { useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import { bytesToBlob, saveAsZip, saveBlob } from '@/lib/download';

// "1-3,5,8-10" → [0,1,2,4,7,8,9]
function parseRange(input: string, pageCount: number): number[] | null {
  const indices: number[] = [];
  for (const part of input.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return null;
    const from = parseInt(m[1], 10);
    const to = m[2] ? parseInt(m[2], 10) : from;
    if (from < 1 || to > pageCount || from > to) return null;
    for (let p = from; p <= to; p += 1) indices.push(p - 1);
  }
  return indices.length > 0 ? indices : null;
}

export default function PdfSplit() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const onFiles = async ([f]: File[]) => {
    setMessage(null);
    setFile(f);
    setPageCount(null);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(await f.arrayBuffer());
      setPageCount(doc.getPageCount());
    } catch {
      setFile(null);
      setMessage({ type: 'error', text: 'PDF를 열 수 없습니다. 암호가 걸렸거나 손상된 파일일 수 있습니다.' });
    }
  };

  const baseName = file ? file.name.replace(/\.pdf$/i, '') : '';

  const extract = async () => {
    if (!file || !pageCount) return;
    const indices = parseRange(range, pageCount);
    if (!indices) {
      setMessage({ type: 'error', text: `범위를 확인해 주세요. 예: 1-3,5 (전체 ${pageCount}페이지)` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const src = await PDFDocument.load(await file.arrayBuffer());
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, indices);
      pages.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      saveBlob(bytesToBlob(bytes, 'application/pdf'), `${baseName}_추출.pdf`);
      setMessage({ type: 'ok', text: `${indices.length}페이지를 추출했습니다.` });
    } catch {
      setMessage({ type: 'error', text: '추출에 실패했습니다. 파일을 다시 확인해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  const splitAll = async () => {
    if (!file || !pageCount) return;
    setBusy(true);
    setMessage(null);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const src = await PDFDocument.load(await file.arrayBuffer());
      const pad = String(pageCount).length;
      const entries: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < pageCount; i += 1) {
        const out = await PDFDocument.create();
        const [page] = await out.copyPages(src, [i]);
        out.addPage(page);
        const bytes = await out.save();
        entries.push({
          name: `${baseName}_p${String(i + 1).padStart(pad, '0')}.pdf`,
          blob: bytesToBlob(bytes, 'application/pdf'),
        });
      }
      await saveAsZip(entries, `${baseName}_낱장.zip`);
      setMessage({ type: 'ok', text: `${pageCount}개 파일로 분리해 ZIP으로 저장했습니다.` });
    } catch {
      setMessage({ type: 'error', text: '분리에 실패했습니다. 파일을 다시 확인해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <FileDropzone
        accept="application/pdf,.pdf"
        label="분할할 PDF 파일을 여기에 놓으세요"
        onFiles={onFiles}
      />
      {file && pageCount && (
        <div className="mt-4 rounded-xl border border-gray-200 p-4" data-testid="split-panel">
          <p className="font-medium text-gray-900">
            {file.name} <span className="text-gray-500">— 총 {pageCount}페이지</span>
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder="추출할 페이지 (예: 1-3,5)"
              className="flex-1 rounded-xl border border-gray-300 px-4 py-3 focus:border-brand-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={extract}
              disabled={busy || !range.trim()}
              className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              페이지 추출
            </button>
          </div>
          <button
            type="button"
            onClick={splitAll}
            disabled={busy}
            className="mt-3 w-full rounded-xl bg-gray-900 px-4 py-3 font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {busy ? '처리 중…' : '모든 페이지 낱장으로 분리 (ZIP)'}
          </button>
        </div>
      )}
      {message && (
        <p
          data-testid="split-message"
          className={`mt-3 text-center text-sm font-medium ${
            message.type === 'ok' ? 'text-emerald-700' : 'text-red-600'
          }`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
