/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static. No server, no route handlers, no env vars, nothing to leak.
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
