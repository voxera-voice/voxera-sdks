import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_COMMANDS, SERVER_EVENTS } from "@voxera/protocol";
import { FakeDevice, io, latestSocket, resetHarness } from "./harness";
import { getUserMedia } from "./setup";

vi.mock("socket.io-client", () => ({ io }));
vi.mock("mediasoup-client", () => ({ Device: FakeDevice }));

const { VoxeraClient } = await import("../src/VoxeraClient");

type Client = InstanceType<typeof VoxeraClient>;

function createClient(
  overrides: Partial<ConstructorParameters<typeof VoxeraClient>[0]> = {},
): Client {
  return new VoxeraClient({
    serverUrl: "https://voice.example.com",
    appKey: "vx_pk_test",
    sessionId: "session-1",
    ...overrides,
  });
}

/** Connects and settles the queued acknowledgement callbacks. */
async function connect(client: Client): Promise<void> {
  await client.connect();
}

beforeEach(() => {
  resetHarness();
});

describe("credential handling", () => {
  it("refuses to construct without a publishable key or session token", () => {
    expect(() => createClient({ appKey: undefined })).toThrow(
      /appKey or sessionToken is required/,
    );
    expect(() => createClient({ appKey: "   " })).toThrow(
      /appKey or sessionToken is required/,
    );
  });

  it("accepts a session token on its own", async () => {
    const client = createClient({ appKey: undefined, sessionToken: "st_abc" });
    await connect(client);

    const [init] = latestSocket().commandsNamed(
      CLIENT_COMMANDS.initSessionConnection,
    ) as Array<{ appKey?: string; sessionToken?: string }>;
    expect(init.sessionToken).toBe("st_abc");
    expect(init.appKey).toBeUndefined();
  });

  it("requires a server url", () => {
    expect(() => createClient({ serverUrl: " " })).toThrow(
      /serverUrl is required/,
    );
  });

  it("sends the credential only in the session handshake", async () => {
    const client = createClient({ appKey: "vx_pk_secret" });
    await connect(client);
    client.startConversation();
    client.sendMessage("hello");

    const carrying = latestSocket().emitted.filter(
      (entry) =>
        entry.event !== CLIENT_COMMANDS.initSessionConnection &&
        JSON.stringify(entry.data ?? {}).includes("vx_pk_secret"),
    );
    expect(carrying).toEqual([]);
  });

  it("keeps the credential out of reported errors", async () => {
    const client = createClient({ appKey: "vx_pk_secret" });
    const errors: unknown[] = [];
    client.on("error", (error) => errors.push(error));

    // A rejected handshake is the case most likely to echo the key back.
    const pending = client.connect();
    latestSocket().ackErrors[CLIENT_COMMANDS.initSessionConnection] = new Error(
      "unauthorized",
    );
    await expect(pending).rejects.toThrow("unauthorized");

    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors)).not.toContain("vx_pk_secret");
  });
});

describe("microphone denial", () => {
  it("fails the connection and reports it when the user denies the microphone", async () => {
    const denied = Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    });
    getUserMedia.mockRejectedValue(denied);

    const client = createClient();
    const errors: Array<{ code?: string }> = [];
    client.on("error", (error) => errors.push(error as { code?: string }));

    await expect(client.connect()).rejects.toThrow("Permission denied");
    expect(client.state.connectionStatus).toBe("error");
    // By its DOMException name, never the legacy numeric DOMException.code.
    expect(errors.map((error) => error.code)).toEqual(["MEDIA_ACCESS_DENIED"]);
  });

  it("tears the socket down so a denial does not leak a live connection", async () => {
    getUserMedia.mockRejectedValue(new Error("Permission denied"));
    const client = createClient();

    await expect(client.connect()).rejects.toThrow();

    expect(latestSocket().disconnectCalls).toBeGreaterThan(0);
    expect(client.localStream.getTracks()).toHaveLength(0);
  });

  it("produces no audio track when the microphone was never granted", async () => {
    getUserMedia.mockRejectedValue(new Error("Permission denied"));
    const client = createClient();
    await expect(client.connect()).rejects.toThrow();

    const device = FakeDevice.instances.at(-1);
    expect(device?.sendTransports.at(-1)?.producers ?? []).toHaveLength(0);
  });

  it("can be retried after the user grants permission", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("Permission denied"));
    const client = createClient();

    await expect(client.connect()).rejects.toThrow();
    await expect(client.connect()).resolves.toBeUndefined();
    expect(client.state.connectionStatus).toBe("connected");
  });
});

