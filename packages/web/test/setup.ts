import { afterEach, vi } from "vitest";

/**
 * jsdom implements neither MediaStream nor navigator.mediaDevices, so the parts
 * of the browser the client actually uses are stubbed here. The stubs behave
 * like the real objects for track add/remove/stop, which is what the cleanup
 * assertions depend on.
 */
export class FakeMediaStreamTrack {
  enabled = true;
  readyState: "live" | "ended" = "live";
  constructor(public readonly kind: string = "audio") {}
  stop(): void {
    this.readyState = "ended";
  }
}

class FakeMediaStream {
  private tracks: FakeMediaStreamTrack[] = [];
  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }
  getAudioTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  addTrack(track: FakeMediaStreamTrack): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }
  removeTrack(track: FakeMediaStreamTrack): void {
    this.tracks = this.tracks.filter((candidate) => candidate !== track);
  }
}

vi.stubGlobal("MediaStream", FakeMediaStream);

export const getUserMedia = vi.fn(
  async () => new FakeMediaStream([new FakeMediaStreamTrack("audio")]),
);

Object.defineProperty(globalThis.navigator, "mediaDevices", {
  configurable: true,
  value: { getUserMedia },
});

// HTMLMediaElement.play is not implemented in jsdom.
Object.defineProperty(globalThis.HTMLMediaElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: vi.fn(async () => undefined),
});

afterEach(() => {
  getUserMedia.mockReset();
  getUserMedia.mockImplementation(
    async () => new FakeMediaStream([new FakeMediaStreamTrack("audio")]),
  );
});
