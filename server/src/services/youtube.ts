import { config } from '../config/env';
import { repo } from '../db/repository';

export interface CourseMeta {
  title: string;
  videoCount: number;
  totalMinutes: number;
  source: 'youtube' | 'stub';
}

/**
 * Resolve course metadata for a YouTube link. Uses the YouTube Data API when a
 * real key is configured, otherwise returns deterministic stub metadata so the
 * planner works with no key. Real lookups are cached (Course store) to avoid
 * re-hitting the quota-limited API for the same playlist.
 */
export async function getCourseMeta(url: string): Promise<CourseMeta> {
  if (config.stub.youtube) return stubMeta(url);

  const cached = url ? await repo.getCourse(url) : null;
  if (cached) {
    return {
      title: cached.title,
      videoCount: cached.videoCount,
      totalMinutes: cached.totalMinutes,
      source: 'youtube',
    };
  }

  try {
    const meta = await fetchYouTubeMeta(url);
    await repo.saveCourse({
      youtubeUrl: url,
      title: meta.title,
      videoCount: meta.videoCount,
      totalMinutes: meta.totalMinutes,
      cachedAt: new Date().toISOString(),
    });
    return meta;
  } catch {
    // Fail soft to a stub so the agent can still produce a plan.
    return stubMeta(url);
  }
}

function extractPlaylistId(url: string): string | null {
  const m = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function stubMeta(url: string): CourseMeta {
  // Deterministic, plausible numbers derived from the URL.
  const seed = [...url].reduce((a, c) => a + c.charCodeAt(0), 0);
  const videoCount = 12 + (seed % 30); // 12..41 videos
  const avgMinutes = 12 + (seed % 14); // 12..25 min each
  return {
    title: url ? 'Imported YouTube course' : 'Your course',
    videoCount,
    totalMinutes: videoCount * avgMinutes,
    source: 'stub',
  };
}

/** Real YouTube Data API path (active once YOUTUBE_API_KEY is set). */
async function fetchYouTubeMeta(url: string): Promise<CourseMeta> {
  const playlistId = extractPlaylistId(url);
  if (!playlistId) throw new Error('no playlist id in url');
  const api = 'https://www.googleapis.com/youtube/v3';
  const res = await fetch(
    `${api}/playlists?part=snippet,contentDetails&id=${playlistId}&key=${config.youtubeApiKey}`,
  );
  const data: any = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error('playlist not found');
  const videoCount: number = item.contentDetails?.itemCount ?? 20;
  return {
    title: item.snippet?.title ?? 'YouTube course',
    videoCount,
    totalMinutes: videoCount * 15, // refined later via video durations
    source: 'youtube',
  };
}
