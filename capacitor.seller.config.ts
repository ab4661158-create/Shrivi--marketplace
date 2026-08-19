import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shrivi.seller',
  appName: 'SHRIVI Seller',
  webDir: 'www',
  server: {
    url: 'https://shrivi-marketplace.onrender.com/seller',
    cleartext: false,
    androidScheme: 'https'
  }
};

export default config;
