import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/school-schedule-helper',
  images: { unoptimized: true },
};

export default nextConfig;
