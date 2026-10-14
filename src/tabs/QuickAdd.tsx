import { Camera, Droplets, Mail, MessageCircle, RefreshCw, Search, Settings as Cog, CloudSun } from 'lucide-react';
import { useApp, type TabKey } from '../store/app';
import { Sheet } from '../ui/kit';

export function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setTab, setSheet, addWater, refreshAll } = useApp();
  const go = (t: TabKey) => {
    setTab(t);
    onClose();
  };
  const items: Array<{ icon: React.ReactNode; label: string; hint: string; run: () => void }> = [
    { icon: <Camera />, label: 'Log a meal by photo', hint: 'Nutrition', run: () => { setTab('nutrition'); setSheet('add-food'); } },
    { icon: <Search />, label: 'Search food / scan barcode', hint: 'Nutrition', run: () => { setTab('nutrition'); setSheet('add-food'); } },
    { icon: <Droplets />, label: 'Drink 250 ml water', hint: 'Today', run: () => { void addWater(250); onClose(); } },
    { icon: <MessageCircle />, label: 'Open WhatsApp', hint: 'Apps', run: () => go('whatsapp') },
    { icon: <Mail />, label: 'Open mail', hint: 'Apps', run: () => go('apps') },
    { icon: <CloudSun />, label: 'Rain radar', hint: 'Weather', run: () => go('weather') },
    { icon: <RefreshCw />, label: 'Sync everything now', hint: 'R', run: () => { void refreshAll(true); onClose(); } },
    { icon: <Cog />, label: 'Settings', hint: '', run: () => go('settings') },
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Quick actions">
      <div className="list">
        {items.map((i) => (
          <button key={i.label} className="li" onClick={i.run} style={{ background: 'none', border: 0, borderTop: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
            <span style={{ color: 'var(--accent)', display: 'flex' }}>{i.icon}</span>
            <span className="grow">{i.label}</span>
            <span className="tiny faint">{i.hint}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
