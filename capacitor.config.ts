import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lifedash.dashboard',
  appName: 'Lifedash',
  webDir: 'dist',
  backgroundColor: '#0a0a0b',
  ios: {
    contentInset: 'never',
    scheme: 'Lifedash',
    preferredContentMode: 'mobile',
  },
  plugins: {
    // Routes window.fetch through native URLSession → no CORS limits for RSS/ICS/APIs.
    CapacitorHttp: { enabled: true },
    LocalNotifications: { iconColor: '#c6f432' },
    BackgroundRunner: {
      label: 'app.lifedash.refresh',
      src: 'runners/background.js',
      event: 'refresh',
      repeat: true,
      interval: 30,
      autoStart: true,
    },
  },
};

export default config;
