/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Only use static export for production builds
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
  // Configure for Azure Static Web Apps in production
  trailingSlash: true,
  // Disable image optimization for static export
  images: {
    unoptimized: true,
  },
  // Fix for static export build issues
  async generateBuildId() {
    return 'build-' + Date.now();
  },
  // Ensure proper static export
  async exportPathMap(defaultPathMap, { dev, dir, outDir, distDir, buildId }) {
    return {
      '/': { page: '/' },
      '/login': { page: '/login' },
      '/teacher': { page: '/teacher' },
      '/student': { page: '/student' },
      '/dev-config': { page: '/dev-config' }
    };
  },
  // Improve dev experience - prevent browser tab closing
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      // Faster rebuilds in development
      config.watchOptions = {
        poll: 1000, // Check for changes every second
        aggregateTimeout: 300, // Delay rebuild after first change
        ignored: /node_modules/,
      };
      // Prevent memory issues that can cause browser crashes
      config.optimization = {
        ...config.optimization,
        removeAvailableModules: false,
        removeEmptyChunks: false,
        splitChunks: false,
      };
    }
    return config;
  },
  // Reduce full page reloads
  onDemandEntries: {
    // Period (in ms) where the server will keep pages in the buffer
    maxInactiveAge: 60 * 1000,
    // Number of pages that should be kept simultaneously without being disposed
    pagesBufferLength: 5,
  },
  // Note: isrMemoryCacheSize removed in Next.js 15 - no longer needed
};

module.exports = nextConfig;
