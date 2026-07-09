'use client';

import { useRef, useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import { bytesToBlob, saveBlob } from '@/lib/download';
import { getFFmpeg } from '@/lib/ffmpeg';
import { formatBytes, replaceExt } from '@/lib/image';

const MAX_SIZE = 500 * 1024 * 1024;

const RESOLUTIONS = [
  { key: 'original', label: '원본 유지', width: 0 },
  { key: '1280', label: '1280px (권장)', width: 1280 },
  { key: '854', label: '854px', width: 854 },
  { key: '640', label: '640px', width: 640 },
] as const;

const QUALITIES = [
  { key: 'high', label: '높음 (보관용)', crf: 23 },
  { key: 'normal', label: '보통 (권장)', crf: 28 },
  { key: 'low', label: '낮음 (전송용)', crf: 33 },
] as const;

export default function VideoCompress() {
  const [file, setFile] = useState<File | null>(null);
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>(RESOLUTIONS[1]);
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]>(QUALITIES[1]);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const progressBound = useRef(false);

  const onFiles = ([f]: File[]) => {
    setError(null);
    setResult(null);
    if (f.size > MAX_SIZE) {
      setError('500MB 이하의 영상만 지원합니다. 긴 영상은 나눠서 압축해 주세요.');
      return;
    }
    setFile(f);
  };

  const compress = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const ffmpeg = await getFFmpeg(setStatus);
      if (!progressBound.current) {
        ffmpeg.on('progress', ({ progress: p }) => {
          if (p > 0 && p <= 1) setProgress(Math.round(p * 100));
        });
        progressBound.current = true;
      }
      const { fetchFile } = await import('@ffmpeg/util');
      setStatus('영상을 읽는 중…');
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
      const inputName = `input.${ext}`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      setStatus('압축(재인코딩) 중… 영상 길이에 따라 수 분이 걸릴 수 있습니다.');
      const args = ['-i', inputName];
      if (resolution.width > 0) {
        // 원본이 더 작으면 업스케일하지 않음
        args.push('-vf', `scale=min(${resolution.width}\\,iw):-2`);
      }
      args.push(
        '-c:v', 'libx264',
        '-crf', String(quality.crf),
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        'out.mp4',
      );
      const code = await ffmpeg.exec(args);
      if (code !== 0) throw new Error(`ffmpeg exit ${code}`);

      const data = await ffmpeg.readFile('out.mp4');
      const blob = bytesToBlob(data as Uint8Array, 'video/mp4');
      if (blob.size === 0) throw new Error('empty output');
      await ffmpeg.deleteFile(inputName).catch(() => undefined);
      await ffmpeg.deleteFile('out.mp4').catch(() => undefined);

      setResult({ blob, name: replaceExt(file.name, 'mp4').replace(/(\.mp4)$/, '_압축$1') });
      setStatus(null);
      setProgress(null);
    } catch {
      setStatus(null);
      setError('압축에 실패했습니다. 다른 영상으로 시도하거나 해상도를 낮춰보세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <FileDropzone
        accept="video/*,.mkv,.avi,.mov"
        label="압축할 동영상을 여기에 놓으세요"
        sublabel="MP4 · MOV · WebM 등, 500MB까지 · 5분 이내 영상 권장"
        onFiles={onFiles}
      />

      {file && (
        <div className="mt-4 rounded-xl border border-gray-200 p-4" data-testid="vc-panel">
          <p className="font-medium text-gray-900">
            {file.name} <span className="text-gray-500">({formatBytes(file.size)})</span>
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="text-sm font-medium text-gray-700">
              해상도 (가로 기준)
              <div className="mt-1 flex flex-wrap gap-2">
                {RESOLUTIONS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setResolution(r)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                      resolution.key === r.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-sm font-medium text-gray-700">
              품질
              <div className="mt-1 flex flex-wrap gap-2">
                {QUALITIES.map((q) => (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => setQuality(q)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                      quality.key === q.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={compress}
            disabled={busy}
            data-testid="vc-button"
            className="mt-4 w-full rounded-xl bg-brand-500 px-4 py-3 font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? (progress !== null ? `압축 중… ${progress}%` : '압축 중…') : '압축하기'}
          </button>
        </div>
      )}

      {status && <p className="mt-3 text-center text-sm text-gray-600" data-testid="vc-status">{status}</p>}
      {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-4 rounded-xl border border-gray-200 p-4 text-center" data-testid="vc-result">
          <p className="font-medium text-gray-900">
            {formatBytes(file!.size)} → {formatBytes(result.blob.size)}{' '}
            <span className="font-bold text-emerald-700">
              ({Math.max(0, Math.round((1 - result.blob.size / file!.size) * 100))}% 절감)
            </span>
          </p>
          <button
            type="button"
            onClick={() => saveBlob(result.blob, result.name)}
            className="mt-3 w-full rounded-xl bg-gray-900 px-4 py-3 font-semibold text-white hover:bg-gray-700"
          >
            압축본 저장
          </button>
        </div>
      )}
    </section>
  );
}
