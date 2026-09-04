const quickLinksData = [
  { label: 'Google', url: 'https://www.google.com' },
  { label: 'YouTube', url: 'https://www.youtube.com' },
  { label: 'Wikipedia', url: 'https://www.wikipedia.org' },
  { label: 'X', url: 'https://x.com' },
];

let state = {
  view: 'home',
  incognito: false,
  bookmarks: JSON.parse(localStorage.getItem('elephant_bookmarks') || '[]'),
  history: JSON.parse(localStorage.getItem('elephant_history') || '[]'),
};

if (state.bookmarks.length === 0) {
  state.bookmarks = quickLinksData.map(q => ({ title: q.label, url: q.url }));
  saveBookmarks();
}

function saveBookmarks() {
  localStorage.setItem('elephant_bookmarks', JSON.stringify(state.bookmarks));
}
function saveHistory() {
  localStorage.setItem('elephant_history', JSON.stringify(state.history));
}

// ---------- IndexedDB: almacenamiento privado de descargas ----------
let dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open('elephant_downloads_db', 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore('downloads', { keyPath: 'id' });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function dbAll() {
  const db = await dbPromise;
  return new Promise((resolve) => {
    const tx = db.transaction('downloads', 'readonly');
    const store = tx.objectStore('downloads');
    const items = [];
    store.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { items.push(cursor.value); cursor.continue(); }
      else resolve(items.sort((a, b) => b.createdAt - a.createdAt));
    };
  });
}
async function dbPut(item) {
  const db = await dbPromise;
  return new Promise((resolve) => {
    const tx = db.transaction('downloads', 'readwrite');
    tx.objectStore('downloads').put(item);
    tx.oncomplete = () => resolve();
  });
}
async function dbDelete(id) {
  const db = await dbPromise;
  return new Promise((resolve) => {
    const tx = db.transaction('downloads', 'readwrite');
    tx.objectStore('downloads').delete(id);
    tx.oncomplete = () => resolve();
  });
}

// ---------- Navegación entre vistas ----------
function showView(name) {
  state.view = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  if (name === 'downloads') renderDownloads();
  if (name === 'bookmarks') renderBookmarks();
  if (name === 'history') renderHistory();
  if (name === 'settings') {
    document.getElementById('incognitoState').textContent = state.incognito ? 'Activado' : 'Desactivado';
  }
}

function navigateTo(rawInput) {
  let url = rawInput.trim();
  if (!/^https?:\/\//i.test(url)) {
    if (url.includes('.') && !url.includes(' ')) url = 'https://' + url;
    else url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
  }
  document.getElementById('addressInput').value = url;
  document.getElementById('frameFallback').classList.add('hidden');
  document.getElementById('browseFrame').classList.remove('hidden');

  const frame = document.getElementById('browseFrame');
  window._pendingExternalUrl = url;
  frame.src = '/proxy?url=' + encodeURIComponent(url);

  if (!state.incognito) {
    state.history.unshift({ title: url, url, at: Date.now() });
    state.history = state.history.slice(0, 100);
    saveHistory();
  }

  showView('browse');
}

// ---------- Render de listas ----------
function renderQuickLinks() {
  const el = document.getElementById('quicklinks');
  el.innerHTML = '';
  quickLinksData.forEach(q => {
    const btn = document.createElement('button');
    btn.className = 'quicklink';
    btn.innerHTML = `<span class="circle">${q.label[0]}</span><span>${q.label}</span>`;
    btn.onclick = () => navigateTo(q.url);
    el.appendChild(btn);
  });
}

