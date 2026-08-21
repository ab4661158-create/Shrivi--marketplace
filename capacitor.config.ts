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
      launchShowDuration: 1800,
      launchFadeOutDuration: 300,
      backgroundColor: '#FFFFFF',
      androidScaleType: 'CENTER',
      showSpinner: false
    }
  }
};

export default config;
