/* Estrategias de calidez parental · foro de videos.
   Firebase (Auth + Firestore) en el plan gratuito; los videos se insertan por enlace (YouTube, Vimeo o .mp4). */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  updateProfile, sendEmailVerification, sendPasswordResetEmail, signInAnonymously, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, getDocs, query, where,
  serverTimestamp, increment, runTransaction, arrayUnion, arrayRemove, connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
if (['127.0.0.1', 'localhost'].includes(location.hostname)) { // desarrollo local: emuladores
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = t => (t && t.toMillis ? t.toMillis() : Date.now());
const ago = t => { const m = (Date.now() - ms(t)) / 6e4; if (m < 1) return 'ahora'; if (m < 60) return `hace ${m | 0} min`; if (m < 1440) return `hace ${m / 60 | 0} h`; return `hace ${m / 1440 | 0} d`; };
const starsStr = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const avgOf = v => (v.ratingCount ? v.ratingSum / v.ratingCount : 0);
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3200); }
const errMsg = e => ({
  'auth/email-already-in-use': 'Ese correo ya está registrado', 'auth/invalid-email': 'Correo no válido',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres', 'auth/invalid-credential': 'Correo o contraseña incorrectos',
  'auth/user-not-found': 'Correo o contraseña incorrectos', 'auth/wrong-password': 'Correo o contraseña incorrectos',
  'auth/too-many-requests': 'Demasiados intentos, espera unos minutos', 'auth/network-request-failed': 'Sin conexión con el servidor',
  'auth/operation-not-allowed': 'El acceso anónimo no está habilitado', 'permission-denied': 'No tienes permiso para hacer esto', 'unavailable': 'Sin conexión con el servidor',
}[e.code?.replace('firestore/', '')] || 'Ocurrió un error, intenta de nuevo');

/* ---------- enlaces de video ---------- */
const YT = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/i;
function ytStart(url) {
  const m = url.match(/[?&#](?:t|start)=([\dhms]+)/i); if (!m) return 0;
  if (/^\d+$/.test(m[1])) return +m[1];
  const p = m[1].match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return (+p[1] || 0) * 3600 + (+p[2] || 0) * 60 + (+p[3] || 0);
}
function parseVideo(raw) {
  const url = String(raw || '').trim(); let m;
  if ((m = url.match(YT))) return { kind: 'youtube', id: m[1], start: ytStart(url) };
  if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i))) return { kind: 'vimeo', id: m[1] };
  if (/^https:\/\/.+\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) return { kind: 'file', url };
  return null;
}
const thumbOf = p => (p?.kind === 'youtube' ? `https://img.youtube.com/vi/${p.id}/hqdefault.jpg` : '');
function playerHtml(url) {
  const p = parseVideo(url); if (!p) return '<p class="center muted" style="padding:3rem">No se pudo cargar el video.</p>';
  if (p.kind === 'youtube') return `<iframe src="https://www.youtube.com/embed/${p.id}?rel=0${p.start ? '&start=' + p.start : ''}" title="Video" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"></iframe>`;
  if (p.kind === 'vimeo') return `<iframe src="https://player.vimeo.com/video/${p.id}" title="Video" allowfullscreen></iframe>`;
  return `<video src="${esc(p.url)}" controls></video>`;
}

/* ---------- estado ---------- */
let user = null, videos = [], unsubs = [], authReady = false, videosReady = false;
const adminEmail = () => !!user && ADMIN_EMAILS.includes((user.email || '').toLowerCase());
const isAdmin = () => adminEmail() && user.emailVerified;
const clearSubs = () => { unsubs.forEach(u => u()); unsubs = []; };

/* ---------- navegación ---------- */
function renderNav() {
  const named = user && !user.isAnonymous;
  $('#nav').innerHTML = named
    ? `${isAdmin() ? '<a class="btn sm" href="#/admin">Panel de administración</a>' : ''}<span class="muted">${esc((user.displayName || user.email).split(' ')[0])}</span><button class="btn sm" id="out">Salir</button>`
    : '<a class="btn sm" href="#/login">Acceso administración</a>';
  $('#out')?.addEventListener('click', async () => { await signOut(auth); location.hash = '#/'; toast('Sesión cerrada'); });
}
const verifyBanner = () => adminEmail() && !user.emailVerified
  ? '<div class="notice">Tu correo de administración aún no está verificado. Abre el mensaje que te enviamos y vuelve a entrar para activar los permisos. <button class="btn sm" id="resend">Reenviar correo</button></div>' : '';
