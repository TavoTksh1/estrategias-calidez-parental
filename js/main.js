'use strict';
/* SofiTV – foro de videos. Sitio estático: los datos viven en localStorage (demo).
   Decisiones: videos por enlace (YouTube/Vimeo/MP4); comentar y calificar requiere registro. */

const KEY = 'sofitv.db.v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => { let h = 5381; for (const c of s + 'sofitv-salt') h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };
const uid = () => Math.random().toString(36).slice(2, 10);

function seed() {
  const now = Date.now(), d = n => now - n * 864e5;
  const v = (id, title, desc, cat, yt, days, views) => ({ id, title, desc, cat, url: 'https://www.youtube.com/watch?v=' + yt, thumb: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`, date: d(days), views });
  return {
    users: [{ id: 'u-admin', name: 'Sofi (Admin)', email: 'admin@sofitv.com', pass: hash('admin123'), role: 'admin' }],
    videos: [
      v('v1', 'Big Buck Bunny – Cortometraje', 'Un conejo gigante y tres roedores traviesos. Animación libre de Blender.', 'Animación', 'aqz-KE-bpKQ', 2, 120),
      v('v2', 'Me at the zoo', 'El primer video de la historia de YouTube. ¡Un clásico!', 'Clásicos', 'jNQXAC9IVRw', 5, 86),
      v('v3', 'Never Gonna Give You Up', 'El himno de internet que todos conocen.', 'Música', 'dQw4w9WgXcQ', 8, 301),
      v('v4', 'Tutorial: HTML y CSS desde cero', 'Introducción a la maquetación web moderna.', 'Tutoriales', 'qz0aGYrrlhU', 11, 64),
    ],
    ratings: [], comments: [], session: null,
  };
}
let db;
try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { toast('No se pudo guardar'); } };
save();

const me = () => db.users.find(u => u.id === db.session) || null;
const isAdmin = () => me()?.role === 'admin';
const rate = id => { const r = db.ratings.filter(x => x.vid === id); return { n: r.length, avg: r.length ? r.reduce((a, b) => a + b.score, 0) / r.length : 0 }; };
const ncom = id => db.comments.filter(c => c.vid === id && !c.hidden).length;
const starsStr = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const ago = t => { const m = (Date.now() - t) / 6e4; if (m < 1) return 'ahora'; if (m < 60) return `hace ${m | 0} min`; if (m < 1440) return `hace ${m / 60 | 0} h`; return `hace ${m / 1440 | 0} d`; };
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2400); }

function embed(url) {
  let m;
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
    ? `${isAdmin() ? '<a class="btn sm" href="#/admin">⚙ Panel</a>' : ''}<span class="muted">Hola, ${esc(u.name.split(' ')[0])}</span><button class="btn sm" id="out">Salir</button>`
    : '<a class="btn sm" href="#/login">Iniciar sesión</a><a class="btn sm primary" href="#/register">Registrarse</a>';
  $('#out')?.addEventListener('click', () => { db.session = null; save(); location.hash = '#/'; route(); toast('Sesión cerrada'); });
}

/* ---------- vistas ---------- */
let filter = { q: '', cat: 'Todas', sort: 'recent' };
function home() {
  const cats = ['Todas', ...new Set(db.videos.map(v => v.cat))];
  let list = db.videos.filter(v => (filter.cat === 'Todas' || v.cat === filter.cat) && (v.title + v.desc).toLowerCase().includes(filter.q.toLowerCase()));
  const key = { recent: v => -v.date, views: v => -v.views, rated: v => -rate(v.id).avg }[filter.sort];
  list.sort((a, b) => key(a) - key(b));
  $('#app').innerHTML = `
    <section class="hero"><h1>Mira, califica y <span>comenta</span> videos</h1><p>La comunidad de SofiTV: reproduce, deja tus estrellas y conversa en los comentarios.</p></section>
    <div class="toolbar"><input id="q" placeholder="🔍 Buscar videos…" value="${esc(filter.q)}">
      <select id="sort"><option value="recent">Más recientes</option><option value="views">Más vistos</option><option value="rated">Mejor calificados</option></select></div>
    <div class="chips">${cats.map(c => `<span class="chip ${c === filter.cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</span>`).join('')}</div>
    <div class="grid">${list.map(card).join('') || '<p class="muted">No hay videos que coincidan.</p>'}</div>`;
  $('#sort').value = filter.sort;
  $('#q').addEventListener('input', e => { filter.q = e.target.value; const p = e.target.selectionStart; home(); const q = $('#q'); q.focus(); q.setSelectionRange(p, p); });
  $('#sort').addEventListener('change', e => { filter.sort = e.target.value; home(); });
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { filter.cat = c.dataset.c; home(); }));
}
function card(v) {
  const r = rate(v.id);
  return `<a class="card" href="#/video/${v.id}"><div class="thumb"><img loading="lazy" src="${esc(v.thumb)}" alt="${esc(v.title)}" onerror="this.style.display='none'"><span class="tag">${esc(v.cat)}</span><span class="play">▶</span></div>
    <div class="info"><h3>${esc(v.title)}</h3><div class="meta"><span class="stars">${starsStr(r.avg)}</span><span>${r.avg ? r.avg.toFixed(1) : 'Sin votos'}</span><span>👁 ${v.views}</span><span>💬 ${ncom(v.id)}</span></div></div></a>`;
}

let sortC = 'recent';
function watch(id, count = true) {
  const v = db.videos.find(x => x.id === id);
  if (!v) { $('#app').innerHTML = '<p class="center muted">Video no encontrado. <a href="#/">Volver</a></p>'; return; }
  if (count) { v.views++; save(); }
  const u = me(), r = rate(id), mine = u && db.ratings.find(x => x.vid === id && x.uid === u.id);
  const likes = c => (c.likes || []).length;
  let top = db.comments.filter(c => c.vid === id && !c.parent && (isAdmin() || !c.hidden));
  top.sort(sortC === 'recent' ? (a, b) => b.date - a.date : (a, b) => likes(b) - likes(a) || b.date - a.date);
  const cm = (c, reply) => {
    const au = db.users.find(x => x.id === c.uid);
    return `<div class="${reply ? 'reply ' : ''}comment"><div class="avatar">${esc((au?.name || '?')[0].toUpperCase())}</div><div class="body">
      <div><span class="who">${esc(au?.name || 'Anónimo')}${au?.role === 'admin' ? ' 👑' : ''}</span><span class="when">${ago(c.date)}</span></div>
      <p class="${c.hidden ? 'hidden-c' : ''}">${c.hidden ? '[Comentario oculto por moderación] ' : ''}${esc(c.text)}</p>
      <div class="actions"><button class="btn sm" data-like="${c.id}">👍 ${likes(c)}</button>
      ${!reply && u ? `<button class="btn sm" data-reply="${c.id}">Responder</button>` : ''}
      ${isAdmin() ? `<button class="btn sm" data-hide="${c.id}">${c.hidden ? 'Mostrar' : 'Ocultar'}</button><button class="btn sm danger" data-del="${c.id}">Eliminar</button>` : ''}</div>
      <div id="rf-${c.id}"></div></div></div>
      ${reply ? '' : db.comments.filter(x => x.parent === c.id && (isAdmin() || !x.hidden)).sort((a, b) => a.date - b.date).map(x => cm(x, true)).join('')}`;
  };
  $('#app').innerHTML = `<p><a class="muted" href="#/">← Volver al inicio</a></p>
  <div class="watch"><div>
    <div class="player">${embed(v.url) || '<p class="center muted" style="padding:3rem">No se pudo cargar el video.</p>'}</div>
    <h1 class="title">${esc(v.title)}</h1>
    <div class="meta"><span class="tag" style="position:static">${esc(v.cat)}</span><span>👁 ${v.views} reproducciones</span><span>📅 ${new Date(v.date).toLocaleDateString('es')}</span></div>
    <div class="panel" style="margin-top:1rem"><p>${esc(v.desc)}</p></div></div>
  <div class="side"><div class="panel" style="margin-bottom:1.2rem"><h2>⭐ Calificación</h2>
    <div class="rate"><span class="avg">${r.avg ? r.avg.toFixed(1) : '–'}</span><div><div class="stars">${starsStr(r.avg)}</div><small class="muted">${r.n} voto${r.n === 1 ? '' : 's'}</small></div></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">
    ${u ? `<p class="muted" style="font-size:.85rem">${mine ? 'Tu voto (puedes cambiarlo):' : 'Tu calificación:'}</p><div>${[1, 2, 3, 4, 5].map(n => `<button class="star-btn ${mine && mine.score >= n ? 'on' : ''}" data-s="${n}">★</button>`).join('')}</div>`
      : '<p class="muted" style="font-size:.9rem"><a href="#/login" style="color:var(--p)">Inicia sesión</a> para calificar.</p>'}</div></div></div>
  <div class="panel" style="margin-top:1.5rem"><h2>💬 ${ncom(id)} comentarios</h2>
    ${u ? `<textarea id="ct" rows="3" maxlength="600" placeholder="Escribe un comentario…"></textarea><div style="margin:.7rem 0 1rem" class="row"><button class="btn primary" id="cs" style="flex:none">Publicar</button><select id="cso" style="flex:none;width:auto"><option value="recent">Más recientes</option><option value="pop">Más populares</option></select></div>`
      : '<p class="muted"><a href="#/login" style="color:var(--p)">Inicia sesión</a> o <a href="#/register" style="color:var(--p)">regístrate</a> para comentar.</p>'}
    ${top.map(c => cm(c)).join('') || '<p class="muted">Sé el primero en comentar.</p>'}</div>`;
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
    <p class="center muted" style="font-size:.85rem">${register ? '¿Ya tienes cuenta? <a href="#/login" style="color:var(--p)">Entra</a>' : '¿Nuevo? <a href="#/register" style="color:var(--p)">Regístrate</a><br>Demo admin: admin@sofitv.com / admin123'}</p></form>`;
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
  const tv = db.videos.reduce((a, v) => a + v.views, 0);
  $('#app').innerHTML = `<h1 class="title">⚙ Panel de administración</h1>
  <div class="stats"><div class="stat"><b>${db.videos.length}</b>Videos</div><div class="stat"><b>${tv}</b>Reproducciones</div><div class="stat"><b>${db.comments.length}</b>Comentarios</div><div class="stat"><b>${db.users.length}</b>Usuarios</div></div>
  <form class="panel" id="vf" style="margin-bottom:1.5rem"><h2>➕ Publicar video</h2><div style="display:grid;gap:.8rem">
    <input name="title" placeholder="Título *" required maxlength="100">
    <input name="url" placeholder="Enlace YouTube / Vimeo / .mp4 *" required>
    <textarea name="desc" rows="3" placeholder="Descripción *" required></textarea>
    <div class="row"><input name="cat" placeholder="Categoría / etiqueta *" required maxlength="25"><input name="thumb" placeholder="URL de miniatura (auto en YouTube)"></div>
    <button class="btn primary">Publicar</button></div></form>
  <div class="panel"><h2>🎬 Videos publicados</h2><div style="overflow:auto"><table><tr><th>Título</th><th>Cat.</th><th>Vistas</th><th>⭐</th><th></th></tr>
    ${db.videos.map(v => `<tr><td><a href="#/video/${v.id}">${esc(v.title)}</a></td><td>${esc(v.cat)}</td><td>${v.views}</td><td>${rate(v.id).avg.toFixed(1)}</td><td><button class="btn sm danger" data-rm="${v.id}">Eliminar</button></td></tr>`).join('')}</table></div></div>`;
  $('#vf').addEventListener('submit', e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (!embed(f.url.trim())) return toast('Enlace no válido (YouTube, Vimeo o .mp4)');
    const thumb = f.thumb.trim() || ytThumb(f.url) || 'img/placeholder.svg';
    db.videos.unshift({ id: uid(), title: f.title.trim(), url: f.url.trim(), desc: f.desc.trim(), cat: f.cat.trim(), thumb, date: Date.now(), views: 0 });
    save(); admin(); toast('Video publicado');
  });
  document.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('¿Eliminar este video y sus datos?')) return; const id = b.dataset.rm;
    db.videos = db.videos.filter(v => v.id !== id); db.comments = db.comments.filter(c => c.vid !== id); db.ratings = db.ratings.filter(r => r.vid !== id); save(); admin();
  }));
}

function route() {
  renderNav(); window.scrollTo(0, 0);
  const [, p, id] = location.hash.split('/');
  if (p === 'video') watch(id); else if (p === 'login') authForm(false); else if (p === 'register') authForm(true); else if (p === 'admin') admin(); else home();
}
window.addEventListener('hashchange', route);
route();
