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
      // Keep the branded native splash visible while the remote SHRIVI shop loads.
      // Auto-hide is intentionally enabled with a safe delay so the WebView is not
      // exposed as a blank white screen during startup.
      launchAutoHide: true,
      launchShowDuration: 3000,
      launchFadeOutDuration: 220,
      backgroundColor: '#FFFFFF',
      androidScaleType: 'CENTER',
      showSpinner: false
    }
  }
};

export default config;
