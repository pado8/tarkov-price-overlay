'use client';

import { useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import ResultList, { type ResultItem } from '@/components/tools/ResultList';
import { formatBytes } from '@/lib/image';

const LEVELS = [
  { key: 'light', label: '약하게 (화질 우선)', quality: 0.85 },
  { key: 'normal', label: '보통 (권장)', quality: 0.7 },
  { key: 'strong', label: '강하게 (용량 우선)', quality: 0.5 },
] as const;

let seq = 0;

export default function ImageCompress() {
  const [level, setLevel] = useState<(typeof LEVELS)[number]>(LEVELS[1]);
  const [items, setItems] = useState<ResultItem[]>([]);

  const update = (id: string, patch: Partial<ResultItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const onFiles = async (files: File[]) => {
    const queue = files.map((file) => ({ file, id: `c${seq++}` }));
    setItems((prev) => [
      ...prev,
      ...queue.map(({ file, id }) => ({
        id,
        name: file.name,
        status: 'working' as const,
        note: '압축 중…',
      })),
    ]);

    const { default: imageCompression } = await import('browser-image-compression');
    for (const { file, id } of queue) {
      try {
        const out = await imageCompression(file, {
          initialQuality: level.quality,
          alwaysKeepResolution: true,
          useWebWorker: true,
        });
        const saved = Math.max(0, Math.round((1 - out.size / file.size) * 100));
        update(id, {
          status: 'done',
          blob: out,
          note: `${formatBytes(file.size)} → ${formatBytes(out.size)} (${saved}% 절감)`,
        });
      } catch {
        update(id, { status: 'error', note: '이미지 파일이 아니거나 처리할 수 없습니다.' });
      }
    }
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap gap-2" role="radiogroup" aria-label="압축 강도">
        {LEVELS.map((l) => (
          <button
            key={l.key}
            type="button"
            role="radio"
            aria-checked={level.key === l.key}
            onClick={() => setLevel(l)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              level.key === l.key
                ? 'bg-brand-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <FileDropzone
        accept="image/jpeg,image/png,image/webp"
        multiple
        label="압축할 이미지를 여기에 놓으세요"
        sublabel="JPG · PNG · WebP 지원, 여러 장 가능"
        onFiles={onFiles}
      />
      <ResultList items={items} zipName="이미지-압축.zip" />
    </section>
  );
}
