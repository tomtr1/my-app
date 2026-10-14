import { useMemo, useState } from 'react';
import { Bookmark, BookmarkCheck, Flame, Newspaper, ExternalLink } from 'lucide-react';
import { useApp } from '../store/app';
import { Card, Empty, SkeletonList, SourceLine, Switch } from '../ui/kit';
import { clusterStories, type Article } from '../services/news';
import { relTime } from '../lib/dates';
import { openExternal } from '../platform/open';

const TOPIC_LABEL: Record<string, string> = { world: 'World', tech: 'Tech', ai: 'AI', science: 'Science', finance: 'Finance', sports: 'Sports', local: 'Local', custom: 'Keywords' };

export function NewsTab() {
  const { news, settings, status, refresh, readLater, toggleReadLater, updateSettings } = useApp();
  const [topic, setTopic] = useState<string>('all');
  const [view, setView] = useState<'feed' | 'later'>('feed');
  const clusters = useMemo(() => clusterStories(news?.articles ?? [], settings.news.keywords), [news, settings.news.keywords]);
  const topics = ['all', ...new Set(clusters.map((c) => c.lead.topic))];
  const shown = clusters.filter((c) => (topic === 'all' || c.lead.topic === topic) && (!settings.news.importantOnly || c.important)).slice(0, 80);
  const saved = new Set(readLater.map((a) => a.id));

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="spread" style={{ flexWrap: 'wrap' }}>
        <div className="page-head">
          <h1>News</h1>
          <p>Personalised from {settings.news.feeds.filter((f) => f.enabled).length} sources · {settings.news.interests.map((i) => TOPIC_LABEL[i] ?? i).join(', ')}</p>
        </div>
        <SourceLine status={status.news} onRefresh={() => void refresh('news', true)} />
      </div>

      <div className="spread" style={{ flexWrap: 'wrap' }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className={`chip ${view === 'feed' ? 'on' : ''}`} onClick={() => setView('feed')}>Feed</button>
          <button className={`chip ${view === 'later' ? 'on' : ''}`} onClick={() => setView('later')}>
            <Bookmark size={12} /> Read later {readLater.length ? `(${readLater.length})` : ''}
          </button>
          {view === 'feed' && <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />}
          {view === 'feed' &&
            topics.map((t) => (
              <button key={t} className={`chip ${topic === t ? 'on' : ''}`} onClick={() => setTopic(t)}>
                {t === 'all' ? 'All' : TOPIC_LABEL[t] ?? t}
              </button>
            ))}
        </div>
        {view === 'feed' && (
          <label className="row small muted" style={{ cursor: 'pointer' }}>
            <Flame size={14} color="var(--orange)" /> Important only
            <Switch checked={settings.news.importantOnly} onChange={(v) => void updateSettings((s) => ({ ...s, news: { ...s.news, importantOnly: v } }))} />
          </label>
        )}
      </div>

      {view === 'later' ? (
        <Card>
          {readLater.length ? (
            <div className="list">
              {readLater.map((a) => (
                <ArticleRow key={a.id} a={a} saved onToggle={() => void toggleReadLater(a)} />
              ))}
            </div>
          ) : (
            <Empty icon={<Bookmark />} title="Nothing saved" body="Tap the bookmark on any story to read it later." />
          )}
        </Card>
      ) : status.news.loading && !news ? (
        <Card><SkeletonList rows={6} /></Card>
      ) : shown.length ? (
        <Card>
          <div className="list">
            {shown.map((c) => (
              <ArticleRow key={c.id} a={c.lead} important={c.important} more={c.others} saved={saved.has(c.lead.id)} onToggle={() => void toggleReadLater(c.lead)} />
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <Empty icon={<Newspaper />} title="No stories" body={news?.errors.length ? news.errors.slice(0, 2).join(' · ') : 'Pick interests and sources in Settings → News.'} />
        </Card>
      )}
    </div>
  );
}

function ArticleRow({ a, important, more = [], saved, onToggle }: { a: Article; important?: boolean; more?: Article[]; saved: boolean; onToggle: () => void }) {
  return (
    <div className="li" style={{ alignItems: 'flex-start', gap: 14 }}>
      <div className="grow col" style={{ gap: 5, cursor: 'pointer' }} onClick={() => void openExternal(a.url)}>
        <div className="row tiny faint" style={{ gap: 8 }}>
          {important && <span className="chip warn" style={{ height: 18, fontSize: 10 }}>TOP</span>}
          <span>{a.source}</span>
          {more.length > 0 && <span title={more.map((m) => m.source).join(', ')}>+{more.length} sources</span>}
          <span>· {relTime(a.published)}</span>
        </div>
        <b style={{ fontSize: 15, lineHeight: 1.35 }}>{a.title}</b>
        {a.summary && <p className="small muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.summary}</p>}
      </div>
      {a.image && <img src={a.image} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: 92, height: 64, objectFit: 'cover', borderRadius: 10, flex: 'none' }} />}
      <div className="col" style={{ gap: 4 }}>
        <button className="btn icon sm ghost" onClick={onToggle} aria-label={saved ? 'Remove from read later' : 'Read later'}>
          {saved ? <BookmarkCheck color="var(--accent)" /> : <Bookmark />}
        </button>
        <button className="btn icon sm ghost" onClick={() => void openExternal(a.url)} aria-label="Open"><ExternalLink /></button>
      </div>
    </div>
  );
}
