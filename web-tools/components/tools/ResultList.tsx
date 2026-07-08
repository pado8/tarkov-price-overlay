'use client';

import { saveAsZip, saveBlob } from '@/lib/download';

export type ResultItem = {
  id: string;
  name: string; // 출력 파일명
  status: 'working' | 'done' | 'error';
  blob?: Blob;
  note?: string; // 용량 비교, 오류 메시지 등
};

export default function ResultList({ items, zipName }: { items: ResultItem[]; zipName: string }) {
  if (items.length === 0) return null;
  const done = items.filter((i) => i.status === 'done' && i.blob);

  return (
    <div className="mt-6" data-testid="results">
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            data-status={item.status}
            className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-900">
                {item.status === 'working' && '⏳ '}
                {item.status === 'error' && '⚠️ '}
                {item.name}
              </p>
              {item.note && (
                <p className={`text-sm ${item.status === 'error' ? 'text-red-600' : 'text-gray-500'}`}>
                  {item.note}
                </p>
              )}
            </div>
            {item.status === 'done' && item.blob && (
              <button
                type="button"
                onClick={() => saveBlob(item.blob!, item.name)}
                className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
              >
                저장
              </button>
            )}
          </li>
        ))}
      </ul>
      {done.length >= 2 && (
        <button
          type="button"
          onClick={() => saveAsZip(done.map((d) => ({ name: d.name, blob: d.blob! })), zipName)}
          className="mt-3 w-full rounded-xl bg-gray-900 px-4 py-3 font-semibold text-white hover:bg-gray-700"
        >
          전체 ZIP 다운로드 ({done.length}개)
        </button>
      )}
    </div>
  );
}
