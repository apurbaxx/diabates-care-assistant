/** @type {import('next').NextConfig} */
const nextConfig = {
  // Let validation builds coexist with a running development workspace.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  serverExternalPackages: ["@xenova/transformers", "sharp", "onnxruntime-node"],
};

export default nextConfig;
