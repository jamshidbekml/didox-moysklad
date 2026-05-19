import { DOC_TYPES, STATUSES } from '../../../constants/didox';

/**
 * HTML template for the documents list iframe (GET /settings/documents).
 * Renders a paginated, filterable table; rows are clickable and navigate
 * to the document detail page.
 */
export function renderDocumentsList(params: { contextKey: string; userLocale: string }): string {
  const { contextKey, userLocale } = params;
  const ru = userLocale.startsWith('ru');
  const t = (rus: string, eng: string) => (ru ? rus : eng);

  return `<!doctype html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
<meta charset="utf-8">
<title>Didox Documents</title>
<style>
  :root {
    --bg: #fafafa; --fg: #333; --muted: #57606a;
    --border: #d0d7de; --accent: #1f75a8; --accent-hover: #195e87;
    --error: #cf222e; --green: #a1b900; --amber: #bf8700; --neutral: #6e7781;
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
  tbody tr { cursor: pointer; }
  tbody tr:hover td { background: #f6f8fa; }
  tr:last-child td { border-bottom: 0; }
  /* Status on the list: colored dot + label, slightly muted via opacity. */
  .status-pill {
    display: inline-flex; gap: 8px; align-items: center;
    font-size: 12px; white-space: nowrap;
    opacity: 0.78;
  }
  .status-pill .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--neutral); flex-shrink: 0;
  }
  .status-pill[data-color="white"]  .dot { background: #ffffff; border: 1px solid var(--border); }
  .status-pill[data-color="blue"]   .dot { background: #1f75a8; }
  .status-pill[data-color="orange"] .dot { background: #f57c00; }
  .status-pill[data-color="green"]  .dot { background: #a1b900; }
  .status-pill[data-color="black"]  .dot { background: #333; }
  .status-pill[data-color="red"]    .dot { background: #cf222e; }
  .status-pill[data-color="gray"]   .dot { background: #6e7781; }

  /* Pager: limit selector + numbered pages */
  .pager { display: flex; gap: 12px; align-items: center; margin-top: 12px; justify-content: space-between; flex-wrap: wrap; }
  .pager .left, .pager .right { display: flex; gap: 8px; align-items: center; }
  .pager .count { color: var(--muted); }
  .pager select { background: #fff; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-family: inherit; font-size: 13px; cursor: pointer; }
  .pages { display: flex; gap: 4px; align-items: center; }
  .page-btn {
    background: #fff; border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 10px; min-width: 32px; text-align: center;
    cursor: pointer; font-family: inherit; font-size: 13px; color: var(--fg);
  }
  .page-btn:hover:not(:disabled):not(.active) { background: #f6f8fa; }
  .page-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; cursor: default; }
  .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .page-ellipsis { padding: 6px 4px; color: var(--muted); }

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
    <div class="left">
      <span class="count" id="count"></span>
      <label class="count" for="limitSel">${t('Показывать:', 'Per page:')}</label>
      <select id="limitSel">
        <option value="10">10</option>
        <option value="25" selected>25</option>
        <option value="50">50</option>
        <option value="100">100</option>
      </select>
    </div>
    <div class="right">
      <div class="pages" id="pages"></div>
    </div>
  </div>

<script src="https://apps-api.moysklad.ru/js/ns/appstore/app/v1/moysklad-iframe-expand-3.js"></script>
<script>
(function() {
  const CONTEXT_KEY = ${JSON.stringify(contextKey)};
  const USER_LOCALE = ${JSON.stringify(userLocale)};
  const DOC_TYPES = ${JSON.stringify(DOC_TYPES)};
  const STATUSES = ${JSON.stringify(STATUSES)};

  let limit = 25;
  let page = 1;
  let owner = 1;
  let total = 0;

  const contentEl = document.getElementById('content');
  const pagerEl = document.getElementById('pager');
  const countEl = document.getElementById('count');
  const pagesEl = document.getElementById('pages');
  const limitSel = document.getElementById('limitSel');

  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  function docTypeName(code) {
    return DOC_TYPES[code] || code || '—';
  }

  function statusPill(code) {
    const s = STATUSES[code];
    const color = s ? s.color : 'gray';
    const name = s ? s.name : String(code);
    return '<span class="status-pill" data-color="' + color + '"><span class="dot"></span>' + escape(name) + '</span>';
  }

  function renderPager() {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    pagesEl.innerHTML = '';

    function btn(label, targetPage, opts) {
      opts = opts || {};
      const b = document.createElement('button');
      b.className = 'page-btn' + (opts.active ? ' active' : '');
      b.textContent = label;
      b.disabled = Boolean(opts.disabled) || opts.active;
      if (!b.disabled) b.addEventListener('click', () => { page = targetPage; load(); });
      return b;
    }
    function ellipsis() {
      const span = document.createElement('span');
      span.className = 'page-ellipsis';
      span.textContent = '…';
      return span;
    }

    pagesEl.appendChild(btn('«', 1, { disabled: page <= 1 }));
    pagesEl.appendChild(btn('‹', page - 1, { disabled: page <= 1 }));

    // Window of ±2 around current page, always include first and last.
    const windowSize = 2;
    const pageNums = new Set([1, totalPages]);
    for (let p = page - windowSize; p <= page + windowSize; p++) {
      if (p >= 1 && p <= totalPages) pageNums.add(p);
    }
    const sorted = Array.from(pageNums).sort((a, b) => a - b);
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) pagesEl.appendChild(ellipsis());
      pagesEl.appendChild(btn(String(p), p, { active: p === page }));
      prev = p;
    }

    pagesEl.appendChild(btn('›', page + 1, { disabled: page >= totalPages }));
    pagesEl.appendChild(btn('»', totalPages, { disabled: page >= totalPages }));
  }

  function render(data) {
    const docs = data.data || [];
    total = data.total || 0;
    countEl.textContent = ${JSON.stringify(t('Всего: ', 'Total: '))} + total;

    if (docs.length === 0) {
      contentEl.innerHTML = '<div class="empty">' + ${JSON.stringify(t('Документы не найдены.', 'No documents found.'))} + '</div>';
      pagerEl.style.display = 'flex';
      renderPager();
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
    html += '</tr></thead><tbody>';

    for (const d of docs) {
      const contract = d.contract_number ? (escape(d.contract_number) + ' / ' + escape(d.contract_date || '')) : '—';
      html += '<tr data-doc-id="' + escape(d.doc_id) + '">';
      html += '<td>' + statusPill(d.doc_status) + '</td>';
      html += '<td>' + escape(docTypeName(d.doctype)) + '</td>';
      html += '<td>' + escape(d.name) + '</td>';
      html += '<td>' + escape(d.doc_date) + '</td>';
      html += '<td>' + escape(d.partnerCompany) + '<div class="sub">' + escape(d.partnerTin) + '</div></td>';
      html += '<td>' + contract + '</td>';
      html += '<td>' + escape(d.total_delivery_sum) + '</td>';
      html += '<td>' + escape(d.total_vat_sum) + '</td>';
      html += '<td>' + escape(d.total_delivery_sum_with_vat) + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    contentEl.innerHTML = html;
    pagerEl.style.display = 'flex';
    renderPager();

    // Navigate to detail view on row click.
    const table = contentEl.querySelector('tbody');
    if (table) {
      table.addEventListener('click', (e) => {
        const row = e.target.closest('tr[data-doc-id]');
        if (!row) return;
        const docId = row.getAttribute('data-doc-id');
        window.location.href = '/settings/documents/view'
          + '?contextKey=' + encodeURIComponent(CONTEXT_KEY)
          + '&userLocale=' + encodeURIComponent(USER_LOCALE)
          + '&docId=' + encodeURIComponent(docId);
      });
    }
  }

  function load() {
    contentEl.innerHTML = '<div class="loading">' + ${JSON.stringify(t('Загрузка...', 'Loading...'))} + '</div>';
    const url = '/settings/documents/list'
      + '?contextKey=' + encodeURIComponent(CONTEXT_KEY)
      + '&owner=' + owner
      + '&page=' + page
      + '&limit=' + limit;
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

  limitSel.addEventListener('change', () => {
    limit = parseInt(limitSel.value, 10) || 25;
    page = 1;
    load();
  });

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
</html>`;
}
