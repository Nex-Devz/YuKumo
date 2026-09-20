export interface SyncedLyricLine {
  timestampMs: number;
  text: string;
}

export interface LyricsResult {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  plainLyrics?: string;
  syncedLyrics: SyncedLyricLine[];
}

/** Parses LRC formatted timestamp string "[mm:ss.xx]" into milliseconds */
export function parseLrc(lrcContent: string): SyncedLyricLine[] {
  if (!lrcContent) return [];
  const lines = lrcContent.split("\n");
  const result: SyncedLyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const minutes = parseInt(match[1]!, 10);
      const seconds = parseInt(match[2]!, 10);
      const millisStr = match[3] ?? "0";
      const millis = parseInt(millisStr.padEnd(3, "0").slice(0, 3), 10);
      const timestampMs = (minutes * 60 + seconds) * 1000 + millis;
      const text = line.replace(timeRegex, "").trim();
      result.push({ timestampMs, text });
    }
  }

  return result.sort((a, b) => a.timestampMs - b.timestampMs);
}

/** The subset of an LRCLIB track record Yukumo reads. */
interface LrcLibTrack {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** User-Agent sent to LRCLIB — identifies Yukumo without exposing any upstream project. */
const LYRICS_USER_AGENT = "Yukumo (https://github.com/Nex-Devz/YuKumo)";

export class LyricsClient {
  private readonly baseUrl: string;

  public constructor(baseUrl: string = "https://lrclib.net/api") {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetches lyrics for a track from LRCLIB.
   * @param trackName Title of song
   * @param artistName Artist/Author of song
   */
  public async getLyrics(
    trackName: string,
    artistName: string,
    albumName?: string,
    durationSeconds?: number,
  ): Promise<LyricsResult | null> {
    try {
      const url = new URL(`${this.baseUrl}/get`);
      url.searchParams.set("track_name", trackName);
      url.searchParams.set("artist_name", artistName);
      if (albumName != null && albumName.length > 0) url.searchParams.set("album_name", albumName);
      if (durationSeconds != null && durationSeconds > 0)
        url.searchParams.set("duration", Math.round(durationSeconds).toString());

      const res = await fetch(url.toString(), {
        headers: { "User-Agent": LYRICS_USER_AGENT },
      });

      if (!res.ok) {
        // Fallback to search if exact match fail
        return await this.searchLyrics(trackName, artistName);
      }

      const data = (await res.json()) as LrcLibTrack;
      const syncedLyrics = parseLrc(data.syncedLyrics ?? "");

      return {
        title: data.trackName ?? trackName,
        artist: data.artistName ?? artistName,
        album: data.albumName,
        duration: data.duration,
        plainLyrics: data.plainLyrics ?? undefined,
        syncedLyrics,
      };
    } catch {
      return null;
    }
  }

  /** Performs a fuzzy search for lyrics when exact match fails */
  public async searchLyrics(trackName: string, artistName: string): Promise<LyricsResult | null> {
    try {
      const url = new URL(`${this.baseUrl}/search`);
      url.searchParams.set("q", `${artistName} ${trackName}`);

      const res = await fetch(url.toString(), {
        headers: { "User-Agent": LYRICS_USER_AGENT },
      });

      if (!res.ok) return null;
      const results = (await res.json()) as LrcLibTrack[];
      if (!Array.isArray(results) || results.length === 0) return null;

      const best = results[0]!;
      return {
        title: best.trackName ?? trackName,
        artist: best.artistName ?? artistName,
        album: best.albumName,
        duration: best.duration,
        plainLyrics: best.plainLyrics ?? undefined,
        syncedLyrics: parseLrc(best.syncedLyrics ?? ""),
      };
    } catch {
      return null;
    }
  }
}
