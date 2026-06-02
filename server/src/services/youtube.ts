import { config } from '../config/env';
import { repo } from '../db/repository';
import type { CourseVideo } from '../types';

export interface CourseMeta {
  title: string;
  videoCount: number;
  totalMinutes: number;
  videos: CourseVideo[];
  source: 'youtube' | 'stub';
}

const API = 'https://www.googleapis.com/youtube/v3';

/**
 * Resolve full course metadata for a YouTube playlist — title plus every
 * video's real title and duration. Uses the YouTube Data API when a real key is
 * configured, otherwise returns deterministic stub data so the planner works
 * with no key. Real lookups are cached (Course store) to spare the API quota.
 */
export async function getCourseMeta(url: string): Promise<CourseMeta> {
  if (config.stub.youtube) return stubMeta(url);

  const cached = url ? await repo.getCourse(url) : null;
  // Require videoId on cached videos — entries cached before links existed are re-fetched.
  if (cached && cached.videos?.length && cached.videos[0]?.videoId) {
    return {
      title: cached.title,
      videoCount: cached.videoCount,
      totalMinutes: cached.totalMinutes,
      videos: cached.videos,
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
      videos: meta.videos,
      cachedAt: new Date().toISOString(),
    });
    return meta;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[youtube] fetch failed, using stub meta:', (err as Error).message);
    return stubMeta(url);
  }
}

/** Pull the playlist id from a URL, tolerating ?list=, &list=, and trailing params. */
export function extractPlaylistId(url: string): string | null {
  const m = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// ── Real YouTube Data API path ─────────────────────────────────────────────────

interface PlaylistItemPage {
  nextPageToken?: string;
  items?: Array<{
    snippet?: { title?: string; position?: number; resourceId?: { videoId?: string } };
    contentDetails?: { videoId?: string };
  }>;
}
interface VideosPage {
  items?: Array<{ id?: string; contentDetails?: { duration?: string } }>;
}

async function fetchYouTubeMeta(url: string): Promise<CourseMeta> {
  const playlistId = extractPlaylistId(url);
  if (!playlistId) throw new Error('no playlist id in url');
  const key = config.youtubeApiKey;

  // 1) Playlist title.
  const plRes = await fetch(`${API}/playlists?part=snippet&id=${playlistId}&key=${key}`);
  const plData = (await plRes.json()) as { items?: Array<{ snippet?: { title?: string } }> };
  const title = plData.items?.[0]?.snippet?.title ?? 'YouTube course';

  // 2) Every playlist item (title + videoId + position), paginating 50 at a time.
  const entries: Array<{ videoId: string; title: string; position: number }> = [];
  let pageToken: string | undefined;
  do {
    const u =
      `${API}/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${key}` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(u);
    const data = (await res.json()) as PlaylistItemPage;
    for (const it of data.items ?? []) {
      const vTitle = it.snippet?.title ?? '';
      const videoId = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
      // Skip removed/private entries — they have no usable title or id.
      if (!videoId || /^(deleted|private) video$/i.test(vTitle.trim())) continue;
      entries.push({ videoId, title: vTitle, position: it.snippet?.position ?? entries.length });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  if (entries.length === 0) throw new Error('playlist has no accessible videos');

  // 3) Real durations via videos.list, batched 50 ids per call.
  const durations = new Map<string, number>();
  for (let i = 0; i < entries.length; i += 50) {
    const ids = entries.slice(i, i + 50).map((e) => e.videoId).join(',');
    const res = await fetch(`${API}/videos?part=contentDetails&id=${ids}&key=${key}`);
    const data = (await res.json()) as VideosPage;
    for (const v of data.items ?? []) {
      if (v.id) durations.set(v.id, parseIsoDuration(v.contentDetails?.duration));
    }
  }

  const videos: CourseVideo[] = entries
    .sort((a, b) => a.position - b.position)
    .map((e, idx) => ({
      position: idx + 1,
      title: e.title,
      seconds: durations.get(e.videoId) || 0,
      videoId: e.videoId,
    }));

  const totalSeconds = videos.reduce((sum, v) => sum + v.seconds, 0);
  return {
    title,
    videoCount: videos.length,
    totalMinutes: Math.round(totalSeconds / 60),
    videos,
    source: 'youtube',
  };
}

/** Parse an ISO-8601 duration ("PT1H2M30S") to seconds. */
export function parseIsoDuration(iso?: string): number {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return (Number(h) || 0) * 3600 + (Number(min) || 0) * 60 + (Number(s) || 0);
}

// ── Stub path (no key) ──────────────────────────────────────────────────────────

function stubMeta(url: string): CourseMeta {
  // Deterministic, plausible course derived from the URL.
  const seed = [...url].reduce((a, c) => a + c.charCodeAt(0), 0);
  const count = 12 + (seed % 18); // 12..29 videos
  const topics = [
    'Introduction & Setup',
    'Core Concepts',
    'Working with Data',
    'Control Flow',
    'Functions & Modules',
    'Common Patterns',
    'Debugging & Tools',
    'Testing Basics',
    'A Real Example',
    'Best Practices',
  ];
  const videos: CourseVideo[] = Array.from({ length: count }, (_, i) => ({
    position: i + 1,
    title: `${i + 1}. ${topics[i % topics.length]}`,
    seconds: (10 + ((seed + i * 7) % 16)) * 60, // 10..25 min each
    videoId: '', // stub has no real video → no link
  }));
  const totalSeconds = videos.reduce((s, v) => s + v.seconds, 0);
  return {
    title: url ? 'Sample Course (stub)' : 'Your course',
    videoCount: count,
    totalMinutes: Math.round(totalSeconds / 60),
    videos,
    source: 'stub',
  };
}
