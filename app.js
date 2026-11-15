// Lớp Mình Live — bản online: giao diện MVP v2, dữ liệu đồng bộ qua Firebase Realtime Database.
// Giáo viên và học sinh ở các máy khác nhau cùng thấy một phòng. Quyền đọc/ghi do database.rules.json quyết định.
import {
  initializeApp, initializeAuth, signInAnonymously, connectAuthEmulator, browserSessionPersistence, browserLocalPersistence,
  getDatabase, connectDatabaseEmulator, ref, set, update, get, onValue, onDisconnect, serverTimestamp, QRCode,
} from './vendor/vendor.js';

// ---------- Kết nối Firebase ----------
// Trên máy (localhost) dùng Firebase emulator qua tool/serve.mjs; trên mạng dùng project thật.
// Cấu hình web Firebase là thông tin công khai; bảo mật nằm ở database.rules.json.
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const FIREBASE_CONFIG = IS_LOCAL ? {
  apiKey: 'demo-key',
  authDomain: 'demo-lopminh.firebaseapp.com',
  projectId: 'demo-lopminh',
  databaseURL: 'https://demo-lopminh-default-rtdb.firebaseio.com',
} : {
  apiKey: 'AIzaSyBlRUqbjEKzP6Q1uDqNDNfLpP50Nt8NE04',
  authDomain: 'altp-toanhoc.firebaseapp.com',
  projectId: 'altp-toanhoc',
  databaseURL: 'https://altp-toanhoc-default-rtdb.asia-southeast1.firebasedatabase.app',
};
const ROOT = 'lopminh/rooms';
const P = (code, sub) => ROOT + '/' + code + (sub ? '/' + sub : '');

// Hai danh tính tách biệt: giáo viên nhớ lâu trên máy (mở lại được lớp), học sinh nhớ theo từng tab
// (F5 không mất, nhiều tab là nhiều học sinh khi thử trên một máy).
const conns = {};
function conn(kind) {
  if (!conns[kind]) {
    const app = initializeApp(FIREBASE_CONFIG, 'lopminh-' + kind);
    const auth = initializeAuth(app, { persistence: kind === 'teacher' ? browserLocalPersistence : browserSessionPersistence });
    const db = getDatabase(app);
    if (IS_LOCAL) {
      connectAuthEmulator(auth, location.origin, { disableWarnings: true });
      connectDatabaseEmulator(db, location.hostname, Number(location.port) || 80);
    }
    const c = { auth, db, uid: null };
    c.ready = (async () => {
      await auth.authStateReady();
      if (!auth.currentUser) await signInAnonymously(auth);
      c.uid = auth.currentUser.uid;
      // Báo "mất mạng" chỉ khi mất quá 2 giây, tránh nháy lúc mới mở trang.
      let t = 0;
      onValue(ref(db, '.info/connected'), (s) => {
        clearTimeout(t);
        if (s.val()) { c.online = true; showNet(); } else t = setTimeout(() => { c.online = false; showNet(); }, 2000);
      });
      return c;
    })();
    conns[kind] = c;
  }
  return conns[kind].ready;
}

// ---------- Trạng thái trên trang ----------
const state = {
  role: 'home', roomCode: '', conn: null, room: null, studentName: '', joinCode: '', joinName: '',
  createName: 'Lớp Toán online', keys: {}, studentDrafts: {}, parentPreviewId: null, rosterDraft: '', rosterOpen: false,
  myRooms: loadMyRooms(), busy: false,
};
let unsubs = [];
const raw = {}; // dữ liệu thô từ Firebase của phòng đang mở
const now = () => Date.now();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (n) => String(n ?? '').trim().replace(/\s+/g, ' ');
const labelKind = { abcd: 'Trắc nghiệm A/B/C/D', tf: 'Đúng hoặc Sai', tf4: 'Đúng/Sai bốn ý', num: 'Trả lời ngắn', checkin: 'Check-in' };
const types = [['abcd', 'ABCD', 'Chọn một đáp án', '◩'], ['tf', 'Đúng / Sai', 'Một nhận định', '✓'], ['tf4', 'Đ/S bốn ý', 'a, b, c, d', '⊞'], ['num', 'Điền số', 'Số nguyên, thập phân, phân số', '№']];
const checkins = {
  start: { title: 'Check-in đầu giờ', prompt: 'Hôm nay con có sẵn sàng học không?', options: ['😊 Sẵn sàng', '😴 Hơi mệt', '🌱 Cần khởi động'] },
  middle: { title: 'Check-in giữa giờ', prompt: 'Con còn theo kịp bài không?', options: ['😊 Con hiểu bài', '🤔 Cần chậm lại', '🙋 Cần giải thích thêm'] },
  end: { title: 'Check-in cuối giờ', prompt: 'Con cảm thấy thế nào về bài học hôm nay?', options: ['✨ Khá tự tin', '🙂 Hiểu phần lớn', '🌱 Cần ôn thêm'] },
};
const DEFAULT_OBS = { attendance: 'unmarked', camera: 'unknown', called: 'not_called', note: '', parentName: '', parentEmail: '', delivery: 'not_sent' };
const attendanceLabels = { unmarked: 'Chưa điểm danh', present: 'Có mặt', late: 'Đến muộn', absent: 'Vắng', excused: 'Có phép' };
const cameraLabels = { unknown: 'Chưa kiểm tra', on: 'Có bật', off: 'Không bật', exempt: 'Không yêu cầu' };
const calledLabels = { not_called: 'Chưa gọi', answered: 'Có trả lời', no_answer: 'Không trả lời' };
const deliveryLabels = { not_sent: 'Chưa gửi', manually_shared: 'Đã soạn gửi' };

function loadMyRooms() { try { return JSON.parse(localStorage.getItem('lopminh:myRooms') || '[]'); } catch { return []; } }
function saveMyRooms() { try { localStorage.setItem('lopminh:myRooms', JSON.stringify(state.myRooms.slice(0, 8))); } catch { /* bỏ qua */ } }
function saveSession(v) { try { v ? sessionStorage.setItem('lopminh:session', JSON.stringify(v)) : sessionStorage.removeItem('lopminh:session'); } catch { /* bỏ qua */ } }
function readSession() { try { return JSON.parse(sessionStorage.getItem('lopminh:session') || 'null'); } catch { return null; } }

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}
function showNet() {
  const c = state.conn || Object.values(conns).find((x) => x.uid);
  const pill = document.getElementById('netPill'), text = document.getElementById('netText');
  const ok = !c || c.online !== false;
  pill.classList.toggle('offline', !ok);
  text.textContent = !c ? 'Sẵn sàng' : ok ? 'Đang kết nối' : 'Mất mạng · đang thử lại';
}
function fail(e, msg) {
  console.warn(e);
  toast(String(e?.code || e?.message || '').includes('PERMISSION') ? (msg || 'Không có quyền thực hiện thao tác này') : 'Lỗi kết nối, thử lại sau giây lát');
}
const normalizeName = (s) => norm(s).normalize('NFC').toLocaleLowerCase('vi-VN');
// Mã cố định theo tên: cùng tên (không phân biệt hoa thường, khoảng trắng) luôn ra cùng một dòng danh sách,
// nên học sinh vào lại bằng máy/tab khác không bị nhân đôi.
function nameId(name) {
  let h = 0x811c9dc5;
  for (const ch of normalizeName(name)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'n' + h.toString(16).padStart(8, '0');
}
function formatDate(t) { return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(t || now())); }
function observation(m) { return { ...DEFAULT_OBS, ...(m.observation || {}) }; }

