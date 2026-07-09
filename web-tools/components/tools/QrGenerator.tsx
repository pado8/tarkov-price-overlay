'use client';

import { useEffect, useRef, useState } from 'react';
import { saveBlob } from '@/lib/download';

const SIZES = [256, 512, 1024];

export default function QrGenerator() {
  const [text, setText] = useState('');
  const [size, setSize] = useState(512);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!text.trim() || !canvasRef.current) return;
      try {
        const QRCode = (await import('qrcode')).default;
        if (cancelled) return;
        await QRCode.toCanvas(canvasRef.current, text.trim(), {
          width: size,
          margin: 2,
          errorCorrectionLevel: 'M',
        });
        setError(null);
      } catch {
        setError('QR 코드를 만들 수 없습니다. 내용이 너무 길지 않은지 확인해 주세요.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text, size]);

  const download = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !text.trim()) return;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) saveBlob(blob, 'qrcode.png');
  };

  return (
    <section>
      <label className="block text-sm font-medium text-gray-700">
        QR 코드에 담을 내용 (링크·텍스트)
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://example.com"
          data-testid="qr-input"
          className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand-500 focus:outline-none"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700">이미지 크기:</span>
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSize(s)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              size === s ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {s}px
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className={`mt-6 text-center ${text.trim() ? '' : 'hidden'}`} data-testid="qr-result">
        <canvas ref={canvasRef} className="mx-auto max-w-[280px] rounded-xl border border-gray-200" />
        <button
          type="button"
          onClick={download}
          data-testid="qr-download"
          className="mt-4 w-full rounded-xl bg-brand-500 px-4 py-3 font-semibold text-white hover:bg-brand-600"
        >
          PNG 저장
        </button>
      </div>
      {!text.trim() && (
        <p className="mt-6 text-center text-sm text-gray-400">
          내용을 입력하면 QR 코드가 즉시 생성됩니다
        </p>
      )}
    </section>
  );
}
