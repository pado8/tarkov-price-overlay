'use client';

import { useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import ResultList, { type ResultItem } from '@/components/tools/ResultList';
import { FORMAT_EXT, convertImage, replaceExt, type ImageFormat } from '@/lib/image';

const FORMATS: { format: ImageFormat; label: string }[] = [
  { format: 'image/jpeg', label: 'JPG로' },
  { format: 'image/png', label: 'PNG로' },
  { format: 'image/webp', label: 'WebP로' },
];

let seq = 0;

export default function ImageConvert() {
  const [format, setFormat] = useState<ImageFormat>('image/jpeg');
  const [items, setItems] = useState<ResultItem[]>([]);

  const update = (id: string, patch: Partial<ResultItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const onFiles = async (files: File[]) => {
    const ext = FORMAT_EXT[format];
    const queue = files.map((file) => ({ file, id: `v${seq++}` }));
    setItems((prev) => [
      ...prev,
      ...queue.map(({ file, id }) => ({
        id,
        name: replaceExt(file.name, ext),
        status: 'working' as const,
        note: '변환 중…',
      })),
    ]);

    for (const { file, id } of queue) {
      try {
        const blob = await convertImage(file, format);
        update(id, { status: 'done', blob, note: undefined });
      } catch (e) {
        update(id, {
          status: 'error',
          note: e instanceof Error ? e.message : '변환에 실패했습니다.',
        });
      }
    }
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap gap-2" role="radiogroup" aria-label="변환할 형식">
        {FORMATS.map((f) => (
          <button
            key={f.format}
            type="button"
            role="radio"
            aria-checked={format === f.format}
            onClick={() => setFormat(f.format)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              format === f.format
                ? 'bg-brand-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <FileDropzone
        accept="image/*"
        multiple
        label="변환할 이미지를 여기에 놓으세요"
        sublabel="JPG · PNG · WebP · GIF · BMP 지원"
        onFiles={onFiles}
      />
      <ResultList items={items} zipName="이미지-변환.zip" />
    </section>
  );
}
