// Lớp Mình Live — bản online. Hai trang dùng chung file này:
//   /            trang HỌC SINH (link cố định cô gửi một lần: /?lop=123456)
//   /giao-vien/  trang GIÁO VIÊN (tạo lớp, mở buổi học, điều khiển, báo cáo)
// Một LỚP dùng cả khoá: mỗi tuần cô bấm "Bắt đầu buổi học", học sinh mở lại đúng link cũ.
// Mỗi lớp có bộ tính năng riêng do cô chọn khi tạo lớp (meta/features); giao diện chỉ hiện phần được bật.
// Dữ liệu đồng bộ qua Firebase Realtime Database; quyền đọc/ghi do database.rules.json quyết định.
import {
  initializeApp, initializeAuth, signInAnonymously, connectAuthEmulator, browserSessionPersistence, browserLocalPersistence,
  getDatabase, connectDatabaseEmulator, ref, set, update, get, onValue, onDisconnect, serverTimestamp, QRCode,
} from './vendor/vendor.js';

const MODE = document.body.dataset.mode === 'teacher' ? 'teacher' : 'student';
const STUDENT_PAGE = MODE === 'teacher' ? '../' : './';

// ---------- Kết nối Firebase ----------
// Trên máy (localhost) dùng Firebase emulator qua tool/serve.mjs; trên mạng dùng project lop-minh-live.
// Cấu hình web Firebase là thông tin công khai; bảo mật nằm ở database.rules.json.
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const FIREBASE_CONFIG = IS_LOCAL ? {
  apiKey: 'demo-key',
  authDomain: 'demo-lopminh.firebaseapp.com',
  projectId: 'demo-lopminh',
  databaseURL: 'https://demo-lopminh-default-rtdb.firebaseio.com',
} : {
  apiKey: "AIzaSyBSFmOf72l8-SnxXAqI6iIhUKw35j-1fOE",
  authDomain: "lop-minh-live.firebaseapp.com",
  databaseURL: "https://lop-minh-live-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "lop-minh-live",
  appId: "1:185046600430:web:4c7960a7da6c2b65fec1ff",
};
const ROOT = 'lopminh/classes';
const P = (code, sub) => ROOT + '/' + code + (sub ? '/' + sub : '');
// Danh tính được nhớ trên máy, nên tuần sau mở lại link vẫn là em đó.
// Thử nhiều học sinh trên một máy: thêm &thu vào link, mỗi tab là một học sinh.
const TEST_TABS = new URLSearchParams(location.search).has('thu');
const studentStore = TEST_TABS ? sessionStorage : localStorage;

const conns = {};
function conn(kind) {
  if (!conns[kind]) {
    const app = initializeApp(FIREBASE_CONFIG, 'lopminh-' + kind);
    const persistence = kind === 'student' && TEST_TABS ? browserSessionPersistence : browserLocalPersistence;
    const auth = initializeAuth(app, { persistence });
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

// ---------- Tính năng cô chọn cho từng lớp ----------
const FEATURES = [
  { id: 'quick', group: 'ask', icon: '⚡', label: 'Hỏi nhanh', desc: 'Cô chiếu đề trên Zoom/Meet, các con chỉ bấm đáp án. Không cần soạn trước.' },
  { id: 'bank', group: 'ask', icon: '📚', label: 'Câu hỏi soạn sẵn', desc: 'Các con thấy đề ngay trên máy mình (gõ được công thức toán). Cô chốt là chấm luôn.' },
  { id: 'checkin', group: 'ask', icon: '🌤️', label: 'Check-in', desc: 'Đầu, giữa, cuối giờ: con sẵn sàng chưa, có theo kịp không. Không chấm điểm.' },
  { id: 'attendance', group: 'track', icon: '✅', label: 'Điểm danh', desc: 'Em nào vào lớp tự được tính có mặt; cô chỉ chạm vào em vắng, đến muộn.' },
  { id: 'camera', group: 'track', icon: '📷', label: 'Bật camera', desc: 'Cô chạm vào tên để đánh dấu em bật/tắt camera.' },
  { id: 'called', group: 'track', icon: '🙋', label: 'Khi gọi tên', desc: 'Em có trả lời khi được gọi không.' },
  { id: 'note', group: 'track', icon: '📝', label: 'Nhận xét từng em', desc: 'Vài dòng ghi chú cho mỗi em sau từng buổi.' },
  { id: 'parent', group: 'after', icon: '👪', label: 'Báo cáo phụ huynh', desc: 'Cuối buổi, mỗi em một tin nhắn soạn sẵn để cô gửi Zalo/email.' },
  { id: 'selfReport', group: 'after', icon: '🌟', label: 'Học sinh xem kết quả', desc: 'Sau mỗi câu các con biết mình đúng hay chưa; cuối buổi thấy mình làm được bao nhiêu câu.' },
];
const ALL_FEATURES = FEATURES.map((f) => f.id);
const SETUP_QUESTIONS = [
  ['ask', 'Trong giờ học, cô muốn các con tương tác thế nào?'],
  ['track', 'Cô muốn ghi lại gì về từng em?'],
  ['after', 'Sau buổi học thì sao?'],
];
const DEFAULT_ON = ['quick', 'checkin', 'attendance', 'camera', 'note', 'parent', 'selfReport'];
const KINDS = [['abcd', 'ABCD'], ['tf', 'Đúng / Sai'], ['tf4', 'Đ/S bốn ý'], ['num', 'Điền số']];
// Lớp tạo trước khi có phần tùy chỉnh: coi như bật hết.
function featuresOf(meta) {
  const f = meta?.features;
  const out = Object.fromEntries(ALL_FEATURES.map((id) => [id, f ? !!f[id] : true]));
  out.kinds = Object.fromEntries(KINDS.map(([k]) => [k, f?.kinds ? !!f.kinds[k] : true]));
  return out;
}
function feat(id) { return (state.view?.features || featuresOf(null))[id]; }
const anyTracking = () => ['attendance', 'camera', 'called', 'note'].some(feat);
// Điểm danh: em đã vào web mà cô chưa đánh dấu thì tính là có mặt.
function attendanceOf(m) { const a = observation(m).attendance; return a !== 'unmarked' ? a : m.joinedAt != null ? 'present' : 'unmarked'; }

// ---------- Trạng thái trên trang ----------
const state = {
  role: 'home', code: '', conn: null, view: null, viewSid: null, joinCode: '', joinName: '',
  claimCode: '', claimKey: '', keys: {}, studentDrafts: {}, parentPreviewId: null,
  rosterDraft: '', rosterOpen: false, search: '', busy: false, setup: null, bankEdit: null,
  teacher: null, catalog: [],
  tab: 'class', tapMode: 'attendance', pick: null, dismissed: {}, justEnded: null, joinClassName: '', showCodeInput: false,
  myClasses: loadJSON(localStorage, 'lopminh:myClasses', []),
};
let unsubs = [];
const raw = {}; // dữ liệu thô từ Firebase của lớp đang mở
const now = () => Date.now();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (n) => String(n ?? '').trim().replace(/\s+/g, ' ');
// Đề bài: giữ xuống dòng, công thức trong $…$ do KaTeX vẽ sau khi hiển thị.
const rich = (s) => `<span class="rich">${esc(s).replace(/\n/g, '<br>')}</span>`;
const labelKind = { abcd: 'Trắc nghiệm A/B/C/D', tf: 'Đúng hoặc Sai', tf4: 'Đúng/Sai bốn ý', num: 'Trả lời ngắn', checkin: 'Check-in' };
const quickTypes = [['abcd', 'ABCD', 'Chọn một đáp án', '◩'], ['tf', 'Đúng / Sai', 'Một nhận định', '✓'], ['tf4', 'Đ/S bốn ý', 'a, b, c, d', '⊞'], ['num', 'Điền số', 'Số nguyên, thập phân, phân số', '№']];
const checkins = {
  start: { title: 'Check-in đầu giờ', prompt: 'Hôm nay con có sẵn sàng học không?', options: ['Rất sẵn sàng!! 🫡🫡🫡', 'Sẵn sàng ạ 🫡', 'Nay con hơi mệt nhưng sẽ cố gắng ạ 😊'] },
  middle: { title: 'Check-in giữa giờ', prompt: 'Con còn theo kịp bài không?', options: ['😊 Con hiểu bài', '🤔 Cần chậm lại', '🙋 Cần giải thích thêm'] },
  end: { title: 'Check-in cuối giờ', prompt: 'Con cảm thấy thế nào về bài học hôm nay?', options: ['✨ Khá tự tin', '🙂 Hiểu phần lớn', '🌱 Cần ôn thêm'] },
};
const DEFAULT_OBS = { attendance: 'unmarked', camera: 'unknown', called: 'not_called', note: '', parentName: '', parentEmail: '', delivery: 'not_sent' };
const attendanceLabels = { unmarked: 'Chưa điểm danh', present: 'Có mặt', late: 'Đến muộn', absent: 'Vắng', excused: 'Có phép' };
const cameraLabels = { unknown: 'Chưa kiểm tra', on: 'Có bật', off: 'Không bật', exempt: 'Không yêu cầu' };
const calledLabels = { not_called: 'Chưa gọi', answered: 'Có trả lời', no_answer: 'Không trả lời' };
const deliveryLabels = { not_sent: 'Chưa gửi', manually_shared: 'Đã soạn gửi' };

function loadJSON(store, key, dflt) { try { return JSON.parse(store.getItem(key) || 'null') ?? dflt; } catch { return dflt; } }
function saveJSON(store, key, v) { try { v == null ? store.removeItem(key) : store.setItem(key, JSON.stringify(v)); } catch { /* bỏ qua */ } }
function saveMyClasses() { saveJSON(localStorage, 'lopminh:myClasses', state.myClasses.slice(0, 20)); }

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}
function showNet() {
  const c = state.conn || Object.values(conns).find((x) => x.uid);
  const off = !!c && c.online === false;
  const pill = document.getElementById('netPill');
  pill.classList.toggle('offline', off); pill.hidden = !off;
  document.getElementById('netText').textContent = 'Mất mạng';
}
function fail(e, msg) {
  console.warn(e);
  toast(String(e?.code || e?.message || '').includes('PERMISSION') ? (msg || 'Không có quyền thực hiện thao tác này') : 'Lỗi kết nối, thử lại');
}
const normalizeName = (s) => norm(s).normalize('NFC').toLocaleLowerCase('vi-VN');
// Mã cố định theo tên: cùng họ tên (không phân biệt hoa thường, khoảng trắng) luôn là một dòng trong danh sách,
// nên học sinh đổi máy hay vào lại tuần sau vẫn được ghép đúng.
function nameId(name) {
  let h = 0x811c9dc5;
  for (const ch of normalizeName(name)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'n' + h.toString(16).padStart(8, '0');
}
function formatDate(t) { return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(t || now())); }
function shortDate(t) { return formatDate(t).slice(0, 5); } // "16/11"
function observation(m) { return { ...DEFAULT_OBS, ...(m.observation || {}) }; }
function randomKey() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = crypto.getRandomValues(new Uint8Array(10)); return [...b].map((x) => a[x % a.length]).join(''); }
function rosterUpdates(text, existing, base) {
  const u = {}; let count = 0;
  for (const [i, name] of String(text || '').split(/\r?\n|;/).map(norm).filter(Boolean).slice(0, 100).entries()) {
    const rid = nameId(name);
    if (existing?.[rid] || u['roster/' + rid]) continue;
    u['roster/' + rid] = { name: name.slice(0, 60), order: base + i }; count++;
  }
  return { u, count };
}

