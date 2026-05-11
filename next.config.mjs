/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          destination: "/design/mockup-01-dashboard.html"
        }
      ]
    };
  }
};

export default nextConfig;
