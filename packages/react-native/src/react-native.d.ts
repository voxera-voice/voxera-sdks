declare module "react-native" {
  export interface EmitterSubscription {
    remove(): void;
  }

  export class NativeEventEmitter {
    constructor(nativeModule?: object);
    addListener(
      eventType: string,
      listener: (event: unknown) => void,
    ): EmitterSubscription;
  }

  export const NativeModules: Record<string, unknown>;

  export const Platform: {
    OS: "ios" | "android" | "windows" | "macos" | "web";
  };

  export const PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: string; CAMERA: string };
    RESULTS: { GRANTED: string; DENIED: string; NEVER_ASK_AGAIN: string };
    request(permission: string): Promise<string>;
  };
}
