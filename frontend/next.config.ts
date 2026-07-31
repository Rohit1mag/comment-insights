import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // On Vercel Services, /api/python is routed at the edge to FastAPI.
    // Locally (next + uvicorn), proxy to the Python process.
    if (process.env.VERCEL) {
      return [];
    }
    return [
      {
        source: "/api/python/:path*",
        destination: `${process.env.PYTHON_API_URL || "http://localhost:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
