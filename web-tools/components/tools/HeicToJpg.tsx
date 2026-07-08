'use client';

import { useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import ResultList, { type ResultItem } from '@/components/tools/ResultList';
import { formatBytes, replaceExt } from '@/lib/image';

let seq = 0;

export default function HeicToJpg() {
  const [items, setItems] = useState<ResultItem[]>([]);

  const update = (id: string, patch: Partial<ResultItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const onFiles = async (files: File[]) => {
    const queue = files.map((file) => ({ file, id: `h${seq++}` }));
    setItems((prev) => [
      ...prev,
      ...queue.map(({ file, id }) => ({
        id,
        name: replaceExt(file.name, 'jpg'),
        status: 'working' as const,
        note: '변환 중…',
      })),
    ]);

    const { default: heic2any } = await import('heic2any');
    // 메모리 보호를 위해 순차 처리
    for (const { file, id } of queue) {
      try {
        const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
        const blob = Array.isArray(out) ? out[0] : out;
        update(id, { status: 'done', blob, note: `${formatBytes(file.size)} → ${formatBytes(blob.size)}` });
      } catch {
        update(id, {
          status: 'error',
          note: 'HEIC 파일이 아니거나 손상된 파일입니다.',
        });
      }
    }
  };

  return (
    <section>
      <FileDropzone
        accept=".heic,.heif,image/heic,image/heif"
        multiple
        label="HEIC 사진을 여기에 놓으세요"
        onFiles={onFiles}
      />
      <ResultList items={items} zipName="heic-변환.zip" />
    </section>
  );
}
