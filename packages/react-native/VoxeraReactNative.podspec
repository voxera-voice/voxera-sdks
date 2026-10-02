Pod::Spec.new do |spec|
  spec.name = "VoxeraReactNative"
  spec.version = "2.2.3"
  spec.summary = "React Native bridge for VoxeraSDK."
  spec.homepage = "https://github.com/voxera-voice/voxera-sdks"
  spec.license = { :type => "MIT", :file => "LICENSE" }
  spec.author = { "Voxera" => "voicevoxera@gmail.com" }
  spec.source = {
    :git => "https://github.com/voxera-voice/voxera-sdks.git",
    :tag => "sdk-react-native@#{spec.version}"
  }

  spec.platform = :ios, "15.0"
  spec.swift_version = "5.9"
  spec.static_framework = true
  spec.source_files = "ios/**/*.{h,m,mm,swift}"
  spec.dependency "React-Core"
  spec.dependency "VoxeraSDK", "= 1.1.43"
end