function renderBookmarks() {
  const el = document.getElementById('bookmarksList');
  el.innerHTML = '';
  state.bookmarks.forEach((bm, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<div class="meta"><div class="title">${bm.title}</div><div class="sub">${bm.url}</div></div>`;
    const del = document.createElement('button');
    del.textContent = 'Quitar';
    del.onclick = (e) => { e.stopPropagation(); state.bookmarks.splice(i, 1); saveBookmarks(); renderBookmarks(); };
    row.appendChild(del);
    row.onclick = () => navigateTo(bm.url);
    el.appendChild(row);
  });
}

function renderHistory() {
  const el = document.getElementById('historyList');
  el.innerHTML = '';
  state.history.forEach(h => {
    const row = document.createElement('div');
    row.className = 'item-row';
    const time = new Date(h.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `<div class="meta"><div class="title">${h.title}</div><div class="sub">${time}</div></div>`;
    row.onclick = () => navigateTo(h.url);
    el.appendChild(row);
  });
}

async function renderDownloads() {
  const el = document.getElementById('downloadsList');
  el.innerHTML = '';
  const items = await dbAll();
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'item-row';
    const sizeKb = (item.blob.size / 1024).toFixed(0);
    row.innerHTML = `<div class="meta"><div class="title">${item.name}</div><div class="sub">${sizeKb} KB · ${item.saved ? 'Guardado en el dispositivo' : 'Solo en Elephant'}</div></div>`;

    if (item.saved) {
      const tag = document.createElement('span');
      tag.className = 'saved';
      tag.textContent = '✓';
      row.appendChild(tag);
    } else {
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Guardar al dispositivo';
      saveBtn.onclick = () => exportToDevice(item);
      row.appendChild(saveBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Eliminar';
    delBtn.onclick = async () => { await dbDelete(item.id); renderDownloads(); };
    row.appendChild(delBtn);

    el.appendChild(row);
  });
}

// ---------- Descargar a almacenamiento privado (no toca la galería) ----------
async function fetchMediaToPrivateStorage(url, opts) {
  opts = opts || {};
  const status = document.getElementById('fetchStatus');
  if (status) status.textContent = 'Descargando...';
  try {
    const proxied = '/fetch-media?url=' + encodeURIComponent(url);
    const res = await fetch(proxied);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const name = url.split('/').pop().split('?')[0] || ('archivo_' + Date.now());
    await dbPut({ id: 'dl_' + Date.now(), name, blob, sourceUrl: url, saved: false, createdAt: Date.now() });
    if (status) status.textContent = 'Guardado dentro de Elephant.';
    renderDownloads();
    if (opts.fromPage) showToast('Descargado: ' + name);
  } catch (err) {
    if (status) status.textContent = 'No se pudo descargar.';
    if (opts.fromPage) showToast('No se pudo descargar ese archivo');
  }
}

function showToast(msg) {
  let toast = document.getElementById('elephantToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'elephantToast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// El proxy inyecta un botón de descarga sobre cada imagen/video de la página cargada,
// e intercepta clics en enlaces y buscadores para que sigan pasando por el proxy.
// Todo nos llega por postMessage (misma app, distinto documento).
window.addEventListener('message', (e) => {
  if (e.origin !== window.location.origin || !e.data) return;
  if (e.data.type === 'elephant-download' && e.data.url) {
    fetchMediaToPrivateStorage(e.data.url, { fromPage: true });
  } else if (e.data.type === 'elephant-navigate' && e.data.url) {
    if (e.data.newWindow) {
      window.open('/proxy?url=' + encodeURIComponent(e.data.url), '_blank');
    } else {
      navigateTo(e.data.url);
    }
  }
});

// ---------- Exportar de verdad al dispositivo (Galería/Descargas del sistema) ----------
function exportToDevice(item) {
  const url = URL.createObjectURL(item.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = item.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  item.saved = true;
  dbPut(item).then(renderDownloads);
}

// ---------- Eventos ----------
document.getElementById('addressInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') navigateTo(e.target.value);
});
document.getElementById('btnReload').addEventListener('click', () => {
  const frame = document.getElementById('browseFrame');
  if (frame.src) frame.src = frame.src;
});
document.getElementById('btnBack').addEventListener('click', () => showView('home'));
document.getElementById('btnOpenExternal').addEventListener('click', () => {
  window.open(window._pendingExternalUrl, '_blank');
});
document.getElementById('btnOpenExternalTop').addEventListener('click', () => {
  if (window._pendingExternalUrl) window.open(window._pendingExternalUrl, '_blank');
});
document.getElementById('btnFetchMedia').addEventListener('click', () => {
  const val = document.getElementById('mediaUrlInput').value.trim();
  if (val) fetchMediaToPrivateStorage(val);
});
document.getElementById('btnClearHistory').addEventListener('click', () => {
  state.history = [];
  saveHistory();
  renderHistory();
});
document.getElementById('btnIncognito').addEventListener('click', (e) => {
  state.incognito = !state.incognito;
  e.target.classList.toggle('on', state.incognito);
});
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

renderQuickLinks();
showView('home');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
    }
