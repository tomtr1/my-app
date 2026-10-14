import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Globe, LogOut, MessageCircle, Mail, Plus, RotateCw, Trash2, NotebookText } from 'lucide-react';
import { useApp } from '../store/app';
import { useUnread } from '../store/unread';
import { Card, Empty, Sheet, Switch } from '../ui/kit';
import { miniapps, type MiniAppDef } from '../platform/miniapp';
import { platform } from '../platform/platform';
import { uid } from '../lib/num';

function appIcon(a: MiniAppDef, size = 22) {
  if (a.id === 'whatsapp') return <MessageCircle size={size} color="#25d366" />;
  if (a.id === 'gmail' || a.id === 'outlook' || /mail/.test(a.url)) return <Mail size={size} color="var(--bad)" />;
  if (/notion/.test(a.url)) return <NotebookText size={size} />;
  return <Globe size={size} color="var(--blue)" />;
}

export function AppsTab() {
  const { settings, updateSettings } = useApp();
  const counts = useUnread((s) => s.counts);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (open) return <MiniAppView appId={open} onBack={() => setOpen(null)} />;

  return (
    <div className="content" style={{ overflowY: 'auto' }}>
      <div className="page">
        <div className="spread">
          <div className="page-head">
            <h1>Apps & Mail</h1>
            <p>Your web apps, embedded with their own private, persistent session.</p>
          </div>
          <button className="btn primary" onClick={() => setAdding(true)}><Plus /> Add app</button>
        </div>
        <div className="grid g-4">
          {settings.miniapps.map((a) => (
            <Card key={a.id} onClick={() => setOpen(a.id)}>
              <div className="col" style={{ gap: 14 }}>
                <div className="spread">
                  <div className="empty ico" style={{ width: 44, height: 44, padding: 0 }}>{appIcon(a)}</div>
                  {counts[a.id] ? <span className="chip accent tabular">{counts[a.id]} unread</span> : null}
                </div>
                <div>
                  <b>{a.title}</b>
                  <div className="tiny faint ellipsis">{new URL(a.url).host}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
        <p className="small faint">
          Logins are stored only inside each app’s isolated web profile on this device. Google may block sign-in inside embedded views — if so, sign in once via
          “Open in browser”, or use an app password / Outlook.
        </p>
      </div>
      <AddAppSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(a) => void updateSettings((s) => ({ ...s, miniapps: [...s.miniapps, a] }))}
      />
    </div>
  );
}

function AddAppSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (a: MiniAppDef) => void }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('https://');
  const [desktop, setDesktop] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="Add a mini-app">
      <form
        className="col"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const u = new URL(url);
            if (u.protocol !== 'https:') throw new Error();
            onAdd({ id: uid(), title: title || u.host, url: u.toString(), desktopUA: desktop });
            onClose();
          } catch {
            alert('Please enter a valid https:// URL');
          }
        }}
      >
        <label className="field">Name<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Banking" /></label>
        <label className="field">URL<input className="input" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <div className="spread">
          <span className="small">Request desktop site (iPhone)</span>
          <Switch checked={desktop} onChange={setDesktop} />
        </div>
        <button className="btn primary" type="submit">Add</button>
      </form>
    </Sheet>
  );
}

/**
 * Hosts one embedded app. On Windows the native WebView2 is laid exactly over the
 * placeholder and follows it on resize; on iPhone a full-screen WKWebView opens.
 */
export function MiniAppView({ appId, onBack }: { appId: string; onBack?: () => void }) {
  const { settings, updateSettings } = useApp();
  const app = settings.miniapps.find((a) => a.id === appId);
  const host = useRef<HTMLDivElement>(null);
  const counts = useUnread((s) => s.counts);
  const [err, setErr] = useState<string | null>(null);
  const inline = miniapps.embedsInline();

  useEffect(() => {
    if (!app) return;
    if (!inline) {
      if (platform() === 'ios') miniapps.show(app, { x: 0, y: 0, width: 0, height: 0 }).catch((e) => setErr(String(e)));
      return;
    }
    const el = host.current!;
    const rect = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    let shown = false;
    const ro = new ResizeObserver(() => {
      if (!shown) {
        shown = true;
        miniapps.show(app, rect()).catch((e) => setErr(String(e)));
      } else void miniapps.resize(app.id, rect());
    });
    ro.observe(el);
    const onWin = () => void miniapps.resize(app.id, rect());
    window.addEventListener('resize', onWin);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWin);
      void miniapps.hideAll();
    };
  }, [app, inline]);

  if (!app)
    return (
      <div className="page" style={{ padding: 28 }}>
        <Empty icon={<MessageCircle />} title="App not configured" body="Add it in Apps & Mail." />
      </div>
    );

  return (
    <>
      <div className="miniapp-bar">
        {onBack && <button className="btn icon sm ghost" onClick={onBack} aria-label="Back"><ArrowLeft /></button>}
        {appIcon(app, 18)}
        <b>{app.title}</b>
        {counts[app.id] ? <span className="chip accent">{counts[app.id]} unread</span> : null}
        <div className="grow" />
        <button className="btn icon sm ghost" title="Reload" onClick={() => void miniapps.reload(app.id)}><RotateCw /></button>
        <button className="btn icon sm ghost" title="Open in browser" onClick={() => window.open(app.url, '_blank')}><ExternalLink /></button>
        <button className="btn icon sm ghost" title="Sign out (clear this app's data)" onClick={() => confirm(`Sign out of ${app.title} and delete its local data?`) && void miniapps.clear(app.id)}><LogOut /></button>
        {onBack && !['whatsapp'].includes(app.id) && (
          <button
            className="btn icon sm ghost danger"
            title="Remove app"
            onClick={() => {
              if (!confirm(`Remove ${app.title}?`)) return;
              void miniapps.clear(app.id);
              void updateSettings((s) => ({ ...s, miniapps: s.miniapps.filter((a) => a.id !== app.id) }));
              onBack();
            }}
          >
            <Trash2 />
          </button>
        )}
      </div>
      <div className="miniapp-host" ref={host}>
        {!inline && (
          <div className="page" style={{ padding: 28 }}>
            <Card>
              <Empty
                icon={appIcon(app, 24)}
                title={app.title}
                body={
                  platform() === 'ios'
                    ? 'Opens full-screen with its own saved session. Swipe down or tap Done to come back.'
                    : 'In the browser preview, sites can’t be embedded — the Windows and iPhone apps show them inside the dashboard.'
                }
                action={<button className="btn primary" onClick={() => void miniapps.show(app, { x: 0, y: 0, width: 0, height: 0 })}>Open {app.title}</button>}
              />
              {app.id === 'whatsapp' && (
                <p className="small faint" style={{ textAlign: 'center' }}>
                  First time: on WhatsApp Web choose “Link with phone number”, then on your phone go to WhatsApp → Linked devices → Link a device → “Link with phone number instead” and enter the code.
                </p>
              )}
            </Card>
          </div>
        )}
        {err && <p className="small c-bad" style={{ padding: 12 }}>{err}</p>}
      </div>
    </>
  );
}
