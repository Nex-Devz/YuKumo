import type { TrackInfo } from "../types/protocol.ts";

/**
 * Client-side Lavalink v4 track encoding/decoding — byte-for-byte compatible
 * with `@lavalink/encoding` (used by Lavalink itself), so tracks built locally
 * can be sent straight to a node and server-encoded tracks can be decoded
 * without any REST round-trip.
 *
 * v4 format: an int32 prefix holding `(payloadLength | 1 << 30)` where the
 * high bit marks the track as "versioned", a single version byte (2), then
 * the fields: title, author, length (int64), identifier, isStream, optional
 * uri, source, [probe info for http/local sources], position (int64).
 */

const TRACK_INFO_VERSIONED = 1;
const TRACK_INFO_VERSION = 2;
const DEFAULT_PROBE_INFO = "<no probe info provided>";
const PROBE_SOURCES = new Set(["http", "local"]);

class DataOutput {
  private buf: Buffer;
  private pos = 0;

  public constructor(initialSize = 256) {
    this.buf = Buffer.alloc(initialSize);
  }

  public get length(): number {
    return this.pos;
  }

  public get bytes(): Buffer {
    return this.buf.subarray(0, this.pos);
  }

  private ensure(bytes: number): void {
    if (this.pos + bytes <= this.buf.length) return;
    const newLength = Math.max(this.buf.length + this.pos + bytes, this.buf.length * 2);
    const next = Buffer.alloc(newLength);
    this.buf.copy(next);
    this.buf = next;
  }

  public writeByte(value: number): void {
    this.ensure(1);
    this.buf.writeUInt8(value & 0xff, this.pos);
    this.pos += 1;
  }

  public writeUnsignedShort(value: number): void {
    this.ensure(2);
    this.buf.writeUInt16BE(value & 0xffff, this.pos);
    this.pos += 2;
  }

  public writeInt(value: number): void {
    this.ensure(4);
    this.buf.writeInt32BE(value | 0, this.pos);
    this.pos += 4;
  }

  public writeLong(value: number): void {
    this.ensure(8);
    this.buf.writeBigInt64BE(BigInt(Math.trunc(value)), this.pos);
    this.pos += 8;
  }

  public writeBoolean(value: boolean): void {
    this.writeByte(value ? 1 : 0);
  }

  public writeUTF(value: string): void {
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > 65535) {
      throw new Error("String too big! Maximum utf8 length of 65535 bytes");
    }
    this.writeUnsignedShort(bytes);
    this.ensure(bytes);
    this.buf.write(value, this.pos, "utf8");
    this.pos += bytes;
  }

  public setPrefix(prefix: number): void {
    this.buf.writeInt32BE(prefix | 0, 0);
  }
}

class DataInput {
  private buf: Buffer;
  private pos = 0;

  public constructor(bytes: Buffer) {
    this.buf = bytes;
  }

  private ensure(bytes: number): void {
    if (this.pos + bytes > this.buf.length) {
      throw new Error(
        `EOF: Tried to read ${bytes} bytes at offset ${this.pos}, but buffer size is only ${this.buf.length}`,
      );
    }
  }

  public readByte(): number {
    this.ensure(1);
    const value = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return value;
  }

  public readBoolean(): boolean {
    return this.readByte() !== 0;
  }

  public readUnsignedShort(): number {
    this.ensure(2);
    const value = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return value;
  }

  public readInt(): number {
    this.ensure(4);
    const value = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return value;
  }

  public readLong(): number {
    this.ensure(8);
    const value = Number(this.buf.readBigInt64BE(this.pos));
    this.pos += 8;
    return value;
  }

  public readUTF(): string {
    const length = this.readUnsignedShort();
    this.ensure(length);
    const value = this.buf.toString("utf8", this.pos, this.pos + length);
    this.pos += length;
    return value;
  }
}

function readProbeInfoIfNeeded(source: string, input: DataInput): void {
  if (PROBE_SOURCES.has(source)) {
    input.readUTF(); // probe info isn't surfaced on TrackInfo
  }
}

function toTrackInfo(parts: {
  title: string;
  author: string;
  length: number;
  identifier: string;
  isStream: boolean;
  uri: string | null;
  source: string;
  position: number;
}): TrackInfo {
  return {
    title: parts.title,
    author: parts.author,
    length: parts.length,
    identifier: parts.identifier,
    isStream: parts.isStream,
    uri: parts.uri,
    sourceName: parts.source,
    position: parts.position,
    // Lavalink derives seekability from the stream flag — live sources can't seek
    isSeekable: !parts.isStream,
    artworkUrl: null,
    isrc: null,
  };
}

/** Encodes a track info into Lavalink v4 base64 format (version 2) */
export function encodeTrackInfo(info: TrackInfo): string {
  const out = new DataOutput();
  out.writeInt(0); // placeholder — overwritten by the prefix below
  out.writeByte(TRACK_INFO_VERSION);
  out.writeUTF(info.title || "<no title provided>");
  out.writeUTF(info.author || "<no author provided>");
  out.writeLong(info.length || 0);
  out.writeUTF(info.identifier || "<no identifier provided>");
  out.writeBoolean(info.isStream || false);
  const uri = info.uri ?? null;
  out.writeBoolean(uri != null);
  if (uri != null) out.writeUTF(uri);
  out.writeUTF(info.sourceName || "<no source provided>");
  if (PROBE_SOURCES.has(info.sourceName)) {
    out.writeUTF(DEFAULT_PROBE_INFO);
  }
  out.writeLong(info.position || 0);

  out.setPrefix((out.length - 4) | (TRACK_INFO_VERSIONED << 30));
  return out.bytes.toString("base64");
}

/** Decodes a Lavalink v4 base64 track into its raw info fields */
export function decodeTrackInfo(encoded: string): TrackInfo {
  const input = new DataInput(Buffer.from(encoded, "base64"));

  const flags = input.readInt() >> 30;
  const version = (flags & TRACK_INFO_VERSIONED) !== 0 ? input.readByte() : 1;

  if (version === 1) {
    const title = input.readUTF();
    const author = input.readUTF();
    const length = input.readLong();
    const identifier = input.readUTF();
    const isStream = input.readBoolean();
    const uri = null;
    const source = input.readUTF();
    readProbeInfoIfNeeded(source, input);
    const position = input.readLong();
    return toTrackInfo({ title, author, length, identifier, isStream, uri, source, position });
  }

  if (version === 2) {
    const title = input.readUTF();
    const author = input.readUTF();
    const length = input.readLong();
    const identifier = input.readUTF();
    const isStream = input.readBoolean();
    const hasUri = input.readBoolean();
    const uri = hasUri ? input.readUTF() : null;
    const source = input.readUTF();
    readProbeInfoIfNeeded(source, input);
    const position = input.readLong();
    return toTrackInfo({ title, author, length, identifier, isStream, uri, source, position });
  }

  throw new Error(
    `This track's version is not supported. Track version: ${version}, supported versions: 1, 2`,
  );
}
