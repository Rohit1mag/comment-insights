/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/python/:path*',
        destination: process.env.PYTHON_API_URL || 'http://localhost:8000/:path*',
      },
    ];
  },
};

module.exports = nextConfig;