// ---------- Ghép dữ liệu Firebase thành "room" như bản v2 ----------
function activitiesFrom(obj) {
  return Object.entries(obj || {}).map(([id, a]) => ({ id, ...a, options: a.options || null, responses: {} })).sort((x, y) => (x.seq || 0) - (y.seq || 0));
}
const autoRosterSent = new Set();
function buildTeacherRoom() {
  const d = raw.room; if (!d || !d.meta) return null;
  const hostUid = d.host, obs = d.obs || {}, roster = d.roster || {}, members = d.members || {}, resp = d.responses || {};
  const persons = {};
  for (const [rid, r] of Object.entries(roster)) persons[rid] = { id: rid, name: r.name, order: r.order || 0, joinedAt: null, online: false, uids: [], observation: obs[rid] };
  const missing = {};
  for (const [uid, m] of Object.entries(members)) {
    if (uid === hostUid || !m || !m.name) continue; // màn "xem thử như học sinh" của cô không tính vào lớp
    const rid = nameId(m.name);
    let p = persons[rid];
    if (!p) { p = persons[rid] = { id: rid, name: m.name, order: m.joinedAt || now(), joinedAt: null, online: false, uids: [], observation: obs[rid] }; missing[rid] = { name: m.name, order: p.order }; }
    p.uids.push(uid);
    if (typeof m.joinedAt === 'number' && (p.joinedAt == null || m.joinedAt < p.joinedAt)) p.joinedAt = m.joinedAt;
    if (m.online) p.online = true;
  }
  // Học sinh vào bằng mã mà chưa có trong danh sách: tự thêm vào danh sách để cô điểm danh, nhận xét.
  const toAdd = {};
  for (const [rid, v] of Object.entries(missing)) if (!autoRosterSent.has(rid)) { autoRosterSent.add(rid); toAdd['roster/' + rid] = { name: v.name, order: v.order, auto: true }; }
  if (Object.keys(toAdd).length) update(ref(state.conn.db, P(state.roomCode)), toAdd).catch((e) => console.warn(e));
  const activities = activitiesFrom(d.activities);
  for (const a of activities) {
    for (const p of Object.values(persons)) {
      let best = null;
      for (const uid of p.uids) { const r = resp[uid]?.[a.id]; if (r && (!best || (r.at || 0) > (best.at || 0))) best = r; }
      if (best) a.responses[p.id] = best;
    }
  }
  const sorted = Object.fromEntries(Object.values(persons).sort((x, y) => (x.order - y.order) || x.name.localeCompare(y.name, 'vi')).map((p) => [p.id, p]));
  return { code: state.roomCode, name: d.meta.name, createdAt: d.createdAt, status: d.meta.status, endedAt: d.meta.endedAt, activeId: d.state?.activeId || null, members: sorted, activities };
}
function buildStudentRoom() {
  if (!raw.meta || !raw.member) return null;
  const uid = state.conn.uid;
  const activities = activitiesFrom(raw.activities);
  for (const a of activities) { const r = raw.responses?.[a.id]; if (r) a.responses[uid] = r; }
  const members = { [uid]: { id: uid, name: raw.member.name, joinedAt: typeof raw.member.joinedAt === 'number' ? raw.member.joinedAt : now(), observation: {} } };
  return { code: state.roomCode, name: raw.meta.name, createdAt: raw.createdAt, status: raw.meta.status, endedAt: raw.meta.endedAt, activeId: raw.state?.activeId || null, members, activities };
}
function getRoom() { return state.room; }
function refreshRoom() {
  state.room = state.role === 'teacher' ? buildTeacherRoom() : state.role === 'student' ? buildStudentRoom() : null;
  render();
}

// ---------- Mở / đóng kết nối tới một phòng ----------
function stopListening() { for (const u of unsubs) u(); unsubs = []; for (const k of Object.keys(raw)) delete raw[k]; state.room = null; }
function listenTeacher(code) {
  stopListening();
  unsubs.push(onValue(ref(state.conn.db, P(code)), (s) => {
    raw.room = s.val();
    if (!raw.room) { toast('Phòng này đã bị xoá'); goHome(); return; }
    // Đáp án nháp của cô được lưu lên máy chủ để F5 không mất.
    for (const [aid, k] of Object.entries(raw.room.drafts || {})) if (state.keys[aid] == null) state.keys[aid] = k;
    refreshRoom();
  }, (e) => { fail(e, 'Máy này không phải máy đã tạo phòng'); goHome(); }));
}
function listenStudent(code) {
  stopListening();
  const db = state.conn.db, uid = state.conn.uid;
  const on = (path, key) => unsubs.push(onValue(ref(db, P(code, path)), (s) => {
    raw[key] = s.val();
    if (key === 'meta' && !raw.meta) { toast('Phòng học đã bị xoá'); goHome(); return; }
    refreshRoom();
  }, (e) => fail(e)));
  on('meta', 'meta'); on('createdAt', 'createdAt'); on('state', 'state'); on('activities', 'activities');
  on('members/' + uid, 'member'); on('responses/' + uid, 'responses');
}
function goHome() {
  if (state.role === 'student' && state.conn && state.roomCode && state.conn.uid !== raw.room?.host) {
    set(ref(state.conn.db, P(state.roomCode, 'members/' + state.conn.uid + '/online')), false).catch(() => {});
  }
  stopListening();
  state.role = 'home'; state.roomCode = ''; state.parentPreviewId = null; state.keys = {}; state.studentDrafts = {};
  saveSession(null);
  render();
}

// ---------- Thao tác giáo viên ----------
async function createRoom() {
  if (state.busy) return; state.busy = true;
  try {
    const c = await conn('teacher');
    const name = norm(state.createName).slice(0, 70) || 'Lớp Toán online';
    let code = null;
    for (let i = 0; i < 6 && !code; i++) {
      const tryCode = String(Math.floor(100000 + Math.random() * 900000));
      try {
        await set(ref(c.db, P(tryCode)), { host: c.uid, createdAt: serverTimestamp(), meta: { name, status: 'live' } });
        code = tryCode;
      } catch (e) { if (!String(e?.code || e?.message).includes('PERMISSION')) throw e; } // trùng mã đang dùng → thử mã khác
    }
    if (!code) { toast('Không tạo được phòng, thử lại'); return; }
    state.myRooms = [{ code, name, at: now() }, ...state.myRooms.filter((r) => r.code !== code)]; saveMyRooms();
    openTeacher(c, code);
    toast('Đã tạo phòng ' + code);
  } catch (e) { fail(e); } finally { state.busy = false; }
}
async function resumeTeacher(code) {
  try {
    const c = await conn('teacher');
    const host = (await get(ref(c.db, P(code, 'host')))).val();
    if (!host) { toast('Phòng ' + code + ' không còn'); state.myRooms = state.myRooms.filter((r) => r.code !== code); saveMyRooms(); render(); return; }
    if (host !== c.uid) { toast('Phòng này được tạo trên trình duyệt khác'); return; }
    openTeacher(c, code);
  } catch (e) { fail(e); }
}
function openTeacher(c, code) {
  state.conn = c; state.roomCode = code; state.role = 'teacher'; state.parentPreviewId = null;
  saveSession({ role: 'teacher', code });
  listenTeacher(code); showNet();
}
function roomRef(sub) { return ref(state.conn.db, P(state.roomCode, sub)); }
// Ghi nhiều đường dẫn một lần; trả về true/false để chỉ báo "đã xong" khi máy chủ nhận thật.
function write(updates, msg) { return update(roomRef(), updates).then(() => true, (e) => { fail(e, msg); return false; }); }

