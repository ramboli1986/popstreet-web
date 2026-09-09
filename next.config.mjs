/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/api/availability-crawler/start-worker": ["../PopStreet/**"]
  }
};

export default nextConfig;