function bindBanner() {
  $('#resend')?.addEventListener('click', async () => { try { await sendEmailVerification(user); toast('Correo reenviado'); } catch (e) { toast(errMsg(e)); } });
}

/* ---------- inicio ---------- */
let filter = { q: '', cat: 'Todas', sort: 'recent' };
function home() {
  const cats = ['Todas', ...new Set(videos.map(v => v.cat))];
  const list = videos.filter(v => (filter.cat === 'Todas' || v.cat === filter.cat) && (v.title + v.desc).toLowerCase().includes(filter.q.toLowerCase()));
  const key = { recent: v => -ms(v.date), views: v => -v.views, rated: v => -avgOf(v) }[filter.sort];
  list.sort((a, b) => key(a) - key(b));
  $('#app').innerHTML = `${verifyBanner()}
    <section class="hero"><div class="eyebrow">Recursos audiovisuales</div><h1>Estrategias de calidez parental</h1><p>Videos educativos para comprender y fortalecer el vínculo afectivo entre cuidadores e hijos. Revisa el material, valóralo y comparte tus reflexiones con la comunidad.</p></section>
    <div class="toolbar"><input id="q" placeholder="Buscar videos…" value="${esc(filter.q)}" aria-label="Buscar videos">
      <select id="sort" aria-label="Ordenar"><option value="recent">Más recientes</option><option value="views">Más vistos</option><option value="rated">Mejor calificados</option></select></div>
    <div class="chips">${cats.map(c => `<span class="chip ${c === filter.cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</span>`).join('')}</div>
    ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : `<div class="empty">${videos.length ? 'No hay videos que coincidan con la búsqueda.' : 'Aún no hay videos publicados. El administrador puede agregarlos desde el panel.'}</div>`}`;
  $('#sort').value = filter.sort; bindBanner();
  $('#q').addEventListener('input', e => { filter.q = e.target.value; const p = e.target.selectionStart; home(); const q = $('#q'); q.focus(); q.setSelectionRange(p, p); });
  $('#sort').addEventListener('change', e => { filter.sort = e.target.value; home(); });
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { filter.cat = c.dataset.c; home(); }));
}
function card(v) {
  const a = avgOf(v);
  return `<a class="card" href="#/video/${v.id}"><div class="thumb"><img loading="lazy" src="${esc(v.thumb || 'img/placeholder.svg')}" alt="${esc(v.title)}" onerror="this.src='img/placeholder.svg'"><span class="tag">${esc(v.cat)}</span><span class="play">▶</span></div>
    <div class="info"><h3>${esc(v.title)}</h3><div class="meta"><span class="stars">${starsStr(a)}</span><span>${a ? a.toFixed(1) : 'Sin votos'}</span><span>${v.views} reprod.</span><span>${v.commentCount} comentarios</span></div></div></a>`;
}

/* ---------- reproductor, calificación y comentarios ---------- */
let sortC = 'recent';
function watch(id) {
  const vref = doc(db, 'videos', id);
  $('#app').innerHTML = `<p><a class="muted" href="#/">← Volver al inicio</a></p>
    <div class="watch"><div><div class="player" id="pl"></div><div id="vmeta"></div></div><div class="side"><div class="panel" id="rating"></div></div></div>
    <div class="panel" style="margin-top:1.5rem" id="cbox"><h2 id="chead">Comentarios</h2><div id="cform"></div><div id="clist"></div></div>`;
  let v = null, my = null, comments = [], first = true;

  const renderMeta = () => {
    $('#vmeta').innerHTML = `<h1 class="title">${esc(v.title)}</h1>
      <div class="meta"><span class="tag" style="position:static">${esc(v.cat)}</span><span>${v.views} reproducciones</span><span>Publicado el ${new Date(ms(v.date)).toLocaleDateString('es')}</span></div>
      <div class="panel" style="margin-top:1rem"><p>${esc(v.desc)}</p></div>`;
    $('#chead').textContent = `Comentarios (${v.commentCount})`;
  };
  const renderRating = () => {
    const a = avgOf(v);
    $('#rating').innerHTML = `<h2>Calificación</h2><div class="rate"><span class="avg">${a ? a.toFixed(1) : '–'}</span><div><div class="stars">${starsStr(a)}</div><small class="muted">${v.ratingCount} voto${v.ratingCount === 1 ? '' : 's'}</small></div></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">
      ${user ? `<p class="muted" style="font-size:.85rem">${my ? 'Tu voto (puedes cambiarlo):' : 'Tu calificación:'}</p><div>${[1, 2, 3, 4, 5].map(n => `<button class="star-btn ${my >= n ? 'on' : ''}" data-s="${n}" aria-label="${n} estrellas">★</button>`).join('')}</div>`
        : '<p class="muted" style="font-size:.9rem">No se pudo conectar. Recarga la página para calificar.</p>'}`;
    document.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => rate(+b.dataset.s)));
  };
  const rate = async score => {
    try {
      await runTransaction(db, async tx => {
        const rref = doc(db, 'ratings', `${id}_${user.uid}`);
        const [vs, rs] = await Promise.all([tx.get(vref), tx.get(rref)]);
        const cur = vs.data(), old = rs.exists() ? rs.data().score : null;
        tx.set(rref, { vid: id, uid: user.uid, score });
        tx.update(vref, { ratingSum: cur.ratingSum - (old ?? 0) + score, ratingCount: cur.ratingCount + (old == null ? 1 : 0) });
      });
      toast('¡Gracias por calificar!');
    } catch (e) { toast(errMsg(e)); }
  };

  const likes = c => (c.likes || []).length;
  const cm = (c, reply) => `<div class="${reply ? 'reply ' : ''}comment"><div class="avatar">${esc((c.name || '?')[0].toUpperCase())}</div><div class="body">
      <div><span class="who">${esc(c.name)}</span><span class="when">${ago(c.date)}</span></div>
      <p class="${c.hidden ? 'hidden-c' : ''}">${c.hidden ? '[Comentario oculto por moderación] ' : ''}${esc(c.text)}</p>
      <div class="actions"><button class="btn sm" data-like="${c.id}">Me gusta · ${likes(c)}</button>
      ${!reply && user ? `<button class="btn sm" data-reply="${c.id}">Responder</button>` : ''}
      ${isAdmin() ? `<button class="btn sm" data-hide="${c.id}">${c.hidden ? 'Mostrar' : 'Ocultar'}</button><button class="btn sm danger" data-del="${c.id}">Eliminar</button>` : ''}</div>
      <div id="rf-${c.id}"></div></div></div>`;
  const renderComments = () => {
    const visible = comments.filter(c => isAdmin() || !c.hidden);
    const top = visible.filter(c => !c.parent);
    top.sort(sortC === 'recent' ? (a, b) => ms(b.date) - ms(a.date) : (a, b) => likes(b) - likes(a) || ms(b.date) - ms(a.date));
    $('#clist').innerHTML = top.map(c => cm(c) + visible.filter(x => x.parent === c.id).sort((a, b) => ms(a.date) - ms(b.date)).map(x => cm(x, true)).join('')).join('')
      || '<p class="muted">Aún no hay comentarios. Comparte tu reflexión.</p>';
    const byId = i => comments.find(c => c.id === i);
    document.querySelectorAll('[data-like]').forEach(b => b.addEventListener('click', async () => {
      if (!user) return toast('No se pudo conectar. Recarga la página');
      const c = byId(b.dataset.like);
      try { await updateDoc(doc(db, 'comments', c.id), { likes: (c.likes || []).includes(user.uid) ? arrayRemove(user.uid) : arrayUnion(user.uid) }); } catch (e) { toast(errMsg(e)); }
    }));
    document.querySelectorAll('[data-reply]').forEach(b => b.addEventListener('click', () => {
      const box = $('#rf-' + b.dataset.reply);
      box.innerHTML = '<textarea rows="2" maxlength="600" placeholder="Tu respuesta…" style="margin:.5rem 0"></textarea><button class="btn sm primary">Enviar</button>';
      box.querySelector('button').addEventListener('click', async () => {
        const t = box.querySelector('textarea').value.trim(); if (t) await postComment(t, b.dataset.reply);
      });
    }));
    document.querySelectorAll('[data-hide]').forEach(b => b.addEventListener('click', () => { const c = byId(b.dataset.hide); updateDoc(doc(db, 'comments', c.id), { hidden: !c.hidden }).catch(e => toast(errMsg(e))); }));
    document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este comentario y sus respuestas?')) return;
      const gone = comments.filter(c => c.id === b.dataset.del || c.parent === b.dataset.del);
      try { await Promise.all(gone.map(c => deleteDoc(doc(db, 'comments', c.id)))); await updateDoc(vref, { commentCount: increment(-gone.length) }); toast('Comentario eliminado'); } catch (e) { toast(errMsg(e)); }
    }));
  };
  const getName = () => {
    const n = (($('#cname')?.value ?? '') || localStorage.getItem('calidez.name') || '').trim().slice(0, 40) || 'Anónimo';
    try { n === 'Anónimo' ? localStorage.removeItem('calidez.name') : localStorage.setItem('calidez.name', n); } catch {}
    return n;
  };
  const postComment = async (text, parent = null) => {
    if (!user) return toast('No se pudo conectar. Recarga la página');
    try {
      await addDoc(collection(db, 'comments'), { vid: id, uid: user.uid, name: getName(), text, parent, hidden: false, likes: [], date: serverTimestamp() });
      await updateDoc(vref, { commentCount: increment(1) });
    } catch (e) { toast(errMsg(e)); }
  };
  let saved = ''; try { saved = localStorage.getItem('calidez.name') || ''; } catch {}
  $('#cform').innerHTML = `<input id="cname" maxlength="40" placeholder="Tu nombre (opcional, por defecto: Anónimo)" value="${esc(saved)}" aria-label="Tu nombre" style="margin-bottom:.6rem">
    <textarea id="ct" rows="3" maxlength="600" placeholder="Escribe un comentario…" aria-label="Comentario"></textarea><div style="margin:.7rem 0 1rem" class="row"><button class="btn primary" id="cs" style="flex:none">Publicar</button><select id="cso" style="flex:none;width:auto" aria-label="Ordenar comentarios"><option value="recent">Más recientes</option><option value="pop">Más populares</option></select></div>`;
  $('#cs')?.addEventListener('click', async () => { const t = $('#ct').value.trim(); if (!t) return toast('Escribe algo primero'); $('#ct').value = ''; await postComment(t); });
  if ($('#cso')) { $('#cso').value = sortC; $('#cso').addEventListener('change', e => { sortC = e.target.value; renderComments(); }); }

  unsubs.push(onSnapshot(vref, s => {
    if (!s.exists()) { $('#app').innerHTML = '<p class="center muted">Video no encontrado. <a href="#/">Volver</a></p>'; return; }
    v = { id, ...s.data() };
    if (first) {
      first = false; $('#pl').innerHTML = playerHtml(v.url);
      if (!sessionStorage.getItem('v_' + id)) { sessionStorage.setItem('v_' + id, '1'); updateDoc(vref, { views: increment(1) }).catch(() => {}); }
    }
    renderMeta(); renderRating();
  }, e => toast(errMsg(e))));
  if (user) unsubs.push(onSnapshot(doc(db, 'ratings', `${id}_${user.uid}`), s => { my = s.exists() ? s.data().score : null; if (v) renderRating(); }));
  unsubs.push(onSnapshot(query(collection(db, 'comments'), where('vid', '==', id)), s => { comments = s.docs.map(d => ({ id: d.id, ...d.data() })); renderComments(); }, e => toast(errMsg(e))));
}

/* ---------- acceso ---------- */
function authForm(register) {
  $('#app').innerHTML = `<form class="form panel" id="f"><h1 class="center">${register ? 'Crear cuenta' : 'Iniciar sesión'}</h1>
    ${register ? '<label>Nombre<input name="name" required maxlength="40" autocomplete="name"></label>' : ''}
    <label>Correo<input name="email" type="email" required autocomplete="email"></label>
    <label>Contraseña<input name="pass" type="password" required minlength="6" autocomplete="${register ? 'new-password' : 'current-password'}"></label>
    <button class="btn primary">${register ? 'Registrarme' : 'Entrar'}</button>
    <p class="center muted" style="font-size:.85rem">${register ? '¿Ya tienes cuenta? <a href="#/login" style="color:var(--p)">Entra</a>' : 'Acceso exclusivo para administración. Para comentar y calificar no necesitas cuenta. · <a href="#" id="forgot" style="color:var(--p)">Olvidé mi contraseña</a>'}</p></form>`;
  $('#forgot')?.addEventListener('click', async e => {
    e.preventDefault(); const email = $('#f [name=email]').value.trim();
    if (!email) return toast('Escribe tu correo arriba y vuelve a pulsar');
    try { await sendPasswordResetEmail(auth, email); toast('Te enviamos un correo para restablecerla'); } catch (err) { toast(errMsg(err)); }
  });
  $('#f').addEventListener('submit', async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), btn = e.target.querySelector('.primary'); btn.disabled = true;
    try {
      if (register) {
        const cred = await createUserWithEmailAndPassword(auth, f.email.trim(), f.pass);
        await updateProfile(cred.user, { displayName: f.name.trim() });
        await cred.user.getIdToken(true); // el nombre debe viajar en el token para las reglas
        sendEmailVerification(cred.user).catch(() => {});
        toast('Cuenta creada. Te enviamos un correo de verificación');
      } else {
        await signInWithEmailAndPassword(auth, f.email.trim(), f.pass); toast('¡Bienvenido!');
      }
      location.hash = '#/';
    } catch (err) { btn.disabled = false; toast(errMsg(err)); }
  });
}

/* ---------- panel de administración ---------- */
function admin() {
  if (!isAdmin()) { $('#app').innerHTML = `${verifyBanner()}<p class="center muted" style="padding:3rem">Esta sección es solo para administración. <a href="#/login" style="color:var(--p)">Iniciar sesión</a></p>`; bindBanner(); return; }
  $('#app').innerHTML = `<h1 class="title">Panel de administración</h1><div class="stats" id="astats"></div>
  <form class="panel" id="vf" style="margin-bottom:1.5rem"><h2>Publicar video</h2><div style="display:grid;gap:.8rem">
    <input name="title" placeholder="Título *" required maxlength="100">
    <input name="url" id="vurl" placeholder="Enlace de YouTube (también Vimeo o .mp4) *" required autocomplete="off">
    <div id="vprev" class="vprev muted">Pega el enlace del video. Puede ser público o “no listado” en YouTube.</div>
    <textarea name="desc" rows="3" placeholder="Descripción *" required maxlength="1000"></textarea>
    <div class="row"><input name="cat" placeholder="Categoría / etiqueta *" required maxlength="25"><input name="thumb" placeholder="URL de miniatura (automática en YouTube)"></div>
    <button class="btn primary">Publicar</button></div></form>
  <div class="panel"><h2>Videos publicados</h2><div style="overflow:auto" id="atbl"></div></div>`;
  $('#vurl').addEventListener('input', e => {
    const raw = e.target.value.trim(), p = parseVideo(raw), box = $('#vprev');
    if (!raw) { box.className = 'vprev muted'; box.textContent = 'Pega el enlace del video. Puede ser público o “no listado” en YouTube.'; return; }
    if (!p) { box.className = 'vprev bad'; box.textContent = 'Enlace no válido. Usa un enlace de YouTube, Vimeo o un archivo .mp4 (https).'; return; }
    box.className = 'vprev ok';
    box.innerHTML = `${thumbOf(p) ? `<img src="${thumbOf(p)}" alt="">` : ''}<span>Enlace válido: ${{ youtube: 'YouTube', vimeo: 'Vimeo', file: 'archivo de video' }[p.kind]}${p.start ? ` (inicia en ${p.start} s)` : ''}</span>`;
  });
  $('#vf').addEventListener('submit', async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), btn = e.target.querySelector('.primary'), p = parseVideo(f.url);
    if (!p) return toast('Enlace no válido (YouTube, Vimeo o .mp4)');
    btn.disabled = true; btn.textContent = 'Publicando…';
    try {
      await addDoc(collection(db, 'videos'), {
        title: f.title.trim(), url: f.url.trim(), desc: f.desc.trim(), cat: f.cat.trim(), thumb: f.thumb.trim() || thumbOf(p) || '',
        date: serverTimestamp(), views: 0, ratingSum: 0, ratingCount: 0, commentCount: 0,
      });
      e.target.reset(); $('#vurl').dispatchEvent(new Event('input')); toast('Video publicado');
    } catch (err) { toast(errMsg(err)); }
    btn.disabled = false; btn.textContent = 'Publicar';
  });
  refreshAdmin();
}
function refreshAdmin() {
  if (!$('#atbl')) return;
  const sum = k => videos.reduce((a, v) => a + (v[k] || 0), 0);
  $('#astats').innerHTML = `<div class="stat"><b>${videos.length}</b>Videos</div><div class="stat"><b>${sum('views')}</b>Reproducciones</div><div class="stat"><b>${sum('commentCount')}</b>Comentarios</div><div class="stat"><b>${sum('ratingCount')}</b>Calificaciones</div>`;
  $('#atbl').innerHTML = videos.length ? `<table><tr><th>Título</th><th>Cat.</th><th>Vistas</th><th>Calif.</th><th></th></tr>${videos.map(v => `<tr><td><a href="#/video/${v.id}">${esc(v.title)}</a></td><td>${esc(v.cat)}</td><td>${v.views}</td><td>${avgOf(v).toFixed(1)}</td><td><button class="btn sm danger" data-rm="${v.id}">Eliminar</button></td></tr>`).join('')}</table>` : '<p class="muted">Aún no has publicado videos.</p>';
  document.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este video con sus comentarios y calificaciones?')) return; const id = b.dataset.rm;
    try {
      const [cs, rs] = await Promise.all([getDocs(query(collection(db, 'comments'), where('vid', '==', id))), getDocs(query(collection(db, 'ratings'), where('vid', '==', id)))]);
      await Promise.all([...cs.docs, ...rs.docs].map(d => deleteDoc(d.ref)));
      await deleteDoc(doc(db, 'videos', id)); toast('Video eliminado');
    } catch (err) { toast(errMsg(err)); }
  }));
}

/* ---------- arranque ---------- */
function route() {
  clearSubs(); renderNav(); window.scrollTo(0, 0);
  if (!authReady || !videosReady) { $('#app').innerHTML = '<p class="center muted" style="padding:3rem">Cargando…</p>'; return; }
  const [, p, id] = location.hash.split('/');
  if (p === 'video' && id) watch(id); else if (p === 'login') authForm(false); else if (p === 'register') authForm(true); else if (p === 'admin') admin(); else home();
}
window.addEventListener('hashchange', route);
onAuthStateChanged(auth, u => {
  if (!u) { signInAnonymously(auth).catch(e => { user = null; authReady = true; route(); toast(errMsg(e)); }); return; }
  user = u; authReady = true; route();
});
onSnapshot(collection(db, 'videos'), s => {
  videos = s.docs.map(d => ({ id: d.id, views: 0, ratingSum: 0, ratingCount: 0, commentCount: 0, ...d.data() }));
  const first = !videosReady; videosReady = true;
  const p = location.hash.split('/')[1];
  if (first) route(); else if (!p || p === '') home(); else if (p === 'admin') refreshAdmin();
}, e => { videosReady = true; $('#app').innerHTML = `<p class="center muted" style="padding:3rem">No se pudo cargar el contenido. ${esc(errMsg(e))}</p>`; });
