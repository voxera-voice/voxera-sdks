import { NativeEventEmitter, NativeModules } from "react-native";

import type { VoxeraConfig, VoxeraEventMap, VoxeraEventName } from "./types";

export const VOXERA_NATIVE_EVENT = "VoxeraEvent";

export interface VoxeraNativeEvent<K extends VoxeraEventName = VoxeraEventName> {
  type: K;
  data: VoxeraEventMap[K];
}

export interface NativeVoxeraModule {
  configure(config: VoxeraConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  startConversation(): Promise<void>;
  endConversation(): Promise<void>;
  sendMessage(message: string): Promise<void>;
  selectAction(actionId: string, result: string): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  startCamera(front: boolean): Promise<void>;
  stopCamera(): Promise<void>;
  switchCamera(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const linkedModule = NativeModules.VoxeraModule as
  | NativeVoxeraModule
  | undefined;

export function getNativeVoxeraModule(): NativeVoxeraModule {
  if (!linkedModule) {
    throw new Error(
      "@voxera/sdk-react-native is not linked. Rebuild the native app after " +
        "installing the package and iOS pods.",
    );
  }
  return linkedModule;
}

export function createNativeVoxeraEmitter(): NativeEventEmitter {
  return new NativeEventEmitter(getNativeVoxeraModule() as object);
}