function active(room) { return (room && room.activities.find((a) => a.id === room.activeId)) || null; }
function numberOf(room, act) { const i = room.activities.findIndex((a) => a.id === act.id); return room.activities.slice(0, i + 1).filter((a) => a.kind !== 'checkin').length; }
function openActivity(kind, phase) {
  const room = getRoom(); if (!room || room.status === 'ended') return;
  if (active(room)) { toast('Hãy chốt hoặc bỏ hoạt động hiện tại trước'); return; }
  const c = checkins[phase];
  const seq = room.activities.reduce((n, a) => Math.max(n, a.seq || 0), 0) + 1;
  const id = 'a' + String(seq).padStart(3, '0');
  const a = { seq, kind, status: 'open', createdAt: serverTimestamp(), prompt: kind === 'checkin' ? c.prompt : 'Đáp án của em là gì?' };
  if (kind === 'checkin') Object.assign(a, { phase, title: c.title, options: c.options });
  state.keys[id] = kind === 'tf4' ? {} : '';
  write({ ['activities/' + id]: a, 'state/activeId': id }).then((ok) => ok && toast(kind === 'checkin' ? 'Đã gửi ' + c.title.toLowerCase() : 'Đã mở ' + labelKind[kind]));
}
function saveDraftKey(aid) { write({ ['drafts/' + aid]: state.keys[aid] || null }); }
function closeActivity(skip = false) {
  const room = getRoom(), a = active(room); if (!a) return;
  const u = { 'state/activeId': null, ['activities/' + a.id + '/closedAt']: serverTimestamp(), ['drafts/' + a.id]: null };
  let status;
  if (a.kind === 'checkin') status = 'closed';
  else if (skip) status = 'skipped';
  else {
    const key = state.keys[a.id];
    if (a.kind === 'tf4') { if (!key || !['a', 'b', 'c', 'd'].every((p) => ['Đ', 'S'].includes(key[p]))) { toast('Hãy chọn đủ đáp án đúng cho 4 ý'); return; } }
    else if (a.kind === 'num') { if (parseNumeric(key) === null) { toast('Đáp án đúng phải là số hợp lệ'); return; } }
    else if (!key) { toast('Hãy chọn đáp án đúng trước khi chốt'); return; }
    u['activities/' + a.id + '/key'] = key; status = 'graded';
  }
  u['activities/' + a.id + '/status'] = status;
  write(u).then((ok) => ok && toast(status === 'graded' ? 'Đã chốt và chấm câu hỏi' : status === 'skipped' ? 'Đã bỏ qua câu hỏi' : 'Đã kết thúc check-in'));
}
function endClass() {
  const room = getRoom(); if (!room) return;
  if (active(room)) { toast('Hãy chốt hoặc bỏ hoạt động đang mở trước'); return; }
  if (!confirm('Kết thúc buổi học? Báo cáo cuối giờ sẽ được hiển thị.')) return;
  write({ 'meta/status': 'ended', 'meta/endedAt': serverTimestamp() });
}
function reset() {
  if (!confirm('Xoá hẳn phòng này và toàn bộ dữ liệu (câu trả lời, điểm danh, nhận xét)? Không khôi phục được.')) return;
  const code = state.roomCode;
  set(roomRef(), null).then(() => {
    state.myRooms = state.myRooms.filter((r) => r.code !== code); saveMyRooms(); toast('Đã xoá phòng ' + code); goHome();
  }).catch((e) => fail(e));
}
function addRoster() {
  const room = getRoom(); if (!room) return;
  const names = state.rosterDraft.split(/\r?\n|;/).map(norm).filter(Boolean);
  if (!names.length) { toast('Nhập tên học sinh, mỗi dòng một tên'); return; }
  const u = {}; let count = 0; const base = now();
  for (const [i, name] of names.slice(0, 80).entries()) {
    const rid = nameId(name);
    if (room.members[rid] || u['roster/' + rid]) continue;
    u['roster/' + rid] = { name: name.slice(0, 60), order: base + i }; count++;
  }
  if (!count) { toast('Các tên này đã có trong danh sách'); return; }
  write(u).then((ok) => {
    if (!ok) return;
    state.rosterDraft = ''; const t = document.getElementById('rosterDraft'); if (t) t.value = '';
    toast('Đã thêm ' + count + ' học sinh vào danh sách');
  });
}
function setObservation(id, field, value) {
  const room = getRoom(); if (!room || !room.members[id] || state.role !== 'teacher') return;
  const valid = { attendance: ['unmarked', 'present', 'late', 'absent', 'excused'], camera: ['unknown', 'on', 'off', 'exempt'], called: ['not_called', 'answered', 'no_answer'] };
  if (!valid[field] || !valid[field].includes(value)) return;
  const o = observation(room.members[id]);
  write({ ['obs/' + id + '/' + field]: o[field] === value ? DEFAULT_OBS[field] : value });
}
// Ô nhập của cô: giữ bản nháp trên trang, lưu sau 0,7 giây ngừng gõ (và khi rời ô).
const drafts = {}; const draftTimers = {};
function draftKey(field, mid) { return field + '|' + (mid || ''); }
function storeObservationField(id, field, value, immediate) {
  if (state.role !== 'teacher' || !['note', 'parentName', 'parentEmail'].includes(field)) return;
  const k = draftKey(field, id);
  drafts[k] = value;
  clearTimeout(draftTimers[k]);
  const save = () => {
    const lim = field === 'note' ? 500 : 150;
    const v = norm(drafts[k]).slice(0, lim);
    write({ ['obs/' + id + '/' + field]: v, ['obs/' + id + '/delivery']: 'not_sent' }).then((ok) => {
      if (ok && k in drafts && norm(drafts[k]).slice(0, lim) === v) delete drafts[k];
      render();
    });
  };
  if (immediate) save(); else draftTimers[k] = setTimeout(save, 700);
}
function fieldValue(field, id, saved) { const k = draftKey(field, id); return k in drafts ? drafts[k] : saved; }
function markDelivered(id) { write({ ['obs/' + id + '/delivery']: 'manually_shared' }); }

// ---------- Thao tác học sinh ----------
async function joinStudent(code, name, asPreview) {
  code = norm(code).replace(/\D/g, ''); name = norm(name).slice(0, 60);
  if (!code || !name) { toast('Vui lòng nhập mã lớp và tên'); return; }
  if (state.busy) return; state.busy = true;
  try {
    const c = asPreview ? state.conn : await conn('student');
    const meta = (await get(ref(c.db, P(code, 'meta')))).val();
    if (!meta) { toast('Không tìm thấy mã lớp ' + code); return; }
    if (meta.status === 'ended' && !asPreview) { toast('Buổi học này đã kết thúc'); return; }
    const mPath = P(code, 'members/' + c.uid);
    const old = (await get(ref(c.db, mPath))).val();
    await set(ref(c.db, mPath), { name, joinedAt: typeof old?.joinedAt === 'number' ? old.joinedAt : serverTimestamp(), online: true });
    onDisconnect(ref(c.db, mPath + '/online')).set(false);
    state.conn = c; state.roomCode = code; state.studentName = name; state.role = 'student'; state.studentDrafts = {};
    if (!asPreview) {
      saveSession({ role: 'student', code, name });
      try { localStorage.setItem('lopminh:lastName', name); } catch { /* bỏ qua */ }
      history.replaceState(null, '', location.pathname + '?room=' + code);
    }
    listenStudent(code); showNet();
  } catch (e) { fail(e, 'Không vào được phòng'); } finally { state.busy = false; }
}
function storeAnswer(value) {
  const room = getRoom(), a = active(room);
  if (!room || !a || a.status !== 'open' || state.role !== 'student') { toast('Không có hoạt động đang mở'); return; }
  set(ref(state.conn.db, P(state.roomCode, 'responses/' + state.conn.uid + '/' + a.id)), { value, at: serverTimestamp() })
    .catch((e) => fail(e, 'Cô đã chốt câu này, không gửi được nữa'));
}

