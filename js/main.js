'use strict';
/* Estrategias de calidez parental – foro de videos. Sitio estático: los datos viven en localStorage (demo).
   Decisiones: videos por enlace (YouTube/Vimeo/MP4); comentar y calificar requiere registro. */

const KEY = 'calidez.db.v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => { let h = 5381; for (const c of s + 'calidez-salt') h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };
const uid = () => Math.random().toString(36).slice(2, 10);

function seed() {
  return {
    users: [{ id: 'u-admin', name: 'Administración', email: 'admin@calidezparental.com', pass: hash('admin123'), role: 'admin' }],
    videos: [], ratings: [], comments: [], session: null,
  };
}
let db;
try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { toast('No se pudo guardar'); } };
save();

/* Videos compartidos: viven en videos.json del repositorio; los locales solo en este navegador */
let remote = [];
const vids = () => [...remote, ...db.videos.filter(v => !remote.some(r => r.id === v.id))];
const getViews = v => v.shared ? ((db.rviews || {})[v.id] || 0) : v.views;
const addView = v => { if (v.shared) { db.rviews = db.rviews || {}; db.rviews[v.id] = getViews(v) + 1; } else v.views++; };
const loadRemote = () => {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
  return fetch('videos.json?t=' + Date.now(), { signal: ctl.signal }).then(r => r.ok ? r.json() : []).catch(() => []).finally(() => clearTimeout(t))
    .then(l => { remote = (Array.isArray(l) ? l : []).map(v => ({ ...v, shared: true })); });
};

const me = () => db.users.find(u => u.id === db.session) || null;
const isAdmin = () => me()?.role === 'admin';
const rate = id => { const r = db.ratings.filter(x => x.vid === id); return { n: r.length, avg: r.length ? r.reduce((a, b) => a + b.score, 0) / r.length : 0 }; };
const ncom = id => db.comments.filter(c => c.vid === id && !c.hidden).length;
const starsStr = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const ago = t => { const m = (Date.now() - t) / 6e4; if (m < 1) return 'ahora'; if (m < 60) return `hace ${m | 0} min`; if (m < 1440) return `hace ${m / 60 | 0} h`; return `hace ${m / 1440 | 0} d`; };
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2400); }

/* Videos subidos como archivo: el Blob vive en IndexedDB y el registro guarda url 'idb:<id>' */
const isLocal = url => url.startsWith('idb:');
const idb = () => new Promise((ok, fail) => {
  const r = indexedDB.open('calidez-files', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('videos');
  r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
});
const idbRun = (mode, fn) => idb().then(d => new Promise((ok, fail) => {
  const tx = d.transaction('videos', mode), req = fn(tx.objectStore('videos'));
  tx.oncomplete = () => ok(req.result); tx.onerror = tx.onabort = () => fail(tx.error);
}));
const putBlob = (id, blob) => idbRun('readwrite', s => s.put(blob, id));
const getBlob = id => idbRun('readonly', s => s.get(id));
const delBlob = id => idbRun('readwrite', s => s.delete(id)).catch(() => {});
const thumbFromFile = file => new Promise(res => {
  const url = URL.createObjectURL(file), v = document.createElement('video');
  v.muted = true; v.preload = 'metadata'; v.src = url;
  const done = d => { URL.revokeObjectURL(url); res(d); };
  v.onerror = () => done('');
  v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 4); };
  v.onseeked = () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 640, 360);
    const k = Math.min(640 / v.videoWidth, 360 / v.videoHeight), w = v.videoWidth * k, h = v.videoHeight * k;
    x.drawImage(v, (640 - w) / 2, (360 - h) / 2, w, h);
    try { done(c.toDataURL('image/jpeg', 0.7)); } catch { done(''); }
  };
});
let objUrl;
async function loadLocalVideo(v) {
  const el = document.querySelector('video[data-idb]'); if (!el) return;
  try {
    const blob = await getBlob(v.url.slice(4));
    if (!blob) throw 0;
    if (objUrl) URL.revokeObjectURL(objUrl);
    el.src = objUrl = URL.createObjectURL(blob);
  } catch { el.parentElement.innerHTML = '<p class="center muted" style="padding:3rem">El archivo de este video no está disponible en este navegador.</p>'; }
}

