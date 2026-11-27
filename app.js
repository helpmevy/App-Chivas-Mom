'use strict';
const APP_VERSION = 'v7'; // <<< MỖI LẦN SỬA CODE: đổi số này (v8, v9...) rồi up GitHub. Hiện ở Cài đặt
const APP_BUILD = '27/11/2026'; // ngày cập nhật (sửa tay cho dễ nhớ)
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

// Tải file trực tiếp về máy (điện thoại hoặc máy tính)
function deliver(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast('Đã tải: ' + name);
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

const DEFAULTS = {
  shopName: 'Mẹ Chivas shop', phone: '84971365980', counter: 0,
  qr: '', // để trống = dùng ảnh qr.png đi kèm app; chọn ảnh khác trong Cài đặt sẽ lưu ở đây
  bankHolder: 'VU THI HIEN', bankAcc: '102869208889', bankName: 'VietinBank - CN VINH PHUC - HOI SO'
};
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
  ({ products: vProducts, cart: vCart, history: vHistory, stats: vStats, settings: vSettings })[tab]();
  updateBar();
}
function updateBar() {
  $('#cartBadge').textContent = sel.size || '';
  const b = $('#selbar');
  b.hidden = !(tab === 'products' && sel.size);
  b.textContent = `Đã chọn ${sel.size} · Tạo hóa đơn ›`;
}