// ---------- Chấm và thống kê (giữ nguyên công thức v2) ----------
function parseNumeric(s) {
  s = String(s ?? '').trim().replace(/\s/g, '').replace(/,/g, '.'); if (!s) return null;
  const m = s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\/([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
  if (m) { const a = Number(m[1]), b = Number(m[2]); return b !== 0 && Number.isFinite(a / b) ? a / b : null; }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
}
function equal(a, b) { if (typeof a !== 'number' || typeof b !== 'number') return false; return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)); }
function graded(a, response) {
  if (!response) return false; const v = response.value;
  if (a.kind === 'num') return equal(parseNumeric(v), parseNumeric(a.key));
  if (a.kind === 'tf4') return ['a', 'b', 'c', 'd'].every((k) => v && a.key && v[k] === a.key[k]);
  return v === a.key;
}
function correctParts(a, response) { if (a.kind !== 'tf4' || !response) return null; return ['a', 'b', 'c', 'd'].filter((k) => response.value && a.key && response.value[k] === a.key[k]).length; }
function eligibility(room, act, member) { return act.status === 'graded' && member.joinedAt != null && typeof act.closedAt === 'number' && member.joinedAt <= act.closedAt; }
function studentStats(room, member) {
  const qs = room.activities.filter((a) => a.kind !== 'checkin' && eligibility(room, a, member));
  const answered = qs.filter((a) => a.responses[member.id]);
  const correct = answered.filter((a) => graded(a, a.responses[member.id]));
  const ci = room.activities.filter((a) => a.kind === 'checkin' && a.status === 'closed' && member.joinedAt != null && member.joinedAt <= a.closedAt);
  const cis = ci.filter((a) => a.responses[member.id]);
  return { eligible: qs.length, answered: answered.length, correct: correct.length, checked: cis.length, checkins: ci.length, participation: qs.length ? Math.round(answered.length / qs.length * 100) : null, accuracy: answered.length ? Math.round(correct.length / answered.length * 100) : null };
}
function percent(v) { return v == null ? '—' : v + '%'; }
function getStatus(room) {
  return { count: Object.keys(room.members).length, graded: room.activities.filter((a) => a.status === 'graded').length, checks: room.activities.filter((a) => a.kind === 'checkin' && a.status === 'closed').length, opened: room.activities.filter((a) => a.kind !== 'checkin').length };
}
function linkStudent() { return location.origin + location.pathname + '?room=' + encodeURIComponent(state.roomCode); }
// Ô bắt đầu bằng = + - @ bị Excel hiểu là công thức: thêm dấu ' phía trước.
function csvCell(x) { let s = String(x ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
function exportCsv() {
  const room = getRoom(); if (!room) return;
  const header = ['Học sinh', 'Ngày', 'Điểm danh', 'Camera (quan sát)', 'Khi cô gọi', 'Câu có cơ hội tham gia', 'Số câu trả lời', 'Số câu đúng', 'Tỷ lệ tham gia', 'Tỷ lệ chính xác', 'Check-in', 'Nhận xét giáo viên', 'Gửi PH'];
  const lines = [header, ...Object.values(room.members).map((m) => {
    const s = studentStats(room, m), o = observation(m);
    return [m.name, formatDate(room.createdAt), attendanceLabels[o.attendance], cameraLabels[o.camera], calledLabels[o.called], s.eligible, s.answered, s.correct, percent(s.participation), percent(s.accuracy), s.checked + '/' + s.checkins, o.note, deliveryLabels[o.delivery] || o.delivery];
  })].map((row) => row.map(csvCell).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); const url = URL.createObjectURL(blob);
  a.href = url; a.download = 'lop-minh-live-bao-cao-lop-' + room.code + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ---------- Giao diện ----------
function headline(room, teacher) {
  return `<div class="row wrap mb"><div><div class="title-eyebrow">${teacher ? 'Bảng điều khiển giáo viên' : 'Màn hình học sinh'}</div><h1 style="font-size:25px;margin:5px 0">${esc(room.name)}</h1><div class="muted">Mã phòng <span class="code" style="font-size:15px;letter-spacing:1px">${room.code}</span></div></div><div class="actions">${teacher ? `<button class="btn sm" data-action="preview">👀 Xem thử như học sinh</button>` : isPreview() ? `<button class="btn sm" data-action="teacher">← Về màn hình cô</button>` : ''}<button class="btn sm" data-action="home">Thoát</button></div></div>`;
}
function isPreview() { return state.role === 'student' && conns.teacher && state.conn === conns.teacher; }
function home() {
  const mine = state.myRooms.length ? `<section class="panel stack"><div><div class="title-eyebrow">Lớp cô đã tạo trên máy này</div><p class="muted tight">Lỡ đóng tab hay tải lại trang? Mở lại để tiếp tục điều khiển.</p></div><div class="my-rooms">${state.myRooms.map((r) => `<div class="name-row"><span><b>${esc(r.name)}</b> <span class="muted">· ${esc(r.code)} · ${formatDate(r.at)}</span></span><button class="btn sm" data-action="resume" data-code="${esc(r.code)}">Mở lại</button></div>`).join('')}</div></section>` : '';
  return `<div class="hero"><div class="herohead"><div class="pill"><span class="dot"></span> Không cần nhập đề bài</div><h1>Giảng bài theo cách của cô.<br><span style="color:var(--brand)">Cả lớp cùng tương tác.</span></h1><p class="muted" style="font-size:15px">Một cửa sổ nhỏ bên cạnh Zoom/Google Meet. Cô mở lượt trả lời, học sinh ở nhà chọn đáp án trên máy của mình, hệ thống tổng hợp ngay.</p></div><div class="two"><section class="panel stack"><div><div class="title-eyebrow">01 · Giáo viên</div><h2 style="margin:7px 0">Tạo lớp học</h2><p class="muted tight">Mở phòng và điều khiển các câu hỏi trực tiếp.</p></div><div><label class="label" for="createName">Tên lớp</label><input id="createName" data-field="createName" class="input" value="${esc(state.createName)}" maxlength="70" placeholder="Ví dụ: Toán 10 tối thứ Hai"></div><button class="btn primary block" data-action="create">+ Tạo phòng học</button></section><section class="panel stack"><div><div class="title-eyebrow">02 · Học sinh</div><h2 style="margin:7px 0">Tham gia lớp</h2><p class="muted tight">Nhập mã phòng cô gửi, hoặc bấm vào link cô gửi.</p></div><div><label class="label" for="joinCode">Mã phòng</label><input id="joinCode" data-field="joinCode" class="input" value="${esc(state.joinCode)}" inputmode="numeric" maxlength="6" placeholder="6 chữ số"></div><div><label class="label" for="joinName">Họ và tên</label><input id="joinName" data-field="joinName" class="input" value="${esc(state.joinName)}" maxlength="60" placeholder="Ví dụ: Nguyễn Minh Anh"><div class="hint mt">Ghi đúng họ tên đầy đủ như trong danh sách lớp.</div></div><button class="btn primary block" data-action="join">Tham gia phòng học</button></section></div>${mine}<div class="notice">🔒 Dữ liệu lưu trên máy chủ Firebase. Học sinh chỉ thấy câu trả lời của chính mình; điểm danh, nhận xét và thông tin phụ huynh chỉ máy của cô xem được.</div><p class="hint" style="text-align:center;margin-top:14px">Muốn thử mà không cần mạng? <a href="demo/">Bản demo chạy trên một máy</a></p></div>`;
}
function keySelector(a) {
  if (a.kind === 'abcd' || a.kind === 'tf') {
    const opts = a.kind === 'abcd' ? ['A', 'B', 'C', 'D'] : ['Đúng', 'Sai'];
    return `<div class="answer-label">Đáp án đúng (chọn khi chuẩn bị chốt)</div><div class="answer-choices">${opts.map((v) => `<button class="btn ${state.keys[a.id] === v ? 'select' : ''}" data-action="key" data-val="${v}">${v}</button>`).join('')}</div>`;
  }
  if (a.kind === 'tf4') return `<div class="answer-label">Chọn đáp án đúng cho cả bốn ý</div>${['a', 'b', 'c', 'd'].map((k) => `<div class="pair-row"><b>Ý ${k}</b><div class="actions"><button class="btn sm ${state.keys[a.id]?.[k] === 'Đ' ? 'select' : ''}" data-action="keypart" data-part="${k}" data-val="Đ">Đúng</button><button class="btn sm ${state.keys[a.id]?.[k] === 'S' ? 'select' : ''}" data-action="keypart" data-part="${k}" data-val="S">Sai</button></div></div>`).join('')}`;
  return `<div><label class="label" for="rightNum">Đáp án đúng</label><input id="rightNum" data-field="rightNum" class="input" placeholder="Ví dụ: 0,5 hoặc 1/2" value="${esc(state.keys[a.id] ?? '')}"><div class="hint mt">Hỗ trợ số nguyên, số thập phân và phân số.</div></div>`;
}
function distribution(a) {
  const values = Object.values(a.responses).map((r) => r.value);
  if (a.kind === 'abcd' || a.kind === 'tf' || a.kind === 'checkin') {
    const choices = a.kind === 'abcd' ? ['A', 'B', 'C', 'D'] : a.kind === 'tf' ? ['Đúng', 'Sai'] : a.options;
    return `<div class="answer-label mt">Phân bố câu trả lời</div>${choices.map((v) => { const n = values.filter((z) => z === v).length; return `<div class="barrow"><b style="font-size:12px" title="${esc(v)}">${esc(a.kind === 'checkin' ? v.slice(0, 2) : v)}</b><div class="track"><div class="fill ${a.key === v ? 'green' : ''}" style="width:${values.length ? 100 * n / values.length : 0}%"></div></div><span class="muted tiny" style="text-align:right">${n}/${values.length}</span></div>`; }).join('')}`;
  }
  if (a.kind === 'tf4') return `<div class="answer-label mt">Số lượt trả lời đủ bốn ý: ${values.filter((v) => v && Object.keys(v).length === 4).length}</div>`;
  return `<div class="answer-label mt">Các kết quả đã gửi (không công bố danh tính)</div><div class="mutedbox" style="font-size:12px;overflow-wrap:anywhere">${values.length ? values.map((v) => esc(v)).join(' · ') : 'Chưa có câu trả lời'}</div>`;
}
function teacherActive(room, a) {
  const joined = Object.values(room.members).filter((m) => m.joinedAt != null);
  const n = joined.filter((m) => a.responses[m.id]).length, total = joined.length;
  const waiting = joined.filter((m) => m.online && !a.responses[m.id]);
  const allReady = total > 0 && n === total;
  return `<section class="panel stack"><div class="row wrap"><div><span class="chip pending">● Đang nhận câu trả lời</span><h2 style="margin:9px 0 0">${a.kind === 'checkin' ? esc(a.title) : 'Câu ' + numberOf(room, a) + ' · ' + labelKind[a.kind]}</h2></div><span class="chip ${allReady ? 'good' : ''}">${n}/${total} đã phản hồi</span></div><div class="mutedbox"><div class="progress"><div style="width:${total ? 100 * n / total : 0}%"></div></div><p class="hint" style="margin:8px 0 0">${a.kind === 'checkin' ? esc(a.prompt) : 'Học sinh thấy: “Câu ' + numberOf(room, a) + ' · Đáp án của em là gì?”'}</p>${waiting.length ? `<div class="hint" style="margin-top:8px">Đang online, chưa trả lời (${waiting.length}):</div><div class="waiting-names">${waiting.slice(0, 40).map((m) => `<span>${esc(m.name)}</span>`).join('')}</div>` : ''}</div>${distribution(a)}${a.kind === 'checkin' ? `<div class="banner info">☑ Check-in không được chấm điểm. Chỉ tổng hợp kết quả toàn lớp.</div><button class="btn primary block" data-action="close">Kết thúc check-in</button>` : `<div class="divider" style="margin:0"></div>${keySelector(a)}<button class="btn primary block" data-action="close">✓ Chốt câu và chấm</button><button class="btn block danger" data-action="skip">Bỏ câu · không tính kết quả</button>`}</section>`;
}
function controls(room) {
  if (room.status === 'ended') return `<div class="banner">✓ Buổi học đã kết thúc. Bạn có thể xem hoặc xuất báo cáo ở bên dưới.</div>`;
  return `<section class="panel stack"><div><h2 style="margin-bottom:4px">Mở hoạt động mới</h2><p class="muted tight">Không cần gõ câu hỏi. Cô mở một lượt mới ngay lúc cần.</p></div><div class="type-grid">${types.map(([k, t, d, ic]) => `<button class="type-btn" data-action="open" data-kind="${k}"><span class="type-icon">${ic}</span><strong>${t}</strong><small>${d}</small></button>`).join('')}</div><div class="divider" style="margin:0"></div><div class="section-title" style="margin:0">Check-in nhanh</div><div class="three">${[['start', '🌤️ Đầu giờ'], ['middle', '☕ Giữa giờ'], ['end', '🌿 Cuối giờ']].map(([k, t]) => `<button class="btn" data-action="checkin" data-phase="${k}">${t}</button>`).join('')}</div></section>`;
}
function members(room) {
  const all = Object.values(room.members), joined = all.filter((m) => m.joinedAt != null), online = joined.filter((m) => m.online).length;
  return `<section class="panel"><div class="row"><h3 style="margin:0">Học sinh đã vào web (${joined.length}/${all.length})</h3><span class="chip good">${online} online</span></div>${joined.length ? `<div class="response-list">${joined.map((m) => { const s = studentStats(room, m); return `<div class="name-row"><span><span class="online-dot ${m.online ? 'on' : ''}" title="${m.online ? 'Đang online' : 'Đã thoát'}"></span>${esc(m.name)}</span><span class="muted">${s.answered}/${s.eligible} câu</span></div>`; }).join('')}</div>` : `<div class="empty-state"><div class="emoji">👋</div>Chưa có học sinh vào web.<br><small>Gửi link hoặc mã phòng cho học sinh qua Zalo/chat của Zoom, Meet.</small></div>`}</section>`;
}
function optionGroup(m, field, options) {
  const obs = observation(m);
  return `<div class="chips-wrap">${options.map(([value, label]) => `<button type="button" class="mini-choice ${obs[field] === value ? 'chosen' : ''}" data-action="observe" data-mid="${esc(m.id)}" data-field="${field}" data-value="${value}" title="${esc(label)}">${esc(label)}</button>`).join('')}</div>`;
}
function attendancePanel(room) {
  const all = Object.values(room.members);
  const present = all.filter((m) => ['present', 'late'].includes(observation(m).attendance)).length;
  const unknown = all.filter((m) => observation(m).attendance === 'unmarked').length;
  const q = normalizeName(state.search || '');
  const shown = q ? all.filter((m) => normalizeName(m.name).includes(q)) : all;
  return `<section class="panel stack"><div class="row wrap"><div><div class="title-eyebrow">Theo dõi lớp học</div><h2 style="margin:5px 0 0">Điểm danh & tương tác</h2></div><div class="actions"><span class="chip good">${present} có mặt / muộn</span><span class="chip pending">${unknown} chưa kiểm tra</span></div></div><div class="hint">Cô tick thủ công trong giờ học. Camera là trạng thái cô quan sát tại thời điểm kiểm tra, không phải dữ liệu webcam. “Chưa gọi” không đồng nghĩa với “không trả lời”. Học sinh vào web bằng tên chưa có trong danh sách sẽ được tự thêm.</div><details class="roster-add" ${state.rosterOpen ? 'open' : ''}><summary>+ Thêm danh sách học sinh trước buổi học</summary><label class="label mt" for="rosterDraft">Mỗi dòng một tên (có thể dán cột tên từ Excel); học sinh vào web đúng tên sẽ được ghép với danh sách</label><textarea class="input" rows="3" id="rosterDraft" data-field="rosterDraft" placeholder="Nguyễn Minh Anh&#10;Trần Đức Minh">${esc(state.rosterDraft)}</textarea><button class="btn sm primary mt" data-action="addRoster">Thêm vào danh sách</button></details>${all.length > 8 ? `<input class="input" data-field="search" value="${esc(state.search || '')}" placeholder="🔎 Tìm tên học sinh…">` : ''}${all.length ? `<div class="table-scroll"><table class="attendance-table"><thead><tr><th>Học sinh</th><th>Điểm danh</th><th>Camera</th><th>Khi cô gọi</th><th>Nhận xét nhanh</th><th>Báo cáo</th></tr></thead><tbody>${shown.map((m) => { const o = observation(m); return `<tr><td><strong>${esc(m.name)}</strong><div class="tiny muted">${m.joinedAt ? `<span class="online-dot ${m.online ? 'on' : ''}"></span>${m.online ? 'Đang online' : 'Đã vào web'}` : 'Chưa vào web'}</div></td><td>${optionGroup(m, 'attendance', [['present', 'Có mặt'], ['late', 'Muộn'], ['absent', 'Vắng'], ['excused', 'Có phép']])}</td><td>${optionGroup(m, 'camera', [['on', 'Bật'], ['off', 'Tắt'], ['exempt', 'Miễn']])}</td><td>${optionGroup(m, 'called', [['answered', 'Trả lời'], ['no_answer', 'Không trả lời']])}</td><td><input class="input compact-input" data-field="obsNote" data-mid="${esc(m.id)}" value="${esc(fieldValue('note', m.id, o.note))}" maxlength="500" placeholder="Ghi chú ngắn..."></td><td><button class="btn sm" data-action="parentPreview" data-mid="${esc(m.id)}">Xem PH ›</button></td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty-state">Chưa có tên nào trong danh sách.<div class="hint mt">Cô thêm danh sách đầu giờ hoặc để học sinh vào bằng mã phòng.</div></div>`}</section>`;
}
function reportTeacher(room) {
  const all = Object.values(room.members);
  const count = room.activities.filter((a) => a.status === 'graded').length;
  const joined = all.filter((m) => m.joinedAt != null);
  const avg = joined.length ? Math.round(joined.reduce((n, m) => n + (studentStats(room, m).participation ?? 0), 0) / joined.length) : null;
  return `<section class="panel stack"><div class="row wrap"><div><div class="title-eyebrow">Tổng hợp buổi học</div><h2 style="margin:5px 0">Báo cáo giáo viên</h2></div><button class="btn sm" data-action="csv">↓ Xuất bảng CSV</button></div><div class="three"><div class="stat"><b>${count}</b><small>Câu đã chấm</small></div><div class="stat"><b>${all.length}</b><small>Sĩ số danh sách</small></div><div class="stat"><b>${percent(avg)}</b><small>Tham gia trung bình của HS vào web</small></div></div>${all.length ? `<div class="table-scroll"><table><thead><tr><th>Học sinh</th><th>Điểm danh</th><th>Camera</th><th>Khi cô gọi</th><th>Đã trả lời</th><th>Đúng</th><th>Tham gia</th><th>Chính xác</th><th>PH</th></tr></thead><tbody>${all.map((m) => { const s = studentStats(room, m), o = observation(m); return `<tr><td>${esc(m.name)}</td><td>${attendanceLabels[o.attendance]}</td><td>${cameraLabels[o.camera]}</td><td>${calledLabels[o.called]}</td><td>${s.answered}/${s.eligible}</td><td>${s.correct}/${s.answered}</td><td>${percent(s.participation)}</td><td>${percent(s.accuracy)}</td><td><button class="btn sm" data-action="parentPreview" data-mid="${esc(m.id)}">Xem</button>${o.delivery === 'manually_shared' ? '<div class="delivery">✓ Đã soạn gửi</div>' : ''}</td></tr>`; }).join('')}</tbody></table></div>` : `<p class="muted">Chưa có học sinh.</p>`}<div class="hint">Báo cáo lớp chỉ dành cho giáo viên. Báo cáo PH tách riêng từng học sinh; cần duyệt trước khi gửi.</div></section>`;
}
function parentMessage(room, m) {
  const st = studentStats(room, m), o = observation(m);
  return `Kính gửi Quý Phụ huynh${o.parentName ? ' ' + o.parentName : ''},\n\nCô gửi thông tin buổi học ${room.name} ngày ${formatDate(room.createdAt)} của con ${m.name}:\n- Điểm danh: ${attendanceLabels[o.attendance]}.\n- Camera (quan sát của cô): ${cameraLabels[o.camera]}.\n- Khi được gọi: ${calledLabels[o.called]}.\n- Tham gia trả lời: ${st.answered}/${st.eligible} lượt hợp lệ (${percent(st.participation)}).\n- Trả lời chính xác: ${st.correct}/${st.answered} (${percent(st.accuracy)}).\n- Check-in đã thực hiện: ${st.checked}/${st.checkins}.\n${o.note ? '\nNhận xét của cô: ' + o.note + '\n' : ''}\nCác tỷ lệ phản ánh hoạt động tương tác trên web, không phải tỷ lệ kiến thức đã nắm vững.\n\nCảm ơn Quý Phụ huynh đã đồng hành cùng cô và các con.`;
}
function parentReportPage(room, m) {
  const st = studentStats(room, m), o = observation(m);
  return `<div class="parent-page"><div class="row wrap no-print" style="margin-bottom:16px"><button class="btn" data-action="backTeacher">← Quay về quản lý lớp</button><span class="chip pending">Bản xem trước · ${o.delivery === 'manually_shared' ? 'Đã soạn gửi' : 'Chưa gửi'}</span></div><div class="report-paper panel"><div class="report-accent"></div><div class="row wrap"><div><div class="title-eyebrow">LỚP MÌNH LIVE · BÁO CÁO CÁ NHÂN</div><h1 style="font-size:25px;margin:7px 0">BÁO CÁO BUỔI HỌC</h1><div class="muted">${esc(room.name)} · ${formatDate(room.createdAt)}</div></div><span class="chip">Dành riêng cho phụ huynh</span></div><div class="divider"></div><div class="row wrap"><div><div class="label">Học sinh</div><h2 style="margin:4px 0">${esc(m.name)}</h2></div><div class="muted" style="font-size:12px">Báo cáo cá nhân, không bao gồm thông tin của học sinh khác</div></div><h3 style="margin:16px 0 10px">1. Nề nếp trong buổi học</h3><div class="report-info"><div><small>Điểm danh</small><strong>${attendanceLabels[o.attendance]}</strong></div><div><small>Camera (cô quan sát)</small><strong>${cameraLabels[o.camera]}</strong></div><div><small>Khi cô gọi</small><strong>${calledLabels[o.called]}</strong></div></div><h3 style="margin:20px 0 10px">2. Tham gia học tập</h3><div class="report-grid"><div class="stat"><small>Tỷ lệ tham gia</small><b>${percent(st.participation)}</b><small>${st.answered}/${st.eligible} câu</small></div><div class="stat"><small>Tỷ lệ chính xác</small><b>${percent(st.accuracy)}</b><small>${st.correct}/${st.answered} câu đúng</small></div></div><p class="hint mt">Check-in: ${st.checked}/${st.checkins} lượt. Không tính check-in vào tỷ lệ chính xác.</p><h3 style="margin:20px 0 10px">3. Nhận xét của giáo viên</h3><div class="note-paper">${o.note ? esc(o.note) : '<span class="muted">Chưa có nhận xét riêng cho buổi học này.</span>'}</div><div class="divider"></div><p class="hint">Lưu ý: Báo cáo thể hiện các quan sát thủ công của giáo viên và số lượt trả lời trên web. Đây không phải thước đo toàn bộ năng lực, mức độ tập trung hay phần trăm kiến thức học sinh đã nắm.</p><div class="tiny muted" style="text-align:right">Lớp Mình Live · ${formatDate(room.endedAt || now())}</div></div><section class="panel stack no-print" style="margin-top:16px"><div><h3 style="margin-bottom:6px">Duyệt thông tin & gửi phụ huynh</h3><p class="hint tight">Bước này chỉ tạo tài liệu và nội dung tin nhắn; cô tự gửi qua Zalo hoặc email.</p></div><div class="two"><div><label class="label" for="guardianName">Tên phụ huynh (không bắt buộc)</label><input id="guardianName" class="input" data-field="parentName" data-mid="${esc(m.id)}" value="${esc(fieldValue('parentName', m.id, o.parentName))}" placeholder="Phụ huynh của con..."></div><div><label class="label" for="guardianEmail">Email phụ huynh (nếu gửi email)</label><input id="guardianEmail" class="input" data-field="parentEmail" data-mid="${esc(m.id)}" value="${esc(fieldValue('parentEmail', m.id, o.parentEmail))}" placeholder="phuhuynh@example.com" type="email"></div></div><div><label class="label" for="guardianNote">Nhận xét riêng của cô</label><textarea id="guardianNote" rows="3" class="input" data-field="note" data-mid="${esc(m.id)}" placeholder="Nhận xét mang tính xây dựng, dựa trên quan sát...">${esc(fieldValue('note', m.id, o.note))}</textarea><div class="hint mt">Tự lưu sau khi cô ngừng gõ.</div></div><div class="actions"><button class="btn primary" data-action="printReport">↧ In / Lưu PDF</button><button class="btn" data-action="copyParent">⧉ Sao chép tin nhắn gửi Zalo</button><button class="btn" data-action="emailParent">✉ Soạn email cho PH</button></div><div class="banner warn">Thông tin phụ huynh chỉ máy của cô đọc được. Chỉ nhập khi có sự đồng ý của phụ huynh.</div></section></div>`;
}
let qrFor = '', qrUrl = '';
function shareBox(room) {
  const link = linkStudent();
  if (qrFor !== link) {
    qrFor = link; qrUrl = '';
    QRCode.toDataURL(link, { margin: 1, width: 300 }).then((u) => { if (qrFor === link) { qrUrl = u; render(); } }).catch(() => {});
  }
  return `<section class="panel stack"><div class="title-eyebrow">Mời học sinh vào lớp</div><div class="row"><div class="code">${room.code}</div><button class="btn sm" data-action="copy">⧉ Mã</button></div><div class="share-link">${esc(link)}</div><button class="btn sm" data-action="copyLink">⧉ Sao chép link gửi Zalo / chat Zoom</button>${qrUrl ? `<div class="qr-box"><img src="${qrUrl}" alt="Mã QR vào lớp"></div><div class="hint" style="text-align:center">Học sinh dùng điện thoại quét khi cô chia sẻ màn hình.</div>` : ''}</section>`;
}
function teacher(room) {
  const selected = state.parentPreviewId && room.members[state.parentPreviewId];
  if (selected) return parentReportPage(room, selected);
  const st = getStatus(room), a = active(room);
  return `${headline(room, true)}<div class="layout"><div class="stack"><div class="four"><div class="stat"><b>${st.count}</b><small>Sĩ số danh sách</small></div><div class="stat"><b>${st.opened}</b><small>Lượt đã mở</small></div><div class="stat"><b>${st.graded}</b><small>Đã chấm</small></div><div class="stat"><b>${st.checks}</b><small>Check-in</small></div></div>${a ? teacherActive(room, a) : controls(room)}</div><div class="stack">${shareBox(room)}${members(room)}<section class="panel stack"><h3 style="margin:0">Quản lý buổi học</h3>${room.status === 'live' ? `<button class="btn block" data-action="end">Kết thúc buổi học & tạo báo cáo</button>` : `<div class="banner">✓ Buổi học đã kết thúc. Cô có thể rà soát và xuất báo cáo riêng cho từng PH.</div>`}<button class="btn block danger" data-action="reset">Xoá phòng & dữ liệu</button><div class="hint">Mở lại lớp này từ trang chủ trên cùng trình duyệt nếu lỡ đóng tab.</div></section></div></div><div class="stack" style="margin-top:18px">${attendancePanel(room)}${reportTeacher(room)}</div>`;
}
function studentAnswer(room, a, m) {
  const own = a.responses[m.id]?.value; const draft = state.studentDrafts[a.id] || {};
  if (a.kind === 'checkin') return `<div class="stack" style="gap:9px">${a.options.map((o) => `<button class="btn block ${own === o ? 'select' : ''}" style="text-align:left;min-height:49px" data-action="answer" data-value="${esc(o)}">${esc(o)} ${own === o ? ' ✓' : ''}</button>`).join('')}</div>`;
  if (a.kind === 'abcd' || a.kind === 'tf') { const opts = a.kind === 'abcd' ? ['A', 'B', 'C', 'D'] : ['Đúng', 'Sai']; return `<div class="question-grid">${opts.map((v) => `<button class="btn option ${a.kind === 'tf' ? 'tf' : ''} ${own === v ? 'active' : ''}" data-action="answer" data-value="${v}">${v}</button>`).join('')}</div>`; }
  if (a.kind === 'tf4') { const all = draft && Object.keys(draft).length ? draft : (own || {}); return `<div class="hint" style="margin-bottom:12px">Chọn Đúng hoặc Sai cho cả bốn ý. Khi đủ 4 ý, hệ thống tự ghi nhận.</div>${['a', 'b', 'c', 'd'].map((k) => `<div class="pair-row"><b>Ý ${k}</b><div class="actions"><button class="btn ${all[k] === 'Đ' ? 'select' : ''}" data-action="part" data-part="${k}" data-value="Đ">Đúng</button><button class="btn ${all[k] === 'S' ? 'select' : ''}" data-action="part" data-part="${k}" data-value="S">Sai</button></div></div>`).join('')}`; }
  return `<div class="stack" style="gap:10px"><input data-field="numberDraft" class="input" value="${esc(state.studentDrafts[a.id] ?? own ?? '')}" placeholder="Ví dụ: -2 hoặc 0,5 hoặc 1/2" inputmode="decimal"><button class="btn primary block" data-action="number">Gửi đáp án</button><div class="hint">Chỉ nhập kết quả bằng số.${own != null ? ' Đã gửi: <b>' + esc(own) + '</b>' : ''}</div></div>`;
}
function studentActive(room, a, m) {
  const own = a.responses[m.id];
  return `<section class="panel stack student-head"><div class="row"><span class="pill"><span class="dot"></span> Cô vừa mở hoạt động</span><span class="chip">${a.kind === 'checkin' ? 'Check-in' : 'Câu ' + numberOf(room, a)}</span></div><div><div class="title-eyebrow">${a.kind === 'checkin' ? esc(a.title) : esc(labelKind[a.kind])}</div><h2 style="margin:8px 0 0">${esc(a.prompt)}</h2></div>${studentAnswer(room, a, m)}<div class="banner ${own ? '' : 'info'}">${own ? '✓ Đã ghi nhận câu trả lời của con. Con có thể thay đổi cho đến khi cô chốt.' : 'Chọn một đáp án để gửi tới cô.'}</div></section>`;
}
function studentReport(room, m, ended) {
  const s = studentStats(room, m);
  const last = [...room.activities].reverse().find((a) => a.status === 'graded' && a.responses[m.id]);
  return `<section class="panel stack"><div><div class="title-eyebrow">${ended ? 'Báo cáo cuối giờ' : 'Tiến độ hiện tại'}</div><h2 style="margin:5px 0">${ended ? 'Hôm nay con học thế nào?' : 'Cùng theo dõi nhé!'}</h2></div><div class="report-grid"><div class="stat"><small>Tỷ lệ tham gia</small><b>${percent(s.participation)}</b><small>${s.answered}/${s.eligible} câu đã chấm</small></div><div class="stat"><small>Tỷ lệ chính xác</small><b>${percent(s.accuracy)}</b><small>${s.correct}/${s.answered} câu trả lời</small></div></div><div class="mutedbox"><div class="row"><span>Check-in hoàn thành</span><b>${s.checked}/${s.checkins}</b></div><div class="progress" style="margin-top:9px"><div style="width:${s.checkins ? 100 * s.checked / s.checkins : 0}%"></div></div></div>${last ? `<div class="banner ${graded(last, last.responses[m.id]) ? '' : 'info'}">${graded(last, last.responses[m.id]) ? '✓' : 'ℹ'} Lượt được chấm gần nhất: <b>${graded(last, last.responses[m.id]) ? 'Chính xác!' : 'Chưa chính xác'}</b>${last.kind === 'tf4' ? ` (${correctParts(last, last.responses[m.id])}/4 ý đúng)` : ''}.</div>` : ''}${ended ? `<div class="callout">🌱 Cảm ơn con đã tham gia! Báo cáo này phản ánh mức độ tham gia trả lời, không phải tỷ lệ kiến thức con đã nắm vững.</div>` : `<div class="hint">Phần trăm chỉ tính các câu đã được cô chốt và chấm. Các câu bị bỏ qua không tính.</div>`}</section>`;
}
function student(room) {
  const m = room.members[state.conn.uid];
  const a = active(room);
  const s = studentStats(room, m);
  const side = room.status === 'ended' ? '' : !a ? studentReport(room, m, false) : `<div class="panel"><div class="title-eyebrow">Tiến độ hôm nay</div><div class="row" style="margin-top:6px"><b>${s.answered} câu đã trả lời và chấm</b><span class="chip">${percent(s.participation)}</span></div></div>`;
  return `<div class="student-shell">${headline(room, false)}<div class="row mb"><div>Xin chào, <span class="student-name">${esc(m.name)}</span> 👋</div><span class="chip ${room.status === 'ended' ? '' : 'good'}">${room.status === 'ended' ? 'Đã kết thúc' : 'Đang học'}</span></div>${isPreview() ? '<div class="banner info">Cô đang xem thử như học sinh. Câu trả lời ở đây không tính vào báo cáo lớp.</div>' : ''}<div class="stack">${room.status === 'ended' ? studentReport(room, m, true) : a ? studentActive(room, a, m) : `<section class="panel empty-state"><div class="emoji">☕</div><h3 style="color:var(--ink);margin-bottom:4px">Đang chờ câu hỏi tiếp theo</h3><p class="muted tight">Khi cô mở lượt mới, bảng trả lời sẽ xuất hiện ở đây.</p></section>`}${side}</div><p class="footer">Lớp Mình Live · Giao diện gọn cho cửa sổ laptop và điện thoại</p></div>`;
}
function view() {
  const room = getRoom();
  if (state.role === 'home') return home();
  if (!room) return '<p class="muted">Đang tải dữ liệu lớp…</p>';
  return state.role === 'teacher' ? teacher(room) : student(room);
}

// Vẽ lại giao diện mà không làm mất ô đang gõ: giữ nguyên chữ, vị trí con trỏ và focus.
// Dùng setTimeout thay requestAnimationFrame: tab nền (học sinh đang xem Zoom/Meet) vẫn được cập nhật.
let lastHtml = '', frame = 0;
const BASE_TITLE = document.title;
function render() { if (!frame) frame = setTimeout(doRender, 16); }
function doRender() {
  frame = 0;
  const root = document.getElementById('app');
  const html = view();
  // Học sinh để tab này ở nền: tiêu đề tab báo khi cô mở câu mới mà con chưa trả lời.
  const r = state.room, a = state.role === 'student' && r && r.status === 'live' ? active(r) : null;
  document.title = a && !a.responses[state.conn.uid] ? '🔔 Cô đang chờ con trả lời · Lớp Mình Live' : BASE_TITLE;
  if (html === lastHtml) return;
  const ae = document.activeElement;
  let keep = null;
  if (ae && root.contains(ae) && ae.dataset?.field) keep = { field: ae.dataset.field, mid: ae.dataset.mid || '', value: ae.value, s: ae.selectionStart, e: ae.selectionEnd };
  const y = window.scrollY;
  root.innerHTML = html; lastHtml = html;
  if (keep) {
    const sel = `[data-field="${CSS.escape(keep.field)}"]` + (keep.mid ? `[data-mid="${CSS.escape(keep.mid)}"]` : '');
    const el = root.querySelector(sel);
    if (el) { el.value = keep.value; el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch { /* ô email không hỗ trợ */ } }
  }
  if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
}

// ---------- Sự kiện ----------
async function copyText(txt, okMsg) {
  try { await navigator.clipboard.writeText(txt); toast(okMsg); return true; } catch { /* thử cách cũ */ }
  const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select();
  const ok = document.execCommand('copy'); t.remove(); toast(ok ? okMsg : 'Không sao chép được'); return ok;
}
function actOnClick(el) {
  const action = el.dataset.action; const room = getRoom();
  switch (action) {
    case 'create': createRoom(); break;
    case 'resume': resumeTeacher(el.dataset.code); break;
    case 'join': joinStudent(state.joinCode, state.joinName); break;
    case 'preview': if (room) joinStudent(room.code, 'Học sinh demo (cô xem thử)', true); break;
    case 'teacher': if (conns.teacher?.uid) openTeacher(conns.teacher, state.roomCode); break;
    case 'home': goHome(); break;
    case 'open': openActivity(el.dataset.kind); break;
    case 'checkin': openActivity('checkin', el.dataset.phase); break;
    case 'answer': storeAnswer(el.dataset.value); break;
    case 'part': {
      const a = active(room); if (!a) return;
      const old = state.studentDrafts[a.id] || a.responses[state.conn.uid]?.value || {};
      const d = { ...old, [el.dataset.part]: el.dataset.value }; state.studentDrafts[a.id] = d;
      if (['a', 'b', 'c', 'd'].every((p) => d[p])) storeAnswer(d); render(); break;
    }
    case 'number': {
      const a = active(room); if (!a) return;
      const v = norm(state.studentDrafts[a.id] ?? '');
      if (parseNumeric(v) === null) { toast('Vui lòng nhập một số hợp lệ'); return; }
      storeAnswer(v); break;
    }
    case 'key': { const a = active(room); if (!a) return; state.keys[a.id] = el.dataset.val; saveDraftKey(a.id); render(); break; }
    case 'keypart': { const a = active(room); if (!a) return; state.keys[a.id] = { ...(state.keys[a.id] || {}), [el.dataset.part]: el.dataset.val }; saveDraftKey(a.id); render(); break; }
    case 'close': closeActivity(false); break;
    case 'skip': closeActivity(true); break;
    case 'end': endClass(); break;
    case 'copy': copyText(room?.code || '', 'Đã sao chép mã lớp'); break;
    case 'copyLink': copyText(linkStudent(), 'Đã sao chép link vào lớp'); break;
    case 'csv': exportCsv(); break;
    case 'reset': reset(); break;
    case 'addRoster': addRoster(); break;
    case 'observe': setObservation(el.dataset.mid, el.dataset.field, el.dataset.value); break;
    case 'parentPreview': state.parentPreviewId = el.dataset.mid; render(); window.scrollTo(0, 0); break;
    case 'backTeacher': state.parentPreviewId = null; render(); window.scrollTo(0, 0); break;
    case 'printReport': window.print(); break;
    case 'copyParent': {
      const m = room?.members[state.parentPreviewId]; if (!m) return;
      copyText(parentMessage(room, m), 'Đã sao chép tin nhắn cá nhân').then((ok) => { if (ok) markDelivered(m.id); }); break;
    }
    case 'emailParent': {
      const m = room?.members[state.parentPreviewId]; if (!m) return;
      const email = norm(fieldValue('parentEmail', m.id, observation(m).parentEmail));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Hãy nhập email PH hợp lệ'); return; }
      const subject = `Báo cáo buổi học ${room.name} - ${formatDate(room.createdAt)} - ${m.name}`;
      window.location.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(parentMessage(room, m));
      markDelivered(m.id); toast('Đã mở ứng dụng email để cô kiểm tra và gửi'); break;
    }
  }
}
document.addEventListener('click', (e) => { const btn = e.target.closest('[data-action]'); if (btn && !btn.disabled) actOnClick(btn); });
document.addEventListener('input', (e) => {
  const f = e.target.dataset.field, v = e.target.value; if (!f) return;
  switch (f) {
    case 'createName': state.createName = v; break;
    case 'joinCode': state.joinCode = v; break;
    case 'joinName': state.joinName = v; break;
    case 'rosterDraft': state.rosterDraft = v; break;
    case 'search': state.search = v; render(); break;
    case 'rightNum': { const a = active(getRoom()); if (a) { state.keys[a.id] = v; clearTimeout(draftTimers.key); draftTimers.key = setTimeout(() => saveDraftKey(a.id), 700); } break; }
    case 'numberDraft': { const a = active(getRoom()); if (a) state.studentDrafts[a.id] = v; break; }
    case 'obsNote': storeObservationField(e.target.dataset.mid, 'note', v); break;
    case 'note': case 'parentName': case 'parentEmail': storeObservationField(e.target.dataset.mid, f, v); break;
  }
});
document.addEventListener('change', (e) => {
  const f = e.target.dataset.field;
  if (['obsNote', 'note', 'parentName', 'parentEmail'].includes(f)) storeObservationField(e.target.dataset.mid, f === 'obsNote' ? 'note' : f, e.target.value, true);
});
document.addEventListener('toggle', (e) => { if (e.target.classList?.contains('roster-add')) state.rosterOpen = e.target.open; }, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (state.role === 'home' && (e.target.id === 'joinName' || e.target.id === 'joinCode')) joinStudent(state.joinCode, state.joinName);
  if (state.role === 'student' && e.target.dataset.field === 'numberDraft') actOnClick({ dataset: { action: 'number' } });
});

// ---------- Khởi động ----------
(async function start() {
  document.getElementById('envPill').textContent = IS_LOCAL ? 'BẢN THỬ TRÊN MÁY' : 'LỚP HỌC ONLINE';
  const urlRoom = (new URLSearchParams(location.search).get('room') || '').replace(/\D/g, '').slice(0, 6);
  if (urlRoom) state.joinCode = urlRoom;
  try { state.joinName = localStorage.getItem('lopminh:lastName') || ''; } catch { /* bỏ qua */ }
  const s = readSession();
  render(); showNet();
  // F5 / mở lại tab: quay về đúng phòng và vai trò cũ.
  if (s?.role === 'teacher' && s.code) await resumeTeacher(s.code);
  else if (s?.role === 'student' && s.code && s.name && (!urlRoom || urlRoom === s.code)) await joinStudent(s.code, s.name);
})();