/* Publicación en GitHub mediante un token de acceso limitado (se guarda solo en este navegador) */
const GH_KEY = 'calidez.gh', MAX_MB = 95;
const ghCfg = () => { try { return JSON.parse(localStorage.getItem(GH_KEY)) || {}; } catch { return {}; } };
const ghReady = () => { const c = ghCfg(); return !!(c.token && c.owner && c.repo); };
const ghFetch = async (path, opt = {}) => {
  const c = ghCfg();
  const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/${path}`, { ...opt, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + c.token, ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!r.ok && r.status !== 404) throw new Error(r.status === 401 || r.status === 403 ? 'GitHub rechazó el token (revisa permisos o caducidad)' : `GitHub respondió ${r.status}`);
  return r;
};
const toB64 = blob => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = () => fail(r.error); r.readAsDataURL(blob); });
const utf8b64 = t => btoa(unescape(encodeURIComponent(t)));
const b64utf8 = b => decodeURIComponent(escape(atob(b.replace(/\n/g, ''))));
const ghSha = async path => { const r = await ghFetch(`contents/${path}`); return r.status === 404 ? null : (await r.json()).sha; };
async function ghPut(path, b64, message) {
  const sha = await ghSha(path);
  await ghFetch(`contents/${path}`, { method: 'PUT', body: JSON.stringify({ message, content: b64, ...(sha ? { sha } : {}) }) });
}
async function ghDelete(path) {
  const sha = await ghSha(path); if (!sha) return;
  await ghFetch(`contents/${path}`, { method: 'DELETE', body: JSON.stringify({ message: 'Elimina ' + path, sha }) });
}
async function ghUpdateList(mutate, message) {
  for (let i = 0; i < 3; i++) {
    const r = await ghFetch('contents/videos.json'); let list = [], sha;
    if (r.status !== 404) { const j = await r.json(); sha = j.sha; try { list = JSON.parse(b64utf8(j.content)); } catch { list = []; } }
    const next = mutate(Array.isArray(list) ? list : []);
    const w = await fetch(`https://api.github.com/repos/${ghCfg().owner}/${ghCfg().repo}/contents/videos.json`, { method: 'PUT', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + ghCfg().token, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: utf8b64(JSON.stringify(next, null, 2)), ...(sha ? { sha } : {}) }) });
    if (w.ok) return; if (w.status !== 409 && w.status !== 422) throw new Error(`GitHub respondió ${w.status}`);
  }
  throw new Error('No se pudo actualizar la lista de videos, intenta de nuevo');
}

function embed(url) {
  let m;
  if (isLocal(url)) return `<video controls data-idb="1"></video>`;
  if (/^videos\/[\w.-]+\.(mp4|webm|ogg|mov)$/i.test(url)) return `<video src="${esc(url)}" controls></video>`;
  if ((m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/))) return `<iframe src="https://www.youtube.com/embed/${m[1]}" allowfullscreen allow="accelerometer; encrypted-media; picture-in-picture" title="Video"></iframe>`;
  if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return `<iframe src="https://player.vimeo.com/video/${m[1]}" allowfullscreen title="Video"></iframe>`;
  if (/^https?:\/\/.+\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) return `<video src="${esc(url)}" controls></video>`;
  return null;
}
const ytThumb = url => { const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/); return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : ''; };

/* ---------- navegación ---------- */
function renderNav() {
  const u = me();
  $('#nav').innerHTML = u
    ? `${isAdmin() ? '<a class="btn sm" href="#/admin">Panel de administración</a>' : ''}<span class="muted">${esc(u.name.split(' ')[0])}</span><button class="btn sm" id="out">Salir</button>`
    : '<a class="btn sm" href="#/login">Iniciar sesión</a><a class="btn sm primary" href="#/register">Registrarse</a>';
  $('#out')?.addEventListener('click', () => { db.session = null; save(); location.hash = '#/'; route(); toast('Sesión cerrada'); });
}

