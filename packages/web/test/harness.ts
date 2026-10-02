import { vi } from "vitest";
import { CLIENT_COMMANDS } from "@voxera/protocol";

type Handler = (...args: unknown[]) => void;

/** Minimal socket.io-client double: enough event plumbing to drive the client. */
export class FakeSocket {
  connected = false;
  readonly emitted: Array<{ event: string; data: unknown }> = [];
  readonly handlers = new Map<string, Set<Handler>>();
  readonly anyHandlers = new Set<Handler>();
  removeAllListenersCalls = 0;
  disconnectCalls = 0;

  readonly io = {
    handlers: new Map<string, Set<Handler>>(),
    removeAllListenersCalls: 0,
    on: (event: string, handler: Handler) => {
      const set = this.io.handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      this.io.handlers.set(event, set);
    },
    removeAllListeners: () => {
      this.io.removeAllListenersCalls += 1;
      this.io.handlers.clear();
    },
    fire: (event: string, ...args: unknown[]) => {
      for (const handler of [...(this.io.handlers.get(event) ?? [])]) {
        handler(...args);
      }
    },
  };

  /** Acknowledgement payloads keyed by command name. */
  acks: Record<string, unknown> = {};
  /** Commands that should acknowledge with an error instead. */
  ackErrors: Record<string, Error> = {};
  /** Commands the server never acknowledges, as a server without failure acks. */
  readonly unacknowledged = new Set<string>();
  /** Set to false to make connect() fail instead of succeed. */
  connectSucceeds = true;
  connectError = new Error("connect_error");

  on(event: string, handler: Handler): this {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return this;
  }

  once(event: string, handler: Handler): this {
    const wrapped: Handler = (...args) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  onAny(handler: Handler): this {
    this.anyHandlers.add(handler);
    return this;
  }

  removeAllListeners(): this {
    this.removeAllListenersCalls += 1;
    this.handlers.clear();
    this.anyHandlers.clear();
    return this;
  }

  connect(): this {
    // Asynchronous like the real transport, so connect() genuinely awaits.
    setTimeout(() => {
      if (this.connectSucceeds) {
        this.connected = true;
        this.fire("connect");
      } else {
        this.fire("connect_error", this.connectError);
      }
    }, 0);
    return this;
  }

  disconnect(): this {
    this.disconnectCalls += 1;
    this.connected = false;
    return this;
  }

  emit(event: string, data?: unknown, ack?: Handler): this {
    this.emitted.push({ event, data });
    if (ack && !this.unacknowledged.has(event)) {
      const error = this.ackErrors[event];
      setTimeout(() => ack(error ?? null, this.acks[event]), 0);
    }
    return this;
  }

  timeout(): this {
    return this;
  }

  /** The transport dropping, as socket.io reports it. */
  drop(): void {
    this.connected = false;
    this.fire("disconnect", "transport close");
  }

  /**
   * socket.io's real reconnect order: the manager announces "reconnect" as
   * soon as the transport is back, while this namespace is still
   * disconnected, and only then does the namespace fire "connect". Firing
   * "reconnect" on a socket that still claims to be connected is what hid
   * the auto-reconnect bug from these tests.
   */
  reconnect(): void {
    this.io.fire("reconnect");
    // The namespace CONNECT is a round trip to the server, so it lands later.
    setTimeout(() => {
      this.connected = true;
      this.fire("connect");
    }, 5);
  }

  /** Dispatches a server-sent event to the client's handlers. */
  fire(event: string, ...args: unknown[]): void {
    for (const handler of [...this.anyHandlers]) handler(event, args[0]);
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      handler(...args);
    }
  }

  commandsNamed(event: string): unknown[] {
    return this.emitted
      .filter((entry) => entry.event === event)
      .map((entry) => entry.data);
  }
}

export class FakeProducer {
  closed = false;
  constructor(
    readonly track?: { stop(): void },
    /** mediasoup-client's default: closing a producer stops its track. */
    readonly stopTracks = true,
  ) {}
  close(): void {
    this.closed = true;
    if (this.stopTracks) this.track?.stop();
  }
}

export class FakeConsumer {
  closed = false;
  readonly track: { kind: string };
  private readonly handlers = new Map<string, Handler>();
  constructor(
    public readonly id: string,
    public readonly producerId: string,
    public readonly kind = "audio",
  ) {
    // A distinct track object per consumer, so remoteStream membership is real.
    this.track = { kind };
  }
  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }
  close(): void {
    this.closed = true;
  }
}

export class FakeTransport {
  readonly id = "transport-1";
  closed = false;
  readonly producers: FakeProducer[] = [];
  readonly consumers: FakeConsumer[] = [];
  private readonly handlers = new Map<string, Handler>();

  on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }
  async produce(options: {
    track?: { stop(): void };
    stopTracks?: boolean;
  } = {}): Promise<FakeProducer> {
    const producer = new FakeProducer(options.track, options.stopTracks ?? true);
    this.producers.push(producer);
    return producer;
  }
  async consume(parameters: {
    id?: string;
    producerId?: string;
    kind?: string;
  }): Promise<FakeConsumer> {
    const consumer = new FakeConsumer(
      parameters.id ?? "consumer",
      parameters.producerId ?? "producer",
      parameters.kind ?? "audio",
    );
    this.consumers.push(consumer);
    return consumer;
  }
  close(): void {
    this.closed = true;
  }
}

export class FakeDevice {
  static instances: FakeDevice[] = [];
  rtpCapabilities = { codecs: [] };
  /** The client gates transport creation on this, as the real Device does. */
  loaded = false;
  readonly sendTransports: FakeTransport[] = [];
  readonly receiveTransports: FakeTransport[] = [];

  constructor() {
    FakeDevice.instances.push(this);
  }
  async load(): Promise<void> {
    this.loaded = true;
  }
  createSendTransport(): FakeTransport {
    const transport = new FakeTransport();
    this.sendTransports.push(transport);
    return transport;
  }
  createRecvTransport(): FakeTransport {
    const transport = new FakeTransport();
    this.receiveTransports.push(transport);
    return transport;
  }
}

export const sockets: FakeSocket[] = [];

export const io = vi.fn(() => {
  const socket = new FakeSocket();
  socket.acks = {
    [CLIENT_COMMANDS.initSessionConnection]: {
      participantId: "participant-1",
      protocol: "voxera",
      protocolVersion: "1.0",
    },
    [CLIENT_COMMANDS.getRtpCapabilities]: { codecs: [] },
    [CLIENT_COMMANDS.getIceServers]: [],
    [CLIENT_COMMANDS.createTransport]: { id: "transport-1" },
    [CLIENT_COMMANDS.consume]: {
      id: "consumer-1",
      producerId: "producer-1",
      kind: "audio",
      rtpParameters: {},
    },
  };
  sockets.push(socket);
  return socket;
});

export function latestSocket(): FakeSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error("No socket was created");
  return socket;
}

export function resetHarness(): void {
  sockets.length = 0;
  FakeDevice.instances.length = 0;
  io.mockClear();
}