/* --- Danh sách sản phẩm --- */
const hasCost = p => p.cost !== undefined && p.cost !== null && p.cost !== '' && !isNaN(p.cost);
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
      <div class="nm">${esc(p.name)}<small>${fmt(p.price)} đ${hasCost(p) ? ` <span class="mu">· nhập ${fmt(p.cost)} · lãi ${fmt(p.price - p.cost)}</span>` : ''}</small></div>
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
      <label class="f">Giá nhập (đ)</label><input id="pc" inputmode="numeric" value="${hasCost(p) ? p.cost : ''}">
      <label class="f">Giá xuất (đ) — giá in trên hóa đơn</label><input id="pp" inputmode="numeric" value="${p.price}">
      <div class="profit" id="pl"></div>
    </div>
    <div class="mf">${old ? '<button class="btn danger" id="del">Xóa</button>' : ''}<button class="btn" id="save">Lưu</button></div>`);
  const showImg = () => m.querySelector('#pimg').innerHTML = thumb(p);
  showImg();
  const num = sel => parseInt(m.querySelector(sel).value.replace(/\D/g, ''), 10);
  const calcProfit = () => {
    const c = num('#pc'), x = num('#pp'), box = m.querySelector('#pl');
    if (isNaN(x) || isNaN(c)) { box.textContent = 'Lợi nhuận: nhập giá nhập và giá xuất để xem'; box.className = 'profit'; return; }
    const l = x - c;
    box.textContent = `Lợi nhuận: ${fmt(l)} đ / sản phẩm` + (c ? ` (${(l / c * 100).toFixed(0)}% so với giá nhập)` : '');
    box.className = 'profit' + (l < 0 ? ' neg' : '');
  };
  m.querySelector('#pc').oninput = calcProfit; m.querySelector('#pp').oninput = calcProfit; calcProfit();
  m.querySelector('#pick').onclick = () => m.querySelector('#file').click();
  m.querySelector('#file').onchange = async e => { const f = e.target.files[0]; if (f) { p.img = await resizeImg(f); showImg(); } };
  m.querySelector('#noimg').onclick = () => { p.img = ''; showImg(); };
  m.querySelector('#save').onclick = async () => {
    p.name = m.querySelector('#pn').value.trim();
    p.price = num('#pp');
    const c = num('#pc'); if (isNaN(c)) delete p.cost; else p.cost = c;
    if (!p.name || isNaN(p.price)) return alert('Nhập tên và giá xuất sản phẩm');
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
  const items = cartItems().map(i => { const it = { name: i.p.name, price: i.price, qty: i.qty }; if (hasCost(i.p)) it.cost = i.p.cost; return it; });
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


/* --- Thống kê lợi nhuận --- */
let statMonth = 'all';
const monthKey = d => { const t = new Date(d); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; };
// lãi của 1 hóa đơn: chỉ tính các dòng có giá nhập (hóa đơn cũ tạo trước v7 chưa có giá nhập)
function invStat(v) {
  let profit = 0, qty = 0, unknown = 0;
  v.items.forEach(it => {
    qty += it.qty;
    if (it.cost === undefined) unknown++; else profit += (it.price - it.cost) * it.qty;
  });
  return { profit, qty, unknown };
}
function vStats() {
  $('#title').textContent = 'Thống kê lợi nhuận';
  if (!invoices.length) { $('#view').innerHTML = '<p class="empty">Chưa có hóa đơn nào để thống kê.</p>'; return; }
  const months = [...new Set(invoices.map(v => monthKey(v.date)))];
  if (statMonth !== 'all' && !months.includes(statMonth)) statMonth = 'all';
  const list = invoices.filter(v => statMonth === 'all' || monthKey(v.date) === statMonth);
  let rev = 0, prof = 0, qty = 0, unk = 0;
  list.forEach(v => { const s = invStat(v); rev += v.total; prof += s.profit; qty += s.qty; unk += s.unknown; });
  $('#view').innerHTML = `
    <select id="sm" class="sel"><option value="all">Tất cả thời gian</option>${months.map(k => `<option value="${k}"${k === statMonth ? ' selected' : ''}>Tháng ${k.slice(5)}/${k.slice(0, 4)}</option>`).join('')}</select>
    <div class="sumbox">
      <div><small>Số đơn</small><b>${list.length}</b></div>
      <div><small>Số sản phẩm</small><b>${fmt(qty)}</b></div>
      <div><small>Doanh thu</small><b>${fmt(rev)} đ</b></div>
      <div><small>Lợi nhuận</small><b class="${prof < 0 ? 'neg' : 'pos'}">${fmt(prof)} đ</b></div>
    </div>
    ${unk ? `<p class="hint">⚠️ ${unk} dòng sản phẩm thuộc hóa đơn cũ chưa có giá nhập nên không tính vào lợi nhuận.</p>` : ''}
    <div id="sl"></div>`;
  $('#sm').onchange = e => { statMonth = e.target.value; vStats(); };
  $('#sl').innerHTML = list.map(v => {
    const s = invStat(v);
    return `<div class="st" data-id="${v.id}">
      <div class="sth"><div class="nm">${v.code}${v.customer ? ' · ' + esc(v.customer) : ''}<small>${fdate(v.date)} · ${s.qty} sản phẩm · ${v.items.length} mặt hàng</small></div>
        <div class="sr"><b class="${s.profit < 0 ? 'neg' : 'pos'}">${s.unknown === v.items.length ? '—' : '+' + fmt(s.profit) + ' đ'}</b><small>Doanh thu ${fmt(v.total)} đ</small></div></div>
      <div class="std" hidden>${v.items.map(it => {
        const known = it.cost !== undefined, l = known ? (it.price - it.cost) : 0;
        return `<div class="sd"><div class="n">${esc(it.name)}<small>Nhập ${known ? fmt(it.cost) : '?'} · Xuất ${fmt(it.price)} · SL ${it.qty}</small></div>
          <div class="sr">${known ? `<b class="${l < 0 ? 'neg' : 'pos'}">${fmt(l * it.qty)} đ</b><small>${fmt(l)} đ/sp</small>` : '<small>chưa có giá nhập</small>'}</div></div>`;
      }).join('')}</div></div>`;
  }).join('') || '<p class="empty">Không có hóa đơn trong tháng này.</p>';
  $('#sl').onclick = e => { const h = e.target.closest('.sth'); if (h) h.nextElementSibling.hidden = !h.nextElementSibling.hidden; };
}

/* ---------- 4. Hóa đơn: giao diện, PDF, Excel ---------- */
// Chia hóa đơn thành các trang A5 giống mẫu: trang 1 có tiêu đề, trang cuối có tổng tiền + QR
// Mỗi dòng sản phẩm có chiều cao CỐ ĐỊNH (tên 1 dòng = 46px, tên 2 dòng = 64px) nên chia trang chính xác, không đè lên đầu/chân trang
function pagesHTML(inv) {
  const BUDGET = 494, HEAD_H = 135, TOTAL_H = 240; // chiều cao vùng nội dung / phần tiêu đề / phần tổng tiền + QR
  const rowH = (it, i) => (`${i + 1}. ${it.name}`.length > 44 ? 64 : 46);
  const pages = [[]]; let used = HEAD_H;
  inv.items.forEach((it, i) => {
    const h = rowH(it, i);
    if (used + h > BUDGET) { pages.push([]); used = 0; }
    pages[pages.length - 1].push({ it, i, h }); used += h;
  });
  if (used + TOTAL_H > BUDGET) pages.push([]); // không đủ chỗ cho tổng tiền → sang trang mới
  const n = pages.length, qty = inv.items.reduce((s, i) => s + i.qty, 0);
  return pages.map((c, pi) => {
    const head = pi ? '' : `
      <div class="ih"><h2>${esc(inv.shop)}</h2><div>SĐT: ${esc(inv.phone)}</div><h3>HOÁ ĐƠN THANH TOÁN</h3>
      <div class="im"><span>Ngày: ${fdate(inv.date)}</span></div>
      ${inv.customer ? `<div class="im"><span>Khách: ${esc(inv.customer)}</span></div>` : ''}</div>`;
    const rows = c.map(({ it, i, h }) => `
      <div class="ir h${h === 64 ? 2 : 1}"><div class="n">${i + 1}. ${esc(it.name)}</div>
      <div class="p"><span>${fmt(it.price)}</span><span>x${it.qty}</span><span>${fmt(it.price * it.qty)} đ</span></div></div>`).join('');
    const foot = pi < n - 1 ? '' : `
      <div class="it"><div class="l"><span>Tổng tiền ${qty} sản phẩm</span><span>${fmt(inv.total)} đ</span></div>
      <div class="tt"><span>Tổng tiền</span><span>${fmt(inv.total)} đ</span></div>
      <div class="qr"><img src="${settings.qr || 'qr.png'}" alt=""><div class="bk"><small>Mã QR Thanh toán</small><b>${esc(settings.bankHolder)}</b><span>Tài khoản: ${esc(settings.bankAcc)}</span><span>${esc(settings.bankName)}</span></div></div>
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
  m.querySelector('#bXls').onclick = () => exportXLSX(inv);
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

