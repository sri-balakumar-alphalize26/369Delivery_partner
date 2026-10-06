/**
 * Lets a new-job ring open the app over the lock screen, like an incoming call
 * (src/push/fullScreenRing.ts). The main activity may show while the phone is
 * locked and turns the screen on when the full-screen notification launches it.
 *
 * The android/ folder is generated at build time, so this is set here rather
 * than edited by hand.
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withLockScreenRing(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (main) {
      main.$['android:showWhenLocked'] = 'true';
      main.$['android:turnScreenOn'] = 'true';
    }
    return cfg;
  });
};
