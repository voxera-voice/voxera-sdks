module.exports = {
  dependency: {
    platforms: {
      ios: {
        podspecPath: "VoxeraReactNative.podspec",
      },
      android: {
        sourceDir: "android",
        packageImportPath: "import com.voxera.reactnative.VoxeraPackage;",
        packageInstance: "new VoxeraPackage()",
      },
    },
  },
};
