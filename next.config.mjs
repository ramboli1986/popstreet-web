/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          destination: "/design/mockup-01-dashboard.html"
        },
        {
          source: "/dashboard",
          destination: "/design/mockup-01-dashboard.html"
        },
        {
          source: "/buildings",
          destination: "/design/mockup-02-buildings.html"
        },
        {
          source: "/units",
          destination: "/design/mockup-03-units.html"
        },
        {
          source: "/map",
          destination: "/design/mockup-04-map.html"
        }
      ]
    };
  }
};

export default nextConfig;
