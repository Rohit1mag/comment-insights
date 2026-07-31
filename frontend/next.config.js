/** @type {import('next').NextConfig} */
// Prefer next.config.ts — keep this in sync if Next loads .js instead.
const nextConfig = {
  async rewrites() {
    // On Vercel Services, /api/python is routed at the edge to FastAPI.
    // Locally (next + uvicorn), proxy to the Python process.
    if (process.env.VERCEL) {
      return [];
    }
    return [
      {
        source: '/api/python/:path*',
        destination: `${process.env.PYTHON_API_URL || 'http://localhost:8000'}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
