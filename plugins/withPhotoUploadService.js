/**
 * Lets the parcel photos keep uploading with the app in the background
 * (src/photos/uploadNotification.ts). Notifee runs them in its foreground
 * service, which its library declares as `shortService` - a few minutes at most,
 * and the wrong kind for a file upload. Here it is declared `dataSync` instead,
 * with the permission Android 14 asks for that kind.
 *
 * The android/ folder is generated at build time, so this is set here rather
 * than edited by hand.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const SERVICE = 'app.notifee.core.ForegroundService';
const PERMISSION = 'android.permission.FOREGROUND_SERVICE_DATA_SYNC';

module.exports = function withPhotoUploadService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    if (!manifest['uses-permission'].some((p) => p.$['android:name'] === PERMISSION)) {
      manifest['uses-permission'].push({ $: { 'android:name': PERMISSION } });
    }

    const app = manifest.application?.[0];
    if (app) {
      app.service = (app.service ?? []).filter((s) => s.$['android:name'] !== SERVICE);
      app.service.push({
        $: {
          'android:name': SERVICE,
          'android:exported': 'false',
          'android:foregroundServiceType': 'dataSync',
          'tools:replace': 'android:foregroundServiceType',
        },
      });
    }
    return cfg;
  });
};