// Excel: file .xlsx đã định dạng sẵn (tiêu đề, cột, viền, số tiền, tổng, thông tin chuyển khoản + QR)
const loadScript = src => window.ExcelJS ? Promise.resolve() : new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src; s.onload = res;
  s.onerror = () => rej(new Error('Không tải được thư viện Excel (cần mạng lần đầu)')); document.head.appendChild(s);
});
const toDataURL = async src => {
  if (src.startsWith('data:')) return src;
  const blob = await (await fetch(src)).blob();
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
};
async function exportXLSX(inv) {
  toast('Đang tạo Excel…');
  try {
    await loadScript('lib/exceljs.min.js');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hóa đơn', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 6 }, { width: 46 }, { width: 14 }, { width: 8 }, { width: 16 }];
    const thin = { style: 'thin', color: { argb: 'FF9AA5A8' } }, box = { top: thin, left: thin, bottom: thin, right: thin };
    const TEAL = 'FF1B7F8C', money = '#,##0';
    const line = (text, o = {}) => { // một dòng gộp 5 cột, căn giữa
      const r = ws.addRow([text]); ws.mergeCells(r.number, 1, r.number, 5);
      r.getCell(1).font = { name: 'Arial', size: o.size || 11, bold: !!o.bold, italic: !!o.italic, color: { argb: o.color || 'FF000000' } };
      r.getCell(1).alignment = { horizontal: o.left ? 'left' : 'center', vertical: 'middle' };
      if (o.h) r.height = o.h; return r;
    };
    line(inv.shop, { size: 18, bold: true, color: TEAL, h: 28 });
    line('SĐT: ' + inv.phone);
    line('HOÁ ĐƠN THANH TOÁN', { size: 14, bold: true, h: 26 });
    line('Ngày: ' + fdate(inv.date), { left: true });
    if (inv.customer) line('Khách: ' + inv.customer, { left: true });
    ws.addRow([]);
    const hr = ws.addRow(['STT', 'Sản phẩm', 'Đơn giá', 'SL', 'Thành tiền']); hr.height = 22;
    hr.eachCell(c => { c.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.border = box; });
    const first = hr.number + 1;
    inv.items.forEach((it, i) => {
      const r = ws.addRow([i + 1, it.name, it.price, it.qty, { formula: `C${first + i}*D${first + i}`, result: it.price * it.qty }]);
      r.eachCell(c => { c.font = { name: 'Arial', size: 11 }; c.border = box; c.alignment = { vertical: 'middle', wrapText: true }; });
      r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }; r.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(3).numFmt = money; r.getCell(5).numFmt = money;
    });
    const last = first + inv.items.length - 1, qty = inv.items.reduce((s, i) => s + i.qty, 0);
    const tr = ws.addRow(['TỔNG CỘNG', '', '', { formula: `SUM(D${first}:D${last})`, result: qty }, { formula: `SUM(E${first}:E${last})`, result: inv.total }]);
    ws.mergeCells(tr.number, 1, tr.number, 3); tr.height = 24;
    tr.eachCell({ includeEmpty: true }, c => { c.font = { name: 'Arial', size: 12, bold: true }; c.border = box; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3D6' } }; c.alignment = { vertical: 'middle' }; });
    tr.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' }; tr.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' }; tr.getCell(5).numFmt = money;
    ws.addRow([]);
    line('Thông tin chuyển khoản', { bold: true, left: true });
    line('Chủ tài khoản: ' + settings.bankHolder, { left: true });
    line('Số tài khoản: ' + settings.bankAcc, { left: true });
    line('Ngân hàng: ' + settings.bankName, { left: true });
    const qrRow = ws.rowCount; // mã QR đặt ngay dưới thông tin chuyển khoản
    const dataUrl = await toDataURL(settings.qr || 'qr.png');
    const id = wb.addImage({ base64: dataUrl, extension: dataUrl.startsWith('data:image/png') ? 'png' : 'jpeg' });
    ws.addImage(id, { tl: { col: 1, row: qrRow + .3 }, ext: { width: 150, height: 150 } });
    for (let i = 0; i < 9; i++) ws.addRow([]);
    line('Xin cảm ơn, hẹn gặp lại', { italic: true });
    const buf = await wb.xlsx.writeBuffer();
    deliver(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), inv.code + '.xlsx');
  } catch (err) { alert('Lỗi tạo Excel: ' + err.message); }
}

