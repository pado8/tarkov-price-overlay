'use client';

import { formatBytes } from '@/lib/image';

type Props = {
  files: File[];
  onChange: (files: File[]) => void;
};

// 합치기·이미지→PDF에서 공유하는 순서 조정 리스트
export default function FileOrderList({ files, onChange }: Props) {
  if (files.length === 0) return null;

  const move = (index: number, dir: -1 | 1) => {
    const next = [...files];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <ul className="mt-4 space-y-2" data-testid="order-list">
      {files.map((file, i) => (
        <li
          key={`${file.name}-${i}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-600">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-900">{file.name}</p>
              <p className="text-sm text-gray-500">{formatBytes(file.size)}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              aria-label={`${file.name} 위로`}
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-sm hover:bg-gray-200 disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label={`${file.name} 아래로`}
              onClick={() => move(i, 1)}
              disabled={i === files.length - 1}
              className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-sm hover:bg-gray-200 disabled:opacity-30"
            >
              ▼
            </button>
            <button
              type="button"
              aria-label={`${file.name} 제거`}
              onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
