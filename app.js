'use strict';
/* =====================================================
   Mẹ Chivas - Quản lý sản phẩm & hóa đơn (PWA)
   Cấu trúc file: 1) Tiện ích  2) Cơ sở dữ liệu  3) Màn hình
   4) Hóa đơn / PDF / Excel  5) Cài đặt, sao lưu  6) Khởi động
   ===================================================== */

/* ---------- 1. Tiện ích ---------- */
const $ = s => document.querySelector(s);
const fmt = n => Number(n || 0).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
const pad = n => String(n).padStart(2, '0');
const fdate = d => { const t = new Date(d); return `${pad(t.getDate())}/${pad(t.getMonth() + 1)}/${t.getFullYear()} ${pad(t.getHours())}:${pad(t.getMinutes())}`; };
const thumb = p => `<div class="th">${p.img ? `<img src="${p.img}" alt="">` : '🧸'}</div>`;
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200); }

function modal(html) {
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="sheet">${html}</div>`;
  $('#modalRoot').appendChild(el);
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) el.remove(); });
  return el;
}

// Thu nhỏ ảnh trước khi lưu để nhẹ máy (ảnh chỉ nằm trong IndexedDB trên thiết bị)
const resizeImg = (file, max = 360, type = 'image/jpeg') => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      const x = c.getContext('2d');
      if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
      x.drawImage(im, 0, 0, c.width, c.height);
      res(c.toDataURL(type, .82));
    };
    im.onerror = rej; im.src = r.result;
  };
  r.onerror = rej; r.readAsDataURL(file);
});

// Chia sẻ (iPhone: bảng Chia sẻ → Lưu vào Tệp) hoặc tải xuống
async function deliver(blob, name, type) {
  const f = new File([blob], name, { type });
  if (navigator.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- 2. Cơ sở dữ liệu (IndexedDB) ---------- */
let db;
const openDB = () => new Promise((res, rej) => {
  const r = indexedDB.open('mechivas-db', 1);
  r.onupgradeneeded = () => {
    const d = r.result;
    d.createObjectStore('products', { keyPath: 'id' });
    d.createObjectStore('invoices', { keyPath: 'id' });
    d.createObjectStore('meta', { keyPath: 'key' });
  };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = (s, m = 'readonly') => db.transaction(s, m).objectStore(s);
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbAll = s => req(tx(s).getAll());
const dbPut = (s, v) => req(tx(s, 'readwrite').put(v));
const dbDel = (s, k) => req(tx(s, 'readwrite').delete(k));
const dbClear = s => req(tx(s, 'readwrite').clear());
const putMany = (s, arr) => new Promise((res, rej) => {
  const t = db.transaction(s, 'readwrite'), st = t.objectStore(s);
  arr.forEach(v => st.put(v)); t.oncomplete = res; t.onerror = () => rej(t.error);
});
const getMeta = async k => (await req(tx('meta').get(k)))?.value;
const setMeta = (k, v) => dbPut('meta', { key: k, value: v });

const DEFAULTS = { shopName: 'Mẹ Chivas shop', phone: '84971365980', qr: '', counter: 0 };
let settings = { ...DEFAULTS }, products = [], invoices = [];
const saveSettings = () => setMeta('settings', settings);
async function loadAll() {
  products = (await dbAll('products')).sort((a, b) => a.order - b.order);
  invoices = (await dbAll('invoices')).sort((a, b) => b.date - a.date);
}

/* ---------- 3. Màn hình ---------- */
let tab = 'products', q = '', custName = '';
const sel = new Map(); // id sản phẩm -> { qty, price }

function setTab(t) { tab = t; render(); }
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  ({ products: vProducts, cart: vCart, history: vHistory, settings: vSettings })[tab]();
  updateBar();
}
function updateBar() {
  $('#cartBadge').textContent = sel.size || '';
  const b = $('#selbar');
  b.hidden = !(tab === 'products' && sel.size);
  b.textContent = `Đã chọn ${sel.size} · Tạo hóa đơn ›`;
}

/* --- Danh sách sản phẩm --- */
const filtered = () => { const k = norm(q.trim()); return k ? products.filter(p => norm(p.name).includes(k)) : products; };
function vProducts() {
  $('#title').textContent = 'Sản phẩm';
  $('#view').innerHTML = `
    <div class="bar"><input id="q" type="search" placeholder="🔍 Tìm sản phẩm…" value="${esc(q)}"><button class="btn" id="add">＋ Thêm</button></div>
    <div class="sub"><span id="cnt"></span><span><a id="all">Chọn tất cả</a> · <a id="none">Bỏ chọn</a></span></div>
    <div id="list"></div>`;
  $('#q').oninput = e => { q = e.target.value; drawList(); };
  $('#add').onclick = () => editProduct();
  $('#all').onclick = () => { filtered().forEach(p => sel.has(p.id) || sel.set(p.id, { qty: 1, price: p.price })); drawList(); };
  $('#none').onclick = () => { filtered().forEach(p => sel.delete(p.id)); drawList(); };
  $('#list').onclick = e => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return editProduct(ed.dataset.edit);
    const r = e.target.closest('.row'); if (r) toggle(r.dataset.id);
  };
  drawList();
}
function drawList() {
  const rows = filtered();
  $('#cnt').textContent = `${rows.length} sản phẩm`;
  $('#list').innerHTML = rows.map(p => `
    <div class="row${sel.has(p.id) ? ' on' : ''}" data-id="${p.id}">
      <input type="checkbox" ${sel.has(p.id) ? 'checked' : ''}>${thumb(p)}
      <div class="nm">${esc(p.name)}<small>${fmt(p.price)} đ</small></div>
      <button class="ic" data-edit="${p.id}">✏️</button>
    </div>`).join('') || '<p class="empty">Không tìm thấy sản phẩm</p>';
  updateBar();
}
function toggle(id) {
  const p = products.find(x => x.id === id);
  sel.has(id) ? sel.delete(id) : sel.set(id, { qty: 1, price: p.price });
  const r = document.querySelector(`.row[data-id="${id}"]`);
  r.classList.toggle('on', sel.has(id)); r.querySelector('input').checked = sel.has(id);
  updateBar();
}

/* --- Thêm / sửa / xóa sản phẩm --- */
function editProduct(id) {
  const old = id && products.find(x => x.id === id);
  const p = old ? { ...old } : { id: uid(), name: '', price: '', img: '', order: 0 };
  const m = modal(`
    <div class="mh"><b>${old ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</b><button data-close>✕</button></div>
    <div class="mb">
      <label class="f">Ảnh (lưu trên máy)</label>
      <div style="display:flex;gap:10px;align-items:center"><div id="pimg"></div>
        <button class="btn alt" id="pick">Chọn ảnh</button><button class="btn danger" id="noimg">Xóa ảnh</button></div>
      <input type="file" id="file" accept="image/*" hidden>
      <label class="f">Tên sản phẩm</label><input id="pn" value="${esc(p.name)}">
      <label class="f">Giá (đ)</label><input id="pp" inputmode="numeric" value="${p.price}">
    </div>
    <div class="mf">${old ? '<button class="btn danger" id="del">Xóa</button>' : ''}<button class="btn" id="save">Lưu</button></div>`);
  const showImg = () => m.querySelector('#pimg').innerHTML = thumb(p);
  showImg();
  m.querySelector('#pick').onclick = () => m.querySelector('#file').click();
  m.querySelector('#file').onchange = async e => { const f = e.target.files[0]; if (f) { p.img = await resizeImg(f); showImg(); } };
  m.querySelector('#noimg').onclick = () => { p.img = ''; showImg(); };
  m.querySelector('#save').onclick = async () => {
    p.name = m.querySelector('#pn').value.trim();
    p.price = parseInt(m.querySelector('#pp').value.replace(/\D/g, ''), 10);
    if (!p.name || isNaN(p.price)) return alert('Nhập tên và giá sản phẩm');
    if (!old) p.order = Math.min(0, ...products.map(x => x.order)) - 1; // sản phẩm mới lên đầu
    await dbPut('products', p);
    await loadAll();
    if (sel.has(p.id)) sel.get(p.id).price = p.price;
    m.remove(); drawList(); toast('Đã lưu');
  };
  if (old) m.querySelector('#del').onclick = async () => {
    if (!confirm(`Xóa "${old.name}"? (Hóa đơn cũ vẫn giữ nguyên)`)) return;
    await dbDel('products', old.id); sel.delete(old.id);
    await loadAll(); m.remove(); drawList(); toast('Đã xóa');
  };
}

/* --- Giỏ hóa đơn: chỉnh số lượng, giá --- */
const cartItems = () => [...sel].map(([id, s]) => ({ p: products.find(x => x.id === id), qty: s.qty, price: s.price })).filter(i => i.p);
const cartRow = i => `
  <div class="ci" data-id="${i.p.id}">${thumb(i.p)}
    <div class="nm">${esc(i.p.name)}<div class="pr"><input class="pin" inputmode="numeric" value="${i.price}"> đ</div></div>
    <div class="qty"><button data-d="-1">−</button><b>${i.qty}</b><button data-d="1">＋</button></div>
    <button class="ic" data-rm>✕</button>
  </div>`;
function vCart() {
  $('#title').textContent = 'Tạo hóa đơn';
  const its = cartItems();
  if (!its.length) {
    $('#view').innerHTML = '<p class="empty">Chưa chọn sản phẩm nào.<br>Vào tab Sản phẩm và tick chọn nhé.</p><button class="btn full" id="go">Chọn sản phẩm</button>';
    $('#go').onclick = () => setTab('products'); return;
  }
  $('#view').innerHTML = `
    <input id="cust" placeholder="Tên khách (không bắt buộc)" value="${esc(custName)}" style="margin-bottom:10px">
    <div id="items">${its.map(cartRow).join('')}</div>
    <div class="total"><span id="tq"></span><b id="tt"></b></div>
    <button class="btn full" id="mk">🧾 Tạo hóa đơn</button>
    <button class="btn alt full" id="clr">Bỏ chọn tất cả</button>`;
  const calc = () => {
    const a = cartItems();
    $('#tq').textContent = `${a.reduce((s, i) => s + i.qty, 0)} sản phẩm`;
    $('#tt').textContent = fmt(a.reduce((s, i) => s + i.qty * i.price, 0)) + ' đ';
  };
  calc();
  $('#cust').oninput = e => custName = e.target.value;
  $('#items').onclick = e => {
    const row = e.target.closest('.ci'); if (!row) return;
    const s = sel.get(row.dataset.id);
    if (e.target.dataset.d) { s.qty = Math.max(1, s.qty + +e.target.dataset.d); row.querySelector('.qty b').textContent = s.qty; calc(); }
    if (e.target.dataset.rm !== undefined) { sel.delete(row.dataset.id); render(); }
  };
  $('#items').oninput = e => {
    if (!e.target.classList.contains('pin')) return;
    sel.get(e.target.closest('.ci').dataset.id).price = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0; calc();
  };
  $('#clr').onclick = () => { sel.clear(); render(); };
  $('#mk').onclick = createInvoice;
}

async function createInvoice() {
  const items = cartItems().map(i => ({ name: i.p.name, price: i.price, qty: i.qty }));
  settings.counter++; await saveSettings();
  const inv = {
    id: uid(), code: 'HD' + String(settings.counter).padStart(4, '0'), date: Date.now(),
    customer: custName.trim(), shop: settings.shopName, phone: settings.phone, items,
    total: items.reduce((s, i) => s + i.qty * i.price, 0)
  };
  await dbPut('invoices', inv); invoices.unshift(inv);
  sel.clear(); custName = ''; render(); openInvoice(inv);
}

/* --- Lịch sử --- */
function vHistory() {
  $('#title').textContent = 'Lịch sử hóa đơn';
  if (!invoices.length) { $('#view').innerHTML = '<p class="empty">Chưa có hóa đơn nào.</p>'; return; }
  $('#view').innerHTML = `<div class="sub"><span>${invoices.length} hóa đơn</span></div>` + invoices.map(v => `
    <div class="hi" data-id="${v.id}">
      <div class="nm">${v.code}${v.customer ? ' · ' + esc(v.customer) : ''}<small>${fdate(v.date)} · ${v.items.length} mặt hàng</small></div>
      <b>${fmt(v.total)} đ</b>
    </div>`).join('');
  $('#view').onclick = e => { const r = e.target.closest('.hi'); if (r) openInvoice(invoices.find(x => x.id === r.dataset.id)); };
}

/* ---------- 4. Hóa đơn: giao diện, PDF, Excel ---------- */
// Chia hóa đơn thành các trang A5 giống mẫu: trang 1 có tiêu đề, trang cuối có tổng tiền + QR
function pagesHTML(inv) {
  const FIRST = 9, NEXT = 12, TOTAL_ROOM = 6;
  const chunks = [inv.items.slice(0, FIRST)];
  for (let i = FIRST; i < inv.items.length; i += NEXT) chunks.push(inv.items.slice(i, i + NEXT));
  const cap = chunks.length === 1 ? FIRST : NEXT;
  if (chunks[chunks.length - 1].length > cap - TOTAL_ROOM) chunks.push([]);
  const n = chunks.length, qty = inv.items.reduce((s, i) => s + i.qty, 0);
  let idx = 0;
  return chunks.map((c, pi) => {
    const head = pi ? '' : `
      <div class="ih"><h2>${esc(inv.shop)}</h2><div>SĐT: ${esc(inv.phone)}</div><h3>HOÁ ĐƠN THANH TOÁN</h3>
      <div class="im"><span>Hoá đơn: ${inv.code}</span><span>Ngày: ${fdate(inv.date)}</span></div>
      ${inv.customer ? `<div class="im"><span>Khách: ${esc(inv.customer)}</span></div>` : ''}</div>`;
    const rows = c.map(it => `
      <div class="ir"><div class="n">${++idx}. ${esc(it.name)}</div>
      <div class="p"><span>${fmt(it.price)}</span><span>x${it.qty}</span><span>${fmt(it.price * it.qty)} đ</span></div></div>`).join('');
    const foot = pi < n - 1 ? '' : `
      <div class="it"><div class="l"><span>Tổng tiền ${qty} sản phẩm</span><span>${fmt(inv.total)} đ</span></div>
      <div class="tt"><span>Tổng tiền</span><span>${fmt(inv.total)} đ</span></div>
      <div class="qr">${settings.qr ? `<img src="${settings.qr}" alt="">` : '<div class="qrph">QR</div>'}<div>Mã QR Thanh toán</div></div>
      <div class="thx">Xin cảm ơn, hẹn gặp lại</div></div>`;
    return `<div class="ipage">${head}<div class="icols"><span>Sản phẩm</span><span>SL</span><span>T.TIỀN</span></div>${rows}${foot}
      <div class="if"><span>${esc(inv.shop)} — Hoá đơn thanh toán</span><span>Page ${pi + 1} of ${n}</span></div></div>`;
  });
}

function openInvoice(inv) {
  const m = modal(`
    <div class="mh"><b>${inv.code} · ${fmt(inv.total)} đ</b><button data-close>✕</button></div>
    <div class="mb" id="pv"></div>
    <div class="mf"><button class="btn" id="bPdf">📄 PDF</button><button class="btn alt" id="bXls">📊 Excel</button><button class="btn danger" id="bDel">Xóa</button></div>`);
  const pv = m.querySelector('#pv'), s = Math.min(1, (pv.clientWidth || 360) / 420);
  pv.innerHTML = pagesHTML(inv).map(h => `<div class="pw" style="width:${420 * s}px;height:${594 * s}px"><div style="transform:scale(${s});transform-origin:0 0;width:420px">${h}</div></div>`).join('');
  m.querySelector('#bPdf').onclick = async e => {
    e.target.disabled = true; toast('Đang tạo PDF…');
    try { await deliver(await makePDF(inv), inv.code + '.pdf', 'application/pdf'); } catch (err) { alert('Lỗi tạo PDF: ' + err.message); }
    e.target.disabled = false;
  };
  m.querySelector('#bXls').onclick = () => exportCSV(inv);
  m.querySelector('#bDel').onclick = async () => {
    if (!confirm(`Xóa hóa đơn ${inv.code}?`)) return;
    await dbDel('invoices', inv.id); invoices = invoices.filter(x => x.id !== inv.id);
    m.remove(); if (tab === 'history') render(); toast('Đã xóa hóa đơn');
  };
}

// PDF: dựng từng trang A5 ngoài màn hình rồi chụp thành ảnh (giữ đúng tiếng Việt có dấu)
async function makePDF(inv) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-10000px;top:0';
  box.innerHTML = pagesHTML(inv).join('');
  document.body.appendChild(box);
  try {
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: [148, 210] });
    const pages = box.querySelectorAll('.ipage');
    for (let i = 0; i < pages.length; i++) {
      const c = await html2canvas(pages[i], { scale: 2, backgroundColor: '#fff' });
      if (i) pdf.addPage([148, 210]);
      pdf.addImage(c.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, 148, 210);
    }
    return pdf.output('blob');
  } finally { box.remove(); }
}

// Excel: file CSV (mở bằng Excel, Numbers, Google Sheets), có BOM để không lỗi tiếng Việt
function exportCSV(inv) {
  const rows = [
    ['STT', 'Sản phẩm', 'Đơn giá', 'SL', 'Thành tiền'],
    ...inv.items.map((it, i) => [i + 1, it.name, it.price, it.qty, it.price * it.qty]),
    ['', 'TỔNG', '', inv.items.reduce((s, i) => s + i.qty, 0), inv.total]
  ];
  const text = '\ufeff' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  deliver(new Blob([text], { type: 'text/csv;charset=utf-8' }), inv.code + '.csv', 'text/csv');
}

/* ---------- 5. Cài đặt, sao lưu, khôi phục ---------- */
function vSettings() {
  $('#title').textContent = 'Cài đặt';
  $('#view').innerHTML = `
    <label class="f">Tên cửa hàng (hiện trên hóa đơn)</label><input id="sn" value="${esc(settings.shopName)}">
    <label class="f">Số điện thoại</label><input id="sp" value="${esc(settings.phone)}">
    <label class="f">Ảnh mã QR thanh toán</label>
    ${settings.qr ? `<img class="qrprev" src="${settings.qr}" alt="">` : '<p class="hint">Chưa có ảnh QR.</p>'}
    <div class="bar"><button class="btn alt" id="qrPick">Chọn ảnh QR</button>${settings.qr ? '<button class="btn danger" id="qrDel">Xóa QR</button>' : ''}</div>
    <input type="file" id="qrFile" accept="image/*" hidden>
    <button class="btn full" id="ss">Lưu cài đặt</button>
    <hr style="border:0;border-top:1px solid var(--bd);margin:22px 0">
    <b>Sao lưu & khôi phục</b>
    <p class="hint">Dữ liệu chỉ nằm trên máy này. Hãy sao lưu thường xuyên, nhất là trước khi xóa dữ liệu Safari hoặc đổi máy.</p>
    <button class="btn full" id="bk">💾 Sao lưu (file JSON)</button>
    <button class="btn alt full" id="rs">📂 Khôi phục từ file</button>
    <input type="file" id="rsFile" accept=".json,application/json" hidden>
    <p class="hint">iPhone: mở bằng Safari → nút Chia sẻ → "Thêm vào MH chính" để dùng như ứng dụng, chạy được khi không có mạng.</p>`;
  $('#qrPick').onclick = () => $('#qrFile').click();
  $('#qrFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    settings.qr = await resizeImg(f, 500, 'image/png'); await saveSettings(); vSettings();
  };
  if (settings.qr) $('#qrDel').onclick = async () => { settings.qr = ''; await saveSettings(); vSettings(); };
  $('#ss').onclick = async () => {
    settings.shopName = $('#sn').value.trim() || DEFAULTS.shopName; settings.phone = $('#sp').value.trim();
    await saveSettings(); toast('Đã lưu cài đặt');
  };
  $('#bk').onclick = backup;
  $('#rs').onclick = () => $('#rsFile').click();
  $('#rsFile').onchange = e => e.target.files[0] && restore(e.target.files[0]);
}

function backup() {
  const d = { app: 'mechivas', version: 1, exported: new Date().toISOString(), settings, products, invoices };
  const t = new Date();
  deliver(new Blob([JSON.stringify(d)], { type: 'application/json' }),
    `mechivas-backup-${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}.json`, 'application/json');
}

async function restore(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.products) || !Array.isArray(d.invoices)) throw new Error('bad');
    if (!confirm('Khôi phục sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại. Tiếp tục?')) return;
    await dbClear('products'); await dbClear('invoices');
    await putMany('products', d.products); await putMany('invoices', d.invoices);
    settings = { ...DEFAULTS, ...d.settings }; await saveSettings(); await setMeta('seeded', 1);
    sel.clear(); await loadAll(); render(); toast('Đã khôi phục dữ liệu');
  } catch (e) { alert('File sao lưu không hợp lệ'); }
}

/* ---------- 6. Khởi động ---------- */
(async () => {
  db = await openDB();
  navigator.storage?.persist?.(); // xin trình duyệt không tự xóa dữ liệu
  settings = { ...DEFAULTS, ...((await getMeta('settings')) || {}) };
  if (!(await getMeta('seeded'))) { // lần đầu: nạp 135 sản phẩm mẫu
    await putMany('products', SEED_PRODUCTS.map(([name, price], i) => ({ id: 's' + (i + 1), name, price, img: '', order: i + 1 })));
    await setMeta('seeded', 1);
  }
  await loadAll();
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
  $('#selbar').onclick = () => setTab('cart');
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();