describe("reconnects", () => {
  it("reports reconnecting when the transport drops", async () => {
    const client = createClient();
    await connect(client);

    latestSocket().fire("disconnect");

    expect(client.state.connectionStatus).toBe("reconnecting");
  });

  it("rebuilds the session and returns to connected", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();
    const firstDevice = FakeDevice.instances.at(-1);

    socket.drop();
    socket.reconnect();
    await vi.waitFor(() =>
      expect(client.state.connectionStatus).toBe("connected"),
    );

    // The handshake is replayed on the same socket, with fresh transports.
    expect(
      socket.commandsNamed(CLIENT_COMMANDS.initSessionConnection),
    ).toHaveLength(2);
    expect(firstDevice?.sendTransports.at(-1)?.closed).toBe(true);
    expect(FakeDevice.instances.at(-1)).not.toBe(firstDevice);
  });

  it("closes the previous producers rather than stacking them", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();
    const firstProducer = FakeDevice.instances
      .at(-1)
      ?.sendTransports.at(-1)
      ?.producers.at(-1);

    socket.drop();
    socket.reconnect();
    await vi.waitFor(() =>
      expect(client.state.connectionStatus).toBe("connected"),
    );

    expect(firstProducer?.closed).toBe(true);
    const latest = FakeDevice.instances.at(-1)?.sendTransports.at(-1);
    expect(latest?.producers).toHaveLength(1);
  });

  it("reports an error when the rebuild fails instead of claiming connected", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();
    const errors: Array<{ code?: string }> = [];
    client.on("error", (error) => errors.push(error as { code?: string }));

    socket.acks[CLIENT_COMMANDS.initSessionConnection] = {
      ok: false,
      error: { code: "AUTHENTICATION_FAILED", message: "lease expired" },
    };
    socket.drop();
    socket.reconnect();

    await vi.waitFor(() =>
      expect(client.state.connectionStatus).toBe("error"),
    );
    expect(errors.map((error) => error.code)).toContain("AUTHENTICATION_FAILED");
  });

  it("keeps the microphone live across a reconnect", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();
    const [track] = client.localStream.getTracks();

    socket.drop();
    socket.reconnect();
    await vi.waitFor(() =>
      expect(client.state.connectionStatus).toBe("connected"),
    );

    // Closing the old producer must not stop the user's microphone.
    expect(track.readyState).toBe("live");
    expect(client.localStream.getTracks()).toEqual([track]);
    const latest = FakeDevice.instances.at(-1)?.sendTransports.at(-1);
    expect(latest?.producers.at(-1)?.track).toBe(track);
  });

  it("asks for the microphone again when the old track has ended", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();
    const [oldTrack] = client.localStream.getTracks();
    oldTrack.stop(); // e.g. the device was unplugged while offline

    socket.drop();
    socket.reconnect();
    await vi.waitFor(() =>
      expect(client.state.connectionStatus).toBe("connected"),
    );

    const [newTrack] = client.localStream.getTracks();
    expect(newTrack).not.toBe(oldTrack);
    expect(newTrack.readyState).toBe("live");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("restores mute and silence on the reconnected participant", async () => {
    const client = createClient();
    await connect(client);
    client.setMuted(true);
    client.setSilenceMode(true);
    const socket = latestSocket();
    socket.acks[CLIENT_COMMANDS.initSessionConnection] = {
      participantId: "participant-2",
    };

    socket.drop();
    socket.reconnect();
    await vi.waitFor(() =>
      expect(client.state.connectionStatus).toBe("connected"),
    );

    expect(socket.commandsNamed(CLIENT_COMMANDS.muteChanged).at(-1)).toEqual({
      id: "participant-2",
      isMuted: true,
    });
    expect(
      socket.commandsNamed(CLIENT_COMMANDS.toggleListenMode).at(-1),
    ).toEqual({ id: "participant-2", listenMode: true });
    expect(client.localStream.getTracks()[0].enabled).toBe(false);
  });

  it("does not treat the first connect as a reconnect", async () => {
    const client = createClient();
    await connect(client);
    expect(
      latestSocket().commandsNamed(CLIENT_COMMANDS.initSessionConnection),
    ).toHaveLength(1);
  });

  it("does not rebuild after dispose", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();

    await client.dispose();
    socket.reconnect();

    expect(
      socket.commandsNamed(CLIENT_COMMANDS.initSessionConnection),
    ).toHaveLength(1);
  });

  it("honours autoReconnect: false", async () => {
    await connect(createClient({ autoReconnect: false }));
    expect(io).toHaveBeenCalledWith(
      "https://voice.example.com",
      expect.objectContaining({ reconnection: false }),
    );
  });

  it("enables socket reconnection by default", async () => {
    await connect(createClient());
    expect(io).toHaveBeenCalledWith(
      "https://voice.example.com",
      expect.objectContaining({ reconnection: true }),
    );
  });
});

