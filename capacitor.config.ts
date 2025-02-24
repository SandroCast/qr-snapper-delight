
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.cf7f214c7f934bbca16e799be85e09b7',
  appName: 'qr-snapper-delight',
  webDir: 'dist',
  server: {
    url: 'https://cf7f214c-7f93-4bbc-a16e-799be85e09b7.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    Camera: {
      permissions: true
    }
  }
};

export default config;
