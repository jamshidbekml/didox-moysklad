import { Router, Request, Response } from 'express';
import { vendorApi } from '../services/moysklad';
import { installationStore } from '../services/store';
import { logger } from '../utils/logger';

export const settingsRouter = Router();

/**
 * Main iframe HTML.
 * MoySklad loads this URL in the main iframe slot of our solution.
 * Query parameters received:
 *   contextKey - one-time key (5-min TTL) to resolve user info via Vendor API
 *   appUid     - our solution's appUid
 *   appId      - our solution's appId
 *   userLocale - ru_RU | en_US
 *
 * Note: we don't trust the contextKey alone for state mutation. The settings POST
 * also requires the contextKey, and we re-resolve it server-side before writing.
 */
settingsRouter.get('/iframe', (req: Request, res: Response) => {
  const contextKey = String(req.query.contextKey ?? '');
  const userLocale = String(req.query.userLocale ?? 'ru_RU');

  if (!contextKey) {
    res.status(400).send('Missing contextKey');
    return;
  }

  const ru = userLocale.startsWith('ru');
  const t = (rus: string, eng: string) => (ru ? rus : eng);

  res.type('html').send(`<!doctype html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
<meta charset="utf-8">
<title>Didox Integration</title>
<style>
  :root {
    --bg: #fafafa;
    --fg: #1f2328;
    --muted: #57606a;
    --border: #d0d7de;
    --accent: #1976d2;
    --accent-hover: #1565c0;
    --success: #1a7f37;
    --error: #cf222e;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 14px;
    color: var(--fg);
    background: var(--bg);
  }
  .container { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p.lead { color: var(--muted); margin: 0 0 24px; }
  .card {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .field { margin-bottom: 16px; }
  .field:last-child { margin-bottom: 0; }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  input[type="text"], input[type="password"] {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
  .help { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .toggle { display: flex; gap: 8px; align-items: center; }
  button {
    background: var(--accent); color: #fff; border: 0;
    padding: 10px 16px; border-radius: 6px; font-size: 14px;
    cursor: pointer; font-family: inherit;
  }
  button:hover { background: var(--accent-hover); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status { padding: 12px; border-radius: 6px; margin-bottom: 16px; display: none; }
  .status.success { background: #dafbe1; color: var(--success); display: block; }
  .status.error { background: #ffebe9; color: var(--error); display: block; }
  .user { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<div class="container">
  <h1>${t('Интеграция с Didox', 'Didox Integration')}</h1>
  <p class="lead">${t(
    'Настройте подключение к Didox для отправки документов из МоегоСклада.',
    'Configure your Didox connection to send documents from MoySklad.'
  )}</p>

  <div class="user" id="user"></div>

  <div class="status" id="status"></div>

  <form id="form">
    <div class="card">
      <div class="field">
        <label for="didoxLogin">${t('Логин Didox', 'Didox login')}</label>
        <input id="didoxLogin" name="didoxLogin" type="text" autocomplete="off" />
        <div class="help">${t(
          'Имя пользователя или email вашего аккаунта Didox.',
          'Username or email of your Didox account.'
        )}</div>
      </div>

      <div class="field">
        <label for="didoxToken">${t('API-токен Didox', 'Didox API token')}</label>
        <input id="didoxToken" name="didoxToken" type="password" autocomplete="off" />
        <div class="help">${t(
          'Токен хранится на сервере интеграции. Заполняйте только для смены значения.',
          'Token is stored on the integration server. Fill only when changing.'
        )}</div>
      </div>

      <div class="field toggle">
        <input id="autoSendDemand" name="autoSendDemand" type="checkbox" />
        <label for="autoSendDemand" style="font-weight: normal; margin: 0;">${t(
          'Автоматически отправлять Отгрузки в Didox',
          'Automatically send Demands to Didox'
        )}</label>
      </div>
    </div>

    <div class="row">
      <button type="submit" id="saveBtn">${t('Сохранить', 'Save')}</button>
    </div>
  </form>
</div>

<script src="https://apps-api.moysklad.ru/js/ns/appstore/app/v1/moysklad-iframe-expand-3.js"></script>
<script>
(function() {
  const CONTEXT_KEY = ${JSON.stringify(contextKey)};
  const statusEl = document.getElementById('status');
  const userEl = document.getElementById('user');
  const form = document.getElementById('form');
  const saveBtn = document.getElementById('saveBtn');

  function showStatus(kind, message) {
    statusEl.className = 'status ' + kind;
    statusEl.textContent = message;
  }

  // Load user context + current settings
  fetch('/settings/bootstrap?contextKey=' + encodeURIComponent(CONTEXT_KEY))
    .then(r => r.ok ? r.json() : Promise.reject(r))
    .then(data => {
      if (data.user && data.user.name) {
        userEl.textContent = ${JSON.stringify(t('Вы вошли как: ', 'Signed in as: '))} + data.user.name;
      }
      const s = data.settings || {};
      if (s.didoxLogin) document.getElementById('didoxLogin').value = s.didoxLogin;
      if (s.autoSendDemand) document.getElementById('autoSendDemand').checked = true;
    })
    .catch(err => {
      console.error('Bootstrap failed', err);
      showStatus('error', ${JSON.stringify(
        t('Не удалось загрузить данные. Перезагрузите страницу.', 'Failed to load. Reload the page.')
      )});
    });

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    saveBtn.disabled = true;
    statusEl.className = 'status';
    statusEl.textContent = '';

    const payload = {
      contextKey: CONTEXT_KEY,
      didoxLogin: document.getElementById('didoxLogin').value.trim(),
      didoxToken: document.getElementById('didoxToken').value, // server treats empty as "no change"
      autoSendDemand: document.getElementById('autoSendDemand').checked
    };

    fetch('/settings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(d)))
    .then(() => {
      showStatus('success', ${JSON.stringify(t('Настройки сохранены.', 'Settings saved.'))});
      document.getElementById('didoxToken').value = '';
    })
    .catch(err => {
      console.error('Save failed', err);
      const msg = (err && err.error) || ${JSON.stringify(t('Ошибка сохранения.', 'Save failed.'))};
      showStatus('error', msg);
    })
    .finally(() => { saveBtn.disabled = false; });
  });

  // Notify host of our height for auto-resize
  function reportHeight() {
    const h = document.body.scrollHeight;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ height: h }, '*');
    }
  }
  window.addEventListener('load', reportHeight);
  new ResizeObserver(reportHeight).observe(document.body);
})();
</script>
</body>
</html>`);
});