describe("interruptions", () => {
  it("tracks who is speaking", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();

    socket.fire(SERVER_EVENTS.speakingStatusChanged, { status: "ai-speaking" });
    expect(client.state.speakingStatus).toBe("ai");

    socket.fire(SERVER_EVENTS.speakingStatusChanged, { status: "user" });
    expect(client.state.speakingStatus).toBe("user");

    // An interruption ends the assistant's turn.
    socket.fire(SERVER_EVENTS.speakingStatusChanged, { status: "none" });
    expect(client.state.speakingStatus).toBe("none");
  });

  it("falls back to none for an unrecognised speaking status", async () => {
    const client = createClient();
    await connect(client);

    latestSocket().fire(SERVER_EVENTS.speakingStatusChanged, {
      status: "something-else",
    });

    expect(client.state.speakingStatus).toBe("none");
  });

  it("drops a closed producer so replacement speech is audible", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();

    socket.fire(SERVER_EVENTS.newProducer, { producerId: "producer-1" });
    await vi.waitFor(() =>
      expect(client.remoteStream.getTracks()).toHaveLength(1),
    );

    socket.fire(SERVER_EVENTS.producerClosed, { producerId: "producer-1" });
    expect(client.remoteStream.getTracks()).toHaveLength(0);

    // The same producer id can be consumed again after being closed.
    socket.fire(SERVER_EVENTS.newProducer, { producerId: "producer-1" });
    await vi.waitFor(() =>
      expect(client.remoteStream.getTracks()).toHaveLength(1),
    );
  });

  it("consumes a producer only once while it is live", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();

    socket.fire(SERVER_EVENTS.newProducer, { producerId: "producer-1" });
    socket.fire(SERVER_EVENTS.newProducer, { producerId: "producer-1" });
    await vi.waitFor(() =>
      expect(client.remoteStream.getTracks()).toHaveLength(1),
    );

    expect(socket.commandsNamed(CLIENT_COMMANDS.consume)).toHaveLength(1);
  });

  it("mutes the microphone locally and tells the server", async () => {
    const client = createClient();
    await connect(client);

    const muted = client.toggleMute();

    expect(muted).toBe(true);
    expect(client.state.isMuted).toBe(true);
    expect(
      client.localStream.getAudioTracks().every((track) => !track.enabled),
    ).toBe(true);
    expect(latestSocket().commandsNamed(CLIENT_COMMANDS.muteChanged)).toEqual([
      { id: "participant-1", isMuted: true },
    ]);
  });
});