// ---------- Ghép dữ liệu Firebase thành "room" của một buổi học ----------
function sessionList(d) {
  return Object.entries(d?.sessions || {}).map(([id, s]) => ({ id, ...s })).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || (a.n || 0) - (b.n || 0));
}
function activitiesFrom(obj) {
  return Object.entries(obj || {}).map(([id, a]) => ({ id, ...a, options: a.options || null, responses: {} })).sort((x, y) => (x.seq || 0) - (y.seq || 0));
}
const autoRosterSent = new Set();
// Học sinh vào lớp bằng tên chưa có trong danh sách: tự thêm vào danh sách để cô theo dõi.
function syncRoster(d) {
  const hosts = d.hosts || {}, roster = d.roster || {}, toAdd = {};
  for (const [uid, m] of Object.entries(d.members || {})) {
    if (hosts[uid] || !m?.name) continue;
    const rid = nameId(m.name);
    if (!roster[rid] && !autoRosterSent.has(rid)) /* removed vẫn là có trong roster */ { autoRosterSent.add(rid); toAdd['roster/' + rid] = { name: m.name, order: now(), auto: true }; }
  }
  if (Object.keys(toAdd).length) update(ref(state.conn.db, P(state.code)), toAdd).catch((e) => console.warn(e));
}
function buildSessionRoom(d, sid) {
  const session = d.sessions?.[sid]; if (!session) return null;
  const hosts = d.hosts || {}, obs = d.obs?.[sid] || {}, guardians = d.guardians || {}, attend = d.attend?.[sid] || {}, resp = d.responses || {};
  const isLive = d.state?.sessionId === sid;
  const persons = {};
  const add = (rid, name, order) => (persons[rid] = { id: rid, name, order: order || 0, joinedAt: null, online: false, uids: [], observation: { ...(obs[rid] || {}), ...(guardians[rid] || {}) } });
  for (const [rid, r] of Object.entries(d.roster || {})) if (!r.removed) add(rid, r.name, r.order);
  for (const [uid, m] of Object.entries(d.members || {})) {
    if (hosts[uid] || !m?.name) continue; // màn "xem thử như học sinh" của cô không tính vào lớp
    const rid = nameId(m.name);
    if (d.roster?.[rid]?.removed) continue;
    const p = persons[rid] || add(rid, m.name, now());
    p.uids.push(uid);
    const j = attend[uid];
    if (typeof j === 'number' && (p.joinedAt == null || j < p.joinedAt)) p.joinedAt = j;
    if (isLive && m.online && j != null) p.online = true;
  }
  const activities = activitiesFrom(d.acts?.[sid]);
  for (const a of activities) {
    for (const p of Object.values(persons)) {
      let best = null;
      for (const uid of p.uids) { const r = resp[uid]?.[sid]?.[a.id]; if (r && (!best || (r.at || 0) > (best.at || 0))) best = r; }
      if (best) a.responses[p.id] = best;
    }
  }
  const sorted = Object.fromEntries(Object.values(persons).sort((x, y) => (x.order - y.order) || x.name.localeCompare(y.name, 'vi')).map((p) => [p.id, p]));
  return {
    code: state.code, sid, n: session.n, name: d.meta?.name || '', createdAt: session.startedAt, status: isLive ? 'live' : 'ended',
    endedAt: session.endedAt, activeId: isLive ? (d.state?.activeId || null) : null, members: sorted, activities,
  };
}
function bankList(d) {
  return Object.entries(d?.bank || {}).map(([id, q]) => ({ id, ...q })).sort((a, b) => (a.order || 0) - (b.order || 0));
}
function buildTeacherView() {
  const d = raw.cls; if (!d || !d.meta) return null;
  syncRoster(d);
  const sessions = sessionList(d);
  const liveSid = d.state?.sessionId || null;
  // Tab Giờ học luôn là buổi đang diễn ra.
  if (!state.viewSid || !d.sessions?.[state.viewSid] || (state.tab === 'class' && liveSid)) state.viewSid = liveSid || sessions[sessions.length - 1]?.id || null;
  const room = state.viewSid ? buildSessionRoom(d, state.viewSid) : null;
  const allRooms = sessions.map((s) => buildSessionRoom(d, s.id)).filter(Boolean);
  // Lớp chưa có buổi nào: vẫn hiện danh sách lớp để cô chuẩn bị.
  const rosterOnly = room || { code: state.code, sid: null, name: d.meta.name, status: 'none', activities: [], members: buildSessionRoom({ ...d, sessions: { x: { n: 0 } } }, 'x').members };
  return { name: d.meta.name, code: state.code, adminKey: d.adminKey, features: featuresOf(d.meta), sessions, liveSid, room: rosterOnly, allRooms, bank: bankList(d) };
}
function buildStudentView() {
  if (!raw.meta || !raw.member) return null;
  const uid = state.conn.uid;
  const sessions = sessionList({ sessions: raw.sessions });
  const liveSid = raw.state?.sessionId || null;
  const roomFor = (sid) => {
    const s = raw.sessions?.[sid]; if (!s) return null;
    const isLive = sid === liveSid;
    const activities = activitiesFrom(raw.acts?.[sid]);
    for (const a of activities) { const r = raw.responses?.[sid]?.[a.id]; if (r) a.responses[uid] = r; }
    const j = raw.attend?.[sid];
    const members = { [uid]: { id: uid, name: raw.member.name, joinedAt: typeof j === 'number' ? j : null, observation: {} } };
    return { code: state.code, sid, n: s.n, name: raw.meta.name, createdAt: s.startedAt, status: isLive ? 'live' : 'ended', endedAt: s.endedAt, activeId: isLive ? (raw.state?.activeId || null) : null, members, activities };
  };
  return { name: raw.meta.name, code: state.code, features: featuresOf(raw.meta), sessions, liveSid, room: liveSid ? roomFor(liveSid) : null, history: sessions.filter((s) => s.id !== liveSid).map((s) => roomFor(s.id)).filter(Boolean) };
}
function getRoom() { return state.view?.room || null; }
function refresh() {
  state.view = state.role === 'teacher' ? buildTeacherView() : state.role === 'student' ? buildStudentView() : state.view;
  if (state.role === 'student') ensureAttend();
  render();
}

// ---------- Mở / đóng kết nối tới một lớp ----------
function stopListening() { for (const u of unsubs) u(); unsubs = []; for (const k of Object.keys(raw)) delete raw[k]; state.view = null; }
function listenTeacher(code) {
  stopListening();
  unsubs.push(onValue(ref(state.conn.db, P(code)), (s) => {
    raw.cls = s.val();
    if (!raw.cls) { toast('Lớp này đã bị xoá'); goHome(); return; }
    // Đáp án nháp của cô được lưu lên máy chủ để F5 không mất.
    for (const [sid, list] of Object.entries(raw.cls.drafts || {})) for (const [aid, k] of Object.entries(list || {})) if (state.keys[sid + '/' + aid] == null) state.keys[sid + '/' + aid] = k;
    refresh();
  }, (e) => { fail(e, 'Máy này chưa có quyền quản lý lớp này'); goHome(); }));
}
function listenStudent(code) {
  stopListening();
  const db = state.conn.db, uid = state.conn.uid;
  const attendSubs = {};
  const on = (path, key, after) => {
    unsubs.push(onValue(ref(db, P(code, path)), (s) => {
      raw[key] = s.val();
      if (key === 'meta' && !raw.meta) { toast('Lớp học này đã bị xoá'); goHome(); return; }
      if (after) after();
      refresh();
    }, (e) => fail(e)));
  };
  on('meta', 'meta'); on('state', 'state'); on('acts', 'acts'); on('members/' + uid, 'member'); on('responses/' + uid, 'responses');
  // Giờ vào lớp của chính em ở từng buổi (để tính câu nào em có cơ hội trả lời).
  on('sessions', 'sessions', () => {
    raw.attend = raw.attend || {};
    for (const sid of Object.keys(raw.sessions || {})) {
      if (attendSubs[sid]) continue;
      attendSubs[sid] = true;
      unsubs.push(onValue(ref(db, P(code, 'attend/' + sid + '/' + uid)), (s) => { raw.attend[sid] = s.val(); refresh(); }, () => {}));
    }
  });
}
// Học sinh đang mở trang khi cô bắt đầu buổi: tự ghi "đã vào buổi này".
let attendWriting = '';
function ensureAttend() {
  const sid = raw.state?.sessionId;
  if (!sid || !raw.member || !raw.sessions?.[sid] || !raw.attend || !(sid in raw.attend)) return; // chờ tải xong
  if (raw.attend[sid] != null || attendWriting === sid) return;
  attendWriting = sid;
  set(ref(state.conn.db, P(state.code, 'attend/' + sid + '/' + state.conn.uid)), serverTimestamp())
    .catch((e) => console.warn(e)).finally(() => { attendWriting = ''; });
}
function goHome() {
  if (state.role === 'student' && state.conn && state.code && !isPreview()) {
    set(ref(state.conn.db, P(state.code, 'members/' + state.conn.uid + '/online')), false).catch(() => {});
    saveJSON(studentStore, 'lopminh:studentClass', null);
  }
  stopListening();
  state.role = 'home'; state.code = ''; state.parentPreviewId = null; state.viewSid = null; state.keys = {}; state.studentDrafts = {};
  state.setup = null; state.bankEdit = null; state.tab = 'class'; state.pick = null;
  if (MODE === 'teacher') saveJSON(sessionStorage, 'lopminh:teacherClass', null);
  render();
}

// ---------- Thiết lập lớp (tạo mới / tùy chỉnh) ----------
function openSetup(editing) {
  const f = editing ? state.view.features : featuresOf({ features: { ...Object.fromEntries(DEFAULT_ON.map((id) => [id, true])), kinds: { abcd: true, tf: true, tf4: true, num: true } } });
  state.setup = { editing: !!editing, name: editing ? state.view.name : '', features: { ...f, kinds: { ...f.kinds } }, roster: '' };
  if (!editing) state.role = 'setup';
  render(); window.scrollTo(0, 0);
}
function setupFeatures() {
  const f = state.setup.features;
  return { ...Object.fromEntries(ALL_FEATURES.map((id) => [id, !!f[id]])), kinds: Object.fromEntries(KINDS.map(([k]) => [k, !!f.kinds[k]])) };
}
async function saveSetup() {
  const s = state.setup; if (!s || state.busy) return;
  const name = norm(s.name).slice(0, 70);
  if (!name) { toast('Nhập tên lớp'); return; }
  if (s.features.quick && !KINDS.some(([k]) => s.features.kinds[k])) { toast('Câu hỏi nhanh: chọn ít nhất một dạng câu'); return; }
  const features = setupFeatures();
  if (s.editing) {
    const ok = await write({ 'meta/name': name, 'meta/features': features });
    if (ok) set(ref(state.conn.db, 'lopminh/catalog/' + state.code + '/name'), name).catch(() => {});
    if (ok) { state.myClasses = state.myClasses.map((r) => (r.code === state.code ? { ...r, name } : r)); saveMyClasses(); state.setup = null; toast('Đã lưu'); render(); }
    return;
  }
  state.busy = true;
  try {
    const c = await conn('teacher');
    const key = randomKey();
    const { u } = rosterUpdates(s.roster, null, now());
    const roster = Object.fromEntries(Object.entries(u).map(([k, v]) => [k.slice('roster/'.length), v]));
    let code = null;
    for (let i = 0; i < 6 && !code; i++) {
      const tryCode = String(Math.floor(100000 + Math.random() * 900000));
      try {
        await set(ref(c.db, P(tryCode)), { adminKey: key, hosts: { [c.uid]: key }, createdAt: serverTimestamp(), meta: { name, features }, ...(Object.keys(roster).length ? { roster } : {}) });
        code = tryCode;
      } catch (e) { if (!String(e?.code || e?.message).includes('PERMISSION')) throw e; } // trùng mã đang dùng → thử mã khác
    }
    if (!code) { toast('Không tạo được lớp, thử lại'); return; }
    await set(ref(c.db, 'lopminh/catalog/' + code), { name, createdAt: serverTimestamp() }).catch((e) => console.warn(e));
    rememberClass(code, name, key);
    state.setup = null;
    openTeacher(c, code);
    toast('Đã tạo lớp ' + name);
  } catch (e) { fail(e); } finally { state.busy = false; }
}
function rememberClass(code, name, key) {
  const old = state.myClasses.find((r) => r.code === code);
  state.myClasses = [{ code, name: name || old?.name || code, key: key || old?.key || '' }, ...state.myClasses.filter((r) => r.code !== code)];
  saveMyClasses();
}
async function resumeTeacher(code, key) {
  try {
    const c = await conn('teacher');
    try {
      await get(ref(c.db, P(code, 'hosts/' + c.uid)));
    } catch {
      // Chưa có quyền trên máy này: dùng mã quản lý để nhận quyền.
      if (!key) { toast('Cần mã quản lý để mở lớp này'); return; }
      try { await set(ref(c.db, P(code, 'hosts/' + c.uid)), key); } catch { toast('Sai mã lớp hoặc mã quản lý'); return; }
    }
    const name = (await get(ref(c.db, P(code, 'meta/name')))).val();
    if (!name) { toast('Lớp ' + code + ' không còn'); state.myClasses = state.myClasses.filter((r) => r.code !== code); saveMyClasses(); render(); return; }
    rememberClass(code, name, key);
    openTeacher(c, code);
  } catch (e) { fail(e); }
}
function openTeacher(c, code) {
  state.conn = c; state.code = code; state.role = 'teacher'; state.parentPreviewId = null; state.viewSid = null; state.setup = null; state.bankEdit = null;
  saveJSON(sessionStorage, 'lopminh:teacherClass', code);
  listenTeacher(code); showNet();
}
function clsRef(sub) { return ref(state.conn.db, P(state.code, sub)); }
// Ghi nhiều đường dẫn một lần; trả về true/false để chỉ báo "đã xong" khi máy chủ nhận thật.
function write(updates, msg) { return update(clsRef(), updates).then(() => true, (e) => { fail(e, msg); return false; }); }

