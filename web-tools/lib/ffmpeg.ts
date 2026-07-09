import type { FFmpeg } from '@ffmpeg/ffmpeg';

// PLAN 8장: 멀티스레드 코어는 COOP/COEP를 강제해 AdSense와 공존 불가 → 반드시 싱글스레드 코어.
// 코어(~32MB)는 Vercel 대역폭 보호를 위해 jsDelivr CDN에서 lazy load.
const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';

let ffmpegSingleton: FFmpeg | null = null;

export async function getFFmpeg(onStatus: (s: string) => void): Promise<FFmpeg> {
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