describe("cleanup", () => {
  it("stops and releases the microphone on disconnect", async () => {
    const client = createClient();
    await connect(client);
    const tracks = client.localStream.getTracks() as Array<{
      readyState: string;
    }>;
    expect(tracks).toHaveLength(1);

    await client.disconnect();

    expect(tracks[0].readyState).toBe("ended");
    expect(client.localStream.getTracks()).toHaveLength(0);
    expect(client.state.connectionStatus).toBe("disconnected");
  });

  it("leaves the room, drops listeners and closes the socket", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();

    await client.disconnect();

    expect(socket.commandsNamed(CLIENT_COMMANDS.leave)).toEqual([
      { sessionId: "session-1" },
    ]);
    expect(socket.removeAllListenersCalls).toBe(1);
    expect(socket.io.removeAllListenersCalls).toBe(1);
    expect(socket.disconnectCalls).toBe(1);
  });

  it("closes every transport, producer and consumer", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();
    socket.fire(SERVER_EVENTS.newProducer, { producerId: "producer-1" });
    await vi.waitFor(() =>
      expect(client.remoteStream.getTracks()).toHaveLength(1),
    );
    const device = FakeDevice.instances.at(-1)!;

    await client.disconnect();

    expect(device.sendTransports.every((t) => t.closed)).toBe(true);
    expect(device.receiveTransports.every((t) => t.closed)).toBe(true);
    expect(
      device.sendTransports.flatMap((t) => t.producers).every((p) => p.closed),
    ).toBe(true);
    expect(
      device.receiveTransports
        .flatMap((t) => t.consumers)
        .every((c) => c.closed),
    ).toBe(true);
    expect(client.remoteStream.getTracks()).toHaveLength(0);
  });

  it("is idempotent across repeated disconnects and disposes", async () => {
    const client = createClient();
    await connect(client);
    const socket = latestSocket();

    await client.disconnect();
    await client.disconnect();
    await client.dispose();
    await client.dispose();

    expect(socket.commandsNamed(CLIENT_COMMANDS.leave)).toHaveLength(1);
    expect(socket.disconnectCalls).toBe(1);
  });

  it("refuses to reconnect a disposed client", async () => {
    const client = createClient();
    await connect(client);
    await client.dispose();

    await expect(client.connect()).rejects.toThrow();
  });

  it("plays remote audio through an element it owns", async () => {
    const client = createClient();
    await connect(client);

    await expect(client.resumeRemoteAudio()).resolves.toBeUndefined();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("does nothing on resumeRemoteAudio when autoPlayRemoteAudio is off", async () => {
    const client = createClient({ autoPlayRemoteAudio: false });
    await connect(client);

    await expect(client.resumeRemoteAudio()).resolves.toBeUndefined();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});

describe("connection failures", () => {
  it("rejects and reports when the socket never connects", async () => {
    const client = createClient();
    const errors: Array<{ code?: string }> = [];
    client.on("error", (error) => errors.push(error as { code?: string }));

    const pending = client.connect();
    latestSocket().connectSucceeds = false;
    await expect(pending).rejects.toThrow();

    expect(client.state.connectionStatus).toBe("error");
    expect(errors.map((error) => error.code)).toContain("CONNECTION_FAILED");
  });

  it("ends in error, not reconnecting, when connect fails", async () => {
    const client = createClient();
    const states: string[] = [];
    client.on("stateChanged", (state) => states.push(state.connectionStatus));

    const pending = client.connect();
    latestSocket().connectSucceeds = false;
    await expect(pending).rejects.toThrow();

    expect(client.state.connectionStatus).toBe("error");
    expect(states).not.toContain("reconnecting");
  });

  it("does not open a second socket while a connect is in flight", async () => {
    const client = createClient();
    const first = client.connect();
    await client.connect();
    await first;

    expect(io).toHaveBeenCalledTimes(1);
  });

  it("refuses conversation commands before connecting", () => {
    const client = createClient();
    expect(() => client.startConversation()).toThrow();
    expect(() => client.sendMessage("hi")).toThrow();
  });
});

describe("refused sessions", () => {
  it("rejects at once with the server's code when the ack refuses", async () => {
    const client = createClient();
    const errors: Array<{ code?: string; message?: string }> = [];
    client.on("error", (error) => errors.push(error));

    const pending = client.connect();
    latestSocket().acks[CLIENT_COMMANDS.initSessionConnection] = {
      ok: false,
      error: { code: "AUTHENTICATION_FAILED", message: "Invalid app key" },
    };

    await expect(pending).rejects.toThrow("Invalid app key");
    expect(client.state.connectionStatus).toBe("error");
    // Reported once, with the real reason — not a timeout, not twice.
    expect(errors).toEqual([
      { code: "AUTHENTICATION_FAILED", message: "Invalid app key" },
    ]);
    // Nothing past the refused handshake was attempted.
    expect(
      latestSocket().commandsNamed(CLIENT_COMMANDS.getRtpCapabilities),
    ).toHaveLength(0);
  });

  it("rejects at once on server-error when the server never acks", async () => {
    const client = createClient({ connectionTimeoutMs: 60_000 });
    const errors: Array<{ code?: string }> = [];
    client.on("error", (error) => errors.push(error));

    const pending = client.connect();
    const socket = latestSocket();
    socket.unacknowledged.add(CLIENT_COMMANDS.initSessionConnection);
    await vi.waitFor(() =>
      expect(
        socket.commandsNamed(CLIENT_COMMANDS.initSessionConnection),
      ).toHaveLength(1),
    );
    socket.fire(SERVER_EVENTS.serverError, {
      code: "AUTHENTICATION_FAILED",
      message: "Origin is not allowed for this app key",
    });

    await expect(pending).rejects.toThrow("Origin is not allowed");
    expect(errors.map((error) => error.code)).toEqual(["AUTHENTICATION_FAILED"]);
  });

  it("treats a legacy { error } ack as a refusal", async () => {
    const client = createClient();
    const pending = client.connect();
    latestSocket().acks[CLIENT_COMMANDS.getRtpCapabilities] = {
      error: "Session is not initialized",
    };
    await expect(pending).rejects.toThrow("Session is not initialized");
  });

  it("reports an ack timeout as TIMEOUT", async () => {
    const client = createClient();
    const errors: Array<{ code?: string }> = [];
    client.on("error", (error) => errors.push(error));

    const pending = client.connect();
    latestSocket().ackErrors[CLIENT_COMMANDS.initSessionConnection] = new Error(
      "operation has timed out",
    );

    await expect(pending).rejects.toThrow("timed out");
    expect(errors.map((error) => error.code)).toEqual(["TIMEOUT"]);
  });

  it("still reports server errors that arrive after setup", async () => {
    const client = createClient();
    await connect(client);
    const errors: Array<{ code?: string }> = [];
    client.on("error", (error) => errors.push(error));

    latestSocket().fire(SERVER_EVENTS.serverError, {
      code: "SPEECH_BUDGET_EXHAUSTED",
      message: "budget",
    });

    expect(errors.map((error) => error.code)).toEqual([
      "SPEECH_BUDGET_EXHAUSTED",
    ]);
  });
});
