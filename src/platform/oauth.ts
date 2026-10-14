import { platform } from './platform';
import { randomBytes, toB64 } from './crypto';

/** Fixed loopback port — register `http://localhost:47823/callback` with the provider. */
export const DESKTOP_OAUTH_PORT = 47823;
export const IOS_REDIRECT = 'lifedash://oauth/callback';

export function redirectUri(): string {
  switch (platform()) {
    case 'tauri':
      return `http://localhost:${DESKTOP_OAUTH_PORT}/callback`;
    case 'ios':
      return IOS_REDIRECT;
    default:
      return `${location.origin}/oauth-callback.html`;
  }
}

export function randomState(): string {
  return toB64(randomBytes(18)).replace(/[+/=]/g, '');
}

/**
 * Runs an authorization-code flow in the system browser and resolves with the
 * redirect URL once the provider calls back.
 */
export async function authorizeInBrowser(authUrl: string, expectedState: string): Promise<URL> {
  const result = await captureRedirect(authUrl);
  const url = new URL(result);
  if (url.searchParams.get('state') !== expectedState) throw new Error('OAuth state mismatch');
  const err = url.searchParams.get('error');
  if (err) throw new Error(`Authorization denied: ${err}`);
  return url;
}

async function captureRedirect(authUrl: string): Promise<string> {
  switch (platform()) {
    case 'tauri': {
      const { start, cancel, onUrl } = await import('@fabianlars/tauri-plugin-oauth');
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      const port = await start({
        ports: [DESKTOP_OAUTH_PORT],
        response: '<html><body style="font-family:system-ui;background:#0b0b0c;color:#eee;display:grid;place-items:center;height:100vh">Connected — you can close this tab and return to Lifedash.</body></html>',
      });
      return new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          void cancel(port);
          reject(new Error('Timed out waiting for authorization'));
        }, 5 * 60_000);
        void onUrl((url) => {
          clearTimeout(timeout);
          void cancel(port);
          resolve(url);
        });
        void openUrl(authUrl);
      });
    }
    case 'ios': {
      const { App } = await import('@capacitor/app');
      const { Browser } = await import('@capacitor/browser');
      return new Promise<string>((resolve) => {
        void App.addListener('appUrlOpen', async ({ url }) => {
          if (!url.startsWith(IOS_REDIRECT)) return;
          await Browser.close();
          resolve(url);
        });
        void Browser.open({ url: authUrl, presentationStyle: 'popover' });
      });
    }
    default: {
      const popup = window.open(authUrl, 'lifedash-oauth', 'width=520,height=720');
      if (!popup) throw new Error('Popup blocked');
      return new Promise<string>((resolve) => {
        const onMsg = (e: MessageEvent) => {
          if (e.origin !== location.origin || e.data?.type !== 'oauth-callback') return;
          window.removeEventListener('message', onMsg);
          resolve(e.data.url as string);
        };
        window.addEventListener('message', onMsg);
      });
    }
  }
}