function nextSessionNo(v) { return v.sessions.reduce((m, s) => Math.max(m, s.n || 0), 0) + 1; }
function startSession() {
  const v = state.view; if (!v || v.liveSid) return;
  const n = Math.round(Number(state.sessionNo ?? nextSessionNo(v)));
  if (!(n >= 1 && n <= 999)) { toast('Số buổi phải từ 1 đến 999'); return; }
  if (v.sessions.some((s) => s.n === n) && !confirm('Đã có buổi ' + n + '. Vẫn tạo thêm buổi ' + n + '?')) return;
  const sid = 's' + now().toString(36);
  write({ ['sessions/' + sid]: { n, startedAt: serverTimestamp(), status: 'live' }, state: { sessionId: sid } }).then((ok) => {
    if (ok) { state.viewSid = sid; state.tab = 'class'; state.justEnded = null; state.sessionNo = null; toast('Đã bắt đầu buổi ' + n); }
  });
}
function renumberSession(sid) {
  const s = state.view?.sessions.find((x) => x.id === sid); if (!s) return;
  const v = prompt('Số thứ tự của buổi này:', s.n); if (v == null) return;
  const n = Math.round(Number(v)); if (!(n >= 1 && n <= 999)) { toast('Số buổi phải từ 1 đến 999'); return; }
  write({ ['sessions/' + sid + '/n']: n }).then((ok) => ok && toast('Đã đổi thành buổi ' + n));
}
// Xoá một buổi: câu hỏi, điểm danh, nhận xét của buổi đó.
function deleteSession(sid) {
  const v = state.view, s = v?.sessions.find((x) => x.id === sid); if (!s) return;
  if (!confirm('Xoá buổi ' + s.n + ' (' + shortDate(s.startedAt) + ')? Không khôi phục được.')) return;
  const u = { ['sessions/' + sid]: null, ['acts/' + sid]: null, ['obs/' + sid]: null, ['drafts/' + sid]: null };
  if (v.liveSid === sid) u.state = null;
  write(u).then((ok) => { if (ok) { state.viewSid = null; state.justEnded = null; toast('Đã xoá buổi ' + s.n); } });
}
// Xoá một câu đã hỏi trong buổi (không tính vào kết quả nữa).
function cancelActivity() {
  const room = getRoom(), a = active(room); if (!a) return;
  const n = Object.keys(a.responses).length;
  if (n && !confirm('Huỷ câu này? ' + n + ' học sinh đã trả lời, kết quả sẽ không tính.')) return;
  write({ ['acts/' + room.sid + '/' + a.id]: null, ['drafts/' + room.sid + '/' + a.id]: null, 'state/activeId': null }).then((ok) => ok && toast('Đã huỷ câu'));
}
function deleteActivity(sid, aid) {
  if (!confirm('Xoá câu này khỏi buổi học? Kết quả câu này sẽ không tính nữa.')) return;
  const u = { ['acts/' + sid + '/' + aid]: null, ['drafts/' + sid + '/' + aid]: null };
  if (state.view?.liveSid === sid && getRoom()?.activeId === aid) u['state/activeId'] = null;
  write(u).then((ok) => ok && toast('Đã xoá câu'));
}
// Xoá học sinh khỏi danh sách lớp (kể cả khi em đó từng vào bằng link).
function deleteStudent(rid) {
  const m = getRoom()?.members[rid]; if (!m) return;
  if (!confirm('Xoá ' + m.name + ' khỏi lớp?')) return;
  const u = { ['roster/' + rid]: { name: m.name, removed: true }, ['guardians/' + rid]: null };
  for (const s of state.view.sessions) u['obs/' + s.id + '/' + rid] = null;
  write(u).then((ok) => { if (ok) { state.pick = null; toast('Đã xoá ' + m.name); } });
}
function endClass() {
  const room = getRoom(); if (!room || room.status !== 'live') return;
  if (active(room)) { toast('Chốt câu đang mở trước'); return; }
  if (!confirm('Kết thúc buổi ' + room.n + '?')) return;
  write({ ['sessions/' + room.sid + '/status']: 'ended', ['sessions/' + room.sid + '/endedAt']: serverTimestamp(), state: null })
    .then((ok) => { if (ok) { state.justEnded = room.sid; state.tab = 'report'; toast('Đã kết thúc buổi ' + room.n); render(); window.scrollTo(0, 0); } });
}
async function deleteClass(code) {
  code = code || state.code;
  const name = state.catalog.find((r) => r.code === code)?.name || state.myClasses.find((r) => r.code === code)?.name || state.view?.name || code;
  if (!confirm('Xoá hẳn lớp "' + name + '" và mọi dữ liệu? Không khôi phục được.')) return;
  try {
    const c = state.conn && state.code === code ? state.conn : await conn('teacher');
    await set(ref(c.db, P(code)), null);
    await set(ref(c.db, 'lopminh/catalog/' + code), null).catch(() => {});
    toast('Đã xoá lớp');
  } catch (e) {
    if (!confirm('Máy này không xoá được lớp trên máy chủ. Chỉ bỏ lớp khỏi danh sách của máy này?')) return;
  }
  state.myClasses = state.myClasses.filter((r) => r.code !== code); saveMyClasses();
  if (state.code === code) goHome(); else render();
}

// ---------- Nhóm giáo viên: ai có mã giáo viên đều thấy và quản lý mọi lớp ----------
// Ai mở trang giáo viên đều là giáo viên: thấy mọi lớp (lopminh/catalog) và có toàn quyền.
async function initTeacher() {
  try {
    const c = await conn('teacher');
    await set(ref(c.db, 'lopminh/teachers/' + c.uid), true);
    state.teacher = true;
    onValue(ref(c.db, 'lopminh/catalog'), (x) => { state.catalog = Object.entries(x.val() || {}).map(([code, v]) => ({ code, ...v })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); render(); }, () => {});
    migrateLocalClasses(c);
    render(); return true;
  } catch (e) { fail(e); return false; }
}
// Lớp tạo trước đây (chỉ lưu trên máy này): đưa vào danh sách chung.
async function migrateLocalClasses(c) {
  for (const r of state.myClasses) {
    try {
      if ((await get(ref(c.db, 'lopminh/catalog/' + r.code))).exists()) continue;
      const name = (await get(ref(c.db, P(r.code, 'meta/name')))).val(); if (!name) continue;
      const createdAt = (await get(ref(c.db, P(r.code, 'createdAt')))).val() || now();
      await set(ref(c.db, 'lopminh/catalog/' + r.code), { name, createdAt });
    } catch (e) { console.warn(e); }
  }
}

// ---------- Thao tác giáo viên: trong buổi học ----------
function active(room) { return (room && room.activities.find((a) => a.id === room.activeId)) || null; }
// Số câu lưu cố định lúc mở (no), xoá câu khác không làm đổi số. Câu cũ chưa có no thì đếm như trước.
function numberOf(room, act) {
  if (act.no) return act.no;
  const i = room.activities.findIndex((a) => a.id === act.id); return room.activities.slice(0, i + 1).filter((a) => a.kind !== 'checkin').length;
}
const keyId = (room, a) => room.sid + '/' + a.id;
// extra: nội dung câu soạn sẵn (đề, lựa chọn) và đáp án có sẵn.
function openActivity(kind, phase, extra) {
  const room = getRoom(); if (!room || room.status !== 'live') return;
  if (active(room)) { toast('Chốt câu đang mở trước'); return; }
  const c = checkins[phase];
  const seq = room.activities.reduce((n, a) => Math.max(n, a.seq || 0), 0) + 1;
  const id = 'a' + now().toString(36); // mã riêng, không dùng lại mã của câu đã huỷ
  const a = { seq, kind, status: 'open', createdAt: serverTimestamp(), prompt: kind === 'checkin' ? c.prompt : 'Đáp án của em là gì?' };
  if (kind === 'checkin') Object.assign(a, { phase, title: c.title, options: c.options });
  else a.no = room.activities.filter((x) => x.kind !== 'checkin').reduce((n, x) => Math.max(n, numberOf(room, x)), 0) + 1;
  const u = {};
  if (extra) {
    a.prompt = extra.text; a.fromBank = extra.id;
    if (kind === 'abcd' && extra.options && Object.values(extra.options).some((x) => norm(x))) a.choices = extra.options;
    if (kind === 'tf4' && extra.statements) a.statements = extra.statements;
    state.keys[room.sid + '/' + id] = extra.key;
    u['drafts/' + room.sid + '/' + id] = extra.key; // đáp án chỉ máy cô đọc được cho tới khi chốt
  } else state.keys[room.sid + '/' + id] = kind === 'tf4' ? {} : '';
  u['acts/' + room.sid + '/' + id] = a; u['state/activeId'] = id;
  write(u).then((ok) => ok && toast(kind === 'checkin' ? 'Đã gửi ' + c.title.toLowerCase() : extra ? 'Đã mở câu soạn sẵn' : 'Đã mở ' + labelKind[kind]));
}
function saveDraftKey(room, a) { write({ ['drafts/' + keyId(room, a)]: state.keys[keyId(room, a)] || null }); }
function closeActivity(skip = false) {
  const room = getRoom(), a = active(room); if (!a) return;
  const base = 'acts/' + room.sid + '/' + a.id;
  const u = { 'state/activeId': null, [base + '/closedAt']: serverTimestamp(), ['drafts/' + keyId(room, a)]: null };
  let status;
  if (a.kind === 'checkin') status = 'closed';
  else if (skip) status = 'skipped';
  else {
    const key = state.keys[keyId(room, a)];
    if (!validKey(a.kind, key)) { toast(a.kind === 'tf4' ? 'Hãy chọn đủ đáp án đúng cho 4 ý' : a.kind === 'num' ? 'Đáp án đúng phải là số hợp lệ' : 'Hãy chọn đáp án đúng trước khi chốt'); return; }
    u[base + '/key'] = key; status = 'graded';
  }
  u[base + '/status'] = status;
  write(u).then((ok) => ok && toast(status === 'graded' ? 'Đã chốt' : status === 'skipped' ? 'Đã bỏ câu' : 'Đã đóng check-in'));
}
function validKey(kind, key) {
  if (kind === 'tf4') return !!key && ['a', 'b', 'c', 'd'].every((p) => ['Đ', 'S'].includes(key[p]));
  if (kind === 'num') return parseNumeric(key) !== null;
  if (kind === 'abcd') return ['A', 'B', 'C', 'D'].includes(key);
  if (kind === 'tf') return ['Đúng', 'Sai'].includes(key);
  return false;
}
function addRoster() {
  const v = state.view; if (!v) return;
  if (!norm(state.rosterDraft)) { toast('Nhập tên học sinh, mỗi dòng một tên'); return; }
  const { u, count } = rosterUpdates(state.rosterDraft, v.room.members, now());
  if (!count) { toast('Các tên này đã có trong danh sách'); return; }
  write(u).then((ok) => {
    if (!ok) return;
    state.rosterDraft = ''; const t = document.getElementById('rosterDraft'); if (t) t.value = '';
    toast('Đã thêm ' + count + ' học sinh vào danh sách lớp');
  });
}
function setObservation(id, field, value) {
  const room = getRoom(); if (!room?.sid || !room.members[id] || state.role !== 'teacher') return;
  const valid = { attendance: ['unmarked', 'present', 'late', 'absent', 'excused'], camera: ['unknown', 'on', 'off', 'exempt'], called: ['not_called', 'answered', 'no_answer'] };
  if (!valid[field] || !valid[field].includes(value)) return;
  const o = observation(room.members[id]);
  write({ ['obs/' + room.sid + '/' + id + '/' + field]: o[field] === value ? DEFAULT_OBS[field] : value });
}
const CYCLE = { attendance: ['present', 'late', 'absent', 'excused'], camera: ['unknown', 'on', 'off'], called: ['not_called', 'answered', 'no_answer'] };
function tapStudent(id) {
  const room = getRoom(), mode = state.tapMode; if (!room?.sid || !room.members[id] || !CYCLE[mode]) return;
  const m = room.members[id], cur = mode === 'attendance' ? attendanceOf(m) : observation(m)[mode];
  const list = CYCLE[mode], next = list[(list.indexOf(cur) + 1) % list.length];
  write({ ['obs/' + room.sid + '/' + id + '/' + mode]: next });
}
// Ô nhập của cô: giữ bản nháp trên trang, lưu sau 0,7 giây ngừng gõ (và khi rời ô).
// Nhận xét thuộc từng buổi; tên/email phụ huynh thuộc học sinh nên giữ cho mọi buổi sau.
const drafts = {}; const draftTimers = {};
function draftKey(field, mid) { return field + '|' + (state.view?.room?.sid || '') + '|' + (mid || ''); }
function storeObservationField(id, field, value, immediate) {
  const room = getRoom();
  if (state.role !== 'teacher' || !['note', 'parentName', 'parentEmail'].includes(field)) return;
  if (field === 'note' && !room?.sid) return;
  const k = draftKey(field, id);
  drafts[k] = value;
  clearTimeout(draftTimers[k]);
  const save = () => {
    const lim = field === 'note' ? 500 : 150;
    const v = norm(drafts[k]).slice(0, lim);
    const u = field === 'note'
      ? { ['obs/' + room.sid + '/' + id + '/note']: v, ['obs/' + room.sid + '/' + id + '/delivery']: 'not_sent' }
      : { ['guardians/' + id + '/' + field]: v };
    write(u).then((ok) => {
      if (ok && k in drafts && norm(drafts[k]).slice(0, lim) === v) delete drafts[k];
      render();
    });
  };
  if (immediate) save(); else draftTimers[k] = setTimeout(save, 700);
}
function fieldValue(field, id, saved) { const k = draftKey(field, id); return k in drafts ? drafts[k] : saved; }
function markDelivered(id) { const room = getRoom(); if (room?.sid) write({ ['obs/' + room.sid + '/' + id + '/delivery']: 'manually_shared' }); }

