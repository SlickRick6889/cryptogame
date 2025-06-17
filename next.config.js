/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_DEMO_MODE: 'false',
    NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSyATBlYvA_dZrQNSdC8F3v7mu8mFYZQAGes",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "website-6889.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "website-6889",
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "website-6889.firebasestorage.app",
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "606064079207",
    NEXT_PUBLIC_FIREBASE_APP_ID: "1:606064079207:web:35dd32a23d0443a873ffc2",
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: "G-5K76PRT0NZ",
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },

  webpack: (config) => {
    config.resolve.fallback = {
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
};

module.exports = nextConfig; 