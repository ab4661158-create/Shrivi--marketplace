import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shrivi.marketplace',
  appName: 'SHRIVI',
  webDir: 'www',
  server: {
    url: 'https://shrivi-marketplace.onrender.com/shop',
    cleartext: false,
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1200,
      backgroundColor: '#FFFFFF',
      showSpinner: false
    }
  }
};

export default config;
