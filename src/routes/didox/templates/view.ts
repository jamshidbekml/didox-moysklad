import { DOC_TYPES, STATUSES } from '../../../constants/didox';

/**
 * HTML template for the document detail iframe (GET /settings/documents/view).
 * Fetches the full document from /settings/documents/details and renders
 * the status, parties, factura metadata, products table, and signatures.
 */
export function renderDocumentView(params: {
  contextKey: string;
  userLocale: string;
  docId: string;
}): string {
  const { contextKey, userLocale, docId } = params;
  const ru = userLocale.startsWith('ru');
  const t = (rus: string, eng: string) => (ru ? rus : eng);
  const backUrl =
    `/settings/documents?contextKey=${encodeURIComponent(contextKey)}&userLocale=${encodeURIComponent(userLocale)}`;

  return `<!doctype html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
<meta charset="utf-8">
<title>Document — Didox</title>
<style>
  :root {
    --bg: #fafafa; --fg: #333; --muted: #57606a;
    --border: #d0d7de; --accent: #1f75a8; --error: #cf222e;
    --neutral: #6e7781;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; font-size: 13px; color: var(--fg); background: var(--bg); }
  .toolbar { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
  .nav-link { color: var(--accent); text-decoration: none; font-size: 13px; }
  .nav-link:hover { text-decoration: underline; }
  .header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 8px; }
  .header h1 { font-size: 22px; margin: 0; }
  .header .doctype { color: var(--muted); }
  .meta-row { color: var(--muted); margin-bottom: 16px; font-size: 12px; }
  .status-comment { background: #fff8c5; border: 1px solid #d4a72c; border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; color: #4d2d00; }

  /* Status badge: solid color from the Didox status spec. */
  .status-badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 500; color: #fff; background: var(--neutral); border: 1px solid transparent; }
  .status-badge[data-color="white"]  { background: #ffffff; color: #333; border-color: #d0d7de; }
  .status-badge[data-color="blue"]   { background: #1f75a8; }
  .status-badge[data-color="orange"] { background: #f57c00; }
  .status-badge[data-color="green"]  { background: #a1b900; }
  .status-badge[data-color="black"]  { background: #333; }
  .status-badge[data-color="red"]    { background: #cf222e; }
  .status-badge[data-color="gray"]   { background: #6e7781; }

  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 800px) { .cards { grid-template-columns: 1fr; } }
  .card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card h3 { margin: 0 0 12px; font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .kv { display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px; }
  .kv dt { color: var(--muted); margin: 0; }
  .kv dd { margin: 0; word-break: break-word; }
  .kv dd.empty { color: var(--muted); font-style: italic; }

  .section-title { font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 24px 0 8px; }

  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; white-space: nowrap; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: 0; }
  tfoot td { font-weight: 600; background: #f6f8fa; border-top: 1px solid var(--border); }
  .sub { color: var(--muted); font-size: 11px; }

  /* Signature cards — receipt-style boxes with a color-coded state label. */
  .sig-grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .sig-card {
    background: #fff; border: 2px solid var(--border); border-radius: 8px;
    padding: 10px 12px; display: flex; flex-direction: column;
    width: 300px; max-width: 300px; max-height: 146px; box-sizing: border-box;
  }
  .sig-card[data-state="confirmed"] { border-color: #a1b900; }
  .sig-card[data-state="cancel"]    { border-color: var(--error); }
  .sig-card .sig-header { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 11px; }
  .sig-card .sig-state {
    flex-grow: 1; display: flex; align-items: center; justify-content: center;
    text-align: center; padding: 6px 0;
    font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--muted);
  }
  .sig-card[data-state="confirmed"] .sig-state { color: #a1b900; }
  .sig-card[data-state="cancel"]    .sig-state { color: var(--error); }
  .sig-card .sig-footer { font-size: 11px; line-height: 1.35; }
  .sig-card .sig-name { font-weight: 600; font-size: 12px; margin-bottom: 2px; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sig-card .sig-operator, .sig-card .sig-ip { color: var(--muted); }

  .loading, .error { padding: 24px; text-align: center; color: var(--muted); }
  .error { color: var(--error); }
</style>
</head>
<body>
  <div class="toolbar">
    <a class="nav-link" href="${backUrl}">${t('← К списку документов', '← Back to documents')}</a>
  </div>
  <div id="content"><div class="loading">${t('Загрузка...', 'Loading...')}</div></div>

<script src="https://apps-api.moysklad.ru/js/ns/appstore/app/v1/moysklad-iframe-expand-3.js"></script>
<script>
(function() {
  const CONTEXT_KEY = ${JSON.stringify(contextKey)};
  const DOC_ID = ${JSON.stringify(docId)};
  const DOC_TYPES = ${JSON.stringify(DOC_TYPES)};
  const STATUSES = ${JSON.stringify(STATUSES)};
  const T = {
    seller:        ${JSON.stringify(t('Продавец', 'Seller'))},
    buyer:         ${JSON.stringify(t('Покупатель', 'Buyer'))},
    tin:           ${JSON.stringify(t('ИНН', 'TIN'))},
    name:          ${JSON.stringify(t('Название', 'Name'))},
    address:       ${JSON.stringify(t('Адрес', 'Address'))},
    account:       ${JSON.stringify(t('Расчётный счёт', 'Bank account'))},
    bank:          ${JSON.stringify(t('Банк (MFO)', 'Bank (MFO)'))},
    director:      ${JSON.stringify(t('Директор', 'Director'))},
    accountant:    ${JSON.stringify(t('Бухгалтер', 'Accountant'))},
    oked:          ${JSON.stringify(t('ОКЭД', 'OKED'))},
    vatRegCode:    ${JSON.stringify(t('Код НДС', 'VAT reg. code'))},
    branch:        ${JSON.stringify(t('Филиал', 'Branch'))},
    workphone:     ${JSON.stringify(t('Рабочий тел.', 'Work phone'))},
    mobile:        ${JSON.stringify(t('Моб. тел.', 'Mobile'))},
    meta:          ${JSON.stringify(t('Сведения о документе', 'Document info'))},
    facturaId:     ${JSON.stringify(t('ID счёт-фактуры', 'Factura ID'))},
    facturaNo:     ${JSON.stringify(t('№ счёт-фактуры', 'Factura №'))},
    facturaDate:   ${JSON.stringify(t('Дата', 'Date'))},
    contract:      ${JSON.stringify(t('Договор', 'Contract'))},
    contractNo:    ${JSON.stringify(t('№ договора', 'Contract №'))},
    contractDate:  ${JSON.stringify(t('Дата договора', 'Contract date'))},
    empowerment:   ${JSON.stringify(t('Доверенность', 'Empowerment'))},
    empowermentNo: ${JSON.stringify(t('№ доверенности', 'Empowerment №'))},
    empowermentDate:${JSON.stringify(t('Дата доверенности', 'Empowerment date'))},
    agentFio:      ${JSON.stringify(t('ФИО доверенного', 'Agent name'))},
    itemReleased:  ${JSON.stringify(t('Отпустил товар', 'Released by'))},
    releasedFio:   ${JSON.stringify(t('ФИО', 'Name'))},
    releasedPinfl: ${JSON.stringify(t('ПИНФЛ', 'PINFL'))},
    products:      ${JSON.stringify(t('Товары', 'Products'))},
    ord:           ${JSON.stringify(t('№', '№'))},
    productName:   ${JSON.stringify(t('Наименование', 'Item'))},
    catalog:       ${JSON.stringify(t('Каталог', 'Catalog'))},
    unit:          ${JSON.stringify(t('Ед. изм.', 'Unit'))},
    count:         ${JSON.stringify(t('Кол-во', 'Qty'))},
    price:         ${JSON.stringify(t('Цена', 'Price'))},
    netSum:        ${JSON.stringify(t('Сумма', 'Net'))},
    vatRate:       ${JSON.stringify(t('НДС %', 'VAT %'))},
    vatSum:        ${JSON.stringify(t('НДС', 'VAT'))},
    gross:         ${JSON.stringify(t('Итого', 'Total'))},
    total:         ${JSON.stringify(t('Итого:', 'Total:'))},
    signatures:    ${JSON.stringify(t('Подписи', 'Signatures'))},
    sigSent:       ${JSON.stringify(t('Отправлено', 'Sent'))},
    sigConfirmed:  ${JSON.stringify(t('Подтверждён', 'Confirmed'))},
    sigCancel:     ${JSON.stringify(t('Отменён', 'Cancelled'))},
    operator:      ${JSON.stringify(t('Оператор', 'Operator'))},
    notSigned:     ${JSON.stringify(t('Документ ещё не подписан.', 'Not signed yet.'))},
    failed:        ${JSON.stringify(t('Не удалось загрузить документ.', 'Failed to load document.'))},
    createdLabel:  ${JSON.stringify(t('Создан: ', 'Created: '))},
    updatedLabel:  ${JSON.stringify(t('Обновлён: ', 'Updated: '))}
  };

  const contentEl = document.getElementById('content');

  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  function docTypeName(code) { return DOC_TYPES[code] || code || '—'; }

  function statusBadge(code) {
    const s = STATUSES[code];
    if (!s) return '<span class="status-badge" data-color="gray">' + escape(code) + '</span>';
    return '<span class="status-badge" data-color="' + s.color + '">' + escape(s.name) + '</span>';
  }

  function kv(label, value) {
    const empty = value === null || value === undefined || value === '';
    const cell = empty ? '<dd class="empty">—</dd>' : '<dd>' + escape(value) + '</dd>';
    return '<dt>' + escape(label) + '</dt>' + cell;
  }

  function partyCard(title, p, tin) {
    if (!p) return '';
    const bank = (p.bankid || '') + (p.branchcode ? ' / ' + p.branchcode : '');
    return '<div class="card"><h3>' + escape(title) + '</h3><dl class="kv">'
      + kv(T.tin, tin)
      + kv(T.name, p.name)
      + kv(T.address, p.address)
      + kv(T.account, p.account)
      + kv(T.bank, bank.trim() || null)
      + kv(T.director, p.director)
      + kv(T.accountant, p.accountant)
      + kv(T.oked, p.oked)
      + kv(T.vatRegCode, p.vatregcode)
      + kv(T.branch, p.branchname)
      + kv(T.workphone, p.workphone)
      + kv(T.mobile, p.mobile)
      + '</dl></div>';
  }

  function metaCard(j) {
    let html = '<div class="card"><h3>' + escape(T.meta) + '</h3><dl class="kv">';
    html += kv(T.facturaId, j.facturaid);
    if (j.facturadoc) {
      html += kv(T.facturaNo, j.facturadoc.facturano);
      html += kv(T.facturaDate, j.facturadoc.facturadate);
    }
    if (j.contractdoc && (j.contractdoc.contractno || j.contractdoc.contractdate)) {
      html += kv(T.contractNo, j.contractdoc.contractno);
      html += kv(T.contractDate, j.contractdoc.contractdate);
    }
    const emp = j.facturaempowermentdoc;
    if (emp && (emp.empowermentno || emp.empowermentdateofissue || emp.agentfio)) {
      html += '</dl><h3 style="margin-top:16px;">' + escape(T.empowerment) + '</h3><dl class="kv">';
      html += kv(T.empowermentNo, emp.empowermentno);
      html += kv(T.empowermentDate, emp.empowermentdateofissue);
      html += kv(T.agentFio, emp.agentfio);
    }
    const rel = j.itemreleaseddoc;
    if (rel && (rel.itemreleasedfio || rel.itemreleasedpinfl)) {
      html += '</dl><h3 style="margin-top:16px;">' + escape(T.itemReleased) + '</h3><dl class="kv">';
      html += kv(T.releasedFio, rel.itemreleasedfio);
      html += kv(T.releasedPinfl, rel.itemreleasedpinfl);
    }
    return html + '</dl></div>';
  }

  function fmtNum(v) {
    const n = Number(v);
    if (!isFinite(n)) return escape(v);
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  }

  function productsTable(pl) {
    if (!pl || !pl.products || pl.products.length === 0) return '';
    let html = '<div class="section-title">' + escape(T.products) + '</div>';
    html += '<table><thead><tr>';
    html += '<th>' + escape(T.ord) + '</th>';
    html += '<th>' + escape(T.productName) + '</th>';
    html += '<th>' + escape(T.catalog) + '</th>';
    html += '<th>' + escape(T.unit) + '</th>';
    html += '<th class="num">' + escape(T.count) + '</th>';
    html += '<th class="num">' + escape(T.price) + '</th>';
    html += '<th class="num">' + escape(T.netSum) + '</th>';
    html += '<th class="num">' + escape(T.vatRate) + '</th>';
    html += '<th class="num">' + escape(T.vatSum) + '</th>';
    html += '<th class="num">' + escape(T.gross) + '</th>';
    html += '</tr></thead><tbody>';

    let sumNet = 0, sumVat = 0, sumGross = 0;
    for (const p of pl.products) {
      sumNet += Number(p.deliverysum) || 0;
      sumVat += Number(p.vatsum) || 0;
      sumGross += Number(p.deliverysumwithvat) || 0;

      const extras = [];
      if (p.barcode) extras.push('barcode: ' + p.barcode);
      if (p.serial) extras.push('serial: ' + p.serial);

      html += '<tr>';
      html += '<td>' + escape(p.ordno) + '</td>';
      html += '<td>' + escape(p.name) + (extras.length ? '<div class="sub">' + escape(extras.join(' · ')) + '</div>' : '') + '</td>';
      html += '<td>' + escape(p.catalogname || '') + (p.catalogcode ? '<div class="sub">' + escape(p.catalogcode) + '</div>' : '') + '</td>';
      html += '<td>' + escape(p.packagename || '') + '</td>';
      html += '<td class="num">' + escape(p.count) + '</td>';
      html += '<td class="num">' + escape(p.summa) + '</td>';
      html += '<td class="num">' + fmtNum(p.deliverysum) + '</td>';
      html += '<td class="num">' + escape(p.vatrate) + '</td>';
      html += '<td class="num">' + escape(p.vatsum) + '</td>';
      html += '<td class="num">' + escape(p.deliverysumwithvat) + '</td>';
      html += '</tr>';
    }
    html += '</tbody><tfoot><tr>';
    html += '<td colspan="6" class="num">' + escape(T.total) + '</td>';
    html += '<td class="num">' + fmtNum(sumNet) + '</td>';
    html += '<td></td>';
    html += '<td class="num">' + fmtNum(sumVat) + '</td>';
    html += '<td class="num">' + fmtNum(sumGross) + '</td>';
    html += '</tr></tfoot></table>';
    return html;
  }

  function signaturesSection(rawSig) {
    let entries = [];
    try { entries = rawSig ? JSON.parse(rawSig) : []; } catch (e) { entries = []; }
    let html = '<div class="section-title">' + escape(T.signatures) + '</div>';
    if (!Array.isArray(entries) || entries.length === 0) {
      return html + '<div class="card"><div class="loading">' + escape(T.notSigned) + '</div></div>';
    }
    html += '<div class="sig-grid">';
    entries.forEach((s, idx) => {
      let state, label;
      if (s && s.type === 'cancel') { state = 'cancel';    label = T.sigCancel; }
      else if (idx === 0)           { state = 'sent';      label = T.sigSent; }
      else                          { state = 'confirmed'; label = T.sigConfirmed; }

      const fullName = s.fullName || ((s.firstName || '') + ' ' + (s.lastName || '')).trim();
      const serial = s.serialDec != null ? s.serialDec : (s.serial || '');

      html += '<div class="sig-card" data-state="' + state + '">';
      html +=   '<div class="sig-header">';
      html +=     '<span class="sig-serial">' + (serial !== '' ? '№' + escape(serial) : '') + '</span>';
      html +=     '<span class="sig-when">' + escape(s.signingTime || '') + '</span>';
      html +=   '</div>';
      html +=   '<div class="sig-state">' + escape(label) + '</div>';
      html +=   '<div class="sig-footer">';
      html +=     '<div class="sig-name">' + escape(fullName) + '</div>';
      if (s.operator) html += '<div class="sig-operator">' + escape(T.operator) + ': ' + escape(s.operator) + '</div>';
      if (s.ip)       html += '<div class="sig-ip">IP: ' + escape(s.ip) + '</div>';
      html +=   '</div>';
      html += '</div>';
    });
    return html + '</div>';
  }

  function render(detail) {
    const j = detail.json || {};
    const d = detail.document || {};
    let html = '';

    html += '<div class="header">';
    html += statusBadge(d.doc_status);
    html += '<h1>' + escape(d.name || '—') + '</h1>';
    html += '<span class="doctype">' + escape(docTypeName(d.doctype)) + '</span>';
    html += '</div>';
    html += '<div class="meta-row">'
      + escape(T.createdLabel) + escape(d.created || '—')
      + '  ·  ' + escape(T.updatedLabel) + escape(d.updated || '—')
      + '</div>';

    if (d.status_comment) {
      html += '<div class="status-comment">' + escape(d.status_comment) + '</div>';
    }

    html += '<div class="cards">';
    html += partyCard(T.seller, j.seller, j.sellertin);
    html += partyCard(T.buyer, j.buyer, j.buyertin);
    html += '</div>';

    html += metaCard(j);
    html += productsTable(j.productlist);
    html += signaturesSection(d.signature);

    contentEl.innerHTML = html;
  }

  fetch('/settings/documents/details?contextKey=' + encodeURIComponent(CONTEXT_KEY) + '&docId=' + encodeURIComponent(DOC_ID))
    .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(d)))
    .then(render)
    .catch(err => {
      console.error('Detail load failed', err);
      const msg = (err && err.error) || T.failed;
      contentEl.innerHTML = '<div class="error">' + escape(msg) + '</div>';
    });

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