/* ---------- vistas ---------- */
let filter = { q: '', cat: 'Todas', sort: 'recent' };
function home() {
  const cats = ['Todas', ...new Set(vids().map(v => v.cat))];
  let list = vids().filter(v => (filter.cat === 'Todas' || v.cat === filter.cat) && (v.title + v.desc).toLowerCase().includes(filter.q.toLowerCase()));
  const key = { recent: v => -v.date, views: v => -getViews(v), rated: v => -rate(v.id).avg }[filter.sort];
  list.sort((a, b) => key(a) - key(b));
  $('#app').innerHTML = `
    <section class="hero"><div class="eyebrow">Recursos audiovisuales</div><h1>Estrategias de calidez parental</h1><p>Videos educativos para comprender y fortalecer el vínculo afectivo entre cuidadores e hijos. Revisa el material, valóralo y comparte tus reflexiones con la comunidad.</p></section>
    <div class="toolbar"><input id="q" placeholder="Buscar videos…" value="${esc(filter.q)}">
      <select id="sort"><option value="recent">Más recientes</option><option value="views">Más vistos</option><option value="rated">Mejor calificados</option></select></div>
    <div class="chips">${cats.map(c => `<span class="chip ${c === filter.cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</span>`).join('')}</div>
    ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : `<div class="empty">${vids().length ? 'No hay videos que coincidan con la búsqueda.' : 'Aún no hay videos publicados. El administrador puede agregarlos desde el panel.'}</div>`}`;
  $('#sort').value = filter.sort;
  $('#q').addEventListener('input', e => { filter.q = e.target.value; const p = e.target.selectionStart; home(); const q = $('#q'); q.focus(); q.setSelectionRange(p, p); });
  $('#sort').addEventListener('change', e => { filter.sort = e.target.value; home(); });
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { filter.cat = c.dataset.c; home(); }));
}
function card(v) {
  const r = rate(v.id);
  return `<a class="card" href="#/video/${v.id}"><div class="thumb"><img loading="lazy" src="${esc(v.thumb)}" alt="${esc(v.title)}" onerror="this.style.display='none'"><span class="tag">${esc(v.cat)}</span><span class="play">▶</span></div>
    <div class="info"><h3>${esc(v.title)}</h3><div class="meta"><span class="stars">${starsStr(r.avg)}</span><span>${r.avg ? r.avg.toFixed(1) : 'Sin votos'}</span><span>${getViews(v)} reprod.</span><span>${ncom(v.id)} comentarios</span></div></div></a>`;
}

let sortC = 'recent';
function watch(id, count = true) {
  const v = vids().find(x => x.id === id);
  if (!v) { $('#app').innerHTML = '<p class="center muted">Video no encontrado. <a href="#/">Volver</a></p>'; return; }
  if (count) { addView(v); save(); }
  const u = me(), r = rate(id), mine = u && db.ratings.find(x => x.vid === id && x.uid === u.id);
  const likes = c => (c.likes || []).length;
  let top = db.comments.filter(c => c.vid === id && !c.parent && (isAdmin() || !c.hidden));
  top.sort(sortC === 'recent' ? (a, b) => b.date - a.date : (a, b) => likes(b) - likes(a) || b.date - a.date);
  const cm = (c, reply) => {
    const au = db.users.find(x => x.id === c.uid);
    return `<div class="${reply ? 'reply ' : ''}comment"><div class="avatar">${esc((au?.name || '?')[0].toUpperCase())}</div><div class="body">
      <div><span class="who">${esc(au?.name || 'Anónimo')}${au?.role === 'admin' ? ' · Administración' : ''}</span><span class="when">${ago(c.date)}</span></div>
      <p class="${c.hidden ? 'hidden-c' : ''}">${c.hidden ? '[Comentario oculto por moderación] ' : ''}${esc(c.text)}</p>
      <div class="actions"><button class="btn sm" data-like="${c.id}">Me gusta · ${likes(c)}</button>
      ${!reply && u ? `<button class="btn sm" data-reply="${c.id}">Responder</button>` : ''}
      ${isAdmin() ? `<button class="btn sm" data-hide="${c.id}">${c.hidden ? 'Mostrar' : 'Ocultar'}</button><button class="btn sm danger" data-del="${c.id}">Eliminar</button>` : ''}</div>
      <div id="rf-${c.id}"></div></div></div>
      ${reply ? '' : db.comments.filter(x => x.parent === c.id && (isAdmin() || !x.hidden)).sort((a, b) => a.date - b.date).map(x => cm(x, true)).join('')}`;
  };
  $('#app').innerHTML = `<p><a class="muted" href="#/">← Volver al inicio</a></p>
  <div class="watch"><div>
    <div class="player">${embed(v.url) || '<p class="center muted" style="padding:3rem">No se pudo cargar el video.</p>'}</div>
    <h1 class="title">${esc(v.title)}</h1>
    <div class="meta"><span class="tag" style="position:static">${esc(v.cat)}</span><span>${getViews(v)} reproducciones</span><span>Publicado el ${new Date(v.date).toLocaleDateString('es')}</span></div>
    <div class="panel" style="margin-top:1rem"><p>${esc(v.desc)}</p></div></div>
  <div class="side"><div class="panel" style="margin-bottom:1.2rem"><h2>Calificación</h2>
    <div class="rate"><span class="avg">${r.avg ? r.avg.toFixed(1) : '–'}</span><div><div class="stars">${starsStr(r.avg)}</div><small class="muted">${r.n} voto${r.n === 1 ? '' : 's'}</small></div></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">
    ${u ? `<p class="muted" style="font-size:.85rem">${mine ? 'Tu voto (puedes cambiarlo):' : 'Tu calificación:'}</p><div>${[1, 2, 3, 4, 5].map(n => `<button class="star-btn ${mine && mine.score >= n ? 'on' : ''}" data-s="${n}">★</button>`).join('')}</div>`
      : '<p class="muted" style="font-size:.9rem"><a href="#/login" style="color:var(--p)">Inicia sesión</a> para calificar.</p>'}</div></div></div>
  <div class="panel" style="margin-top:1.5rem"><h2>Comentarios (${ncom(id)})</h2>
    ${u ? `<textarea id="ct" rows="3" maxlength="600" placeholder="Escribe un comentario…"></textarea><div style="margin:.7rem 0 1rem" class="row"><button class="btn primary" id="cs" style="flex:none">Publicar</button><select id="cso" style="flex:none;width:auto"><option value="recent">Más recientes</option><option value="pop">Más populares</option></select></div>`
      : '<p class="muted"><a href="#/login" style="color:var(--p)">Inicia sesión</a> o <a href="#/register" style="color:var(--p)">regístrate</a> para comentar.</p>'}
    ${top.map(c => cm(c)).join('') || '<p class="muted">Aún no hay comentarios. Comparte tu reflexión.</p>'}</div>`;
  loadLocalVideo(v);
  const re = () => watch(id, false);
  document.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    const s = +b.dataset.s; if (mine) mine.score = s; else db.ratings.push({ vid: id, uid: u.id, score: s });
    save(); re(); toast('¡Gracias por calificar!');
  }));
  $('#cs')?.addEventListener('click', () => { const t = $('#ct').value.trim(); if (!t) return toast('Escribe algo primero'); db.comments.push({ id: uid(), vid: id, uid: u.id, text: t, date: Date.now(), likes: [] }); save(); re(); });
  if ($('#cso')) { $('#cso').value = sortC; $('#cso').addEventListener('change', e => { sortC = e.target.value; re(); }); }
  document.querySelectorAll('[data-like]').forEach(b => b.addEventListener('click', () => {
    if (!u) return toast('Inicia sesión para dar like');
    const c = db.comments.find(x => x.id === b.dataset.like); c.likes = c.likes || [];
    const i = c.likes.indexOf(u.id); i < 0 ? c.likes.push(u.id) : c.likes.splice(i, 1); save(); re();
  }));
  document.querySelectorAll('[data-reply]').forEach(b => b.addEventListener('click', () => {
    const box = $('#rf-' + b.dataset.reply);
    box.innerHTML = '<textarea rows="2" maxlength="600" placeholder="Tu respuesta…" style="margin:.5rem 0"></textarea><button class="btn sm primary">Enviar</button>';
    box.querySelector('button').addEventListener('click', () => { const t = box.querySelector('textarea').value.trim(); if (!t) return; db.comments.push({ id: uid(), vid: id, uid: u.id, text: t, date: Date.now(), likes: [], parent: b.dataset.reply }); save(); re(); });
  }));
  document.querySelectorAll('[data-hide]').forEach(b => b.addEventListener('click', () => { const c = db.comments.find(x => x.id === b.dataset.hide); c.hidden = !c.hidden; save(); re(); }));
  document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { const x = b.dataset.del; db.comments = db.comments.filter(c => c.id !== x && c.parent !== x); save(); re(); toast('Comentario eliminado'); }));
}

function authForm(register) {
  $('#app').innerHTML = `<form class="form panel" id="f"><h1 class="center">${register ? 'Crear cuenta' : 'Iniciar sesión'}</h1>
    ${register ? '<label>Nombre<input name="name" required maxlength="40"></label>' : ''}
    <label>Correo<input name="email" type="email" required></label>
    <label>Contraseña<input name="pass" type="password" required minlength="6"></label>
    <button class="btn primary">${register ? 'Registrarme' : 'Entrar'}</button>
    <p class="center muted" style="font-size:.85rem">${register ? '¿Ya tienes cuenta? <a href="#/login" style="color:var(--p)">Entra</a>' : '¿Nuevo? <a href="#/register" style="color:var(--p)">Regístrate</a><br>Acceso de demostración (administración): admin@calidezparental.com / admin123'}</p></form>`;
  $('#f').addEventListener('submit', e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const email = f.email.trim().toLowerCase();
    if (register) {
      if (db.users.some(u => u.email === email)) return toast('Ese correo ya está registrado');
      const u = { id: uid(), name: f.name.trim(), email, pass: hash(f.pass), role: 'user' }; db.users.push(u); db.session = u.id;
    } else {
      const u = db.users.find(x => x.email === email && x.pass === hash(f.pass)); if (!u) return toast('Credenciales incorrectas'); db.session = u.id;
    }
    save(); location.hash = '#/'; route(); toast('¡Bienvenido!');
  });
}

function admin() {
  if (!isAdmin()) { location.hash = '#/login'; return; }
  const tv = vids().reduce((a, v) => a + getViews(v), 0), gh = ghCfg();
  $('#app').innerHTML = `<h1 class="title">Panel de administración</h1>
  <div class="stats"><div class="stat"><b>${vids().length}</b>Videos</div><div class="stat"><b>${tv}</b>Reproducciones</div><div class="stat"><b>${db.comments.length}</b>Comentarios</div><div class="stat"><b>${db.users.length}</b>Usuarios</div></div>
  <div class="panel" style="margin-bottom:1.5rem"><h2>Publicación en GitHub (para toda la comunidad)</h2>
    <p class="muted" style="font-size:.9rem;margin-bottom:.8rem">${ghReady() ? `Conectado a <b>${esc(gh.owner)}/${esc(gh.repo)}</b>. Los videos publicados con la casilla activa serán visibles para todos.` : 'Sin conexión: los videos se guardan solo en este navegador. Conecta GitHub con un token de acceso limitado a este repositorio (permiso <i>Contents: Read and write</i>).'}</p>
    <form id="ghf" class="row" style="align-items:end">
      <label class="muted" style="font-size:.82rem">Usuario/organización<input name="owner" value="${esc(gh.owner || 'TavoTksh1')}" required></label>
      <label class="muted" style="font-size:.82rem">Repositorio<input name="repo" value="${esc(gh.repo || 'foro-videos-sofi')}" required></label>
      <label class="muted" style="font-size:.82rem">Token<input name="token" type="password" autocomplete="off" placeholder="${gh.token ? '•••••••• (guardado)' : 'github_pat_…'}"></label>
      <div style="flex:none;display:flex;gap:.5rem"><button class="btn primary">Guardar y verificar</button>${ghReady() ? '<button type="button" class="btn" id="ghx">Quitar</button>' : ''}</div></form>
    <p class="muted" style="font-size:.8rem;margin-top:.7rem">Crea el token en github.com/settings/personal-access-tokens/new: solo este repositorio, permiso Contents en lectura y escritura, y caducidad corta. Se guarda únicamente en este navegador.</p></div>
  <form class="panel" id="vf" style="margin-bottom:1.5rem"><h2>Publicar video</h2><div style="display:grid;gap:.8rem">
    <input name="title" placeholder="Título *" required maxlength="100">
    <div id="dz" class="dropzone" tabindex="0" role="button" aria-label="Subir archivo de video">
      <input type="file" id="vfile" accept="video/*" hidden>
      <p><b>Arrastra un video aquí</b> o <u>elige un archivo</u></p>
      <small id="dzinfo">MP4, WebM u otro formato de video (hasta ${MAX_MB} MB para publicar en GitHub).</small></div>
    <div class="or"><span>o pega un enlace</span></div>
    <input name="url" placeholder="Enlace YouTube / Vimeo / .mp4">
    <textarea name="desc" rows="3" placeholder="Descripción *" required></textarea>
    <div class="row"><input name="cat" placeholder="Categoría / etiqueta *" required maxlength="25"><input name="thumb" placeholder="URL de miniatura (automática si no la pones)"></div>
    <label class="check"><input type="checkbox" id="share" ${ghReady() ? 'checked' : 'disabled'}> Publicar para toda la comunidad (GitHub)${ghReady() ? '' : ' · conecta GitHub arriba'}</label>
    <button class="btn primary">Publicar</button></div></form>
  <div class="panel"><h2>Videos publicados</h2><div style="overflow:auto"><table><tr><th>Título</th><th>Cat.</th><th>Alcance</th><th>Vistas</th><th>Calif.</th><th></th></tr>
    ${vids().map(v => `<tr><td><a href="#/video/${v.id}">${esc(v.title)}</a></td><td>${esc(v.cat)}</td><td>${v.shared ? 'Todos' : 'Solo este navegador'}</td><td>${getViews(v)}</td><td>${rate(v.id).avg.toFixed(1)}</td><td><button class="btn sm danger" data-rm="${v.id}">Eliminar</button></td></tr>`).join('')}</table></div></div>`;

  $('#ghf').addEventListener('submit', async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), btn = e.target.querySelector('.primary');
    const token = f.token.trim() || ghCfg().token;
    if (!token) return toast('Pega el token de GitHub');
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      const r = await fetch(`https://api.github.com/repos/${f.owner.trim()}/${f.repo.trim()}`, { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token } });
      if (!r.ok) throw new Error('No se pudo acceder al repositorio con ese token');
      if (!(await r.json()).permissions?.push) throw new Error('El token no tiene permiso de escritura');
      localStorage.setItem(GH_KEY, JSON.stringify({ owner: f.owner.trim(), repo: f.repo.trim(), token }));
      admin(); toast('GitHub conectado');
    } catch (err) { btn.disabled = false; btn.textContent = 'Guardar y verificar'; toast(err.message); }
  });
  $('#ghx')?.addEventListener('click', () => { localStorage.removeItem(GH_KEY); admin(); toast('Token eliminado de este navegador'); });

  let file = null;
  const dz = $('#dz'), vfile = $('#vfile'), urlIn = $('#vf [name=url]');
  const setFile = f => {
    if (!f) return;
    if (!f.type.startsWith('video/')) return toast('Elige un archivo de video');
    file = f; dz.classList.add('has'); urlIn.value = ''; urlIn.disabled = true;
    $('#dzinfo').textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB (clic para cambiar)`;
  };
  dz.addEventListener('click', () => vfile.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vfile.click(); } });
  vfile.addEventListener('change', () => setFile(vfile.files[0]));
  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));

  $('#vf').addEventListener('submit', async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), link = (f.url || '').trim(), btn = e.target.querySelector('.primary');
    const share = $('#share').checked && ghReady();
    if (!file && !link) return toast('Arrastra un archivo, elígelo o pega un enlace');
    if (!file && !embed(link)) return toast('Enlace no válido (YouTube, Vimeo o .mp4)');
    if (share && file && file.size > MAX_MB * 1048576) return toast(`GitHub admite hasta ${MAX_MB} MB por archivo. Usa un enlace de YouTube.`);
    const id = uid(); let url = link, thumb = f.thumb.trim();
    const rec = () => ({ id, title: f.title.trim(), url, desc: f.desc.trim(), cat: f.cat.trim(), thumb: thumb || ytThumb(url) || 'img/placeholder.svg', date: Date.now() });
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      if (share) {
        if (file) {
          const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
          url = `videos/${id}.${ext}`; btn.textContent = 'Subiendo video a GitHub…';
          await ghPut(url, await toB64(file), 'Agrega video ' + id);
          thumb = thumb || await thumbFromFile(file);
        }
        if (thumb.startsWith('data:')) { const tp = `videos/thumbs/${id}.jpg`; await ghPut(tp, thumb.split(',')[1], 'Agrega miniatura ' + id); thumb = tp; }
        const r = rec(); btn.textContent = 'Actualizando lista…';
        await ghUpdateList(l => [r, ...l.filter(x => x.id !== id)], 'Publica video ' + id);
        remote.unshift({ ...r, shared: true });
        admin(); toast('Publicado. Será visible para todos en 1-2 minutos');
      } else {
        if (file) { await putBlob(id, file); url = 'idb:' + id; thumb = thumb || await thumbFromFile(file); }
        db.videos.unshift({ ...rec(), views: 0 });
        save(); admin(); toast('Video guardado en este navegador');
      }
    } catch (err) { btn.disabled = false; btn.textContent = 'Publicar'; toast(err.message || 'No se pudo guardar el video'); }
  });

  document.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.rm, v = vids().find(x => x.id === id);
    if (!confirm('¿Eliminar este video y sus datos?')) return;
    if (v.shared) {
      if (!ghReady()) return toast('Conecta GitHub para eliminar un video compartido');
      try {
        for (const path of [v.url, v.thumb]) if (/^videos\//.test(path)) await ghDelete(path);
        await ghUpdateList(l => l.filter(x => x.id !== id), 'Elimina video ' + id);
        remote = remote.filter(x => x.id !== id);
      } catch (err) { return toast(err.message); }
    } else if (isLocal(v.url)) delBlob(id);
    db.videos = db.videos.filter(x => x.id !== id); db.comments = db.comments.filter(c => c.vid !== id); db.ratings = db.ratings.filter(r => r.vid !== id); save(); admin();
  }));
}

function route() {
  renderNav(); window.scrollTo(0, 0);
  const [, p, id] = location.hash.split('/');
  if (p === 'video') watch(id); else if (p === 'login') authForm(false); else if (p === 'register') authForm(true); else if (p === 'admin') admin(); else home();
}
window.addEventListener('hashchange', route);
$('#app').innerHTML = '<p class="center muted" style="padding:3rem">Cargando…</p>';
loadRemote().then(route);
