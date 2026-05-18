import { Router, Request, Response } from 'express';
import { config } from '../config';
import { vendorApi } from '../services/moysklad';
import { installationStore } from '../services/store';
import { AccountSettings } from '../types/vendor';
import { logger } from '../utils/logger';

const TIN_RE = /^(\d{9}|\d{14})$/;

/**
 * Resolve a MoySklad contextKey to an accountId + display name.
 * Returns null and writes the appropriate HTTP error if resolution fails.
 */
async function resolveAccount(
  contextKey: string | undefined,
  res: Response
): Promise<{ accountId: string; userName: string } | null> {
  if (!contextKey) {
    res.status(400).json({ error: 'missing_context_key' });
    return null;
  }
  try {
    const user = (await vendorApi.getUserContext(contextKey)) as {
      accountId?: string;
      name?: string;
      fullName?: string;
    };
    if (!user.accountId) {
      res.status(401).json({ error: 'invalid_context' });
      return null;
    }
    return { accountId: user.accountId, userName: user.fullName || user.name || '' };
  } catch (err) {
    logger.error({ err }, 'getUserContext failed');
    res.status(401).json({ error: 'context_resolution_failed' });
    return null;
  }
}

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
        <label for="didoxTin">${t('СТИР / ЖШШИР', 'TIN / PINFL')}</label>
        <input id="didoxTin" name="didoxTin" type="text" inputmode="numeric" pattern="[0-9]{9}|[0-9]{14}" autocomplete="off" />
        <div class="help">${t(
          'СТИР (9 цифр) для юр. лиц или ЖШШИР (14 цифр) для физ. лиц.',
          'TIN (9 digits) for legal entities or PINFL (14 digits) for individuals.'
        )}</div>
      </div>

      <div class="field">
        <label for="didoxPassword">${t('Пароль Didox', 'Didox password')}</label>
        <input id="didoxPassword" name="didoxPassword" type="password" autocomplete="new-password" />
        <div class="help">${t(
          'Пароль хранится на сервере интеграции. Оставьте пустым, чтобы не менять.',
          'Password is stored on the integration server. Leave empty to keep current.'
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
  const passwordEl = document.getElementById('didoxPassword');

  // Picks /create on first save, /update afterwards.
  let hasSettings = false;

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
      hasSettings = Boolean(data.hasSettings);
      const s = data.settings || {};
      if (s.didoxTin) document.getElementById('didoxTin').value = s.didoxTin;
      if (s.autoSendDemand) document.getElementById('autoSendDemand').checked = true;
      if (hasSettings) {
        passwordEl.placeholder = ${JSON.stringify(
          t('Оставьте пустым, чтобы не менять', 'Leave empty to keep current')
        )};
      }
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
      didoxTin: document.getElementById('didoxTin').value.trim(),
      didoxPassword: passwordEl.value, // /update treats empty as "no change"; /create requires it
      autoSendDemand: document.getElementById('autoSendDemand').checked
    };

    const endpoint = hasSettings ? '/settings/update' : '/settings/create';

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(d)))
    .then(() => {
      showStatus('success', ${JSON.stringify(t('Настройки сохранены.', 'Settings saved.'))});
      passwordEl.value = '';
      hasSettings = true;
      passwordEl.placeholder = ${JSON.stringify(
        t('Оставьте пустым, чтобы не менять', 'Leave empty to keep current')
      )};
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
  const resolved = await resolveAccount(String(req.query.contextKey ?? ''), res);
  if (!resolved) return;

  const install = await installationStore.get(resolved.accountId);
  // Never send the decrypted Didox password to the browser.
  const { didoxPassword: _omit, ...safeSettings } = install?.settings ?? {};
  void _omit;
  res.json({
    user: { name: resolved.userName },
    settings: safeSettings,
    hasSettings: Boolean(install?.settings?.configured),
  });
});

/**
 * POST /settings/create
 * First-time settings save. Both didoxTin and didoxPassword are required.
 * Creates the installation row (with placeholder accountName) if it doesn't
 * exist yet — covers the case where the iframe is opened before MoySklad's
 * vendor activation webhook has fired.
 *
 * Refuses (409) if settings are already configured — use /update instead.
 */
settingsRouter.post('/create', async (req: Request, res: Response) => {
  const { contextKey, didoxTin, didoxPassword, autoSendDemand } = req.body as {
    contextKey?: string;
    didoxTin?: string;
    didoxPassword?: string;
    autoSendDemand?: boolean;
  };

  const resolved = await resolveAccount(contextKey, res);
  if (!resolved) return;
  const { accountId, userName } = resolved;

  if (!didoxTin || !TIN_RE.test(didoxTin)) {
    res.status(400).json({ error: 'didoxTin must be 9 (СТИР) or 14 (ЖШШИР) digits' });
    return;
  }
  if (!didoxPassword) {
    res.status(400).json({ error: 'didoxPassword is required' });
    return;
  }

  const existing = await installationStore.get(accountId);
  if (existing?.settings?.configured) {
    res.status(409).json({ error: 'settings_already_exist' });
    return;
  }

  // Create installation row if missing (vendor activation hasn't fired yet),
  // otherwise just attach settings to the existing row.
  const baseInstall = existing ?? {
    accountId,
    appUid: config.moysklad.appUid,
    accountName: userName,
    status: 'Activated' as const,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const settings: AccountSettings = {
    didoxTin,
    didoxPassword,
    autoSendDemand: Boolean(autoSendDemand),
    configured: true,
  };

  await installationStore.upsert({ ...baseInstall, settings });

  // If MoySklad activation set status=SettingsRequired, flip to Activated now.
  if (existing?.status === 'SettingsRequired') {
    try {
      await vendorApi.updateStatus(accountId, 'Activated');
      await installationStore.upsert({
        ...baseInstall,
        status: 'Activated',
        settings,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err, accountId }, 'Failed to transition to Activated');
      // Settings are already saved locally; not fatal for the user.
    }
  }

  res.status(201).json({ ok: true });
});

/**
 * POST /settings/update
 * Update existing settings. All fields are optional; an empty password keeps
 * the current value. Requires settings to already be configured (use /create
 * for the first save).
 */
settingsRouter.post('/update', async (req: Request, res: Response) => {
  const { contextKey, didoxTin, didoxPassword, autoSendDemand } = req.body as {
    contextKey?: string;
    didoxTin?: string;
    didoxPassword?: string;
    autoSendDemand?: boolean;
  };

  const resolved = await resolveAccount(contextKey, res);
  if (!resolved) return;
  const { accountId } = resolved;

  if (didoxTin && !TIN_RE.test(didoxTin)) {
    res.status(400).json({ error: 'didoxTin must be 9 (СТИР) or 14 (ЖШШИР) digits' });
    return;
  }

  const existing = await installationStore.get(accountId);
  if (!existing?.settings?.configured) {
    res.status(404).json({ error: 'settings_not_found' });
    return;
  }

  const patch: Partial<AccountSettings> = {
    autoSendDemand: Boolean(autoSendDemand),
  };
  if (didoxTin) patch.didoxTin = didoxTin;
  if (didoxPassword) patch.didoxPassword = didoxPassword;

  await installationStore.updateSettings(accountId, patch);
  res.json({ ok: true });
});
