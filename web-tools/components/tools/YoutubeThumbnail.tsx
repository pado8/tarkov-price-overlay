'use client';

import { useState } from 'react';

const VARIANTS = [
  { key: 'maxresdefault', label: '최대 해상도', size: '1280×720' },
  { key: 'sddefault', label: '고화질', size: '640×480' },
  { key: 'hqdefault', label: '중간 화질', size: '480×360' },
  { key: 'mqdefault', label: '저화질', size: '320×180' },
] as const;

function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  // 주소 없이 ID만 붙여넣는 경우
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

type Thumb = { key: string; label: string; size: string; url: string; ok: boolean | null };

export default function YoutubeThumbnail() {
  const [input, setInput] = useState('');
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lookup = () => {
    setError(null);
    setThumbs([]);
    const id = parseVideoId(input);
    if (!id) {
      setError('유튜브 영상 주소를 인식하지 못했습니다. 전체 URL을 붙여넣어 주세요.');
      return;
    }
    setThumbs(
      VARIANTS.map((v) => ({
        ...v,
        url: `https://i.ytimg.com/vi/${id}/${v.key}.jpg`,
        ok: null,
      })),
    );
  };

  // 존재하지 않는 해상도는 유튜브가 120×90 플레이스홀더를 반환 → 로드 후 크기로 판별
  const markLoaded = (key: string, img: HTMLImageElement) => {
    const ok = img.naturalWidth > 120;
    setThumbs((prev) => prev.map((t) => (t.key === key ? { ...t, ok } : t)));
  };

  const visible = thumbs.filter((t) => t.ok !== false);

  return (
    <section>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
          placeholder="https://www.youtube.com/watch?v=…"
          data-testid="yt-input"
          className="flex-1 rounded-xl border border-gray-300 px-4 py-3 focus:border-brand-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={lookup}
          data-testid="yt-button"
          className="rounded-xl bg-brand-500 px-6 py-3 font-semibold text-white hover:bg-brand-600"
        >
          썸네일 추출
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {visible.length > 0 && (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2" data-testid="yt-results">
          {visible.map((t) => (
            <li key={t.key} className="overflow-hidden rounded-xl border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={t.url}
                alt={`${t.label} 썸네일`}
                className="w-full"
                onLoad={(e) => markLoaded(t.key, e.currentTarget)}
              />
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-sm">
                  <span className="font-semibold text-gray-900">{t.label}</span>{' '}
                  <span className="text-gray-500">{t.size}</span>
                </p>
                <a
                  href={t.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700"
                >
                  새 탭에서 열기
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      {visible.length > 0 && (
        <p className="mt-3 text-sm text-gray-500">
          새 탭에서 이미지를 우클릭 → &ldquo;이미지를 다른 이름으로 저장&rdquo;하면 됩니다.
        </p>
      )}
    </section>
  );
}
