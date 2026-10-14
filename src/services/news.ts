import { getJSON, getText } from '../platform/http';
import { getSecret } from '../platform/secure';
import type { NewsFeed, Settings } from '../store/settings';

export interface Article {
  id: string;
  title: string;
  url: string;
  source: string;
  topic: string;
  published: number;
  summary?: string;
  image?: string;
}

export interface StoryCluster {
  id: string;
  lead: Article;
  others: Article[];
  score: number;
  important: boolean;
}

// ---- parsing -----------------------------------------------------------------------------

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

function stripHtml(s: string): string {
  const doc = new DOMParser().parseFromString(s, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function firstChild(el: Element, names: string[]): Element | undefined {
  for (const child of Array.from(el.children)) {
    const n = child.localName.toLowerCase();
    const full = child.nodeName.toLowerCase();
    if (names.includes(n) || names.includes(full)) return child;
  }
  return undefined;
}

/** RSS 2.0 + Atom. */
export function parseFeed(xml: string, source: string, topic: string): Article[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return [];
  const items = Array.from(doc.getElementsByTagName('item'));
  const entries = items.length ? items : Array.from(doc.getElementsByTagName('entry'));
  const out: Article[] = [];
  for (const it of entries) {
    const title = stripHtml(text(firstChild(it, ['title'])));
    let url = text(firstChild(it, ['link']));
    if (!url) {
      const links = Array.from(it.children).filter((c) => c.localName === 'link');
      const alt = links.find((l) => (l.getAttribute('rel') ?? 'alternate') === 'alternate') ?? links[0];
      url = alt?.getAttribute('href') ?? '';
    }
    const date = text(firstChild(it, ['pubdate', 'published', 'updated', 'dc:date', 'date']));
    const desc = text(firstChild(it, ['description', 'summary', 'content']));
    const media =
      firstChild(it, ['media:thumbnail', 'thumbnail', 'media:content', 'content'])?.getAttribute('url') ??
      firstChild(it, ['enclosure'])?.getAttribute('url') ??
      undefined;
    if (!title || !url) continue;
    const published = date ? Date.parse(date) : NaN;
    out.push({
      id: url,
      title,
      url,
      source,
      topic,
      published: Number.isFinite(published) ? published : Date.now(),
      summary: desc ? stripHtml(desc).slice(0, 280) : undefined,
      image: media ?? undefined,
    });
  }
  return out;
}

// ---- importance & de-duplication ------------------------------------------------------------

const STOP = new Set(
  'the a an and or of to in on for with at by from as is are was were be been it its this that after over into new says say amid about than more will can could has have had not but der die das und oder ein eine im in am zu von mit für auf ist sind nach bei aus wie'.split(' '),
);

export function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

const URGENT = /\b(breaking|live|urgent|earthquake|killed|dies|dead|war|election|resigns|attack|storm|eilmeldung|tot|krieg|wahl)\b/i;

/**
 * Groups the same story across outlets and scores it. A story covered by several
 * independent sources is, empirically, the best cheap proxy for "important".
 */
export function clusterStories(articles: Article[], keywords: string[] = [], now = Date.now()): StoryCluster[] {
  const sorted = [...articles].sort((a, b) => b.published - a.published);
  const clusters: Array<{ lead: Article; others: Article[]; toks: Set<string> }> = [];
  for (const a of sorted) {
    const t = tokens(a.title);
    const hit = clusters.find((c) => similarity(c.toks, t) >= 0.34);
    if (hit) {
      if (hit.lead.source !== a.source && !hit.others.some((o) => o.source === a.source)) hit.others.push(a);
      for (const w of t) hit.toks.add(w);
    } else clusters.push({ lead: a, others: [], toks: t });
  }
  const kw = keywords.map((k) => k.toLowerCase()).filter(Boolean);
  return clusters
    .map((c) => {
      const ageH = (now - c.lead.published) / 3_600_000;
      const sources = 1 + c.others.length;
      const urgent = URGENT.test(c.lead.title);
      const interest = kw.some((k) => c.lead.title.toLowerCase().includes(k));
      const score = sources * 3 + (urgent ? 3 : 0) + (interest ? 4 : 0) + Math.max(0, 6 - ageH / 2);
      return {
        id: c.lead.id,
        lead: c.lead,
        others: c.others,
        score,
        important: sources >= 2 || urgent || interest,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ---- fetching -------------------------------------------------------------------------------

export function googleNewsFeed(query: string, lang: 'en' | 'de'): NewsFeed {
  const gl = lang === 'de' ? 'DE' : 'US';
  return {
    id: `gnews-rss:${query}`,
    title: `Google News: ${query}`,
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${gl}&ceid=${gl}:${lang}`,
    topic: 'local',
    enabled: true,
  };
}

const GNEWS_CATEGORY: Record<string, string> = {
  world: 'world',
  tech: 'technology',
  ai: 'technology',
  science: 'science',
  finance: 'business',
  sports: 'sports',
};

async function fetchGNews(topics: string[], lang: string): Promise<Article[]> {
  const key = await getSecret('gnews-key');
  if (!key) return [];
  const cats = [...new Set(topics.map((t) => GNEWS_CATEGORY[t]).filter(Boolean))].slice(0, 3);
  const results = await Promise.allSettled(
    cats.map((cat) =>
      getJSON<{ articles: Array<{ title: string; url: string; description: string; image: string; publishedAt: string; source: { name: string } }> }>(
        `https://gnews.io/api/v4/top-headlines?category=${cat}&lang=${lang}&max=10&apikey=${encodeURIComponent(key)}`,
      ).then((r) =>
        r.articles.map<Article>((a) => ({
          id: a.url,
          title: a.title,
          url: a.url,
          source: a.source.name,
          topic: Object.keys(GNEWS_CATEGORY).find((k) => GNEWS_CATEGORY[k] === cat) ?? 'world',
          published: Date.parse(a.publishedAt),
          summary: a.description,
          image: a.image,
        })),
      ),
    ),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

export interface NewsSnapshot {
  articles: Article[];
  errors: string[];
  fetchedAt: number;
}

export async function fetchNews(s: Settings['news']): Promise<NewsSnapshot> {
  const feeds = s.feeds.filter((f) => f.enabled && (s.interests.includes(f.topic) || f.topic === 'custom'));
  if (s.interests.includes('local') && s.region) feeds.push(googleNewsFeed(s.region, s.language));
  for (const k of s.keywords) feeds.push({ ...googleNewsFeed(k, s.language), topic: 'custom' });

  const errors: string[] = [];
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      try {
        return parseFeed(await getText(f.url, { timeoutMs: 15000 }), f.title, f.topic).slice(0, 25);
      } catch (e) {
        errors.push(`${f.title}: ${(e as Error).message}`);
        return [];
      }
    }),
  );
  const articles = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (s.useGNews) articles.push(...(await fetchGNews(s.interests, s.language).catch(() => [])));

  const cutoff = Date.now() - 3 * 86_400_000;
  const seen = new Set<string>();
  const fresh = articles.filter((a) => a.published >= cutoff && !seen.has(a.url) && seen.add(a.url));
  return { articles: fresh, errors, fetchedAt: Date.now() };
}
