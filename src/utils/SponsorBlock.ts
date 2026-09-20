export type SponsorCategory =
  "sponsor" | "intro" | "outro" | "interaction" | "selfpromo" | "music_offtopic" | "preview" | "filler";

export interface SponsorSegment {
  UUID: string;
  category: SponsorCategory;
  startMs: number;
  endMs: number;
}

export class SponsorBlockClient {
  private readonly baseUrl: string;

  public constructor(baseUrl: string = "https://sponsor.ajay.app/api") {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetches SponsorBlock skip segments for a video ID.
   * @param videoId YouTube Video ID
   * @param categories Categories to skip (defaults to sponsor, intro, outro, selfpromo, music_offtopic)
   */
  public async getSegments(
    videoId: string,
    categories: SponsorCategory[] = ["sponsor", "intro", "outro", "selfpromo", "music_offtopic"],
  ): Promise<SponsorSegment[]> {
    try {
      const url = new URL(`${this.baseUrl}/skipSegments`);
      url.searchParams.set("videoID", videoId);
      url.searchParams.set("categories", JSON.stringify(categories));

      const res = await fetch(url.toString());
      if (!res.ok) return [];

      const data = (await res.json()) as Array<{
        UUID: string;
        category: SponsorCategory;
        segment: [number, number];
      }>;

      if (!Array.isArray(data)) return [];

      return data.map((item) => ({
        UUID: item.UUID,
        category: item.category,
        startMs: Math.round(item.segment[0] * 1000),
        endMs: Math.round(item.segment[1] * 1000),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Checks if current position falls into a segment and returns the end position to seek to.
   * @param currentPositionMs Current track position in milliseconds
   * @param segments List of sponsor segments
   */
  public getSkipPosition(currentPositionMs: number, segments: SponsorSegment[]): number | null {
    for (const seg of segments) {
      // If position is within start and end with a 500ms margin before end
      if (currentPositionMs >= seg.startMs - 200 && currentPositionMs < seg.endMs - 500) {
        return seg.endMs;
      }
    }
    return null;
  }
}
