'use client';

import { useRef, useState } from 'react';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import FileDropzone from '@/components/FileDropzone';
import { bytesToBlob, saveBlob } from '@/lib/download';
import { formatBytes, replaceExt } from '@/lib/image';

// PLAN 8장: 멀티스레드 코어는 COOP/COEP를 강제해 AdSense와 공존 불가 → 반드시 싱글스레드 코어.
// 코어(~32MB)는 Vercel 대역폭 보호를 위해 jsDelivr CDN에서 lazy load.
const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
const MAX_SIZE = 500 * 1024 * 1024;

let ffmpegSingleton: FFmpeg | null = null;

async function getFFmpeg(onStatus: (s: string) => void): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  onStatus('변환 엔진을 내려받는 중… (최초 1회, 약 30MB)');
  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ]);
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegSingleton = ffmpeg;
  return ffmpeg;
}

const WIDTHS = [320, 480, 640];
const FPS_OPTIONS = [8, 10, 15];

export default function VideoToGif() {
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState('0');
  const [duration, setDuration] = useState('3');
  const [width, setWidth] = useState(480);
  const [fps, setFps] = useState(10);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string; name: string } | null>(null);
  const prevUrl = useRef<string | null>(null);

  const onFiles = ([f]: File[]) => {
    setError(null);
    setResult(null);
    if (f.size > MAX_SIZE) {
      setError('500MB 이하의 영상만 지원합니다. 긴 영상은 잘라서 사용해 주세요.');
      return;
    }
    setFile(f);
  };

  const convert = async () => {
    if (!file) return;
    const startSec = Math.max(0, parseFloat(start) || 0);
    const durSec = Math.min(30, Math.max(0.5, parseFloat(duration) || 3));
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const ffmpeg = await getFFmpeg(setStatus);
      const { fetchFile } = await import('@ffmpeg/util');
      setStatus('영상을 읽는 중…');
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
      const inputName = `input.${ext}`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      setStatus('GIF로 변환하는 중… (영상 길이에 따라 수십 초 걸릴 수 있습니다)');
      // palettegen/paletteuse 2패스 팔레트로 색 품질 확보 (PLAN 3장)
      const code = await ffmpeg.exec([
        '-ss', String(startSec),
        '-t', String(durSec),
        '-i', inputName,
        '-filter_complex',
        `fps=${fps},scale=${width}:-2:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
        '-f', 'gif',
        'out.gif',
      ]);
      if (code !== 0) throw new Error(`ffmpeg exit ${code}`);

      const data = await ffmpeg.readFile('out.gif');
      const blob = bytesToBlob(data as Uint8Array, 'image/gif');
      if (blob.size === 0) throw new Error('empty output');
      await ffmpeg.deleteFile(inputName).catch(() => undefined);
      await ffmpeg.deleteFile('out.gif').catch(() => undefined);

      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
      const url = URL.createObjectURL(blob);
      prevUrl.current = url;
      setResult({ blob, url, name: replaceExt(file.name, 'gif') });
      setStatus(null);
    } catch {
      setStatus(null);
      setError('변환에 실패했습니다. 시작 시간이 영상 길이를 넘지 않는지 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <FileDropzone
        accept="video/*,.mkv,.avi,.mov"
        label="동영상 파일을 여기에 놓으세요"
        sublabel="MP4 · MOV · WebM 등, 500MB까지"
        onFiles={onFiles}
      />

      {file && (
        <div className="mt-4 rounded-xl border border-gray-200 p-4" data-testid="gif-panel">
          <p className="font-medium text-gray-900">
            {file.name} <span className="text-gray-500">({formatBytes(file.size)})</span>
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              시작 시간 (초)
              <input
                type="number"
                min={0}
                step={0.5}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              길이 (초, 최대 30)
              <input
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <div className="text-sm font-medium text-gray-700">
              가로 크기
              <div className="mt-1 flex gap-2">
                {WIDTHS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWidth(w)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                      width === w ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {w}px
                  </button>
                ))}
              </div>
            </div>
            <div className="text-sm font-medium text-gray-700">
              초당 프레임 (부드러움)
              <div className="mt-1 flex gap-2">
                {FPS_OPTIONS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFps(f)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                      fps === f ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {f}fps
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={convert}
            disabled={busy}
            data-testid="gif-button"
            className="mt-4 w-full rounded-xl bg-brand-500 px-4 py-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? '변환 중…' : 'GIF 만들기'}
          </button>
        </div>
      )}

      {status && <p className="mt-3 text-center text-sm text-gray-600" data-testid="gif-status">{status}</p>}
      {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-4 rounded-xl border border-gray-200 p-4 text-center" data-testid="gif-result">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.url} alt="변환된 GIF 미리보기" className="mx-auto max-w-full rounded-lg" />
          <p className="mt-2 text-sm text-gray-500">{formatBytes(result.blob.size)}</p>
          <button
            type="button"
            onClick={() => saveBlob(result.blob, result.name)}
            className="mt-3 w-full rounded-xl bg-gray-900 px-4 py-3 font-semibold text-white hover:bg-gray-700"
          >
            GIF 저장
          </button>
        </div>
      )}
    </section>
  );
}
