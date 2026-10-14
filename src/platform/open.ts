import { platform } from './platform';

/** Opens an article/link: system browser on Windows, in-app Safari sheet on iOS. */
export async function openExternal(url: string): Promise<void> {
  switch (platform()) {
    case 'tauri': {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    }
    case 'ios': {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, presentationStyle: 'popover' });
      return;
    }
    default:
      window.open(url, '_blank', 'noopener');
  }
}
