import { describe, expect, it } from 'vitest';
import { clusterStories, parseFeed } from '../services/news';

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>X</title>
<item><title>Earthquake hits coastal city, dozens injured</title><link>https://a.example/1</link><pubDate>Wed, 14 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Rescue <b>teams</b> deployed.</p>]]></description><media:thumbnail url="https://a.example/1.jpg"/></item>
<item><title>New phone launched</title><link>https://a.example/2</link><pubDate>Wed, 14 Oct 2026 07:00:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Y</title>
<entry><title>Coastal city earthquake leaves dozens injured</title><link rel="alternate" href="https://b.example/9"/><updated>2026-10-14T08:30:00Z</updated><summary>Strong quake.</summary></entry>
</feed>`;

describe('feeds', () => {
  it('parses RSS with HTML descriptions and media', () => {
    const a = parseFeed(RSS, 'A', 'world');
    expect(a).toHaveLength(2);
    expect(a[0].summary).toBe('Rescue teams deployed.');
    expect(a[0].image).toBe('https://a.example/1.jpg');
    expect(a[0].published).toBe(Date.parse('2026-10-14T08:00:00Z'));
  });

  it('parses Atom', () => {
    const b = parseFeed(ATOM, 'B', 'world');
    expect(b[0].url).toBe('https://b.example/9');
  });

  it('clusters the same story across sources and flags it important', () => {
    const all = [...parseFeed(RSS, 'A', 'world'), ...parseFeed(ATOM, 'B', 'world')];
    const c = clusterStories(all, [], Date.parse('2026-10-14T09:00:00Z'));
    expect(c).toHaveLength(2);
    expect(c[0].others).toHaveLength(1);
    expect(c[0].important).toBe(true);
    expect(c[1].important).toBe(false);
  });

  it('boosts followed keywords', () => {
    const all = parseFeed(RSS, 'A', 'tech');
    const c = clusterStories(all, ['phone'], Date.parse('2026-10-14T09:00:00Z'));
    expect(c.find((x) => x.lead.title.includes('phone'))!.important).toBe(true);
  });
});
