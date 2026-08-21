import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shrivi.marketplace',
  appName: 'SHRIVI',
  webDir: 'www',
  server: {
    // The native customer app should open the dedicated mobile storefront.
    // /app serves app-v2.html; /shop is the desktop/customer storefront.
    url: 'https://shrivi-marketplace.onrender.com/app',
    cleartext: false,
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      // Let Capacitor dismiss the native splash automatically. The remote
      // storefront must not be able to leave the native launch screen stuck.
      launchAutoHide: true,
      backgroundColor: '#FFFFFF',
      androidScaleType: 'CENTER',
      showSpinner: false
    }
  }
};

export default config;
