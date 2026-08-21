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
      // Keep the native splash until the remote SHRIVI shop has actually loaded.
      // The customer page calls SplashScreen.hide() on window load, preventing the
      // native splash from being replaced by a black/white WebView transition.
      launchAutoHide: false,
      backgroundColor: '#FFFFFF',
      androidScaleType: 'CENTER',
      showSpinner: false
    }
  }
};

export default config;