// ---------- Bộ câu hỏi soạn sẵn ----------
const blankChoices = () => ({ A: '', B: '', C: '', D: '' });
const blankStatements = () => ({ a: '', b: '', c: '', d: '' });
function openBankEditor(qid) {
  const q = qid ? state.view.bank.find((x) => x.id === qid) : null;
  const lastTopic = state.view.bank[state.view.bank.length - 1]?.topic || '';
  state.bankEdit = q
    ? { id: q.id, kind: q.kind, topic: q.topic || '', text: q.text || '', options: { ...blankChoices(), ...(q.options || {}) }, statements: { ...blankStatements(), ...(q.statements || {}) }, key: q.kind === 'tf4' ? { ...(q.key || {}) } : q.key ?? '', order: q.order }
    : { id: null, kind: 'abcd', topic: lastTopic, text: '', options: blankChoices(), statements: blankStatements(), key: '', order: null };
  render();
  setTimeout(() => document.getElementById('bankText')?.focus(), 30);
}
function saveBankQuestion() {
  const e = state.bankEdit; if (!e) return;
  const text = String(e.text || '').trim().slice(0, 1000);
  if (!text) { toast('Nhập nội dung câu hỏi'); return; }
  const key = e.kind === 'num' ? norm(e.key) : e.key;
  if (!validKey(e.kind, key)) { toast(e.kind === 'tf4' ? 'Chọn Đúng/Sai cho cả 4 ý' : e.kind === 'num' ? 'Đáp án phải là một số (vd 0,5 hoặc 1/2)' : 'Chọn đáp án đúng'); return; }
  const q = { kind: e.kind, topic: norm(e.topic).slice(0, 80), text, key, order: e.order || now() };
  if (e.kind === 'abcd') q.options = Object.fromEntries(Object.entries(e.options).map(([k, v]) => [k, String(v || '').trim().slice(0, 300)]));
  if (e.kind === 'tf4') q.statements = Object.fromEntries(Object.entries(e.statements).map(([k, v]) => [k, String(v || '').trim().slice(0, 300)]));
  const id = e.id || 'q' + now().toString(36) + Math.random().toString(36).slice(2, 5);
  write({ ['bank/' + id]: q }).then((ok) => { if (ok) { state.bankEdit = null; toast(e.id ? 'Đã sửa câu hỏi' : 'Đã thêm câu hỏi'); render(); } });
}
function deleteBankQuestion(qid) {
  if (!confirm('Xoá câu hỏi này?')) return;
  write({ ['bank/' + qid]: null }).then((ok) => ok && toast('Đã xoá câu hỏi'));
}
function openBankQuestion(qid) {
  const q = state.view.bank.find((x) => x.id === qid); if (!q) return;
  openActivity(q.kind, null, q);
}

