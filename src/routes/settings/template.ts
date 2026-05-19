/**
 * HTML template for the main settings iframe (GET /settings/iframe).
 * MoySklad loads this URL inside our solution's iframe slot.
 */
export function renderSettingsIframe(params: { contextKey: string; userLocale: string }): string {
  const { contextKey, userLocale } = params;
  const ru = userLocale.startsWith('ru');
  const t = (rus: string, eng: string) => (ru ? rus : eng);

  return `<!doctype html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
<meta charset="utf-8">
<title>Didox Integration</title>
<style>
  :root {
    --bg: #fafafa;
    --fg: #333;
    --muted: #57606a;
    --border: #d0d7de;
    --accent: #1f75a8;
    --accent-hover: #195e87;
    --success: #a1b900;
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
  .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .header h1 { font-size: 20px; margin: 0 0 8px; }
  p.lead { color: var(--muted); margin: 0 0 24px; }
  .nav-link { color: var(--accent); text-decoration: none; font-size: 13px; white-space: nowrap; }
  .nav-link:hover { text-decoration: underline; }
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
  <div class="header">
    <h1>${t('Интеграция с Didox', 'Didox Integration')}</h1>
    <a id="docsLink" class="nav-link" href="#" style="display:none;">${t('Документы →', 'Documents →')}</a>
  </div>
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

  fetch('/settings/bootstrap?contextKey=' + encodeURIComponent(CONTEXT_KEY))
    .then(r => r.ok ? r.json() : Promise.reject(r))
    .then(data => {
      if (data.user && data.user.name) {
        userEl.textContent = ${JSON.stringify(t('Вы вошли как: ', 'Signed in as: '))} + data.user.name;
      }
      hasSettings = Boolean(data.hasSettings);

      const docsUrl = '/settings/documents'
        + '?contextKey=' + encodeURIComponent(CONTEXT_KEY)
        + '&userLocale=' + encodeURIComponent(USER_LOCALE);

      // If configured and not explicitly editing, skip the form and go to the
      // documents list — this is the typical "open the app" path.
      if (hasSettings && !EDIT_MODE) {
        window.location.href = docsUrl;
        return;
      }

      const s = data.settings || {};
      if (s.didoxTin) document.getElementById('didoxTin').value = s.didoxTin;
      if (s.autoSendDemand) document.getElementById('autoSendDemand').checked = true;
      if (hasSettings) {
        passwordEl.placeholder = ${JSON.stringify(
          t('Оставьте пустым, чтобы не менять', 'Leave empty to keep current')
        )};
        // Edit mode: show the "Documents →" return link in the header.
        const docsLink = document.getElementById('docsLink');
        docsLink.href = docsUrl;
        docsLink.style.display = 'inline';
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
</html>`;
}
