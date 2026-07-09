'use client';

import { useState } from 'react';
import FileDropzone from '@/components/FileDropzone';

export default function ImageOcr() {
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onFiles = async ([file]: File[]) => {
    setError(null);
    setText(null);
    setProgress(null);
    setStatus('인식 엔진을 준비하는 중… (최초 1회 약 20MB 다운로드)');
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker(['kor', 'eng'], 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setStatus('글자를 인식하는 중…');
            setProgress(Math.round(m.progress * 100));
          }
        },
      });
      const { data } = await worker.recognize(file);
      await worker.terminate();
      const result = data.text.trim();
      if (!result) {
        setError('인식된 글자가 없습니다. 글자가 더 선명하고 큰 이미지로 시도해 보세요.');
      } else {
        setText(result);
      }
      setStatus(null);
      setProgress(null);
    } catch {
      setStatus(null);
      setError('인식에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.');
    }
  };

  return (
    <section>
      <FileDropzone
        accept="image/*"
        label="글자가 담긴 이미지를 여기에 놓으세요"
        sublabel="사진·스크린샷·스캔본 (한국어+영어 인식)"
        onFiles={onFiles}
      />
      {status && (
        <p className="mt-3 text-center text-sm text-gray-600" data-testid="ocr-status">
          {status}
          {progress !== null && ` ${progress}%`}
        </p>
      )}
      {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}

      {text !== null && (
        <div className="mt-6" data-testid="ocr-result">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-gray-900">추출된 텍스트</p>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
            >
              {copied ? '복사됨 ✓' : '전체 복사'}
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            인식 결과를 바로 수정할 수 있습니다. 이미지와 텍스트 모두 서버로 전송되지 않습니다.
          </p>
        </div>
      )}
    </section>
  );
}
