import { Router, Request, Response } from 'express';
import { config } from '../config';
import { vendorApi } from '../services/moysklad';
import {
  didoxApi,
  DidoxApiError,
  DidoxInvalidCredentialsError,
  DidoxUserNotRegisteredError,
} from '../services/didox';
import { installationStore } from '../services/store';
import { AccountSettings } from '../types/vendor';
import { logger } from '../utils/logger';

const TIN_RE = /^(\d{9}|\d{14})$/;

/**
 * Validate credentials against Didox by exchanging tin+password for a token.
 * On failure, writes the appropriate HTTP error and returns null so the
 * caller can `return`. On success, returns the issued token (callers may
 * choose to discard it; the next request will fetch a fresh one).
 */
async function validateDidoxCredentials(
  tin: string,
  password: string,
  res: Response
): Promise<string | null> {
  try {
    const { token } = await didoxApi.getToken({ inn: tin, password });
    return token;
  } catch (err) {
    if (err instanceof DidoxInvalidCredentialsError) {
      res.status(422).json({ error: 'didox_invalid_credentials' });
      return null;
    }
    if (err instanceof DidoxUserNotRegisteredError) {
      res.status(422).json({ error: 'didox_user_not_registered' });
      return null;
    }
    const status = err instanceof DidoxApiError ? err.status || 502 : 502;
    logger.error({ err }, 'Didox credential validation failed');
    res.status(502).json({ error: 'didox_upstream_error', upstreamStatus: status });
    return null;
  }
}

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
  const USER_LOCALE = ${JSON.stringify(userLocale)};
  // ?edit=1 lets the user stay on the settings form even when settings exist
  // (used by the "← Settings" back-link from the documents page).
  const EDIT_MODE = new URLSearchParams(window.location.search).get('edit') === '1';
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

      // If configured and not explicitly editing, skip the form and go to the
      // documents list — this is the typical "open the app" path.
      if (hasSettings && !EDIT_MODE) {
        window.location.href = '/settings/documents'
          + '?contextKey=' + encodeURIComponent(CONTEXT_KEY)
          + '&userLocale=' + encodeURIComponent(USER_LOCALE);
        return;
      }

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
    .then(data => {
      showStatus('success', ${JSON.stringify(t('Настройки сохранены.', 'Settings saved.'))});
      passwordEl.value = '';
      hasSettings = true;
      passwordEl.placeholder = ${JSON.stringify(
        t('Оставьте пустым, чтобы не менять', 'Leave empty to keep current')
      )};
      // First-time /create returns a redirect to the documents list.
      if (data && data.redirect) {
        window.location.href = data.redirect;
      }
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

  // Verify the supplied credentials against Didox before persisting them.
  const token = await validateDidoxCredentials(didoxTin, didoxPassword, res);
  if (!token) return;

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

  // First-time success: tell the client to navigate to the documents page.
  res
    .status(201)
    .json({ ok: true, redirect: `/settings/documents?contextKey=${encodeURIComponent(contextKey ?? '')}` });
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

  // Only revalidate against Didox if tin or password is actually changing.
  // (Avoids an extra round-trip when the user only toggles autoSendDemand.)
  const credsChanging = Boolean(didoxTin || didoxPassword);
  if (credsChanging) {
    const effectiveTin = didoxTin || existing.settings.didoxTin;
    const effectivePassword = didoxPassword || existing.settings.didoxPassword;
    if (!effectiveTin || !effectivePassword) {
      res.status(400).json({ error: 'missing_credentials' });
      return;
    }
    const token = await validateDidoxCredentials(effectiveTin, effectivePassword, res);
    if (!token) return;
  }

  const patch: Partial<AccountSettings> = {
    autoSendDemand: Boolean(autoSendDemand),
  };
  if (didoxTin) patch.didoxTin = didoxTin;
  if (didoxPassword) patch.didoxPassword = didoxPassword;

  await installationStore.updateSettings(accountId, patch);
  res.json({ ok: true });
});

/**
 * GET /settings/documents
 * Iframe page that shows the user's Didox documents. Linked to from the
 * settings page after a successful first-time /create.
 */
