/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // @xenova/transformers ships binary ONNX files — keep it server-side only, never bundled
  experimental: {
    serverComponentsExternalPackages: ['@xenova/transformers'],
    // Collect page data with a single worker. db.ts performs writes at import
    // time (migrations + welcome refresh); parallel build workers otherwise
    // contend on the SQLite file and fail with SQLITE_BUSY.
    cpus: 1,
    workerThreads: false,
  },

  webpack(config) {
    // Ignore native bindings that won't exist in the Next.js webpack context
    config.resolve.alias = {
      ...config.resolve.alias,
      'sharp$': false,
      'onnxruntime-node$': false,
    };
    return config;
  },
};

export default nextConfig;