/**
 * Bootstrap data for the iframe.
 * Resolves contextKey to user info (server-side) and returns current settings.
 *
 * Note on auth: we deliberately don't require the Vendor JWT here — this is
 * called from the browser inside the MoySklad iframe and the only secret it
 * carries is the contextKey, which has a 5-minute TTL and is meaningful only
 * to MoySklad. We re-validate it by exchanging it for a user context.
 */
settingsRouter.get('/bootstrap', async (req: Request, res: Response) => {
  const contextKey = String(req.query.contextKey ?? '');
  if (!contextKey) {
    res.status(400).json({ error: 'missing_context_key' });
    return;
  }

  try {
    const user = (await vendorApi.getUserContext(contextKey)) as {
      accountId?: string;
      name?: string;
      fullName?: string;
      permissions?: Record<string, unknown>;
    };

    if (!user.accountId) {
      res.status(401).json({ error: 'invalid_context' });
      return;
    }

    const install = installationStore.get(user.accountId);
    res.json({
      user: { name: user.fullName || user.name || '' },
      settings: install?.settings ?? {},
    });
  } catch (err) {
    logger.error({ err }, 'Bootstrap: getUserContext failed');
    res.status(401).json({ error: 'context_resolution_failed' });
  }
});

/**
 * Save settings posted from the iframe.
 * Re-resolves contextKey server-side to identify the account.
 *
 * If the installation is in SettingsRequired status, transitions it to Activated
 * by calling MoySklad's PUT /apps/{appId}/{accountId}/status.
 */
settingsRouter.post('/save', async (req: Request, res: Response) => {
  const {
    contextKey,
    didoxLogin,
    didoxToken,
    autoSendDemand,
  } = req.body as {
    contextKey?: string;
    didoxLogin?: string;
    didoxToken?: string;
    autoSendDemand?: boolean;
  };

  if (!contextKey) {
    res.status(400).json({ error: 'missing_context_key' });
    return;
  }

  let accountId: string;
  try {
    const user = (await vendorApi.getUserContext(contextKey)) as {
      accountId?: string;
      permissions?: { admin?: { view?: string } };
    };
    if (!user.accountId) {
      res.status(401).json({ error: 'invalid_context' });
      return;
    }
    // Optional: enforce admin-only writes. Uncomment if you want strict checks.
    // const isAdmin = user.permissions?.admin?.view === 'ALL';
    // if (!isAdmin) {
    //   res.status(403).json({ error: 'admin_required' });
    //   return;
    // }
    accountId = user.accountId;
  } catch (err) {
    logger.error({ err }, 'Save: getUserContext failed');
    res.status(401).json({ error: 'context_resolution_failed' });
    return;
  }

  const install = installationStore.get(accountId);
  if (!install) {
    res.status(404).json({ error: 'installation_not_found' });
    return;
  }

  // Validate basic inputs
  if (didoxLogin !== undefined && didoxLogin.length > 256) {
    res.status(400).json({ error: 'didoxLogin too long' });
    return;
  }

  // Persist settings (empty token means "do not change")
  const patch: Record<string, unknown> = {
    didoxLogin: didoxLogin || install.settings?.didoxLogin,
    autoSendDemand: Boolean(autoSendDemand),
    configured: Boolean(didoxLogin && (didoxToken || install.settings?.didoxTokenHint)),
  };
  if (didoxToken) {
    // In production, store the real token in a secrets manager and keep only a hint here.
    patch.didoxTokenHint = '****' + didoxToken.slice(-4);
  }
  installationStore.updateSettings(accountId, patch);

  // If we were in SettingsRequired, flip to Activated.
  if (install.status === 'SettingsRequired' && patch.configured) {
    try {
      await vendorApi.updateStatus(accountId, 'Activated');
      installationStore.upsert({
        ...install,
        status: 'Activated',
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err, accountId }, 'Failed to transition to Activated');
      // Don't fail the user save - the settings are saved locally.
      // A retry can be added on next user action.
    }
  }

  res.json({ ok: true });
});
