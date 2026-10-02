// Resolve from the host app first so `file:`/workspace links work during local
// SDK development (Node otherwise resolves from this package's real path).
const configPluginsPath = require.resolve("@expo/config-plugins", {
  paths: [process.cwd(), __dirname],
});
const { withAndroidManifest, withInfoPlist } = require(configPluginsPath);

const ANDROID_PERMISSIONS = [
  "android.permission.CAMERA",
  "android.permission.INTERNET",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.RECORD_AUDIO",
];

module.exports = function withVoxera(config, props = {}) {
  config = withInfoPlist(config, (iosConfig) => {
    iosConfig.modResults.NSMicrophoneUsageDescription =
      props.microphonePermission ||
      iosConfig.modResults.NSMicrophoneUsageDescription ||
      "Allow this app to use the microphone for Voxera conversations.";
    iosConfig.modResults.NSCameraUsageDescription =
      props.cameraPermission ||
      iosConfig.modResults.NSCameraUsageDescription ||
      "Allow this app to use the camera for Voxera video.";
    return iosConfig;
  });

  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    const permissions = manifest["uses-permission"] || [];
    const existing = new Set(
      permissions.map((permission) => permission.$?.["android:name"]),
    );
    for (const permission of ANDROID_PERMISSIONS) {
      if (!existing.has(permission)) {
        permissions.push({ $: { "android:name": permission } });
      }
    }
    manifest["uses-permission"] = permissions;
    return androidConfig;
  });
};