/* ---------- 5. Cài đặt, sao lưu, khôi phục ---------- */
function vSettings() {
  $('#title').textContent = 'Cài đặt';
  $('#view').innerHTML = `
    <label class="f">Tên cửa hàng (hiện trên hóa đơn)</label><input id="sn" value="${esc(settings.shopName)}">
    <label class="f">Số điện thoại</label><input id="sp" value="${esc(settings.phone)}">
    <label class="f">Chủ tài khoản ngân hàng</label><input id="bh" value="${esc(settings.bankHolder)}">
    <label class="f">Số tài khoản</label><input id="ba" inputmode="numeric" value="${esc(settings.bankAcc)}">
    <label class="f">Ngân hàng / chi nhánh</label><input id="bn" value="${esc(settings.bankName)}">
    <label class="f">Ảnh mã QR thanh toán</label>
    <img class="qrprev" src="${settings.qr || 'qr.png'}" alt="">
    <div class="bar"><button class="btn alt" id="qrPick">Chọn ảnh QR khác</button>${settings.qr ? '<button class="btn danger" id="qrDel">Dùng QR mặc định</button>' : ''}</div>
    <input type="file" id="qrFile" accept="image/*" hidden>
    <button class="btn full" id="ss">Lưu cài đặt</button>
    <hr style="border:0;border-top:1px solid var(--bd);margin:22px 0">
    <b>Sao lưu & khôi phục</b>
    <p class="hint">Dữ liệu chỉ nằm trên máy này. Hãy sao lưu thường xuyên, nhất là trước khi xóa dữ liệu Safari hoặc đổi máy.</p>
    <button class="btn full" id="bk">💾 Sao lưu (file JSON)</button>
    <button class="btn alt full" id="rs">📂 Khôi phục từ file</button>
    <input type="file" id="rsFile" accept=".json,application/json" hidden>
    <p class="hint">iPhone: mở link bằng <b>Safari</b> → nút Chia sẻ → "Thêm vào MH chính" (bật "Mở dưới dạng Ứng dụng web"). Không dùng app Phím tắt vì chỉ tạo lối tắt mở trình duyệt.</p>
    <hr style="border:0;border-top:1px solid var(--bd);margin:22px 0">
    <b>Thông tin phiên bản</b>
    <p class="hint">Phiên bản đang chạy: <b>${APP_VERSION}</b> · cập nhật ${APP_BUILD}<br>Chế độ: ${isStandalone ? '✅ Đang chạy như ứng dụng' : '🌐 Đang mở trong trình duyệt'}</p>
    <button class="btn alt full" id="chk">🔄 Kiểm tra cập nhật</button>
    <p class="hint" id="chkR"></p>`;
  $('#chk').onclick = checkUpdate;
  $('#qrPick').onclick = () => $('#qrFile').click();
  $('#qrFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    settings.qr = await resizeImg(f, 500, 'image/png'); await saveSettings(); vSettings();
  };
  if (settings.qr) $('#qrDel').onclick = async () => { settings.qr = ''; await saveSettings(); vSettings(); };
  $('#ss').onclick = async () => {
    settings.shopName = $('#sn').value.trim() || DEFAULTS.shopName; settings.phone = $('#sp').value.trim();
    settings.bankHolder = $('#bh').value.trim(); settings.bankAcc = $('#ba').value.trim(); settings.bankName = $('#bn').value.trim();
    await saveSettings(); toast('Đã lưu cài đặt');
  };
  $('#bk').onclick = backup;
  $('#rs').onclick = () => $('#rsFile').click();
  $('#rsFile').onchange = e => e.target.files[0] && restore(e.target.files[0]);
}

const isStandalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
// so sánh phiên bản đang chạy với bản mới nhất trên GitHub
async function checkUpdate() {
  const r = $('#chkR'); r.textContent = 'Đang kiểm tra…';
  try {
    const t = await (await fetch('app.js?_=' + Date.now(), { cache: 'no-store' })).text();
    const v = (t.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
    if (!v) throw new Error('không đọc được');
    if (v === APP_VERSION) r.textContent = `✅ Đã là bản mới nhất (${v}).`;
    else { r.innerHTML = `⬆️ GitHub có bản <b>${v}</b>, máy đang chạy ${APP_VERSION}. <a id="rl" style="color:var(--c);font-weight:700">Bấm để cập nhật</a>`;
      $('#rl').onclick = async () => { (await navigator.serviceWorker?.getRegistration())?.update(); (await caches.keys()).forEach(k => caches.delete(k)); location.reload(); }; }
  } catch (e) { r.textContent = 'Không kiểm tra được (cần có mạng).'; }
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
