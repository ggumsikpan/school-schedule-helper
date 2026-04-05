import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',   // 정적 파일로 빌드 (서버 불필요)
  images: { unoptimized: true },
};

export default nextConfig;
