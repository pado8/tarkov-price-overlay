'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import { saveBlob } from '@/lib/download';
import { loadImage, replaceExt } from '@/lib/image';

const STRENGTHS = [
  { key: 'weak', label: '약하게', divisor: 100 },
  { key: 'normal', label: '보통', divisor: 60 },
  { key: 'strong', label: '강하게', divisor: 30 },
] as const;

type Rect = { x: number; y: number; w: number; h: number };
type UndoEntry = { rect: Rect; data: ImageData };

export default function ImageMosaic() {
  const [file, setFile] = useState<File | null>(null);
  const [strength, setStrength] = useState<(typeof STRENGTHS)[number]>(STRENGTHS[1]);
  const [undoCount, setUndoCount] = useState(0);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null); // 원본 해상도 작업 캔버스
  const undoStack = useRef<UndoEntry[]>([]);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const render = useCallback((selection?: Rect) => {
    const display = displayRef.current;
    const work = workRef.current;
    if (!display || !work) return;
    const ctx = display.getContext('2d')!;
    ctx.drawImage(work, 0, 0);
    if (selection) {
      ctx.save();
      ctx.strokeStyle = '#2b7de9';
      ctx.lineWidth = Math.max(2, work.width / 400);
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      ctx.restore();
    }
  }, []);

  const onFiles = async ([f]: File[]) => {
    const img = await loadImage(f);
    const work = document.createElement('canvas');
    work.width = img.naturalWidth;
    work.height = img.naturalHeight;
    work.getContext('2d')!.drawImage(img, 0, 0);
    workRef.current = work;
    undoStack.current = [];
    setUndoCount(0);
    setFile(f);
  };

  // 파일 로드 후 display 캔버스 크기를 맞추고 첫 렌더
  useEffect(() => {
    if (!file || !workRef.current || !displayRef.current) return;
    displayRef.current.width = workRef.current.width;
    displayRef.current.height = workRef.current.height;
    render();
  }, [file, render]);

  const toNatural = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = displayRef.current!;
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, ((e.clientX - box.left) / box.width) * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, ((e.clientY - box.top) / box.height) * canvas.height)),
    };
  };

  const pixelate = (rect: Rect) => {
    const work = workRef.current!;
    const ctx = work.getContext('2d')!;
    // 되돌리기용 원본 영역 저장
    undoStack.current.push({ rect, data: ctx.getImageData(rect.x, rect.y, rect.w, rect.h) });
    setUndoCount(undoStack.current.length);

    const block = Math.max(8, Math.round(Math.max(work.width, work.height) / strength.divisor));
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.ceil(rect.w / block));
    tmp.height = Math.max(1, Math.ceil(rect.h / block));
    const tctx = tmp.getContext('2d')!;
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(work, rect.x, rect.y, rect.w, rect.h, 0, 0, tmp.width, tmp.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, rect.x, rect.y, rect.w, rect.h);
    ctx.imageSmoothingEnabled = true;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 일부 환경(합성 이벤트 등)에서 실패해도 드래그 자체는 동작
    }
    dragStart.current = toNatural(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStart.current) return;
    const cur = toNatural(e);
    const s = dragStart.current;
    render({ x: Math.min(s.x, cur.x), y: Math.min(s.y, cur.y), w: Math.abs(cur.x - s.x), h: Math.abs(cur.y - s.y) });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStart.current) return;
    const cur = toNatural(e);
    const s = dragStart.current;
    dragStart.current = null;
    const rect: Rect = {
      x: Math.round(Math.min(s.x, cur.x)),
      y: Math.round(Math.min(s.y, cur.y)),
      w: Math.round(Math.abs(cur.x - s.x)),
      h: Math.round(Math.abs(cur.y - s.y)),
    };
    if (rect.w < 4 || rect.h < 4) {
      render();
      return;
    }
    pixelate(rect);
    render();
  };

  const undo = () => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    setUndoCount(undoStack.current.length);
    workRef.current!.getContext('2d')!.putImageData(entry.data, entry.rect.x, entry.rect.y);
    render();
  };

  const save = async () => {
    if (!file || !workRef.current) return;
    const isPng = file.type === 'image/png';
    const blob = await new Promise<Blob | null>((r) =>
      workRef.current!.toBlob(r, isPng ? 'image/png' : 'image/jpeg', 0.92),
    );
    if (blob) saveBlob(blob, replaceExt(file.name, isPng ? 'png' : 'jpg').replace(/(\.[^.]+)$/, '_모자이크$1'));
  };

  return (
    <section>
      {!file && (
        <FileDropzone
          accept="image/jpeg,image/png,image/webp"
          label="모자이크할 사진을 여기에 놓으세요"
          onFiles={onFiles}
        />
      )}
      {file && (
        <div data-testid="mosaic-panel">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-700">모자이크 강도:</span>
            {STRENGTHS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStrength(s)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                  strength.key === s.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {s.label}
              </button>
            ))}
            <span className="ml-auto text-sm text-gray-500">가릴 부분을 드래그하세요</span>
          </div>
          <canvas
            ref={displayRef}
            data-testid="mosaic-canvas"
            className="w-full cursor-crosshair touch-none rounded-xl border border-gray-200"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={undoCount === 0}
              data-testid="mosaic-undo"
              className="rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-40"
            >
              ↩ 되돌리기 ({undoCount})
            </button>
            <button
              type="button"
              onClick={save}
              disabled={undoCount === 0}
              data-testid="mosaic-save"
              className="flex-1 rounded-xl bg-brand-500 px-4 py-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              모자이크 적용본 저장
            </button>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                workRef.current = null;
                undoStack.current = [];
                setUndoCount(0);
              }}
              className="rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-700 hover:bg-gray-200"
            >
              다른 사진
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
