'use client';

import { useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import FileOrderList from '@/components/tools/FileOrderList';
import { bytesToBlob, saveBlob } from '@/lib/download';

export default function PdfMerge() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  const merge = async () => {
    setBusy(true);
    setError(null);
    setDoneCount(null);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      for (const file of files) {
        const src = await PDFDocument.load(await file.arrayBuffer());
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      saveBlob(bytesToBlob(bytes, 'application/pdf'), '합친문서.pdf');
      setDoneCount(out.getPageCount());
    } catch {
      setError(
        'PDF 병합에 실패했습니다. 암호가 걸렸거나 손상된 파일이 있는지 확인해 주세요.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <FileDropzone
        accept="application/pdf,.pdf"
        multiple
        label="합칠 PDF 파일들을 여기에 놓으세요"
        onFiles={(f) => {
          setFiles((prev) => [...prev, ...f]);
          setDoneCount(null);
        }}
      />
      <FileOrderList files={files} onChange={setFiles} />
      {files.length >= 2 && (
        <button
          type="button"
          onClick={merge}
          disabled={busy}
          data-testid="merge-button"
          className="mt-4 w-full rounded-xl bg-brand-500 px-4 py-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? '병합 중…' : `PDF 합치기 (${files.length}개)`}
        </button>
      )}
      {doneCount !== null && (
        <p className="mt-3 text-center text-sm font-medium text-emerald-700" data-testid="merge-done">
          총 {doneCount}페이지짜리 PDF가 다운로드되었습니다.
        </p>
      )}
      {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}
    </section>
  );
}