// ---------- Thao tác học sinh ----------
async function joinStudent(code, name, asPreview) {
  code = norm(code).replace(/\D/g, ''); name = norm(name).slice(0, 60);
  if (!code || !name) { toast('Nhập mã lớp và họ tên'); return; }
  if (state.busy) return; state.busy = true;
  try {
    const c = asPreview ? state.conn : await conn('student');
    const meta = (await get(ref(c.db, P(code, 'meta')))).val();
    if (!meta) { toast('Không tìm thấy lớp có mã ' + code); return; }
    const mPath = P(code, 'members/' + c.uid);
    await set(ref(c.db, mPath), { name, online: true });
    onDisconnect(ref(c.db, mPath + '/online')).set(false);
    state.conn = c; state.code = code; state.role = 'student'; state.studentDrafts = {};
    if (!asPreview) {
      saveJSON(studentStore, 'lopminh:studentClass', { code, name });
      history.replaceState(null, '', location.pathname + '?lop=' + code + (TEST_TABS ? '&thu' : ''));
    }
    listenStudent(code); showNet();
  } catch (e) { fail(e, 'Không vào được lớp'); } finally { state.busy = false; }
}
// Cô xem màn học sinh: đánh dấu máy này là máy giáo viên của lớp trước, để "Xem thử" không bị tính là một học sinh.
async function previewAsStudent() {
  const d = raw.cls, uid = state.conn.uid, u = {};
  if (!d?.hosts?.[uid]) u['hosts/' + uid] = d.adminKey;
  const rid = nameId('Xem thử');
  if (d?.roster?.[rid]?.auto) u['roster/' + rid] = null; // dọn dòng "Xem thử" lỡ tạo trước đây
  if (Object.keys(u).length && !(await write(u))) return;
  joinStudent(state.code, 'Xem thử', true);
}
async function storeAnswer(value) {
  const room = getRoom(), a = active(room);
  if (!room || !a || a.status !== 'open' || state.role !== 'student') { toast('Không có hoạt động đang mở'); return; }
  const db = state.conn.db, uid = state.conn.uid;
  // Em vừa vào lớp: ghi "đã vào buổi" xong rồi mới gửi đáp án (luật cần có bản ghi này).
  if (raw.attend?.[room.sid] == null) await set(ref(db, P(state.code, 'attend/' + room.sid + '/' + uid)), serverTimestamp()).catch(() => {});
  try {
    await set(ref(db, P(state.code, 'responses/' + uid + '/' + room.sid + '/' + a.id)), { value, at: serverTimestamp() });
  } catch (e) {
    const still = active(getRoom())?.id === a.id;
    fail(e, still ? 'Chưa gửi được, bấm lại' : 'Cô đã chốt câu này, không gửi được nữa');
  }
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
const attendedSession = (m) => ['present', 'late'].includes(attendanceOf(m));
// Cộng dồn cả khoá cho một học sinh (theo mã danh sách lớp).
function courseStats(rooms, rid) {
  let sessions = 0, attended = 0, eligible = 0, answered = 0, correct = 0;
  for (const r of rooms) {
    const m = r.members[rid]; if (!m) continue;
    sessions++;
    if (attendedSession(m)) attended++;
    const s = studentStats(r, m); eligible += s.eligible; answered += s.answered; correct += s.correct;
  }
  return { sessions, attended, eligible, answered, correct, participation: eligible ? Math.round(answered / eligible * 100) : null, accuracy: answered ? Math.round(correct / answered * 100) : null };
}
function percent(v) { return v == null ? '—' : v + '%'; }
const hasQuestions = () => feat('quick') || feat('bank');
function getStatus(room) {
  return { count: Object.keys(room.members).length, graded: room.activities.filter((a) => a.status === 'graded').length, checks: room.activities.filter((a) => a.kind === 'checkin' && a.status === 'closed').length, opened: room.activities.filter((a) => a.kind !== 'checkin').length };
}
function linkStudent() { return new URL(STUDENT_PAGE + '?lop=' + encodeURIComponent(state.code), location.href).href; }
// Ô bắt đầu bằng = + - @ bị Excel hiểu là công thức: thêm dấu ' phía trước.
function csvCell(x) { let s = String(x ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
function downloadCsv(rows, filename) {
  const blob = new Blob(['﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); const url = URL.createObjectURL(blob);
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
// Cột của báo cáo buổi: chỉ những cột thuộc tính năng cô đã bật.
function sessionColumns() {
  return [
    ['Điểm danh', (m) => attendanceLabels[attendanceOf(m)], 'attendance'],
    ['Camera (quan sát)', (m, s, o) => cameraLabels[o.camera], 'camera'],
    ['Khi cô gọi', (m, s, o) => calledLabels[o.called], 'called'],
    ['Câu có cơ hội tham gia', (m, s) => s.eligible, 'q'],
    ['Số câu trả lời', (m, s) => s.answered, 'q'],
    ['Số câu đúng', (m, s) => s.correct, 'q'],
    ['Tỷ lệ tham gia', (m, s) => percent(s.participation), 'q'],
    ['Tỷ lệ chính xác', (m, s) => percent(s.accuracy), 'q'],
    ['Check-in', (m, s) => s.checked + '/' + s.checkins, 'checkin'],
    ['Nhận xét giáo viên', (m, s, o) => o.note, 'note'],
    ['Gửi PH', (m, s, o) => deliveryLabels[o.delivery] || o.delivery, 'parent'],
  ].filter(([, , f]) => (f === 'q' ? hasQuestions() : feat(f)));
}
function exportCsv() {
  const room = getRoom(); if (!room?.sid) return;
  const cols = sessionColumns();
  downloadCsv([['Học sinh', 'Buổi', 'Ngày', ...cols.map((c) => c[0])], ...Object.values(room.members).map((m) => {
    const s = studentStats(room, m), o = observation(m);
    return [m.name, room.n, formatDate(room.createdAt), ...cols.map((c) => c[1](m, s, o))];
  })], 'lop-minh-live-' + state.code + '-buoi-' + room.n + '.csv');
}
function exportCourseCsv() {
  const v = state.view; if (!v) return;
  const rooms = v.allRooms, q = hasQuestions();
  const header = ['Học sinh', feat('attendance') ? 'Số buổi có mặt' : 'Số buổi vào web', 'Tổng số buổi', ...(q ? ['Câu có cơ hội tham gia', 'Số câu trả lời', 'Số câu đúng', 'Tỷ lệ tham gia', 'Tỷ lệ chính xác'] : []),
    ...rooms.map((r) => 'Buổi ' + r.n + ' (' + shortDate(r.createdAt) + ')')];
  downloadCsv([header, ...Object.values(v.room.members).map((m) => {
    const c = courseStats(rooms, m.id);
    return [m.name, c.attended, rooms.length, ...(q ? [c.eligible, c.answered, c.correct, percent(c.participation), percent(c.accuracy)] : []),
      ...rooms.map((r) => {
        const x = r.members[m.id]; if (!x) return '';
        const o = observation(x), s = studentStats(r, x), bits = [];
        if (feat('attendance')) bits.push(attendanceLabels[attendanceOf(x)]);
        if (feat('camera')) bits.push('cam ' + cameraLabels[o.camera].toLowerCase());
        if (q) bits.push(s.answered + '/' + s.eligible + ' câu, đúng ' + s.correct);
        if (!bits.length) bits.push(x.joinedAt ? 'Có vào web' : 'Không vào web');
        return bits.join(' · ');
      })];
  })], 'lop-minh-live-' + state.code + '-tong-hop-ca-khoa.csv');
}

// ---------- Giao diện ----------
// Nguyên tắc: mỗi màn một việc, chữ ít và rõ, không ghi chú thừa.
function isPreview() { return state.role === 'student' && MODE === 'teacher'; }
const pct = (a, b) => (b ? Math.round(100 * a / b) : null);
function classAccuracy(room) {
  let right = 0, total = 0;
  for (const a of room.activities) {
    if (a.status !== 'graded') continue;
    for (const r of Object.values(a.responses)) { total++; if (graded(a, r)) right++; }
  }
  return { right, total, pct: pct(right, total) };
}
function lastClosed(room) { return [...room.activities].reverse().find((a) => a.status !== 'open') || null; }
let qrFor = '', qrUrl = '';
function qrImage() {
  const link = linkStudent();
  if (qrFor !== link) {
    qrFor = link; qrUrl = '';
    QRCode.toDataURL(link, { margin: 1, width: 300 }).then((u) => { if (qrFor === link) { qrUrl = u; render(); } }).catch(() => {});
  }
  return qrUrl ? `<img class="qr" src="${qrUrl}" alt="Mã QR vào lớp">` : '';
}

// ===== Trang chủ giáo viên =====
function teacherHome() {
  if (state.teacher === null) return '<p class="muted center">Đang tải…</p>';
  if (!state.teacher) return '<p class="muted center">Không kết nối được, tải lại trang.</p>';
  const cards = state.catalog.map((r) => `<div class="class-row"><button class="class-card" data-action="resume" data-code="${esc(r.code)}"><span class="class-icon">📘</span><span><b>${esc(r.name)}</b><small>Mã ${esc(r.code)}</small></span><span class="go">›</span></button><button class="icon-btn" data-action="deleteClass" data-code="${esc(r.code)}" title="Xoá lớp">🗑</button></div>`).join('');
  return `<div class="home">
<h1 class="home-title">Các lớp</h1>
<div class="class-list">${cards}<button class="class-card new" data-action="newClass"><span class="class-icon">＋</span><span><b>Tạo lớp mới</b></span></button></div>
</div>`;
}

// ===== Tạo lớp / tùy chỉnh =====
function setupView() {
  const s = state.setup, f = s.features;
  const card = (x) => `<button class="feat-card ${f[x.id] ? 'on' : ''}" data-action="toggleFeat" data-id="${x.id}" aria-pressed="${f[x.id] ? 'true' : 'false'}"><span class="feat-check">${f[x.id] ? '✓' : ''}</span><span class="feat-icon">${x.icon}</span><b>${x.label}</b></button>`;
  const titles = { ask: 'Trong giờ học', track: 'Theo dõi', after: 'Sau buổi học' };
  return `<div class="setup">
<button class="btn sm ghost" data-action="cancelSetup">← Quay lại</button>
<h1 class="home-title">${s.editing ? 'Tùy chỉnh lớp' : 'Tạo lớp mới'}</h1>
<section class="q-block"><h2>Tên lớp</h2><input id="setupName" data-field="setupName" class="input big" value="${esc(s.name)}" maxlength="70" placeholder="Toán 10A1 tối thứ Hai"></section>
${['ask', 'track', 'after'].map((g) => `<section class="q-block"><h2>${titles[g]}</h2><div class="feat-grid">${FEATURES.filter((x) => x.group === g).map(card).join('')}</div>${g === 'ask' && f.quick ? `<div class="feat-sub">${KINDS.map(([k, l]) => `<button class="mini-choice ${f.kinds[k] ? 'chosen' : ''}" data-action="toggleKind" data-id="${k}">${l}</button>`).join('')}</div>` : ''}</section>`).join('')}
${s.editing ? '' : `<section class="q-block"><h2>Danh sách học sinh</h2><textarea class="input" rows="5" id="setupRoster" data-field="setupRoster" placeholder="Mỗi dòng một họ tên">${esc(s.roster)}</textarea></section>`}
<div class="setup-bar"><button class="btn primary big-btn" data-action="saveSetup">${s.editing ? 'Lưu' : 'Tạo lớp'}</button></div>
</div>`;
}

// ===== Màn giáo viên trong một lớp =====
function teacher(v) {
  if (state.setup?.editing) return setupView();
  const room = v.room;
  const selected = state.parentPreviewId && room.members[state.parentPreviewId];
  if (selected && room.sid && feat('parent')) return parentReportPage(room, selected);
  const live = !!v.liveSid;
  const liveN = v.sessions.find((s) => s.id === v.liveSid)?.n;
  const tabs = [['class', 'Giờ học'], ['students', 'Học sinh'], feat('bank') && ['questions', 'Câu hỏi'], ['report', 'Báo cáo'], ['settings', 'Cài đặt']].filter(Boolean);
  if (!tabs.some(([k]) => k === state.tab)) state.tab = 'class';
  const body = { class: tabClass, students: tabStudents, questions: tabQuestions, report: tabReport, settings: tabSettings }[state.tab](v);
  return `<div class="cls">
<div class="cls-head"><button class="link-btn" data-action="home">‹ Các lớp</button><h1>${esc(v.name)}</h1>${live ? `<div class="muted"><span class="live-dot"></span>Buổi ${liveN}</div>` : ''}</div>
<nav class="tabs">${tabs.map(([k, l]) => `<button class="tab ${state.tab === k ? 'on' : ''}" data-action="tab" data-id="${k}">${l}</button>`).join('')}</nav>
<div class="tab-body">${body}</div></div>`;
}
// --- Giờ học ---
function tabClass(v) {
  const room = v.room;
  if (!v.liveSid) {
    const n = state.sessionNo ?? nextSessionNo(v);
    return `<section class="hero-card"><div class="start-row"><label for="sessionNo">Buổi</label><input id="sessionNo" data-field="sessionNo" class="input big no-input" type="number" min="1" max="999" value="${esc(n)}"></div><button class="btn primary big-btn" data-action="startSession">Bắt đầu</button></section>${inviteStrip()}`;
  }
  const inClass = Object.values(room.members).filter((m) => m.joinedAt != null);
  const online = inClass.filter((m) => m.online).length;
  const a = active(room);
  const strip = `<div class="live-strip"><span><b>${online}</b> học sinh trong lớp</span><span class="actions"><button class="btn sm" data-action="copyLink">Sao chép link</button><button class="btn sm" data-action="preview">Xem màn học sinh</button><button class="btn sm" data-action="end">Kết thúc buổi</button></span></div>`;
  if (a) return strip + questionFocus(room, a);
  const lc = lastClosed(room);
  const result = lc && !state.dismissed[room.sid + '/' + lc.id] && lc.status !== 'skipped' ? resultCard(room, lc) : '';
  return strip + result + nextActions(v, room);
}
function inviteStrip() {
  return `<section class="invite"><div class="share-link">${esc(linkStudent())}</div><button class="btn primary" data-action="copyLink">Sao chép link</button></section>`;
}
function nextActions(v, room) {
  const used = new Set(room.activities.map((a) => a.fromBank).filter(Boolean));
  const nextQ = feat('bank') ? v.bank.find((q) => !used.has(q.id)) : null;
  const kinds = quickTypes.filter(([k]) => v.features.kinds[k]);
  const blocks = [];
  if (feat('bank')) {
    blocks.push(nextQ
      ? `<section class="next-card"><div class="eyebrow">Câu tiếp theo</div><div class="q-text">${rich(nextQ.text)}</div><div class="actions"><button class="btn primary big-btn" data-action="bankOpen" data-id="${nextQ.id}">Mở câu này</button><button class="btn" data-action="tab" data-id="questions">Chọn câu khác</button></div></section>`
      : `<section class="next-card muted-card"><span>${v.bank.length ? 'Đã hỏi hết câu soạn sẵn.' : 'Chưa có câu soạn sẵn.'}</span> <button class="link-btn" data-action="tab" data-id="questions">${v.bank.length ? 'Xem' : 'Soạn câu'}</button></section>`);
  }
  if (feat('quick') && kinds.length) blocks.push(`<section class="next-card"><div class="eyebrow">Hỏi nhanh</div><div class="quick-grid">${kinds.map(([k, t]) => `<button class="quick-btn" data-action="open" data-kind="${k}">${t}</button>`).join('')}</div></section>`);
  if (feat('checkin')) blocks.push(`<section class="next-card"><div class="eyebrow">Check-in</div><div class="quick-grid">${[['start', 'Đầu giờ'], ['middle', 'Giữa giờ'], ['end', 'Cuối giờ']].map(([k, t]) => `<button class="quick-btn soft" data-action="checkin" data-phase="${k}">${t}</button>`).join('')}</div></section>`);
  return blocks.join('');
}
function questionFocus(room, a) {
  const inClass = Object.values(room.members).filter((m) => m.joinedAt != null);
  const done = inClass.filter((m) => a.responses[m.id]).length, total = inClass.length;
  const waiting = inClass.filter((m) => m.online && !a.responses[m.id]);
  const title = a.kind === 'checkin' ? a.title : 'Câu ' + numberOf(room, a);
  const choices = a.kind === 'abcd' && a.choices ? `<div class="q-list">${['A', 'B', 'C', 'D'].map((k) => `<div><b>${k}.</b> ${rich(a.choices[k])}</div>`).join('')}</div>` : '';
  return `<section class="focus">
<div class="focus-top"><button class="btn sm" data-action="cancelAct">← Quay lại</button><div class="eyebrow">${esc(title)}</div></div>
${a.fromBank ? questionBody(a) + choices : a.kind === 'checkin' ? `<div class="q-text">${esc(a.prompt)}</div>` : ''}
<div class="counter"><b>${done}</b><span>/${total} đã trả lời</span></div>
<div class="progress big"><div style="width:${total ? 100 * done / total : 0}%"></div></div>
${waiting.length ? `<div class="waiting"><div class="hint">Chưa trả lời</div><div class="waiting-names">${waiting.slice(0, 40).map((m) => `<span>${esc(m.name)}</span>`).join('')}</div></div>` : ''}
${a.kind === 'checkin' ? distribution(a) + `<button class="btn primary big-btn" data-action="close">Kết thúc check-in</button>` : `${keySelector(room, a)}<button class="btn primary big-btn" data-action="close">Kết thúc & chấm điểm</button>`}
</section>`;
}
function resultCard(room, a) {
  const key = room.sid + '/' + a.id;
  const close = `<button class="link-btn" data-action="dismiss" data-id="${key}">Ẩn</button>`;
  if (a.kind === 'checkin') return `<section class="result-card"><div class="row"><div class="eyebrow">${esc(a.title)}</div>${close}</div>${distribution(a)}</section>`;
  const res = Object.entries(a.responses);
  const right = res.filter(([, r]) => graded(a, r)).length;
  const wrong = res.filter(([, r]) => !graded(a, r)).map(([id]) => room.members[id]?.name).filter(Boolean);
  const p = pct(right, res.length);
  return `<section class="result-card"><div class="row"><div class="eyebrow">Câu ${numberOf(room, a)} · Đáp án ${esc(keyText(a.kind, a.key))}</div>${close}</div><div class="result-big"><b>${right}/${res.length}</b> đúng${p != null ? ` <span class="pct-pill ${p >= 70 ? 'good' : p >= 40 ? 'mid' : 'low'}">${p}%</span>` : ''}</div>${a.kind === 'abcd' || a.kind === 'tf' ? distribution(a) : ''}${wrong.length ? `<details class="soft-details"><summary>Sai (${wrong.length})</summary><div class="waiting-names">${wrong.map((n) => `<span>${esc(n)}</span>`).join('')}</div></details>` : ''}</section>`;
}
function keySelector(room, a) {
  const key = state.keys[keyId(room, a)];
  if (a.fromBank && validKey(a.kind, key)) return `<div class="key-row"><span class="hint">Đáp án:</span><b>${esc(keyText(a.kind, key))}</b></div>`;
  if (a.kind === 'abcd' || a.kind === 'tf') {
    const opts = a.kind === 'abcd' ? ['A', 'B', 'C', 'D'] : ['Đúng', 'Sai'];
    return `<div class="key-row"><span class="hint">Đáp án:</span>${opts.map((v) => `<button class="btn ${key === v ? 'select' : ''}" data-action="key" data-val="${v}">${v}</button>`).join('')}</div>`;
  }
  if (a.kind === 'tf4') return `<div class="hint mt">Đáp án:</div>${['a', 'b', 'c', 'd'].map((k) => `<div class="pair-row"><b>${k}</b><div class="actions"><button class="btn sm ${key?.[k] === 'Đ' ? 'select' : ''}" data-action="keypart" data-part="${k}" data-val="Đ">Đúng</button><button class="btn sm ${key?.[k] === 'S' ? 'select' : ''}" data-action="keypart" data-part="${k}" data-val="S">Sai</button></div></div>`).join('')}`;
  return `<div class="key-row"><span class="hint">Đáp án:</span><input id="rightNum" data-field="rightNum" class="input" style="max-width:180px" value="${esc(key ?? '')}"></div>`;
}
function keyText(kind, key) { return kind === 'tf4' ? ['a', 'b', 'c', 'd'].map((k) => k + ' ' + (key?.[k] || '?')).join(', ') : String(key ?? ''); }
function distribution(a) {
  const values = Object.values(a.responses).map((r) => r.value);
  if (!(a.kind === 'abcd' || a.kind === 'tf' || a.kind === 'checkin')) return '';
  const choices = a.kind === 'abcd' ? ['A', 'B', 'C', 'D'] : a.kind === 'tf' ? ['Đúng', 'Sai'] : a.options;
  return `<div class="dist">${choices.map((v) => { const n = values.filter((z) => z === v).length; return `<div class="barrow ${a.kind === 'checkin' ? 'wide' : ''}"><b title="${esc(v)}">${esc(v)}</b><div class="track"><div class="fill ${a.key === v ? 'green' : ''}" style="width:${values.length ? 100 * n / values.length : 0}%"></div></div><span class="muted tiny">${n}</span></div>`; }).join('')}</div>`;
}
function questionBody(a) {
  if (!a.fromBank) return '';
  let html = `<div class="q-text">${rich(a.prompt)}</div>`;
  if (a.kind === 'tf4' && a.statements) html += `<div class="q-list">${['a', 'b', 'c', 'd'].map((k) => `<div><b>${k})</b> ${rich(a.statements[k])}</div>`).join('')}</div>`;
  return html;
}
// --- Học sinh ---
function rosterAdd(open) {
  return `<details class="soft-details" ${state.rosterOpen || open ? 'open' : ''}><summary>Thêm học sinh</summary><textarea class="input" rows="3" id="rosterDraft" data-field="rosterDraft" placeholder="Mỗi dòng một họ tên">${esc(state.rosterDraft)}</textarea><button class="btn sm primary mt" data-action="addRoster">Thêm</button></details>`;
}
function tabStudents(v) {
  const room = v.room, all = Object.values(room.members);
  const pick = state.pick && room.members[state.pick] ? studentDetail(room, room.members[state.pick]) : '';
  if (!room.sid) return `<section class="plain"><div class="counts"><span><b>${all.length}</b> học sinh</span></div>${pick}<div class="name-grid">${all.map((m) => nameCard(m, false)).join('')}</div>${rosterAdd(!all.length)}</section>`;
  const modes = [['attendance', 'Điểm danh'], ['camera', 'Camera'], ['called', 'Khi gọi']].filter(([k]) => feat(k));
  if (!modes.some(([k]) => k === state.tapMode)) state.tapMode = modes[0]?.[0] || '';
  const present = all.filter((m) => ['present', 'late'].includes(attendanceOf(m))).length;
  const absent = all.filter((m) => attendanceOf(m) === 'absent').length;
  const cam = all.filter((m) => observation(m).camera === 'on').length;
  const counts = [feat('attendance') && `<span><b>${present}</b> có mặt</span>`, feat('attendance') && absent && `<span><b>${absent}</b> vắng</span>`, feat('camera') && `<span><b>${cam}</b> bật cam</span>`, !feat('attendance') && `<span><b>${all.filter((m) => m.joinedAt != null).length}</b>/${all.length} vào lớp</span>`].filter(Boolean).join('');
  const q = normalizeName(state.search || '');
  const shown = q ? all.filter((m) => normalizeName(m.name).includes(q)) : all;
  return `<section class="plain">${room.status !== 'live' ? `<div class="mb">${sessionPicker(v)}</div>` : ''}<div class="counts">${counts}</div>
${modes.length > 1 ? `<div class="tap-modes">${modes.map(([k, l]) => `<button class="seg ${state.tapMode === k ? 'on' : ''}" data-action="tapMode" data-id="${k}">${l}</button>`).join('')}</div>` : ''}
${all.length > 12 ? `<input class="input" data-field="search" value="${esc(state.search || '')}" placeholder="Tìm tên">` : ''}
${pick}
<div class="name-grid">${shown.map((m) => nameCard(m, modes.length)).join('')}</div>
${rosterAdd(!all.length)}</section>`;
}
function nameCard(m, tappable) {
  const att = attendanceOf(m), o = observation(m);
  const cls = att === 'absent' ? 'absent' : att === 'late' ? 'late' : att === 'excused' ? 'excused' : m.joinedAt != null || att === 'present' ? 'here' : '';
  const badges = [feat('attendance') && att !== 'unmarked' && `<span class="b-att">${attendanceLabels[att]}</span>`, feat('camera') && o.camera === 'on' && '<span>📷</span>', feat('camera') && o.camera === 'off' && '<span class="off">📷</span>', feat('called') && o.called === 'answered' && '<span>🙋✓</span>', feat('called') && o.called === 'no_answer' && '<span>🙋✗</span>', feat('note') && o.note && '<span>📝</span>'].filter(Boolean).join('');
  return `<div class="name-card ${cls}"><button class="name-tap" ${tappable ? `data-action="tapStudent" data-mid="${esc(m.id)}"` : 'disabled'}><b>${m.online ? '<span class="online-dot on"></span>' : ''}${esc(m.name)}</b><span class="badges">${badges}</span></button><button class="more" data-action="pick" data-mid="${esc(m.id)}" title="Chi tiết">⋯</button></div>`;
}
function studentDetail(room, m) {
  const o = observation(m);
  const group = (field, options) => `<div class="chips-wrap wide">${options.map(([val, label]) => `<button class="mini-choice ${(field === 'attendance' ? attendanceOf(m) : o[field]) === val ? 'chosen' : ''}" data-action="observe" data-mid="${esc(m.id)}" data-field="${field}" data-value="${val}">${label}</button>`).join('')}</div>`;
  const s = !!room.sid;
  return `<div class="detail"><div class="row"><h3 style="margin:0">${esc(m.name)}</h3><button class="link-btn" data-action="pick" data-mid="">Đóng</button></div>
${s && feat('attendance') ? `<div class="detail-row"><span>Điểm danh</span>${group('attendance', [['present', 'Có mặt'], ['late', 'Muộn'], ['absent', 'Vắng'], ['excused', 'Có phép']])}</div>` : ''}
${s && feat('camera') ? `<div class="detail-row"><span>Camera</span>${group('camera', [['on', 'Bật'], ['off', 'Tắt'], ['exempt', 'Miễn']])}</div>` : ''}
${s && feat('called') ? `<div class="detail-row"><span>Khi gọi</span>${group('called', [['answered', 'Trả lời'], ['no_answer', 'Không trả lời']])}</div>` : ''}
${s && feat('note') ? `<textarea class="input" rows="2" data-field="obsNote" data-mid="${esc(m.id)}" maxlength="500" placeholder="Nhận xét">${esc(fieldValue('note', m.id, o.note))}</textarea>` : ''}
<div class="actions">${s && feat('parent') ? `<button class="btn sm" data-action="parentPreview" data-mid="${esc(m.id)}">Báo cáo phụ huynh</button>` : ''}<button class="btn sm danger" data-action="deleteStudent" data-mid="${esc(m.id)}">Xoá khỏi lớp</button></div></div>`;
}
function sessionPicker(v) {
  if (!v.sessions.length) return '';
  return `<span class="session-bar">${v.sessions.map((s) => `<button class="session-chip ${s.id === v.room.sid ? 'on' : ''}" data-action="viewSession" data-sid="${s.id}">${s.id === v.liveSid ? '● ' : ''}Buổi ${s.n} · ${shortDate(s.startedAt)}</button>`).join('')}</span>`;
}
// --- Câu hỏi soạn sẵn ---
function tabQuestions(v) {
  const room = v.room, canOpen = room.status === 'live' && room.sid === v.liveSid && !active(room);
  const used = new Set(room.status === 'live' ? room.activities.map((a) => a.fromBank).filter(Boolean) : []);
  const e = state.bankEdit;
  const topics = [...new Set(v.bank.map((q) => q.topic || ''))];
  const list = topics.map((t) => `${t ? `<div class="bank-topic">${esc(t)}</div>` : ''}${v.bank.filter((q) => (q.topic || '') === t).map((q) => `<div class="bank-row ${used.has(q.id) ? 'used' : ''}"><div class="bank-main"><div class="bank-text">${rich(q.text)}</div><div class="tiny muted">${esc(labelKind[q.kind])} · Đáp án ${esc(keyText(q.kind, q.key))}${used.has(q.id) ? ' · đã hỏi' : ''}</div></div><div class="actions">${canOpen ? `<button class="btn sm primary" data-action="bankOpen" data-id="${q.id}">Mở</button>` : ''}<button class="btn sm" data-action="bankEdit" data-id="${q.id}">Sửa</button><button class="icon-btn" data-action="bankDelete" data-id="${q.id}" title="Xoá">🗑</button></div></div>`).join('')}`).join('');
  return `<section class="plain"><div class="row wrap"><h2 style="margin:0">Câu hỏi (${v.bank.length})</h2>${e ? '' : `<button class="btn primary" data-action="bankNew">+ Thêm câu</button>`}</div>${e ? bankEditor(e) : ''}<div class="bank-list">${list}</div></section>`;
}
function bankEditor(e) {
  return `<div class="bank-editor stack"><div class="chips-wrap wide">${KINDS.map(([k, l]) => `<button class="mini-choice ${e.kind === k ? 'chosen' : ''}" data-action="bankKind" data-id="${k}">${l}</button>`).join('')}</div>
<input id="bankTopic" class="input" data-field="bankTopic" value="${esc(e.topic)}" maxlength="80" placeholder="Bài (không bắt buộc)">
<textarea id="bankText" class="input" rows="3" data-field="bankText" maxlength="1000" placeholder="Nội dung câu hỏi. Công thức: $x^2+1$">${esc(e.text)}</textarea>
${e.kind === 'abcd' ? `<div class="stack" style="gap:6px">${['A', 'B', 'C', 'D'].map((k) => `<div class="pair-row"><button class="btn sm ${e.key === k ? 'select' : ''}" data-action="bankKey" data-val="${k}" title="Đáp án đúng">${e.key === k ? '✓ ' : ''}${k}</button><input class="input" data-field="bankOpt" data-mid="${k}" value="${esc(e.options[k])}" maxlength="300" placeholder="Lựa chọn ${k}"></div>`).join('')}</div>` : ''}
${e.kind === 'tf' ? `<div class="key-row"><span class="hint">Đáp án:</span>${['Đúng', 'Sai'].map((k) => `<button class="btn ${e.key === k ? 'select' : ''}" data-action="bankKey" data-val="${k}">${k}</button>`).join('')}</div>` : ''}
${e.kind === 'tf4' ? `<div class="stack" style="gap:6px">${['a', 'b', 'c', 'd'].map((k) => `<div class="pair-row"><b>${k}</b><input class="input" data-field="bankStmt" data-mid="${k}" value="${esc(e.statements[k])}" maxlength="300" placeholder="Ý ${k}"><div class="actions"><button class="btn sm ${e.key?.[k] === 'Đ' ? 'select' : ''}" data-action="bankKeyPart" data-part="${k}" data-val="Đ">Đ</button><button class="btn sm ${e.key?.[k] === 'S' ? 'select' : ''}" data-action="bankKeyPart" data-part="${k}" data-val="S">S</button></div></div>`).join('')}</div>` : ''}
${e.kind === 'num' ? `<div class="key-row"><span class="hint">Đáp án:</span><input id="bankNum" class="input" style="max-width:200px" data-field="bankNum" value="${esc(typeof e.key === 'string' ? e.key : '')}"></div>` : ''}
<div class="actions"><button class="btn primary" data-action="bankSave">Lưu</button><button class="btn" data-action="bankCancel">Huỷ</button></div></div>`;
}
// --- Báo cáo ---
function tabReport(v) {
  const room = v.room;
  if (!room.sid) return `<section class="plain muted">Chưa có buổi học nào.</section>`;
  const all = Object.values(room.members), q = hasQuestions();
  const present = all.filter((m) => ['present', 'late'].includes(attendanceOf(m))).length;
  const inClass = all.filter((m) => m.joinedAt != null).length;
  const cam = all.filter((m) => observation(m).camera === 'on').length;
  const nq = room.activities.filter((a) => a.status === 'graded').length;
  const acc = classAccuracy(room);
  const summary = [`<span><b>${all.length}</b> học sinh</span>`, feat('attendance') ? `<span><b>${present}</b> có mặt</span>` : `<span><b>${inClass}</b> vào lớp</span>`, feat('camera') && `<span><b>${cam}</b> bật cam</span>`, q && `<span><b>${nq}</b> câu</span>`, q && acc.pct != null && `<span>đúng <b>${acc.pct}%</b></span>`].filter(Boolean).join('');
  const sendList = feat('parent') ? `<section class="plain"><h2>Gửi phụ huynh</h2><div class="send-list">${all.map((m) => { const s = studentStats(room, m), o = observation(m); const short = [feat('attendance') && attendanceLabels[attendanceOf(m)], q && s.eligible && `đúng ${s.correct}/${s.eligible}`].filter(Boolean).join(' · '); return `<div class="send-row ${o.delivery === 'manually_shared' ? 'sent' : ''}"><div><b>${esc(m.name)}</b><div class="tiny muted">${esc(short)}</div></div><div class="actions">${o.delivery === 'manually_shared' ? '<span class="chip good">Đã gửi</span>' : ''}<button class="btn sm primary" data-action="zalo" data-mid="${esc(m.id)}">Sao chép tin Zalo</button>${o.parentEmail ? `<button class="btn sm" data-action="mail" data-mid="${esc(m.id)}">Email</button>` : ''}<button class="btn sm" data-action="parentPreview" data-mid="${esc(m.id)}">Xem</button></div></div>`; }).join('')}</div></section>` : '';
  const acts = room.activities;
  const actList = acts.length ? `<details class="soft-details plain"><summary>Các câu đã hỏi (${acts.length})</summary>${acts.map((a) => { const res = Object.values(a.responses); const right = res.filter((r) => graded(a, r)).length; const label = a.kind === 'checkin' ? a.title : 'Câu ' + numberOf(room, a) + (a.fromBank ? ': ' : ' · ' + labelKind[a.kind]); const info = a.status === 'graded' ? `${right}/${res.length} đúng · đáp án ${esc(keyText(a.kind, a.key))}` : a.status === 'skipped' ? 'đã bỏ' : a.status === 'open' ? 'đang mở' : `${res.length} trả lời`; return `<div class="name-row"><span>${esc(label)}${a.fromBank ? rich(a.prompt) : ''}<div class="tiny muted">${info}</div></span><button class="icon-btn" data-action="deleteAct" data-sid="${room.sid}" data-id="${a.id}" title="Xoá câu">🗑</button></div>`; }).join('')}</details>` : '';
  const cols = sessionColumns();
  return `<section class="plain${state.justEnded === room.sid ? ' done' : ''}"><div class="row wrap"><h2 style="margin:0">${state.justEnded === room.sid ? 'Đã kết thúc buổi ' + room.n : 'Buổi ' + room.n + ' · ' + formatDate(room.createdAt)}</h2><span class="actions"><button class="btn sm" data-action="renumber" data-sid="${room.sid}">Đổi số buổi</button><button class="icon-btn" data-action="deleteSession" data-sid="${room.sid}" title="Xoá buổi này">🗑</button></span></div>${v.sessions.length > 1 ? `<div class="mt">${sessionPicker(v)}</div>` : ''}<div class="counts mt">${summary}</div></section>
${sendList}
${actList}
<details class="soft-details plain"><summary>Bảng chi tiết</summary><div class="table-scroll"><table><thead><tr><th>Học sinh</th>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${all.map((m) => { const s = studentStats(room, m), o = observation(m); return `<tr><td>${esc(m.name)}</td>${cols.map((c) => `<td>${esc(c[1](m, s, o))}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div><button class="btn sm mt" data-action="csv">Tải CSV</button></details>
${courseReport(v)}`;
}
function courseReport(v) {
  const rooms = v.allRooms; if (rooms.length < 2) return '';
  const all = Object.values(v.room.members), q = hasQuestions();
  return `<details class="soft-details plain"><summary>Cả khoá (${rooms.length} buổi)</summary><div class="table-scroll"><table><thead><tr><th>Học sinh</th><th>${feat('attendance') ? 'Có mặt' : 'Vào lớp'}</th>${q ? '<th>Trả lời</th><th>Đúng</th>' : ''}</tr></thead><tbody>${all.map((m) => { const c = courseStats(rooms, m.id); return `<tr><td>${esc(m.name)}</td><td>${c.attended}/${rooms.length}</td>${q ? `<td>${c.answered}/${c.eligible}</td><td>${c.correct}/${c.answered}</td>` : ''}</tr>`; }).join('')}</tbody></table></div><button class="btn sm mt" data-action="csvCourse">Tải CSV cả khoá</button></details>`;
}
function parentMessage(room, m) {
  const st = studentStats(room, m), o = observation(m);
  const c = courseStats(state.view?.allRooms || [], m.id);
  const lines = [];
  if (feat('attendance')) lines.push(`- Điểm danh: ${attendanceLabels[attendanceOf(m)]}`);
  if (feat('camera')) lines.push(`- Camera: ${cameraLabels[o.camera]}`);
  if (feat('called')) lines.push(`- Khi cô gọi: ${calledLabels[o.called]}`);
  if (hasQuestions() && st.eligible) lines.push(`- Trả lời ${st.answered}/${st.eligible} câu, đúng ${st.correct} câu`);
  if (c.sessions > 1) lines.push(`- Từ đầu khoá: ${feat('attendance') ? 'có mặt' : 'vào lớp'} ${c.attended}/${c.sessions} buổi`);
  return `Kính gửi phụ huynh${o.parentName ? ' ' + o.parentName : ''},\n\nKết quả buổi ${room.n} lớp ${room.name} (${formatDate(room.createdAt)}) của con ${m.name}:\n${lines.join('\n')}${feat('note') && o.note ? '\n\nNhận xét: ' + o.note : ''}\n\nTrân trọng.`;
}
function parentReportPage(room, m) {
  const st = studentStats(room, m), o = observation(m);
  const info = [feat('attendance') && `<div><small>Điểm danh</small><strong>${attendanceLabels[attendanceOf(m)]}</strong></div>`, feat('camera') && `<div><small>Camera</small><strong>${cameraLabels[o.camera]}</strong></div>`, feat('called') && `<div><small>Khi cô gọi</small><strong>${calledLabels[o.called]}</strong></div>`].filter(Boolean).join('');
  return `<div class="parent-page"><div class="row wrap no-print" style="margin-bottom:16px"><button class="btn" data-action="backTeacher">← Quay lại</button>${o.delivery === 'manually_shared' ? '<span class="chip good">Đã gửi</span>' : ''}</div>
<div class="report-paper panel"><div class="report-accent"></div><div class="title-eyebrow">Báo cáo buổi học</div><h1 style="font-size:24px;margin:7px 0">${esc(m.name)}</h1><div class="muted">${esc(room.name)} · Buổi ${room.n} · ${formatDate(room.createdAt)}</div><div class="divider"></div>
${info ? `<div class="report-info">${info}</div>` : ''}
${hasQuestions() ? `<div class="report-grid mt"><div class="stat"><small>Đã trả lời</small><b>${st.answered}/${st.eligible}</b></div><div class="stat"><small>Đúng</small><b>${st.correct}/${st.answered}</b></div></div>` : ''}
${feat('note') && o.note ? `<h3 style="margin:18px 0 8px">Nhận xét</h3><div class="note-paper">${esc(o.note)}</div>` : ''}</div>
<section class="plain no-print" style="margin-top:16px"><div class="two"><input class="input" data-field="parentName" data-mid="${esc(m.id)}" value="${esc(fieldValue('parentName', m.id, o.parentName))}" placeholder="Tên phụ huynh"><input class="input" type="email" data-field="parentEmail" data-mid="${esc(m.id)}" value="${esc(fieldValue('parentEmail', m.id, o.parentEmail))}" placeholder="Email phụ huynh"></div>${feat('note') ? `<textarea class="input mt" rows="3" data-field="note" data-mid="${esc(m.id)}" placeholder="Nhận xét">${esc(fieldValue('note', m.id, o.note))}</textarea>` : ''}<div class="actions mt"><button class="btn primary" data-action="zalo" data-mid="${esc(m.id)}">Sao chép tin Zalo</button><button class="btn" data-action="mail" data-mid="${esc(m.id)}">Email</button><button class="btn" data-action="printReport">In / PDF</button></div></section></div>`;
}
// --- Cài đặt ---
function tabSettings(v) {
  const on = FEATURES.filter((x) => v.features[x.id]);
  return `<section class="plain"><h2>Link vào lớp</h2><div class="invite-big"><div>${qrImage()}</div><div class="stack" style="gap:8px"><div class="share-link">${esc(linkStudent())}</div><div>Mã lớp <span class="code">${esc(v.code)}</span></div><div class="actions"><button class="btn primary" data-action="copyLink">Sao chép link</button><button class="btn" data-action="copy">Sao chép mã</button></div></div></div></section>
<section class="plain"><div class="row wrap"><h2 style="margin:0">Tính năng</h2><button class="btn" data-action="customize">Sửa</button></div><div class="feat-chips">${on.map((x) => `<span>${x.icon} ${x.label}</span>`).join('')}</div></section>
<section class="plain danger-zone"><button class="btn danger" data-action="deleteClass">Xoá lớp</button></section>`;
}

// ===== Học sinh =====
function studentHome() {
  const named = state.joinClassName && !state.showCodeInput;
  return `<div class="student-shell s-home"><h1 class="home-title">${named ? esc(state.joinClassName) : 'Vào lớp'}</h1>
${named ? '' : `<input id="joinCode" data-field="joinCode" class="input big" value="${esc(state.joinCode)}" inputmode="numeric" maxlength="6" placeholder="Mã lớp">`}
<input id="joinName" data-field="joinName" class="input big" value="${esc(state.joinName)}" maxlength="60" placeholder="Họ và tên" autocomplete="name">
<button class="btn primary big-btn" data-action="join">Vào lớp</button>
${named ? '<p class="center"><button class="link-btn" data-action="showCode">Lớp khác</button></p>' : ''}</div>`;
}
function student(v) {
  const uid = state.conn.uid, room = v.room;
  let body;
  if (!room) {
    const last = v.history.filter((r) => r.members[uid].joinedAt != null).pop();
    body = last && v.history[v.history.length - 1] === last ? endSummary(last, uid) : `<div class="s-state"><h2>Chưa bắt đầu</h2></div>`;
    body += studentHistory(v, uid);
  } else {
    const a = active(room), m = room.members[uid];
    if (a) body = studentQuestion(room, a, m);
    else {
      const lc = lastClosed(room);
      body = (lc && lc.status === 'graded' ? studentResult(room, lc, m) : '') + `<div class="s-state small"><h2>Chờ câu hỏi</h2></div>`;
    }
  }
  return `<div class="student-shell"><div class="s-top"><span>${esc(v.name)}${room ? ` · Buổi ${room.n}` : ''}</span>${isPreview() ? '<button class="link-btn" data-action="teacher">← Quay lại</button>' : '<button class="link-btn muted" data-action="home">Thoát</button>'}</div>${body}</div>`;
}
function studentQuestion(room, a, m) {
  const own = a.responses[m.id];
  const head = a.kind === 'checkin' ? `<div class="q-text">${esc(a.prompt)}</div>` : a.fromBank ? questionBody(a) : `<div class="q-text">Chọn đáp án đúng</div>`;
  const pick = state.studentDrafts[a.id];
  const ready = a.kind === 'tf4' ? pick && ['a', 'b', 'c', 'd'].every((k) => pick[k]) : a.kind === 'num' ? true : pick != null && pick !== '';
  const foot = own ? '<div class="s-ok">✓ Đã chốt đáp án</div>' : `<button class="btn primary big-btn s-submit" data-action="submitAns" ${ready ? '' : 'disabled'}>${a.kind === 'checkin' ? 'Gửi' : 'Chốt đáp án'}</button>`;
  return `<section class="s-question"><div class="eyebrow">${a.kind === 'checkin' ? esc(a.title) : 'Câu ' + numberOf(room, a)}</div>${head}${studentAnswer(room, a, m)}${foot}</section>`;
}
function studentAnswer(room, a, m) {
  const own = a.responses[m.id]?.value, locked = own != null;
  const cur = locked ? own : state.studentDrafts[a.id];
  const dis = locked ? 'disabled' : '';
  if (a.kind === 'checkin') return `<div class="s-choices">${a.options.map((o) => `<button class="s-choice ${cur === o ? 'on' : ''}" data-action="pickAns" data-value="${esc(o)}" ${dis}>${esc(o)}</button>`).join('')}</div>`;
  if (a.kind === 'abcd' && a.choices) return `<div class="s-choices">${['A', 'B', 'C', 'D'].map((v) => `<button class="s-choice ${cur === v ? 'on' : ''}" data-action="pickAns" data-value="${v}" ${dis}><b>${v}</b><span>${rich(a.choices[v])}</span></button>`).join('')}</div>`;
  if (a.kind === 'abcd' || a.kind === 'tf') { const opts = a.kind === 'abcd' ? ['A', 'B', 'C', 'D'] : ['Đúng', 'Sai']; return `<div class="s-grid ${a.kind}">${opts.map((v) => `<button class="s-big ${cur === v ? 'on' : ''}" data-action="pickAns" data-value="${v}" ${dis}>${v}</button>`).join('')}</div>`; }
  if (a.kind === 'tf4') { const all = cur || {}; return ['a', 'b', 'c', 'd'].map((k) => `<div class="pair-row s-pair"><b>${k}</b><div class="actions"><button class="btn ${all[k] === 'Đ' ? 'select' : ''}" data-action="part" data-part="${k}" data-value="Đ" ${dis}>Đúng</button><button class="btn ${all[k] === 'S' ? 'select' : ''}" data-action="part" data-part="${k}" data-value="S" ${dis}>Sai</button></div></div>`).join(''); }
  return `<div class="s-num"><input data-field="numberDraft" class="input big" value="${esc(cur ?? '')}" placeholder="Nhập số" inputmode="decimal" ${dis}></div>`;
}
function studentResult(room, a, m) {
  const r = a.responses[m.id];
  const ans = esc(keyText(a.kind, a.key));
  if (!r) return `<div class="s-result none"><h2>Chưa trả lời</h2><p>Đáp án: <b>${ans}</b></p></div>`;
  if (graded(a, r)) return `<div class="s-result good"><h2>✓ Đúng</h2><p>Đáp án: <b>${ans}</b></p></div>`;
  return `<div class="s-result bad"><h2>✗ Sai</h2><p>Đáp án: <b>${ans}</b>${a.kind === 'tf4' ? ` · đúng ${correctParts(a, r)}/4 ý` : ''}</p></div>`;
}
function endSummary(room, uid) {
  const m = room.members[uid], s = studentStats(room, m);
  const stats = feat('selfReport') && hasQuestions() && s.eligible ? `<div class="counts center"><span>Trả lời <b>${s.answered}/${s.eligible}</b></span><span>Đúng <b>${s.correct}</b></span></div>` : '';
  return `<div class="s-state"><h2>Kết thúc buổi ${room.n}</h2>${stats}</div>`;
}
function studentHistory(v, uid) {
  if (!feat('selfReport') || !hasQuestions()) return '';
  const past = v.history.filter((r) => r.members[uid].joinedAt != null).reverse();
  if (past.length < 2) return '';
  return `<details class="soft-details"><summary>Các buổi trước</summary>${past.map((r) => { const s = studentStats(r, r.members[uid]); return `<div class="name-row"><span>Buổi ${r.n} · ${shortDate(r.createdAt)}</span><span class="muted">${s.eligible ? `đúng ${s.correct}/${s.eligible}` : '—'}</span></div>`; }).join('')}</details>`;
}
function view() {
  if (state.role === 'setup') return setupView();
  if (state.role === 'home') return MODE === 'teacher' ? teacherHome() : studentHome();
  const v = state.view;
  if (!v) return '<p class="muted center">Đang tải…</p>';
  return state.role === 'teacher' ? teacher(v) : student(v);
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
  // Học sinh để tab này ở nền: tiêu đề tab báo khi có câu hỏi chưa trả lời.
  const r = state.role === 'student' ? state.view?.room : null, a = r ? active(r) : null;
  document.title = a && !a.responses[state.conn.uid] ? '🔔 Có câu hỏi · Lớp Mình Live' : BASE_TITLE;
  if (html === lastHtml) return;
  const ae = document.activeElement;
  let keep = null;
  if (ae && root.contains(ae) && ae.dataset?.field) keep = { field: ae.dataset.field, mid: ae.dataset.mid || '', value: ae.value, s: ae.selectionStart, e: ae.selectionEnd };
  const openDetails = [...root.querySelectorAll('details[open] > summary')].map((s) => s.textContent);
  const y = window.scrollY;
  root.innerHTML = html; lastHtml = html;
  for (const s of root.querySelectorAll('details > summary')) if (openDetails.includes(s.textContent)) s.parentElement.open = true;
  // Công thức toán trong $…$ (KaTeX tải kèm trang; nếu chưa tải xong thì vẽ khi tải xong).
  const math = () => window.renderMathInElement?.(root, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }], throwOnError: false, ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'input'] });
  if (window.renderMathInElement) math(); else window.addEventListener('load', math, { once: true });
  if (keep) {
    const sel = `[data-field="${CSS.escape(keep.field)}"]` + (keep.mid ? `[data-mid="${CSS.escape(keep.mid)}"]` : '');
    const el = root.querySelector(sel);
    if (el) { el.value = keep.value; el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch { /* ô email/số không hỗ trợ */ } }
  }
  if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
}

// ---------- Sự kiện ----------
async function copyText(txt, okMsg) {
  try { await navigator.clipboard.writeText(txt); toast(okMsg); return true; } catch { /* thử cách cũ */ }
  const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select();
  const ok = document.execCommand('copy'); t.remove(); toast(ok ? okMsg : 'Không sao chép được'); return ok;
}
function sendZalo(id) {
  const room = getRoom(), m = room?.members[id]; if (!m) return;
  copyText(parentMessage(room, m), 'Đã sao chép tin của ' + m.name).then((ok) => { if (ok) markDelivered(m.id); });
}
function sendMail(id) {
  const room = getRoom(), m = room?.members[id]; if (!m) return;
  const email = norm(fieldValue('parentEmail', m.id, observation(m).parentEmail));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { state.parentPreviewId = m.id; render(); toast('Nhập email phụ huynh'); return; }
  const subject = `Kết quả buổi ${room.n} lớp ${room.name} - ${m.name}`;
  window.location.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(parentMessage(room, m));
  markDelivered(m.id);
}
function actOnClick(el, ev) {
  const action = el.dataset.action; const room = getRoom();
  if (el.tagName === 'A') ev?.preventDefault();
  switch (action) {
    case 'newClass': openSetup(false); break;
    case 'customize': openSetup(true); break;
    case 'cancelSetup': if (state.setup?.editing) { state.setup = null; render(); } else { state.setup = null; state.role = 'home'; render(); } break;
    case 'toggleFeat': state.setup.features[el.dataset.id] = !state.setup.features[el.dataset.id]; render(); break;
    case 'toggleKind': state.setup.features.kinds[el.dataset.id] = !state.setup.features.kinds[el.dataset.id]; render(); break;
    case 'saveSetup': saveSetup(); break;
    case 'resume': { const c = state.myClasses.find((r) => r.code === el.dataset.code); resumeTeacher(el.dataset.code, c?.key); break; }
    case 'claim': resumeTeacher(norm(state.claimCode).replace(/\D/g, ''), norm(state.claimKey).toUpperCase()); break;
    case 'join': joinStudent(state.joinCode, state.joinName); break;
    case 'showCode': state.showCodeInput = true; render(); break;
    case 'preview': if (state.view?.liveSid) previewAsStudent(); break;
    case 'teacher': if (conns.teacher?.uid) openTeacher(conns.teacher, state.code); break;
    case 'home': goHome(); break;
    case 'tab': state.tab = el.dataset.id; state.parentPreviewId = null; state.pick = null; refresh(); window.scrollTo(0, 0); break;
    case 'startSession': startSession(); break;
    case 'viewSession': state.viewSid = el.dataset.sid; state.parentPreviewId = null; state.justEnded = null; refresh(); break;
    case 'renumber': renumberSession(el.dataset.sid); break;
    case 'deleteSession': deleteSession(el.dataset.sid); break;
    case 'deleteAct': deleteActivity(el.dataset.sid, el.dataset.id); break;
    case 'deleteStudent': deleteStudent(el.dataset.mid); break;
    case 'deleteClass': deleteClass(el.dataset.code); break;
    case 'dismiss': state.dismissed[el.dataset.id] = true; render(); break;
    case 'open': openActivity(el.dataset.kind); break;
    case 'checkin': openActivity('checkin', el.dataset.phase); break;
    case 'tapMode': state.tapMode = el.dataset.id; render(); break;
    case 'tapStudent': tapStudent(el.dataset.mid); break;
    case 'pick': state.pick = el.dataset.mid || null; render(); break;
    case 'bankNew': openBankEditor(null); break;
    case 'bankEdit': openBankEditor(el.dataset.id); break;
    case 'bankCancel': state.bankEdit = null; render(); break;
    case 'bankSave': saveBankQuestion(); break;
    case 'bankDelete': deleteBankQuestion(el.dataset.id); break;
    case 'bankOpen': state.tab = 'class'; openBankQuestion(el.dataset.id); window.scrollTo(0, 0); break;
    case 'bankKind': { const e = state.bankEdit; if (e.kind !== el.dataset.id) { e.kind = el.dataset.id; e.key = e.kind === 'tf4' ? {} : ''; } render(); break; }
    case 'bankKey': state.bankEdit.key = el.dataset.val; render(); break;
    case 'bankKeyPart': { const e = state.bankEdit; e.key = { ...(typeof e.key === 'object' && e.key ? e.key : {}), [el.dataset.part]: el.dataset.val }; render(); break; }
    case 'pickAns': { const a = active(room); if (!a || a.responses[state.conn.uid]) return; state.studentDrafts[a.id] = el.dataset.value; render(); break; }
    case 'part': {
      const a = active(room); if (!a || a.responses[state.conn.uid]) return;
      state.studentDrafts[a.id] = { ...(state.studentDrafts[a.id] || {}), [el.dataset.part]: el.dataset.value }; render(); break;
    }
    case 'submitAns': {
      const a = active(room); if (!a || a.responses[state.conn.uid]) return;
      let v = state.studentDrafts[a.id];
      if (a.kind === 'num') { v = norm(v ?? ''); if (parseNumeric(v) === null) { toast('Nhập một số, ví dụ 0,5 hoặc 1/2'); return; } }
      if (a.kind === 'tf4' && !(v && ['a', 'b', 'c', 'd'].every((k) => v[k]))) { toast('Chọn đủ 4 ý'); return; }
      if (v == null || v === '') { toast('Chọn một đáp án'); return; }
      storeAnswer(v); break;
    }
    case 'key': { const a = active(room); if (!a) return; state.keys[keyId(room, a)] = el.dataset.val; saveDraftKey(room, a); render(); break; }
    case 'keypart': { const a = active(room); if (!a) return; const k = keyId(room, a); state.keys[k] = { ...(state.keys[k] || {}), [el.dataset.part]: el.dataset.val }; saveDraftKey(room, a); render(); break; }
    case 'close': closeActivity(false); break;
    case 'skip': closeActivity(true); break;
    case 'cancelAct': cancelActivity(); break;
    case 'end': endClass(); break;
    case 'copy': copyText(state.code, 'Đã sao chép mã lớp'); break;
    case 'copyLink': copyText(linkStudent(), 'Đã sao chép link'); break;
    case 'copyKey': copyText(state.view?.adminKey || '', 'Đã sao chép mã quản lý'); break;
    case 'csv': exportCsv(); break;
    case 'csvCourse': exportCourseCsv(); break;
    case 'addRoster': addRoster(); break;
    case 'observe': setObservation(el.dataset.mid, el.dataset.field, el.dataset.value); break;
    case 'parentPreview': state.parentPreviewId = el.dataset.mid; render(); window.scrollTo(0, 0); break;
    case 'backTeacher': state.parentPreviewId = null; render(); break;
    case 'printReport': window.print(); break;
    case 'zalo': sendZalo(el.dataset.mid); break;
    case 'mail': sendMail(el.dataset.mid); break;
  }
}
document.addEventListener('click', (e) => { const btn = e.target.closest('[data-action]'); if (btn && !btn.disabled) actOnClick(btn, e); });
document.addEventListener('input', (e) => {
  const f = e.target.dataset.field, v = e.target.value; if (!f) return;
  const be = state.bankEdit;
  switch (f) {
    case 'setupName': state.setup.name = v; break;
    case 'setupRoster': state.setup.roster = v; break;
    case 'claimCode': state.claimCode = v; break;
    case 'claimKey': state.claimKey = v; break;
    case 'joinCode': state.joinCode = v; break;
    case 'joinName': state.joinName = v; break;
    case 'rosterDraft': state.rosterDraft = v; break;
    case 'sessionNo': state.sessionNo = v; break;
    case 'search': state.search = v; render(); break;
    case 'bankTopic': if (be) be.topic = v; break;
    case 'bankText': if (be) be.text = v; break;
    case 'bankOpt': if (be) be.options[e.target.dataset.mid] = v; break;
    case 'bankStmt': if (be) be.statements[e.target.dataset.mid] = v; break;
    case 'bankNum': if (be) be.key = v; break;
    case 'rightNum': {
      const room = getRoom(), a = active(room);
      if (a) { state.keys[keyId(room, a)] = v; clearTimeout(draftTimers.key); draftTimers.key = setTimeout(() => saveDraftKey(room, a), 700); }
      break;
    }
    case 'numberDraft': { const a = active(getRoom()); if (a) state.studentDrafts[a.id] = v; break; }
    case 'obsNote': storeObservationField(e.target.dataset.mid, 'note', v); break;
    case 'note': case 'parentName': case 'parentEmail': storeObservationField(e.target.dataset.mid, f, v); break;
  }
});
document.addEventListener('change', (e) => {
  const f = e.target.dataset.field;
  if (['obsNote', 'note', 'parentName', 'parentEmail'].includes(f)) storeObservationField(e.target.dataset.mid, f === 'obsNote' ? 'note' : f, e.target.value, true);
});
document.addEventListener('toggle', (e) => { if (e.target.querySelector?.('#rosterDraft')) state.rosterOpen = e.target.open; }, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (state.role === 'home' && (e.target.id === 'joinName' || e.target.id === 'joinCode')) joinStudent(state.joinCode, state.joinName);
  if (state.role === 'student' && e.target.dataset.field === 'numberDraft') actOnClick({ dataset: { action: 'submitAns' } });
  if (e.target.id === 'sessionNo') startSession();
});

// ---------- Khởi động ----------
(async function start() {
  const pill = document.getElementById('envPill');
  pill.hidden = !IS_LOCAL; pill.textContent = 'BẢN THỬ';
  document.getElementById('netPill').hidden = true;
  render();
  if (MODE === 'teacher') {
    if (!(await initTeacher())) return;
    // F5 / mở lại tab: quay về đúng lớp đang điều khiển.
    const code = loadJSON(sessionStorage, 'lopminh:teacherClass', null);
    if (code) { const c = state.myClasses.find((r) => r.code === code); await resumeTeacher(code, c?.key); }
    return;
  }
  const urlCode = (new URLSearchParams(location.search).get('lop') || '').replace(/\D/g, '').slice(0, 6);
  const saved = loadJSON(studentStore, 'lopminh:studentClass', null);
  state.joinCode = urlCode || saved?.code || '';
  state.joinName = saved?.name || '';
  // Mở lại link cũ: vào thẳng lớp với tên đã nhập lần trước.
  if (saved?.code && saved.name && (!urlCode || urlCode === saved.code)) { await joinStudent(saved.code, saved.name); return; }
  if (urlCode) {
    try { const c = await conn('student'); state.joinClassName = (await get(ref(c.db, P(urlCode, 'meta/name')))).val() || ''; } catch { /* vẫn nhập tay được */ }
    if (!state.joinClassName) state.showCodeInput = true;
  }
  render();
  setTimeout(() => document.getElementById('joinName')?.focus(), 50);
})();