settingsRouter.get('/documents', (req: Request, res: Response) => {
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
<title>Didox Documents</title>
<style>
  :root {
    --bg: #fafafa; --fg: #1f2328; --muted: #57606a;
    --border: #d0d7de; --accent: #1976d2; --accent-hover: #1565c0;
    --error: #cf222e; --green: #1a7f37;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; font-size: 13px; color: var(--fg); background: var(--bg); }
  .toolbar { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
  .tab { padding: 8px 16px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--muted); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
  .nav-link { color: var(--accent); text-decoration: none; font-size: 13px; }
  .nav-link:hover { text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { background: #f6f8fa; font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; }
  tr:last-child td { border-bottom: 0; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .status-dot.signed { background: var(--green); }
  .status-dot.rejected { background: var(--error); }
  .pager { display: flex; gap: 8px; align-items: center; margin-top: 12px; justify-content: flex-end; }
  .pager button { background: #fff; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; cursor: pointer; font-family: inherit; font-size: 13px; }
  .pager button:disabled { opacity: 0.5; cursor: not-allowed; }
  .pager .count { color: var(--muted); }
  .empty, .loading, .error { padding: 24px; text-align: center; color: var(--muted); }
  .error { color: var(--error); }
  .sub { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
  <div class="toolbar">
    <a class="nav-link" href="/settings/iframe?contextKey=${encodeURIComponent(contextKey)}&userLocale=${encodeURIComponent(userLocale)}&edit=1">${t('← Настройки', '← Settings')}</a>
  </div>

  <div class="tabs">
    <div class="tab active" data-owner="1">${t('Исходящие', 'Outgoing')}</div>
    <div class="tab" data-owner="0">${t('Входящие', 'Incoming')}</div>
  </div>

  <div id="content"><div class="loading">${t('Загрузка...', 'Loading...')}</div></div>

  <div class="pager" id="pager" style="display:none;">
    <span class="count" id="count"></span>
    <button id="prevBtn">${t('Назад', 'Prev')}</button>
    <button id="nextBtn">${t('Далее', 'Next')}</button>
  </div>

<script src="https://apps-api.moysklad.ru/js/ns/appstore/app/v1/moysklad-iframe-expand-3.js"></script>
<script>
(function() {
  const CONTEXT_KEY = ${JSON.stringify(contextKey)};
  const LIMIT = 20;
  let page = 1;
  let owner = 1;
  let total = 0;

  const contentEl = document.getElementById('content');
  const pagerEl = document.getElementById('pager');
  const countEl = document.getElementById('count');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  function statusClass(s) {
    // 1/4 commonly = signed; -1 = rejected. Anything else = neutral dot.
    if (s === 1 || s === 4) return 'signed';
    if (s === -1 || s === 2) return 'rejected';
    return '';
  }

  function render(data) {
    const docs = data.data || [];
    total = data.total || 0;
    countEl.textContent = ${JSON.stringify(t('Всего: ', 'Total: '))} + total;

    if (docs.length === 0) {
      contentEl.innerHTML = '<div class="empty">' + ${JSON.stringify(t('Документы не найдены.', 'No documents found.'))} + '</div>';
      pagerEl.style.display = 'flex';
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = true;
      return;
    }

    let html = '<table><thead><tr>';
    html += '<th>' + ${JSON.stringify(t('Статус', 'Status'))} + '</th>';
    html += '<th>' + ${JSON.stringify(t('Тип', 'Type'))} + '</th>';
    html += '<th>' + ${JSON.stringify(t('Номер', '№'))} + '</th>';
    html += '<th>' + ${JSON.stringify(t('Дата', 'Date'))} + '</th>';
    html += '<th>' + ${JSON.stringify(t('Контрагент', 'Counterparty'))} + '</th>';
    html += '<th>' + ${JSON.stringify(t('Договор', 'Contract'))} + '</th>';
    html += '<th>' + ${JSON.stringify(t('Сумма без НДС', 'Net sum'))} + '</th>';
    html += '<th>' + ${JSON.stringify(t('НДС', 'VAT'))} + '</th>';
    html += '<th>' + ${JSON.stringify(t('Сумма с НДС', 'Gross sum'))} + '</th>';
    html += '<th>Roaming ID</th>';
    html += '</tr></thead><tbody>';

    for (const d of docs) {
      const contract = d.contract_number ? (escape(d.contract_number) + ' / ' + escape(d.contract_date || '')) : '—';
      html += '<tr>';
      html += '<td><span class="status-dot ' + statusClass(d.doc_status) + '"></span></td>';
      html += '<td>' + escape(d.doctype) + '</td>';
      html += '<td>' + escape(d.name) + '</td>';
      html += '<td>' + escape(d.doc_date) + '</td>';
      html += '<td>' + escape(d.partnerCompany) + '<div class="sub">' + escape(d.partnerTin) + '</div></td>';
      html += '<td>' + contract + '</td>';
      html += '<td>' + escape(d.total_delivery_sum) + '</td>';
      html += '<td>' + escape(d.total_vat_sum) + '</td>';
      html += '<td>' + escape(d.total_delivery_sum_with_vat) + '</td>';
      html += '<td><code>' + escape(d.roaming_id || '—') + '</code></td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    contentEl.innerHTML = html;
    pagerEl.style.display = 'flex';
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page * LIMIT >= total;
  }

  function load() {
    contentEl.innerHTML = '<div class="loading">' + ${JSON.stringify(t('Загрузка...', 'Loading...'))} + '</div>';
    const url = '/settings/documents/list'
      + '?contextKey=' + encodeURIComponent(CONTEXT_KEY)
      + '&owner=' + owner
      + '&page=' + page
      + '&limit=' + LIMIT;
    fetch(url)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(d)))
      .then(render)
      .catch(err => {
        console.error('List failed', err);
        const msg = (err && err.error) || ${JSON.stringify(t('Не удалось загрузить.', 'Failed to load.'))};
        contentEl.innerHTML = '<div class="error">' + escape(msg) + '</div>';
        pagerEl.style.display = 'none';
      });
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      owner = Number(tab.getAttribute('data-owner'));
      page = 1;
      load();
    });
  });

  prevBtn.addEventListener('click', () => { if (page > 1) { page--; load(); } });
  nextBtn.addEventListener('click', () => { if (page * LIMIT < total) { page++; load(); } });

  load();

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
 * GET /settings/documents/list
 * JSON endpoint that fetches a page of Didox documents for the resolved
 * account. Uses the stored (encrypted) password to mint a fresh Didox
 * user-token per request.
 *
 * Query params: owner (0|1), page, limit, plus any other Didox list params
 * passed through as-is.
 */
settingsRouter.get('/documents/list', async (req: Request, res: Response) => {
  const resolved = await resolveAccount(String(req.query.contextKey ?? ''), res);
  if (!resolved) return;

  const install = await installationStore.get(resolved.accountId);
  if (!install?.settings?.configured || !install.settings.didoxTin || !install.settings.didoxPassword) {
    res.status(412).json({ error: 'settings_not_configured' });
    return;
  }

  let userToken: string;
  try {
    const auth = await didoxApi.getToken({
      inn: install.settings.didoxTin,
      password: install.settings.didoxPassword,
    });
    userToken = auth.token;
  } catch (err) {
    if (err instanceof DidoxInvalidCredentialsError) {
      res.status(401).json({ error: 'didox_invalid_credentials' });
      return;
    }
    if (err instanceof DidoxUserNotRegisteredError) {
      res.status(401).json({ error: 'didox_user_not_registered' });
      return;
    }
    logger.error({ err, accountId: resolved.accountId }, 'Didox auth failed during list');
    res.status(502).json({ error: 'didox_upstream_error' });
    return;
  }

  const owner = req.query.owner === '0' ? 0 : 1;
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));

  try {
    const data = await didoxApi.listDocuments(userToken, { owner, page, limit });
    res.json(data);
  } catch (err) {
    const status = err instanceof DidoxApiError ? err.status || 502 : 502;
    logger.error({ err, accountId: resolved.accountId }, 'Didox listDocuments failed');
    res.status(502).json({ error: 'didox_upstream_error', upstreamStatus: status });
  }
});
