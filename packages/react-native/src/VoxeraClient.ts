import {
  VOXERA_PROTOCOL,
  VOXERA_PROTOCOL_VERSION,
} from "@voxera/protocol";

import {
  createNativeVoxeraEmitter,
  getNativeVoxeraModule,
  VOXERA_NATIVE_EVENT,
} from "./NativeVoxeraModule";
import type {
  VoxeraConfig,
  VoxeraEventMap,
  VoxeraEventName,
  VoxeraSubscription,
} from "./types";

export class VoxeraClient {
  readonly protocol = VOXERA_PROTOCOL;
  readonly protocolVersion = VOXERA_PROTOCOL_VERSION;

  private readonly config: VoxeraConfig;
  private configured = false;

  constructor(config: VoxeraConfig) {
    if (!config.appKey.trim()) {
      throw new Error("VoxeraConfig.appKey must not be empty");
    }
    if (!config.serverUrl.trim()) {
      throw new Error("VoxeraConfig.serverUrl must not be empty");
    }
    this.config = { ...config };
  }

  async connect(): Promise<void> {
    await this.ensureConfigured();
    await getNativeVoxeraModule().connect();
  }

  async disconnect(): Promise<void> {
    await getNativeVoxeraModule().disconnect();
  }

  async startConversation(): Promise<void> {
    await this.ensureConfigured();
    await getNativeVoxeraModule().startConversation();
  }

  async endConversation(): Promise<void> {
    await getNativeVoxeraModule().endConversation();
  }

  async sendMessage(message: string): Promise<void> {
    if (!message.trim()) return;
    await getNativeVoxeraModule().sendMessage(message);
  }

  /**
   * Return a tool's output for the `toolTriggered` call with this `actionId`.
   *
   * The reply is paused until this arrives, so call it exactly once per
   * action — including when the tool failed, where saying so is what lets the
   * model recover.
   *
   * `result` reaches the model verbatim, so it should say what happened in
   * terms the model can act on ("calendar shown, awaiting a slot") rather than
   * a status code. For a tool whose real result is a piece of UI, describing
   * the UI is the honest answer.
   */
  async selectAction(actionId: string, result: string): Promise<void> {
    if (!actionId) return;
    await getNativeVoxeraModule().selectAction(actionId, result);
  }

  async setMuted(muted: boolean): Promise<void> {
    await getNativeVoxeraModule().setMuted(muted);
  }

  async startCamera(front = true): Promise<void> {
    await this.ensureConfigured();
    await getNativeVoxeraModule().startCamera(front);
  }

  async stopCamera(): Promise<void> {
    await getNativeVoxeraModule().stopCamera();
  }

  async switchCamera(): Promise<void> {
    await getNativeVoxeraModule().switchCamera();
  }

  on<K extends VoxeraEventName>(
    eventName: K,
    listener: (event: VoxeraEventMap[K]) => void,
  ): VoxeraSubscription {
    const emitter = createNativeVoxeraEmitter();
    return emitter.addListener(VOXERA_NATIVE_EVENT, (nativeEvent) => {
      const event = nativeEvent as {
        type?: VoxeraEventName;
        data?: VoxeraEventMap[VoxeraEventName];
      };
      if (event.type === eventName && event.data !== undefined) {
        listener(event.data as VoxeraEventMap[K]);
      }
    });
  }

  private async ensureConfigured(): Promise<void> {
    if (this.configured) return;
    await getNativeVoxeraModule().configure(this.config);
    this.configured = true;
  }
}
