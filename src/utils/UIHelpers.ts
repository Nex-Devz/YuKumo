export interface ProgressBarOptions {
  /** Total length of progress bar in characters (default: 15) */
  size?: number;
  /** Character for filled progress portion (default: "▬") */
  charFilled?: string;
  /** Character for empty progress portion (default: "▬") */
  charEmpty?: string;
  /** Character for slider thumb indicator (default: "🔘") */
  charThumb?: string;
}

/** Formats milliseconds into human-readable time string ("M:SS" or "H:MM:SS") */
export function formatDuration(durationMs: number): string {
  if (isNaN(durationMs) || durationMs < 0) return "0:00";
  const secondsTotal = Math.floor(durationMs / 1000);
  const hours = Math.floor(secondsTotal / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;

  const paddedSeconds = seconds.toString().padStart(2, "0");

  if (hours > 0) {
    const paddedMinutes = minutes.toString().padStart(2, "0");
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}

/** Generates a visual progress bar string for playback UI */
export function getProgressBar(currentMs: number, totalMs: number, options?: ProgressBarOptions): string {
  const size = options?.size ?? 15;
  const charFilled = options?.charFilled ?? "▬";
  const charEmpty = options?.charEmpty ?? "▬";
  const charThumb = options?.charThumb ?? "🔘";

  if (totalMs <= 0) {
    return `${charThumb}${charEmpty.repeat(size - 1)}`;
  }

  const progress = Math.min(1, Math.max(0, currentMs / totalMs));
  const filledCount = Math.round(progress * (size - 1));
  const emptyCount = Math.max(0, size - 1 - filledCount);

  return `${charFilled.repeat(filledCount)}${charThumb}${charEmpty.repeat(emptyCount)}`;
}

/** Formats a paginated queue slice into Discord embed description data */
export function createQueueEmbedData<
  T extends { info?: { title?: string; author?: string; length?: number } },
>(
  tracks: T[],
  currentTrack: T | null,
  page: number = 1,
  pageSize: number = 10,
): { title: string; description: string; totalPages: number } {
  const totalTracks = tracks.length;
  const totalPages = Math.max(1, Math.ceil(totalTracks / pageSize));
  const normalizedPage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (normalizedPage - 1) * pageSize;
  const pageTracks = tracks.slice(startIdx, startIdx + pageSize);

  let description = "";
  if (currentTrack?.info) {
    description += `**Now Playing:** ${currentTrack.info.title ?? "Unknown"} (\`${formatDuration(currentTrack.info.length ?? 0)}\`)\n\n`;
  }

  description += "**Up Next:**\n";
  if (pageTracks.length === 0) {
    description += "*No upcoming tracks in queue.*";
  } else {
    pageTracks.forEach((t, i) => {
      const idx = startIdx + i + 1;
      const title = t.info?.title ?? "Unknown Track";
      const dur = formatDuration(t.info?.length ?? 0);
      description += `\`${idx}.\` ${title} - \`${dur}\`\n`;
    });
  }

  return {
    title: `Queue (Page ${normalizedPage}/${totalPages})`,
    description,
    totalPages,
  };
}
