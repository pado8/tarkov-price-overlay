'use client';

import { useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import FileOrderList from '@/components/tools/FileOrderList';
import { bytesToBlob, saveBlob } from '@/lib/download';
import { convertImage } from '@/lib/image';

export default function JpgToPdf() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.create();
      for (const file of files) {
        let image;
        if (file.type === 'image/jpeg') {
          image = await doc.embedJpg(await file.arrayBuffer());
        } else if (file.type === 'image/png') {
          image = await doc.embedPng(await file.arrayBuffer());
        } else {
          // WebP 등은 PNG로 중간 변환 후 삽입
          const png = await convertImage(file, 'image/png');
          image = await doc.embedPng(await png.arrayBuffer());
        }
        const page = doc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      const bytes = await doc.save();
      saveBlob(bytesToBlob(bytes, 'application/pdf'), '이미지문서.pdf');
      setMessage({ type: 'ok', text: `${files.length}페이지짜리 PDF가 다운로드되었습니다.` });
    } catch {
      setMessage({ type: 'error', text: 'PDF 생성에 실패했습니다. 지원하는 이미지인지 확인해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <FileDropzone
        accept="image/jpeg,image/png,image/webp"
        multiple
        label="PDF로 만들 이미지를 여기에 놓으세요"
        sublabel="JPG · PNG · WebP 지원, 한 장 = 한 페이지"
        onFiles={(f) => {
          setFiles((prev) => [...prev, ...f]);
          setMessage(null);
        }}
      />
      <FileOrderList files={files} onChange={setFiles} />
      {files.length >= 1 && (
        <button
          type="button"
          onClick={create}
          disabled={busy}
          data-testid="create-pdf-button"
          className="mt-4 w-full rounded-xl bg-brand-500 px-4 py-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? '만드는 중…' : `PDF 만들기 (${files.length}장)`}
        </button>
      )}
      {message && (
        <p
          data-testid="jpg2pdf-message"
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
