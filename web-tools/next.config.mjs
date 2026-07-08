/** @type {import('next').NextConfig} */
const nextConfig = {
  // 전 페이지 정적 출력 — 서버 코드 0, 어떤 정적 호스트에도 배포 가능
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
