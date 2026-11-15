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
  { id: 'quick', group: 'Tương tác trong giờ', icon: '⚡', label: 'Câu hỏi nhanh', desc: 'Cô chiếu đề trên Zoom/Meet, học sinh chỉ bấm đáp án. Không cần soạn trước.' },
  { id: 'bank', group: 'Tương tác trong giờ', icon: '📚', label: 'Bộ câu hỏi soạn sẵn', desc: 'Cô soạn đề, lựa chọn và đáp án trước giờ học (gõ được công thức toán). Học sinh thấy đề trên máy mình; cô bấm chốt là chấm ngay.' },
  { id: 'checkin', group: 'Tương tác trong giờ', icon: '🌤️', label: 'Check-in cảm xúc', desc: 'Hỏi nhanh đầu, giữa, cuối giờ: con sẵn sàng chưa, có theo kịp không. Không chấm điểm.' },
  { id: 'attendance', group: 'Theo dõi lớp', icon: '✅', label: 'Điểm danh', desc: 'Có mặt, muộn, vắng, có phép cho từng em.' },
  { id: 'camera', group: 'Theo dõi lớp', icon: '📷', label: 'Ghi nhận bật camera', desc: 'Cô tick em nào bật/tắt camera; có số đếm “x em bật cam”.' },
  { id: 'called', group: 'Theo dõi lớp', icon: '🙋', label: 'Ghi nhận khi cô gọi', desc: 'Em có trả lời khi được cô gọi tên không.' },
  { id: 'note', group: 'Theo dõi lớp', icon: '📝', label: 'Nhận xét từng em', desc: 'Ghi chú ngắn cho mỗi em trong từng buổi.' },
  { id: 'parent', group: 'Báo cáo', icon: '👪', label: 'Báo cáo phụ huynh', desc: 'Báo cáo riêng từng em mỗi buổi: in PDF, sao chép tin Zalo, soạn email. Nhớ tên/email phụ huynh.' },
  { id: 'selfReport', group: 'Báo cáo', icon: '📊', label: 'Học sinh xem kết quả của mình', desc: 'Học sinh thấy tỷ lệ tham gia, tỷ lệ đúng và các buổi đã học.' },
];
const ALL_FEATURES = FEATURES.map((f) => f.id);
const PRESETS = [
  { id: 'full', icon: '🌟', label: 'Đầy đủ', desc: 'Tương tác, theo dõi lớp và báo cáo phụ huynh', on: ALL_FEATURES },
  { id: 'quiz', icon: '🎯', label: 'Chỉ tương tác', desc: 'Câu hỏi và check-in; không điểm danh, không báo cáo PH', on: ['quick', 'bank', 'checkin', 'selfReport'] },
  { id: 'track', icon: '📋', label: 'Theo dõi lớp', desc: 'Điểm danh, camera, nhận xét, báo cáo PH; câu hỏi nhanh', on: ['quick', 'attendance', 'camera', 'called', 'note', 'parent'] },
];
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

// ---------- Trạng thái trên trang ----------
const state = {
  role: 'home', code: '', conn: null, view: null, viewSid: null, joinCode: '', joinName: '',
  claimCode: '', claimKey: '', keys: {}, studentDrafts: {}, parentPreviewId: null,
  rosterDraft: '', rosterOpen: false, search: '', busy: false, setup: null, bankEdit: null,
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
  start: { title: 'Check-in đầu giờ', prompt: 'Hôm nay con có sẵn sàng học không?', options: ['😊 Sẵn sàng', '😴 Hơi mệt', '🌱 Cần khởi động'] },
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
  return Object.entries(d?.sessions || {}).map(([id, s]) => ({ id, ...s })).sort((a, b) => (a.n || 0) - (b.n || 0));
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
    if (!roster[rid] && !autoRosterSent.has(rid)) { autoRosterSent.add(rid); toAdd['roster/' + rid] = { name: m.name, order: now(), auto: true }; }
  }
  if (Object.keys(toAdd).length) update(ref(state.conn.db, P(state.code)), toAdd).catch((e) => console.warn(e));
}
function buildSessionRoom(d, sid) {
  const session = d.sessions?.[sid]; if (!session) return null;
  const hosts = d.hosts || {}, obs = d.obs?.[sid] || {}, guardians = d.guardians || {}, attend = d.attend?.[sid] || {}, resp = d.responses || {};
  const isLive = d.state?.sessionId === sid;
  const persons = {};
  const add = (rid, name, order) => (persons[rid] = { id: rid, name, order: order || 0, joinedAt: null, online: false, uids: [], observation: { ...(obs[rid] || {}), ...(guardians[rid] || {}) } });
  for (const [rid, r] of Object.entries(d.roster || {})) add(rid, r.name, r.order);
  for (const [uid, m] of Object.entries(d.members || {})) {
    if (hosts[uid] || !m?.name) continue; // màn "xem thử như học sinh" của cô không tính vào lớp
    const rid = nameId(m.name);
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
  if (!state.viewSid || !d.sessions?.[state.viewSid]) state.viewSid = liveSid || sessions[sessions.length - 1]?.id || null;
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
  state.setup = null; state.bankEdit = null;
  if (MODE === 'teacher') saveJSON(sessionStorage, 'lopminh:teacherClass', null);
  render();
}

// ---------- Thiết lập lớp (tạo mới / tùy chỉnh) ----------
function openSetup(editing) {
  const f = editing ? state.view.features : featuresOf({ features: { ...Object.fromEntries(PRESETS[0].on.map((id) => [id, true])), kinds: { abcd: true, tf: true, tf4: true, num: true } } });
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
  if (!name) { toast('Nhập tên lớp, ví dụ "Toán 10A1 tối thứ Hai"'); return; }
  if (s.features.quick && !KINDS.some(([k]) => s.features.kinds[k])) { toast('Câu hỏi nhanh: chọn ít nhất một dạng câu'); return; }
  const features = setupFeatures();
  if (s.editing) {
    const ok = await write({ 'meta/name': name, 'meta/features': features });
    if (ok) { state.myClasses = state.myClasses.map((r) => (r.code === state.code ? { ...r, name } : r)); saveMyClasses(); state.setup = null; toast('Đã lưu tùy chỉnh lớp'); render(); }
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
      if (!key) { toast('Máy này chưa quản lý lớp ' + code + '. Nhập mã quản lý.'); return; }
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

function startSession() {
  const v = state.view; if (!v || v.liveSid) return;
  const n = v.sessions.reduce((m, s) => Math.max(m, s.n || 0), 0) + 1;
  const sid = 's' + String(n).padStart(3, '0');
  write({ ['sessions/' + sid]: { n, startedAt: serverTimestamp(), status: 'live' }, state: { sessionId: sid } }).then((ok) => {
    if (ok) { state.viewSid = sid; toast('Đã bắt đầu buổi ' + n + '. Học sinh mở link cũ là vào được.'); }
  });
}
function endClass() {
  const room = getRoom(); if (!room || room.status !== 'live') return;
  if (active(room)) { toast('Hãy chốt hoặc bỏ hoạt động đang mở trước'); return; }
  if (!confirm('Kết thúc buổi ' + room.n + '? Báo cáo buổi này sẽ được tổng hợp. Lớp và link vẫn giữ nguyên cho buổi sau.')) return;
  write({ ['sessions/' + room.sid + '/status']: 'ended', ['sessions/' + room.sid + '/endedAt']: serverTimestamp(), state: null })
    .then((ok) => ok && toast('Đã kết thúc buổi ' + room.n));
}
function deleteClass() {
  const v = state.view; if (!v) return;
  if (prompt('Xoá hẳn lớp "' + v.name + '" và dữ liệu MỌI buổi học? Không khôi phục được.\nGõ XOA để xác nhận.') !== 'XOA') return;
  const code = state.code;
  set(clsRef(), null).then(() => {
    state.myClasses = state.myClasses.filter((r) => r.code !== code); saveMyClasses(); toast('Đã xoá lớp'); goHome();
  }).catch((e) => fail(e));
}

// ---------- Thao tác giáo viên: trong buổi học ----------
function active(room) { return (room && room.activities.find((a) => a.id === room.activeId)) || null; }
function numberOf(room, act) { const i = room.activities.findIndex((a) => a.id === act.id); return room.activities.slice(0, i + 1).filter((a) => a.kind !== 'checkin').length; }
const keyId = (room, a) => room.sid + '/' + a.id;
// extra: nội dung câu soạn sẵn (đề, lựa chọn) và đáp án có sẵn.
function openActivity(kind, phase, extra) {
  const room = getRoom(); if (!room || room.status !== 'live') return;
  if (active(room)) { toast('Hãy chốt hoặc bỏ hoạt động hiện tại trước'); return; }
  const c = checkins[phase];
  const seq = room.activities.reduce((n, a) => Math.max(n, a.seq || 0), 0) + 1;
  const id = 'a' + String(seq).padStart(3, '0');
  const a = { seq, kind, status: 'open', createdAt: serverTimestamp(), prompt: kind === 'checkin' ? c.prompt : 'Đáp án của em là gì?' };
  if (kind === 'checkin') Object.assign(a, { phase, title: c.title, options: c.options });
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
  write(u).then((ok) => ok && toast(status === 'graded' ? 'Đã chốt và chấm câu hỏi' : status === 'skipped' ? 'Đã bỏ qua câu hỏi' : 'Đã kết thúc check-in'));
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
  if (!confirm('Xoá câu hỏi này khỏi bộ câu hỏi? (Kết quả các buổi đã dùng câu này vẫn giữ.)')) return;
  write({ ['bank/' + qid]: null }).then((ok) => ok && toast('Đã xoá câu hỏi'));
}
function openBankQuestion(qid) {
  const q = state.view.bank.find((x) => x.id === qid); if (!q) return;
  openActivity(q.kind, null, q);
}

// ---------- Thao tác học sinh ----------
async function joinStudent(code, name, asPreview) {
  code = norm(code).replace(/\D/g, ''); name = norm(name).slice(0, 60);
  if (!code || !name) { toast('Vui lòng nhập mã lớp và họ tên'); return; }
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
function storeAnswer(value) {
  const room = getRoom(), a = active(room);
  if (!room || !a || a.status !== 'open' || state.role !== 'student') { toast('Không có hoạt động đang mở'); return; }
  set(ref(state.conn.db, P(state.code, 'responses/' + state.conn.uid + '/' + room.sid + '/' + a.id)), { value, at: serverTimestamp() })
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
const attendedSession = (m) => ['present', 'late'].includes(observation(m).attendance) || m.joinedAt != null;
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
    ['Điểm danh', (m, s, o) => attendanceLabels[o.attendance], 'attendance'],
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
        if (feat('attendance')) bits.push(attendanceLabels[o.attendance]);
        if (feat('camera')) bits.push('cam ' + cameraLabels[o.camera].toLowerCase());
        if (q) bits.push(s.answered + '/' + s.eligible + ' câu, đúng ' + s.correct);
        if (!bits.length) bits.push(x.joinedAt ? 'Có vào web' : 'Không vào web');
        return bits.join(' · ');
      })];
  })], 'lop-minh-live-' + state.code + '-tong-hop-ca-khoa.csv');
}

// ---------- Giao diện ----------
function isPreview() { return state.role === 'student' && MODE === 'teacher'; }
function headline(v, teacher) {
  const room = v.room;
  const sub = room?.sid ? ` · Buổi ${room.n} · ${formatDate(room.createdAt)}` : '';
  return `<div class="row wrap mb"><div><div class="title-eyebrow">${teacher ? 'Bảng điều khiển giáo viên' : 'Màn hình học sinh'}</div><h1 style="font-size:25px;margin:5px 0">${esc(v.name)}</h1><div class="muted">Mã lớp <span class="code" style="font-size:15px;letter-spacing:1px">${esc(v.code)}</span>${esc(sub)}</div></div><div class="actions">${teacher ? `${v.liveSid ? `<button class="btn sm" data-action="preview">👀 Xem thử như học sinh</button>` : ''}<button class="btn sm" data-action="customize">⚙ Tùy chỉnh lớp</button><button class="btn sm" data-action="home">← Các lớp của cô</button>` : isPreview() ? `<button class="btn sm" data-action="teacher">← Về màn hình cô</button>` : `<button class="btn sm" data-action="home">Đổi lớp / đổi tên</button>`}</div></div>`;
}
function teacherHome() {
  const mine = state.myClasses.length ? `<section class="panel stack"><div><div class="title-eyebrow">Lớp của cô trên máy này</div><p class="muted tight">Mỗi lớp dùng cả khoá. Vào lớp rồi bấm "Bắt đầu buổi học" mỗi tuần.</p></div><div class="my-rooms">${state.myClasses.map((r) => `<div class="name-row"><span><b>${esc(r.name)}</b> <span class="muted">· mã ${esc(r.code)}</span></span><button class="btn sm primary" data-action="resume" data-code="${esc(r.code)}">Vào lớp</button></div>`).join('')}</div></section>` : '';
  return `<div class="hero"><div class="herohead"><div class="pill"><span class="dot"></span> Trang dành cho giáo viên</div><h1>Lớp của cô, theo cách của cô.<br><span style="color:var(--brand)">Chọn tính năng lớp cần, dùng cả khoá.</span></h1><p class="muted" style="font-size:15px">Tạo mỗi lớp một lần, chọn những gì lớp cần (câu hỏi, điểm danh, báo cáo phụ huynh…), gửi học sinh một link duy nhất.</p></div>${mine}<div class="two"><section class="panel stack"><div><div class="title-eyebrow">Lớp mới</div><h2 style="margin:7px 0">Tạo và thiết lập lớp</h2><p class="muted tight">Đặt tên lớp, chọn các tính năng cô muốn dùng, dán danh sách học sinh. Sửa lại được bất cứ lúc nào.</p></div><button class="btn primary block" data-action="newClass">+ Tạo lớp mới</button></section><section class="panel stack"><div><div class="title-eyebrow">Mở lớp trên máy khác</div><h2 style="margin:7px 0">Đã có lớp</h2><p class="muted tight">Đổi máy hoặc trình duyệt: nhập mã lớp và mã quản lý (xem trong trang lớp ở máy cũ).</p></div><div><label class="label" for="claimCode">Mã lớp</label><input id="claimCode" data-field="claimCode" class="input" value="${esc(state.claimCode)}" inputmode="numeric" maxlength="6" placeholder="6 chữ số"></div><div><label class="label" for="claimKey">Mã quản lý</label><input id="claimKey" data-field="claimKey" class="input" value="${esc(state.claimKey)}" maxlength="20" placeholder="10 ký tự" autocomplete="off"></div><button class="btn block" data-action="claim">Mở lớp</button></section></div><div class="notice">🔒 Dữ liệu lưu trên máy chủ Firebase. Học sinh chỉ thấy kết quả của chính mình; điểm danh, nhận xét, đáp án soạn sẵn và thông tin phụ huynh chỉ máy của cô xem được.</div></div>`;
}
function setupView() {
  const s = state.setup, f = s.features;
  const groups = [...new Set(FEATURES.map((x) => x.group))];
  const matches = (p) => ALL_FEATURES.every((id) => !!f[id] === p.on.includes(id));
  const chosen = FEATURES.filter((x) => f[x.id]);
  return `<div class="setup">${s.editing ? '' : `<button class="btn sm" data-action="cancelSetup">← Quay lại</button>`}
<div class="row wrap" style="margin:12px 0 4px"><div><div class="title-eyebrow">${s.editing ? 'Tùy chỉnh lớp' : 'Tạo lớp mới'}</div><h1 style="font-size:26px;margin:5px 0">${s.editing ? esc(s.name || 'Lớp của cô') : 'Thiết lập lớp học của cô'}</h1></div>${s.editing ? `<button class="btn sm" data-action="cancelSetup">Đóng</button>` : ''}</div>
<section class="panel stack"><div class="setup-step">1</div><h2 style="margin:0">Tên lớp</h2><input id="setupName" data-field="setupName" class="input" value="${esc(s.name)}" maxlength="70" placeholder="Ví dụ: Toán 10A1 tối thứ Hai"></section>
<section class="panel stack"><div class="setup-step">2</div><div><h2 style="margin:0">Lớp của cô cần những gì?</h2><p class="muted tight">Chọn nhanh một mẫu, rồi bật/tắt từng tính năng. Phần nào tắt sẽ không hiện trong lớp.</p></div>
<div class="preset-grid">${PRESETS.map((p) => `<button class="preset-card ${matches(p) ? 'on' : ''}" data-action="preset" data-id="${p.id}"><span class="preset-icon">${p.icon}</span><b>${p.label}</b><small>${p.desc}</small></button>`).join('')}</div>
${groups.map((g) => `<div class="feat-group"><div class="section-title" style="margin:6px 0">${g}</div><div class="feat-grid">${FEATURES.filter((x) => x.group === g).map((x) => `<button class="feat-card ${f[x.id] ? 'on' : ''}" data-action="toggleFeat" data-id="${x.id}" aria-pressed="${f[x.id] ? 'true' : 'false'}"><span class="feat-check">${f[x.id] ? '✓' : ''}</span><span class="feat-icon">${x.icon}</span><span><b>${x.label}</b><small>${x.desc}</small></span></button>${x.id === 'quick' && f.quick ? `<div class="feat-sub"><span class="muted tiny">Dạng câu dùng trong lớp:</span>${KINDS.map(([k, l]) => `<button class="mini-choice ${f.kinds[k] ? 'chosen' : ''}" data-action="toggleKind" data-id="${k}">${l}</button>`).join('')}</div>` : ''}`).join('')}</div></div>`).join('')}</section>
${s.editing ? '' : `<section class="panel stack"><div class="setup-step">3</div><div><h2 style="margin:0">Danh sách học sinh <span class="muted" style="font-size:14px;font-weight:500">(không bắt buộc)</span></h2><p class="muted tight">Mỗi dòng một họ tên, có thể dán cả cột từ Excel. Để trống cũng được: học sinh vào bằng link sẽ được tự thêm.</p></div><textarea class="input" rows="5" id="setupRoster" data-field="setupRoster" placeholder="Nguyễn Minh Anh&#10;Trần Đức Minh&#10;Lê Phương An">${esc(s.roster)}</textarea></section>`}
<section class="panel stack setup-summary"><div><b>Lớp gồm:</b> ${chosen.length ? chosen.map((x) => x.icon + ' ' + x.label).join(' · ') : '<span class="muted">chưa chọn tính năng nào</span>'}</div><button class="btn primary block" data-action="saveSetup">${s.editing ? '✓ Lưu thay đổi' : '✓ Tạo lớp'}</button>${s.editing ? '<div class="hint">Dữ liệu cũ không bị xoá khi tắt tính năng; bật lại là thấy lại.</div>' : ''}</section></div>`;
}
function studentHome() {
  return `<div class="student-shell"><div class="hero"><div class="herohead"><div class="pill"><span class="dot"></span> Lớp Mình Live</div><h1 style="font-size:28px">Vào lớp học online</h1><p class="muted">Nhập mã lớp cô gửi (link của cô đã điền sẵn) và họ tên của con. Lần sau mở lại link là vào thẳng.</p></div><section class="panel stack"><div><label class="label" for="joinCode">Mã lớp</label><input id="joinCode" data-field="joinCode" class="input" value="${esc(state.joinCode)}" inputmode="numeric" maxlength="6" placeholder="6 chữ số"></div><div><label class="label" for="joinName">Họ và tên</label><input id="joinName" data-field="joinName" class="input" value="${esc(state.joinName)}" maxlength="60" placeholder="Ví dụ: Nguyễn Minh Anh"><div class="hint mt">Ghi đúng họ tên đầy đủ, giống nhau ở mọi buổi.</div></div><button class="btn primary block" data-action="join">Vào lớp</button></section></div></div>`;
}
function keySelector(room, a) {
  const key = state.keys[keyId(room, a)];
  if (a.fromBank && validKey(a.kind, key)) return `<div class="banner info">Đáp án soạn sẵn: <b>${esc(keyText(a.kind, key))}</b>. Bấm chốt là chấm ngay.</div>`;
  if (a.kind === 'abcd' || a.kind === 'tf') {
    const opts = a.kind === 'abcd' ? ['A', 'B', 'C', 'D'] : ['Đúng', 'Sai'];
    return `<div class="answer-label">Đáp án đúng (chọn khi chuẩn bị chốt)</div><div class="answer-choices">${opts.map((v) => `<button class="btn ${key === v ? 'select' : ''}" data-action="key" data-val="${v}">${v}</button>`).join('')}</div>`;
  }
  if (a.kind === 'tf4') return `<div class="answer-label">Chọn đáp án đúng cho cả bốn ý</div>${['a', 'b', 'c', 'd'].map((k) => `<div class="pair-row"><b>Ý ${k}</b><div class="actions"><button class="btn sm ${key?.[k] === 'Đ' ? 'select' : ''}" data-action="keypart" data-part="${k}" data-val="Đ">Đúng</button><button class="btn sm ${key?.[k] === 'S' ? 'select' : ''}" data-action="keypart" data-part="${k}" data-val="S">Sai</button></div></div>`).join('')}`;
  return `<div><label class="label" for="rightNum">Đáp án đúng</label><input id="rightNum" data-field="rightNum" class="input" placeholder="Ví dụ: 0,5 hoặc 1/2" value="${esc(key ?? '')}"><div class="hint mt">Hỗ trợ số nguyên, số thập phân và phân số.</div></div>`;
}
function keyText(kind, key) { return kind === 'tf4' ? ['a', 'b', 'c', 'd'].map((k) => k + ' ' + (key?.[k] || '?')).join(', ') : String(key ?? ''); }
function distribution(a) {
  const values = Object.values(a.responses).map((r) => r.value);
  if (a.kind === 'abcd' || a.kind === 'tf' || a.kind === 'checkin') {
    const choices = a.kind === 'abcd' ? ['A', 'B', 'C', 'D'] : a.kind === 'tf' ? ['Đúng', 'Sai'] : a.options;
    return `<div class="answer-label mt">Phân bố câu trả lời</div>${choices.map((v) => { const n = values.filter((z) => z === v).length; return `<div class="barrow"><b style="font-size:12px" title="${esc(v)}">${esc(a.kind === 'checkin' ? v.slice(0, 2) : v)}</b><div class="track"><div class="fill ${a.key === v ? 'green' : ''}" style="width:${values.length ? 100 * n / values.length : 0}%"></div></div><span class="muted tiny" style="text-align:right">${n}/${values.length}</span></div>`; }).join('')}`;
  }
  if (a.kind === 'tf4') return `<div class="answer-label mt">Số lượt trả lời đủ bốn ý: ${values.filter((v) => v && Object.keys(v).length === 4).length}</div>`;
  return `<div class="answer-label mt">Các kết quả đã gửi (không công bố danh tính)</div><div class="mutedbox" style="font-size:12px;overflow-wrap:anywhere">${values.length ? values.map((v) => esc(v)).join(' · ') : 'Chưa có câu trả lời'}</div>`;
}
// Đề của câu soạn sẵn (dùng ở cả màn cô và màn học sinh).
function questionBody(a) {
  if (!a.fromBank) return '';
  let html = `<div class="q-text">${rich(a.prompt)}</div>`;
  if (a.kind === 'tf4' && a.statements) html += `<div class="q-list">${['a', 'b', 'c', 'd'].map((k) => `<div><b>${k})</b> ${rich(a.statements[k])}</div>`).join('')}</div>`;
  return html;
}
function teacherActive(room, a) {
  const joined = Object.values(room.members).filter((m) => m.joinedAt != null);
  const n = joined.filter((m) => a.responses[m.id]).length, total = joined.length;
  const waiting = joined.filter((m) => m.online && !a.responses[m.id]);
  const allReady = total > 0 && n === total;
  const shown = a.kind === 'checkin' ? esc(a.prompt) : a.fromBank ? 'Học sinh đang thấy đề này trên máy mình.' : 'Học sinh thấy: “Câu ' + numberOf(room, a) + ' · Đáp án của em là gì?”';
  const choicesList = a.kind === 'abcd' && a.choices ? `<div class="q-list">${['A', 'B', 'C', 'D'].map((k) => `<div><b>${k}.</b> ${rich(a.choices[k])}</div>`).join('')}</div>` : '';
  return `<section class="panel stack"><div class="row wrap"><div><span class="chip pending">● Đang nhận câu trả lời</span><h2 style="margin:9px 0 0">${a.kind === 'checkin' ? esc(a.title) : 'Câu ' + numberOf(room, a) + ' · ' + labelKind[a.kind]}</h2></div><span class="chip ${allReady ? 'good' : ''}">${n}/${total} đã phản hồi</span></div>${questionBody(a)}${choicesList}<div class="mutedbox"><div class="progress"><div style="width:${total ? 100 * n / total : 0}%"></div></div><p class="hint" style="margin:8px 0 0">${shown}</p>${waiting.length ? `<div class="hint" style="margin-top:8px">Đang online, chưa trả lời (${waiting.length}):</div><div class="waiting-names">${waiting.slice(0, 40).map((m) => `<span>${esc(m.name)}</span>`).join('')}</div>` : ''}</div>${distribution(a)}${a.kind === 'checkin' ? `<div class="banner info">☑ Check-in không được chấm điểm. Chỉ tổng hợp kết quả toàn lớp.</div><button class="btn primary block" data-action="close">Kết thúc check-in</button>` : `<div class="divider" style="margin:0"></div>${keySelector(room, a)}<button class="btn primary block" data-action="close">✓ Chốt câu và chấm</button><button class="btn block danger" data-action="skip">Bỏ câu · không tính kết quả</button>`}</section>`;
}
function controls(v) {
  const room = v.room;
  if (room.status !== 'live' && v.liveSid) {
    const live = v.sessions.find((s) => s.id === v.liveSid);
    return `<section class="panel stack"><div><h2 style="margin-bottom:4px">Đang xem lại buổi ${room.n}</h2><p class="muted tight">Buổi ${live?.n} đang diễn ra. Cô vẫn sửa được thông tin của buổi ${room.n} ở bên dưới.</p></div><button class="btn primary block" data-action="viewSession" data-sid="${v.liveSid}">● Quay lại buổi ${live?.n} đang học</button></section>`;
  }
  if (room.status !== 'live') {
    return `<section class="panel stack"><div><h2 style="margin-bottom:4px">${v.sessions.length ? 'Chưa có buổi học nào đang diễn ra' : 'Lớp mới tạo'}</h2><p class="muted tight">Đến giờ học, cô bấm bắt đầu. Học sinh mở lại đúng link cũ là vào buổi mới; danh sách lớp${feat('parent') ? ', thông tin phụ huynh' : ''}${feat('bank') ? ', bộ câu hỏi' : ''} được giữ nguyên.</p></div><button class="btn primary block" data-action="startSession">▶ Bắt đầu buổi ${v.sessions.length + 1} hôm nay</button>${room.sid ? `<div class="hint">Đang xem lại buổi ${room.n} (${formatDate(room.createdAt)}).</div>` : ''}</section>`;
  }
  const kinds = quickTypes.filter(([k]) => v.features.kinds[k]);
  const quick = feat('quick') && kinds.length ? `<div><h2 style="margin-bottom:4px">Câu hỏi nhanh</h2><p class="muted tight">Không cần gõ câu hỏi. Cô chiếu đề trên Zoom/Meet rồi mở một lượt.</p></div><div class="type-grid">${kinds.map(([k, t, d, ic]) => `<button class="type-btn" data-action="open" data-kind="${k}"><span class="type-icon">${ic}</span><strong>${t}</strong><small>${d}</small></button>`).join('')}</div>` : '';
  const checkin = feat('checkin') ? `<div class="section-title" style="margin:0">Check-in nhanh</div><div class="three">${[['start', '🌤️ Đầu giờ'], ['middle', '☕ Giữa giờ'], ['end', '🌿 Cuối giờ']].map(([k, t]) => `<button class="btn" data-action="checkin" data-phase="${k}">${t}</button>`).join('')}</div>` : '';
  if (!quick && !checkin) return feat('bank') ? '' : `<section class="panel stack"><h2 style="margin:0">Buổi ${room.n} đang diễn ra</h2><p class="muted tight">Lớp này không bật câu hỏi hay check-in. Cô theo dõi điểm danh ở bên dưới; muốn thêm, bấm ⚙ Tùy chỉnh lớp.</p></section>`;
  return `<section class="panel stack">${quick}${quick && checkin ? '<div class="divider" style="margin:0"></div>' : ''}${checkin}</section>`;
}
function bankPanel(v) {
  if (!feat('bank')) return '';
  const room = v.room, live = room.status === 'live' && !active(room);
  const usedNow = new Set(room.status === 'live' ? room.activities.map((a) => a.fromBank).filter(Boolean) : []);
  const e = state.bankEdit;
  const topics = [...new Set(v.bank.map((q) => q.topic || ''))];
  const list = v.bank.length ? topics.map((t) => `<div class="bank-topic">${t ? esc(t) : '<span class="muted">Chưa phân bài</span>'}</div>${v.bank.filter((q) => (q.topic || '') === t).map((q) => `<div class="bank-row"><div class="bank-main"><span class="chip">${esc(labelKind[q.kind])}</span>${usedNow.has(q.id) ? ' <span class="chip good">✓ đã mở buổi này</span>' : ''}<div class="bank-text">${rich(q.text)}</div><div class="tiny muted">Đáp án: <b>${esc(keyText(q.kind, q.key))}</b></div></div><div class="actions">${live ? `<button class="btn sm primary" data-action="bankOpen" data-id="${q.id}">▶ Mở cho lớp</button>` : ''}<button class="btn sm" data-action="bankEdit" data-id="${q.id}">Sửa</button><button class="btn sm danger" data-action="bankDelete" data-id="${q.id}">Xoá</button></div></div>`).join('')}`).join('') : `<div class="empty-state">Chưa có câu nào. Cô soạn trước giờ học, trong giờ chỉ việc bấm “Mở cho lớp”.</div>`;
  return `<section class="panel stack"><div class="row wrap"><div><div class="title-eyebrow">Soạn trước · dùng lại mọi buổi</div><h2 style="margin:5px 0 0">📚 Bộ câu hỏi (${v.bank.length})</h2></div>${e ? '' : `<button class="btn sm primary" data-action="bankNew">+ Soạn câu mới</button>`}</div>${e ? bankEditor(e) : ''}${room.status === 'live' && active(room) ? '<div class="hint">Đang có hoạt động mở. Chốt xong mới mở được câu tiếp theo.</div>' : room.status !== 'live' && v.bank.length ? '<div class="hint">Bắt đầu buổi học để mở câu cho lớp.</div>' : ''}<div class="bank-list">${list}</div><div class="hint">Gõ công thức toán giữa hai dấu $, ví dụ <code>$x^2-4x+3=0$</code> hoặc <code>$\\frac{1}{2}$</code>.</div></section>`;
}
function bankEditor(e) {
  const keyBtns = e.kind === 'abcd' ? ['A', 'B', 'C', 'D'] : e.kind === 'tf' ? ['Đúng', 'Sai'] : [];
  return `<div class="bank-editor stack"><div class="row wrap"><b>${e.id ? 'Sửa câu hỏi' : 'Câu hỏi mới'}</b><div class="chips-wrap" style="max-width:none">${KINDS.map(([k, l]) => `<button class="mini-choice ${e.kind === k ? 'chosen' : ''}" data-action="bankKind" data-id="${k}">${l}</button>`).join('')}</div></div>
<div><label class="label" for="bankTopic">Bài / chủ đề (để nhóm câu)</label><input id="bankTopic" class="input" data-field="bankTopic" value="${esc(e.topic)}" maxlength="80" placeholder="Ví dụ: Bài 3 – Hàm số bậc hai"></div>
<div><label class="label" for="bankText">Nội dung câu hỏi</label><textarea id="bankText" class="input" rows="3" data-field="bankText" maxlength="1000" placeholder="Ví dụ: Nghiệm của phương trình $x^2-4x+3=0$ là">${esc(e.text)}</textarea></div>
${e.kind === 'abcd' ? `<div class="stack" style="gap:6px"><div class="label">Các lựa chọn (bỏ trống nếu chỉ cần A/B/C/D) và đáp án đúng</div>${['A', 'B', 'C', 'D'].map((k) => `<div class="pair-row"><button class="btn sm ${e.key === k ? 'select' : ''}" data-action="bankKey" data-val="${k}" title="Chọn ${k} là đáp án đúng">${e.key === k ? '✓ ' : ''}${k}</button><input class="input" data-field="bankOpt" data-mid="${k}" value="${esc(e.options[k])}" maxlength="300" placeholder="Lựa chọn ${k}"></div>`).join('')}<div class="hint">Bấm vào chữ A/B/C/D để chọn đáp án đúng.</div></div>` : ''}
${e.kind === 'tf' ? `<div><div class="label">Đáp án đúng</div><div class="answer-choices">${keyBtns.map((k) => `<button class="btn ${e.key === k ? 'select' : ''}" data-action="bankKey" data-val="${k}">${k}</button>`).join('')}</div></div>` : ''}
${e.kind === 'tf4' ? `<div class="stack" style="gap:6px"><div class="label">Bốn ý và đáp án Đúng/Sai của từng ý</div>${['a', 'b', 'c', 'd'].map((k) => `<div class="pair-row"><b>${k})</b><input class="input" data-field="bankStmt" data-mid="${k}" value="${esc(e.statements[k])}" maxlength="300" placeholder="Ý ${k}"><div class="actions"><button class="btn sm ${e.key?.[k] === 'Đ' ? 'select' : ''}" data-action="bankKeyPart" data-part="${k}" data-val="Đ">Đ</button><button class="btn sm ${e.key?.[k] === 'S' ? 'select' : ''}" data-action="bankKeyPart" data-part="${k}" data-val="S">S</button></div></div>`).join('')}</div>` : ''}
${e.kind === 'num' ? `<div><label class="label" for="bankNum">Đáp án đúng</label><input id="bankNum" class="input" data-field="bankNum" value="${esc(typeof e.key === 'string' ? e.key : '')}" placeholder="Ví dụ: 0,5 hoặc 1/2 hoặc -3"></div>` : ''}
<div class="actions"><button class="btn primary" data-action="bankSave">✓ Lưu câu hỏi</button><button class="btn" data-action="bankCancel">Huỷ</button></div></div>`;
}
function sessionBar(v) {
  if (!v.sessions.length) return '';
  return `<div class="session-bar"><span class="muted tiny">Các buổi:</span>${v.sessions.map((s) => `<button class="session-chip ${s.id === v.room.sid ? 'on' : ''} ${s.id === v.liveSid ? 'live' : ''}" data-action="viewSession" data-sid="${s.id}">${s.id === v.liveSid ? '● ' : ''}Buổi ${s.n} · ${shortDate(s.startedAt)}</button>`).join('')}</div>`;
}
function members(room) {
  const all = Object.values(room.members), joined = all.filter((m) => m.joinedAt != null), online = joined.filter((m) => m.online).length;
  return `<section class="panel"><div class="row"><h3 style="margin:0">Học sinh đã vào buổi này (${joined.length}/${all.length})</h3>${room.status === 'live' ? `<span class="chip good">${online} online</span>` : ''}</div>${joined.length ? `<div class="response-list">${joined.map((m) => { const s = studentStats(room, m); return `<div class="name-row"><span>${room.status === 'live' ? `<span class="online-dot ${m.online ? 'on' : ''}" title="${m.online ? 'Đang online' : 'Đã thoát'}"></span>` : ''}${esc(m.name)}</span>${hasQuestions() ? `<span class="muted">${s.answered}/${s.eligible} câu</span>` : ''}</div>`; }).join('')}</div>` : `<div class="empty-state"><div class="emoji">👋</div>Chưa có học sinh vào buổi này.<br><small>Học sinh mở link lớp (gửi một lần qua Zalo) là vào.</small></div>`}</section>`;
}
function optionGroup(m, field, options) {
  const obs = observation(m);
  return `<div class="chips-wrap">${options.map(([value, label]) => `<button type="button" class="mini-choice ${obs[field] === value ? 'chosen' : ''}" data-action="observe" data-mid="${esc(m.id)}" data-field="${field}" data-value="${value}" title="${esc(label)}">${esc(label)}</button>`).join('')}</div>`;
}
function rosterBox(compact) {
  return `<details class="roster-add" ${state.rosterOpen || !compact ? 'open' : ''}><summary>+ Thêm học sinh vào danh sách lớp (dùng cho mọi buổi)</summary><label class="label mt" for="rosterDraft">Mỗi dòng một tên (có thể dán cột họ tên từ Excel); học sinh vào web đúng tên sẽ được ghép với danh sách</label><textarea class="input" rows="3" id="rosterDraft" data-field="rosterDraft" placeholder="Nguyễn Minh Anh&#10;Trần Đức Minh">${esc(state.rosterDraft)}</textarea><button class="btn sm primary mt" data-action="addRoster">Thêm vào danh sách</button></details>`;
}
function attendancePanel(room) {
  const all = Object.values(room.members);
  const obsOf = (m) => observation(m);
  const present = all.filter((m) => ['present', 'late'].includes(obsOf(m).attendance)).length;
  const unknown = all.filter((m) => obsOf(m).attendance === 'unmarked').length;
  const camOn = all.filter((m) => obsOf(m).camera === 'on').length;
  const camChecked = all.filter((m) => obsOf(m).camera !== 'unknown').length;
  const q = normalizeName(state.search || '');
  const shown = q ? all.filter((m) => normalizeName(m.name).includes(q)) : all;
  const tracking = anyTracking() || feat('parent');
  if (!room.sid || !tracking) {
    return `<section class="panel stack"><div><div class="title-eyebrow">Danh sách lớp</div><h2 style="margin:5px 0 0">${all.length} học sinh</h2></div>${rosterBox(!!room.sid)}${all.length ? `<div class="waiting-names">${all.map((m) => `<span class="roster-name">${room.sid && room.status === 'live' ? `<span class="online-dot ${m.online ? 'on' : ''}"></span>` : ''}${esc(m.name)}</span>`).join('')}</div>` : ''}</section>`;
  }
  const chips = [feat('attendance') ? `<span class="chip good">${present} có mặt / muộn</span>` : '', feat('camera') ? `<span class="chip good">📷 ${camOn} bật cam${camChecked < all.length ? ` · ${all.length - camChecked} chưa kiểm tra` : ''}</span>` : '', feat('attendance') ? `<span class="chip pending">${unknown} chưa điểm danh</span>` : ''].join('');
  const head = ['<th>Học sinh</th>', feat('attendance') ? '<th>Điểm danh</th>' : '', feat('camera') ? '<th>Camera</th>' : '', feat('called') ? '<th>Khi cô gọi</th>' : '', feat('note') ? '<th>Nhận xét buổi này</th>' : '', feat('parent') ? '<th>Báo cáo</th>' : ''].join('');
  const row = (m) => {
    const o = obsOf(m);
    return `<tr><td><strong>${esc(m.name)}</strong><div class="tiny muted">${m.joinedAt ? `<span class="online-dot ${m.online ? 'on' : ''}"></span>${m.online ? 'Đang online' : 'Đã vào web'}` : 'Chưa vào web'}</div></td>${feat('attendance') ? `<td>${optionGroup(m, 'attendance', [['present', 'Có mặt'], ['late', 'Muộn'], ['absent', 'Vắng'], ['excused', 'Có phép']])}</td>` : ''}${feat('camera') ? `<td>${optionGroup(m, 'camera', [['on', 'Bật'], ['off', 'Tắt'], ['exempt', 'Miễn']])}</td>` : ''}${feat('called') ? `<td>${optionGroup(m, 'called', [['answered', 'Trả lời'], ['no_answer', 'Không trả lời']])}</td>` : ''}${feat('note') ? `<td><input class="input compact-input" data-field="obsNote" data-mid="${esc(m.id)}" value="${esc(fieldValue('note', m.id, o.note))}" maxlength="500" placeholder="Ghi chú ngắn..."></td>` : ''}${feat('parent') ? `<td><button class="btn sm" data-action="parentPreview" data-mid="${esc(m.id)}">Xem PH ›</button></td>` : ''}</tr>`;
  };
  return `<section class="panel stack"><div class="row wrap"><div><div class="title-eyebrow">Theo dõi buổi ${room.n}</div><h2 style="margin:5px 0 0">${anyTracking() ? 'Điểm danh & tương tác' : 'Học sinh'}</h2></div><div class="actions">${chips}</div></div>${anyTracking() ? `<div class="hint">Cô tick thủ công trong giờ học.${feat('camera') ? ' Camera là trạng thái cô quan sát, không phải dữ liệu webcam.' : ''}${feat('called') ? ' “Chưa gọi” không đồng nghĩa với “không trả lời”.' : ''} Học sinh vào web bằng tên chưa có trong danh sách sẽ được tự thêm.</div>` : ''}${rosterBox(true)}${all.length > 8 ? `<input class="input" data-field="search" value="${esc(state.search || '')}" placeholder="🔎 Tìm tên học sinh…">` : ''}${all.length ? `<div class="table-scroll"><table class="attendance-table"><thead><tr>${head}</tr></thead><tbody>${shown.map(row).join('')}</tbody></table></div>` : `<div class="empty-state">Chưa có tên nào trong danh sách.<div class="hint mt">Cô thêm danh sách lớp hoặc để học sinh vào bằng link.</div></div>`}</section>`;
}
function reportTeacher(room) {
  if (!room.sid) return '';
  const all = Object.values(room.members);
  const count = room.activities.filter((a) => a.status === 'graded').length;
  const joined = all.filter((m) => m.joinedAt != null);
  const avg = joined.length ? Math.round(joined.reduce((n, m) => n + (studentStats(room, m).participation ?? 0), 0) / joined.length) : null;
  const present = all.filter((m) => ['present', 'late'].includes(observation(m).attendance)).length;
  const camOn = all.filter((m) => observation(m).camera === 'on').length;
  const q = hasQuestions();
  const stats = [feat('attendance') ? `<div class="stat"><b>${present}/${all.length}</b><small>Có mặt / muộn</small></div>` : `<div class="stat"><b>${joined.length}/${all.length}</b><small>Vào web buổi này</small></div>`, feat('camera') ? `<div class="stat"><b>${camOn}/${all.length}</b><small>Bật camera (cô tick)</small></div>` : '', q ? `<div class="stat"><b>${count}</b><small>Câu đã chấm</small></div>` : '', q ? `<div class="stat"><b>${percent(avg)}</b><small>Tham gia TB của HS vào web</small></div>` : ''].filter(Boolean);
  const cols = [feat('attendance') && ['Điểm danh', (m, s, o) => attendanceLabels[o.attendance]], feat('camera') && ['Camera', (m, s, o) => cameraLabels[o.camera]], feat('called') && ['Khi cô gọi', (m, s, o) => calledLabels[o.called]], !feat('attendance') && ['Vào web', (m) => (m.joinedAt ? 'Có' : 'Không')], q && ['Đã trả lời', (m, s) => s.answered + '/' + s.eligible], q && ['Đúng', (m, s) => s.correct + '/' + s.answered], q && ['Tham gia', (m, s) => percent(s.participation)], q && ['Chính xác', (m, s) => percent(s.accuracy)]].filter(Boolean);
  return `<section class="panel stack"><div class="row wrap"><div><div class="title-eyebrow">Tổng hợp buổi ${room.n} · ${formatDate(room.createdAt)}</div><h2 style="margin:5px 0">Báo cáo buổi học</h2></div><button class="btn sm" data-action="csv">↓ CSV buổi này</button></div><div class="${stats.length >= 4 ? 'four' : stats.length === 3 ? 'three' : 'two'}">${stats.join('')}</div>${all.length ? `<div class="table-scroll"><table><thead><tr><th>Học sinh</th>${cols.map((c) => `<th>${c[0]}</th>`).join('')}${feat('parent') ? '<th>PH</th>' : ''}</tr></thead><tbody>${all.map((m) => { const s = studentStats(room, m), o = observation(m); return `<tr><td>${esc(m.name)}</td>${cols.map((c) => `<td>${esc(c[1](m, s, o))}</td>`).join('')}${feat('parent') ? `<td><button class="btn sm" data-action="parentPreview" data-mid="${esc(m.id)}">Xem</button>${o.delivery === 'manually_shared' ? '<div class="delivery">✓ Đã soạn gửi</div>' : ''}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>` : `<p class="muted">Chưa có học sinh.</p>`}<div class="hint">Báo cáo lớp chỉ dành cho giáo viên.${feat('parent') ? ' Gửi phụ huynh bằng báo cáo riêng từng học sinh (nút Xem), không gửi file CSV cả lớp.' : ''}</div></section>`;
}
function courseReport(v) {
  const rooms = v.allRooms; if (!rooms.length) return '';
  const all = Object.values(v.room.members), q = hasQuestions();
  return `<section class="panel stack"><div class="row wrap"><div><div class="title-eyebrow">Từ buổi 1 đến nay · ${rooms.length} buổi</div><h2 style="margin:5px 0">Tổng hợp cả khoá</h2></div><button class="btn sm" data-action="csvCourse">↓ CSV cả khoá</button></div>${all.length ? `<div class="table-scroll"><table><thead><tr><th>Học sinh</th><th>${feat('attendance') ? 'Buổi có mặt' : 'Buổi vào web'}</th>${q ? '<th>Đã trả lời</th><th>Đúng</th><th>Tham gia</th><th>Chính xác</th>' : ''}</tr></thead><tbody>${all.map((m) => { const c = courseStats(rooms, m.id); return `<tr><td>${esc(m.name)}</td><td>${c.attended}/${rooms.length}</td>${q ? `<td>${c.answered}/${c.eligible}</td><td>${c.correct}/${c.answered}</td><td>${percent(c.participation)}</td><td>${percent(c.accuracy)}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>` : ''}<div class="hint">“${feat('attendance') ? 'Buổi có mặt' : 'Buổi vào web'}” tính khi ${feat('attendance') ? 'cô tick Có mặt/Muộn hoặc ' : ''}học sinh có vào web buổi đó. File CSV cả khoá có thêm một cột cho từng buổi.</div></section>`;
}
function parentMessage(room, m) {
  const st = studentStats(room, m), o = observation(m);
  const c = courseStats(state.view?.allRooms || [], m.id);
  const lines = [];
  if (feat('attendance')) lines.push(`- Điểm danh: ${attendanceLabels[o.attendance]}.`);
  if (feat('camera')) lines.push(`- Camera (quan sát của cô): ${cameraLabels[o.camera]}.`);
  if (feat('called')) lines.push(`- Khi được gọi: ${calledLabels[o.called]}.`);
  if (hasQuestions()) lines.push(`- Tham gia trả lời: ${st.answered}/${st.eligible} lượt hợp lệ (${percent(st.participation)}).`, `- Trả lời chính xác: ${st.correct}/${st.answered} (${percent(st.accuracy)}).`);
  if (feat('checkin')) lines.push(`- Check-in đã thực hiện: ${st.checked}/${st.checkins}.`);
  if (c.sessions > 1) lines.push(`- Từ đầu khoá: ${feat('attendance') ? 'có mặt' : 'vào lớp'} ${c.attended}/${c.sessions} buổi${hasQuestions() ? `, tham gia ${percent(c.participation)}, chính xác ${percent(c.accuracy)}` : ''}.`);
  return `Kính gửi Quý Phụ huynh${o.parentName ? ' ' + o.parentName : ''},\n\nCô gửi thông tin buổi ${room.n} lớp ${room.name} ngày ${formatDate(room.createdAt)} của con ${m.name}:\n${lines.join('\n')}\n${feat('note') && o.note ? '\nNhận xét của cô: ' + o.note + '\n' : ''}${hasQuestions() ? '\nCác tỷ lệ phản ánh hoạt động tương tác trên web, không phải tỷ lệ kiến thức đã nắm vững.\n' : ''}\nCảm ơn Quý Phụ huynh đã đồng hành cùng cô và các con.`;
}
function parentReportPage(room, m) {
  const st = studentStats(room, m), o = observation(m);
  const c = courseStats(state.view?.allRooms || [], m.id);
  let sec = 0;
  const info = [feat('attendance') && `<div><small>Điểm danh</small><strong>${attendanceLabels[o.attendance]}</strong></div>`, feat('camera') && `<div><small>Camera (cô quan sát)</small><strong>${cameraLabels[o.camera]}</strong></div>`, feat('called') && `<div><small>Khi cô gọi</small><strong>${calledLabels[o.called]}</strong></div>`].filter(Boolean).join('');
  const course = c.sessions > 1 ? ` Từ đầu khoá: ${feat('attendance') ? 'có mặt' : 'vào lớp'} ${c.attended}/${c.sessions} buổi${hasQuestions() ? `, tham gia ${percent(c.participation)}, chính xác ${percent(c.accuracy)}` : ''}.` : '';
  return `<div class="parent-page"><div class="row wrap no-print" style="margin-bottom:16px"><button class="btn" data-action="backTeacher">← Quay về quản lý lớp</button><span class="chip pending">Bản xem trước · ${o.delivery === 'manually_shared' ? 'Đã soạn gửi' : 'Chưa gửi'}</span></div><div class="report-paper panel"><div class="report-accent"></div><div class="row wrap"><div><div class="title-eyebrow">LỚP MÌNH LIVE · BÁO CÁO CÁ NHÂN</div><h1 style="font-size:25px;margin:7px 0">BÁO CÁO BUỔI ${room.n}</h1><div class="muted">${esc(room.name)} · ${formatDate(room.createdAt)}</div></div><span class="chip">Dành riêng cho phụ huynh</span></div><div class="divider"></div><div class="row wrap"><div><div class="label">Học sinh</div><h2 style="margin:4px 0">${esc(m.name)}</h2></div><div class="muted" style="font-size:12px">Báo cáo cá nhân, không bao gồm thông tin của học sinh khác</div></div>${info ? `<h3 style="margin:16px 0 10px">${++sec}. Nề nếp trong buổi học</h3><div class="report-info">${info}</div>` : ''}${hasQuestions() ? `<h3 style="margin:20px 0 10px">${++sec}. Tham gia học tập</h3><div class="report-grid"><div class="stat"><small>Tỷ lệ tham gia</small><b>${percent(st.participation)}</b><small>${st.answered}/${st.eligible} câu</small></div><div class="stat"><small>Tỷ lệ chính xác</small><b>${percent(st.accuracy)}</b><small>${st.correct}/${st.answered} câu đúng</small></div></div>` : ''}${feat('checkin') || course ? `<p class="hint mt">${feat('checkin') ? `Check-in: ${st.checked}/${st.checkins} lượt. Không tính check-in vào tỷ lệ chính xác.` : ''}${course}</p>` : ''}${feat('note') ? `<h3 style="margin:20px 0 10px">${++sec}. Nhận xét của giáo viên</h3><div class="note-paper">${o.note ? esc(o.note) : '<span class="muted">Chưa có nhận xét riêng cho buổi học này.</span>'}</div>` : ''}<div class="divider"></div><p class="hint">Lưu ý: Báo cáo thể hiện các quan sát thủ công của giáo viên và số lượt trả lời trên web. Đây không phải thước đo toàn bộ năng lực, mức độ tập trung hay phần trăm kiến thức học sinh đã nắm.</p><div class="tiny muted" style="text-align:right">Lớp Mình Live · ${formatDate(room.endedAt || now())}</div></div><section class="panel stack no-print" style="margin-top:16px"><div><h3 style="margin-bottom:6px">Duyệt thông tin & gửi phụ huynh</h3><p class="hint tight">Bước này chỉ tạo tài liệu và nội dung tin nhắn; cô tự gửi qua Zalo hoặc email. Tên và email phụ huynh được nhớ cho các buổi sau.</p></div><div class="two"><div><label class="label" for="guardianName">Tên phụ huynh (không bắt buộc)</label><input id="guardianName" class="input" data-field="parentName" data-mid="${esc(m.id)}" value="${esc(fieldValue('parentName', m.id, o.parentName))}" placeholder="Phụ huynh của con..."></div><div><label class="label" for="guardianEmail">Email phụ huynh (nếu gửi email)</label><input id="guardianEmail" class="input" data-field="parentEmail" data-mid="${esc(m.id)}" value="${esc(fieldValue('parentEmail', m.id, o.parentEmail))}" placeholder="phuhuynh@example.com" type="email"></div></div>${feat('note') ? `<div><label class="label" for="guardianNote">Nhận xét riêng của cô (buổi ${room.n})</label><textarea id="guardianNote" rows="3" class="input" data-field="note" data-mid="${esc(m.id)}" placeholder="Nhận xét mang tính xây dựng, dựa trên quan sát...">${esc(fieldValue('note', m.id, o.note))}</textarea><div class="hint mt">Tự lưu sau khi cô ngừng gõ.</div></div>` : ''}<div class="actions"><button class="btn primary" data-action="printReport">↧ In / Lưu PDF</button><button class="btn" data-action="copyParent">⧉ Sao chép tin nhắn gửi Zalo</button><button class="btn" data-action="emailParent">✉ Soạn email cho PH</button></div><div class="banner warn">Thông tin phụ huynh chỉ máy của cô đọc được. Chỉ nhập khi có sự đồng ý của phụ huynh.</div></section></div>`;
}
let qrFor = '', qrUrl = '';
function shareBox(v) {
  const link = linkStudent();
  if (qrFor !== link) {
    qrFor = link; qrUrl = '';
    QRCode.toDataURL(link, { margin: 1, width: 300 }).then((u) => { if (qrFor === link) { qrUrl = u; render(); } }).catch(() => {});
  }
  return `<section class="panel stack"><div class="title-eyebrow">Link lớp cho học sinh · dùng cả khoá</div><div class="row"><div class="code">${esc(v.code)}</div><button class="btn sm" data-action="copy">⧉ Mã</button></div><div class="share-link">${esc(link)}</div><button class="btn sm" data-action="copyLink">⧉ Sao chép link gửi Zalo / chat Zoom</button><div class="hint">Gửi một lần đầu khoá. Các tuần sau học sinh mở lại đúng link này.</div>${qrUrl ? `<div class="qr-box"><img src="${qrUrl}" alt="Mã QR vào lớp"></div>` : ''}</section>`;
}
function manageBox(v) {
  const room = v.room;
  const on = FEATURES.filter((x) => v.features[x.id]);
  return `<section class="panel stack"><h3 style="margin:0">Quản lý</h3>${room.status === 'live' ? `<button class="btn block" data-action="end">■ Kết thúc buổi ${room.n} & tổng hợp báo cáo</button>` : ''}<div class="tiny muted">Lớp đang dùng: ${on.map((x) => x.icon + ' ' + x.label).join(' · ') || 'chưa bật tính năng nào'} <a href="#" data-action="customize">Tùy chỉnh</a></div><div class="mutedbox"><div class="tiny muted">Mã quản lý (giữ bí mật) — dùng để mở lớp này trên máy khác</div><div class="row" style="margin-top:4px"><b class="code" style="font-size:15px">${esc(v.adminKey || '')}</b><button class="btn sm" data-action="copyKey">⧉</button></div></div><button class="btn block danger" data-action="deleteClass">Xoá lớp & mọi dữ liệu</button></section>`;
}
function teacher(v) {
  if (state.setup?.editing) return setupView();
  const room = v.room;
  const selected = state.parentPreviewId && room.members[state.parentPreviewId];
  if (selected && room.sid && feat('parent')) return parentReportPage(room, selected);
  const st = getStatus(room), a = active(room);
  const q = hasQuestions();
  const stats = room.sid ? `<div class="${q ? 'four' : 'two'}"><div class="stat"><b>${st.count}</b><small>Sĩ số danh sách</small></div>${q ? `<div class="stat"><b>${st.opened}</b><small>Lượt đã mở</small></div><div class="stat"><b>${st.graded}</b><small>Đã chấm</small></div>` : ''}<div class="stat"><b>${Object.values(room.members).filter((m) => m.joinedAt != null).length}</b><small>Vào web buổi này</small></div></div>` : '';
  return `${headline(v, true)}${sessionBar(v)}<div class="layout"><div class="stack">${stats}${a ? teacherActive(room, a) : controls(v)}${bankPanel(v)}</div><div class="stack">${shareBox(v)}${room.sid ? members(room) : ''}${manageBox(v)}</div></div><div class="stack" style="margin-top:18px">${attendancePanel(room)}${reportTeacher(room)}${courseReport(v)}</div>`;
}
function studentAnswer(room, a, m) {
  const own = a.responses[m.id]?.value; const draft = state.studentDrafts[a.id] || {};
  if (a.kind === 'checkin') return `<div class="stack" style="gap:9px">${a.options.map((o) => `<button class="btn block ${own === o ? 'select' : ''}" style="text-align:left;min-height:49px" data-action="answer" data-value="${esc(o)}">${esc(o)} ${own === o ? ' ✓' : ''}</button>`).join('')}</div>`;
  if (a.kind === 'abcd' && a.choices) return `<div class="stack" style="gap:9px">${['A', 'B', 'C', 'D'].map((v) => `<button class="btn block choice-btn ${own === v ? 'select' : ''}" data-action="answer" data-value="${v}"><b>${v}.</b> ${rich(a.choices[v])}${own === v ? ' ✓' : ''}</button>`).join('')}</div>`;
  if (a.kind === 'abcd' || a.kind === 'tf') { const opts = a.kind === 'abcd' ? ['A', 'B', 'C', 'D'] : ['Đúng', 'Sai']; return `<div class="question-grid">${opts.map((v) => `<button class="btn option ${a.kind === 'tf' ? 'tf' : ''} ${own === v ? 'active' : ''}" data-action="answer" data-value="${v}">${v}</button>`).join('')}</div>`; }
  if (a.kind === 'tf4') { const all = draft && Object.keys(draft).length ? draft : (own || {}); return `<div class="hint" style="margin-bottom:12px">Chọn Đúng hoặc Sai cho cả bốn ý. Khi đủ 4 ý, hệ thống tự ghi nhận.</div>${['a', 'b', 'c', 'd'].map((k) => `<div class="pair-row"><b>Ý ${k}</b><div class="actions"><button class="btn ${all[k] === 'Đ' ? 'select' : ''}" data-action="part" data-part="${k}" data-value="Đ">Đúng</button><button class="btn ${all[k] === 'S' ? 'select' : ''}" data-action="part" data-part="${k}" data-value="S">Sai</button></div></div>`).join('')}`; }
  return `<div class="stack" style="gap:10px"><input data-field="numberDraft" class="input" value="${esc(state.studentDrafts[a.id] ?? own ?? '')}" placeholder="Ví dụ: -2 hoặc 0,5 hoặc 1/2" inputmode="decimal"><button class="btn primary block" data-action="number">Gửi đáp án</button><div class="hint">Chỉ nhập kết quả bằng số.${own != null ? ' Đã gửi: <b>' + esc(own) + '</b>' : ''}</div></div>`;
}
function studentActive(room, a, m) {
  const own = a.responses[m.id];
  return `<section class="panel stack student-head"><div class="row"><span class="pill"><span class="dot"></span> Cô vừa mở hoạt động</span><span class="chip">${a.kind === 'checkin' ? 'Check-in' : 'Câu ' + numberOf(room, a)}</span></div><div><div class="title-eyebrow">${a.kind === 'checkin' ? esc(a.title) : esc(labelKind[a.kind])}</div>${a.fromBank ? questionBody(a) : `<h2 style="margin:8px 0 0">${esc(a.prompt)}</h2>`}</div>${studentAnswer(room, a, m)}<div class="banner ${own ? '' : 'info'}">${own ? '✓ Đã ghi nhận câu trả lời của con. Con có thể thay đổi cho đến khi cô chốt.' : 'Chọn một đáp án để gửi tới cô.'}</div></section>`;
}
function studentReport(room, m, ended) {
  if (!feat('selfReport')) return ended ? `<section class="panel"><div class="callout">🌱 Cảm ơn con đã tham gia buổi ${room.n}!</div></section>` : '';
  const s = studentStats(room, m);
  const last = [...room.activities].reverse().find((a) => a.status === 'graded' && a.responses[m.id]);
  const q = hasQuestions();
  return `<section class="panel stack"><div><div class="title-eyebrow">${ended ? 'Báo cáo buổi ' + room.n + ' · ' + formatDate(room.createdAt) : 'Tiến độ buổi ' + room.n}</div><h2 style="margin:5px 0">${ended ? 'Buổi học vừa rồi con học thế nào?' : 'Cùng theo dõi nhé!'}</h2></div>${q ? `<div class="report-grid"><div class="stat"><small>Tỷ lệ tham gia</small><b>${percent(s.participation)}</b><small>${s.answered}/${s.eligible} câu đã chấm</small></div><div class="stat"><small>Tỷ lệ chính xác</small><b>${percent(s.accuracy)}</b><small>${s.correct}/${s.answered} câu trả lời</small></div></div>` : ''}${feat('checkin') ? `<div class="mutedbox"><div class="row"><span>Check-in hoàn thành</span><b>${s.checked}/${s.checkins}</b></div><div class="progress" style="margin-top:9px"><div style="width:${s.checkins ? 100 * s.checked / s.checkins : 0}%"></div></div></div>` : ''}${last ? `<div class="banner ${graded(last, last.responses[m.id]) ? '' : 'info'}">${graded(last, last.responses[m.id]) ? '✓' : 'ℹ'} Lượt được chấm gần nhất: <b>${graded(last, last.responses[m.id]) ? 'Chính xác!' : 'Chưa chính xác'}</b>${last.kind === 'tf4' ? ` (${correctParts(last, last.responses[m.id])}/4 ý đúng)` : ''}.</div>` : ''}${ended ? `<div class="callout">🌱 Cảm ơn con đã tham gia! Báo cáo này phản ánh mức độ tham gia trả lời, không phải tỷ lệ kiến thức con đã nắm vững.</div>` : q ? `<div class="hint">Phần trăm chỉ tính các câu đã được cô chốt và chấm. Các câu bị bỏ qua không tính.</div>` : ''}</section>`;
}
function studentHistory(v, uid) {
  if (!feat('selfReport')) return '';
  const past = v.history.filter((r) => r.members[uid].joinedAt != null).reverse();
  if (!past.length) return '';
  return `<section class="panel stack"><div class="title-eyebrow">Các buổi con đã học</div>${past.map((r) => { const s = studentStats(r, r.members[uid]); return `<div class="name-row"><span>Buổi ${r.n} · ${shortDate(r.createdAt)}</span><span class="muted">${hasQuestions() ? `tham gia ${percent(s.participation)} · đúng ${percent(s.accuracy)}` : 'đã vào lớp'}</span></div>`; }).join('')}</section>`;
}
function student(v) {
  const uid = state.conn.uid;
  const room = v.room;
  const name = raw.member?.name || '';
  let body;
  if (!room) {
    const last = v.history.filter((r) => r.members[uid].joinedAt != null).pop();
    body = `<section class="panel empty-state"><div class="emoji">🕒</div><h3 style="color:var(--ink);margin-bottom:4px">Chưa đến giờ học</h3><p class="muted tight">Khi cô bắt đầu buổi học, màn hình này tự chuyển. Con cứ để trang mở.</p></section>${last ? studentReport(last, last.members[uid], true) : ''}${studentHistory(v, uid)}`;
  } else {
    const m = room.members[uid];
    const a = active(room);
    const s = studentStats(room, m);
    const side = !a ? studentReport(room, m, false) : feat('selfReport') && hasQuestions() ? `<div class="panel"><div class="title-eyebrow">Tiến độ buổi ${room.n}</div><div class="row" style="margin-top:6px"><b>${s.answered} câu đã trả lời và chấm</b><span class="chip">${percent(s.participation)}</span></div></div>` : '';
    body = `${a ? studentActive(room, a, m) : `<section class="panel empty-state"><div class="emoji">☕</div><h3 style="color:var(--ink);margin-bottom:4px">${hasQuestions() || feat('checkin') ? 'Đang chờ câu hỏi tiếp theo' : 'Con đã vào lớp'}</h3><p class="muted tight">${hasQuestions() || feat('checkin') ? 'Khi cô mở lượt mới, bảng trả lời sẽ xuất hiện ở đây.' : 'Cô đã ghi nhận con có mặt trên web buổi này.'}</p></section>`}${side}`;
  }
  return `<div class="student-shell">${headline(v, false)}<div class="row mb"><div>Xin chào, <span class="student-name">${esc(name)}</span> 👋</div><span class="chip ${room ? 'good' : ''}">${room ? 'Đang học · buổi ' + room.n : 'Chờ buổi học'}</span></div>${isPreview() ? '<div class="banner info">Cô đang xem thử như học sinh. Câu trả lời ở đây không tính vào báo cáo lớp.</div>' : ''}<div class="stack">${body}</div><p class="footer">Lớp Mình Live · Giao diện gọn cho cửa sổ laptop và điện thoại</p></div>`;
}
function view() {
  if (state.role === 'setup') return setupView();
  if (state.role === 'home') return MODE === 'teacher' ? teacherHome() : studentHome();
  const v = state.view;
  if (!v) return '<p class="muted">Đang tải dữ liệu lớp…</p>';
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
  // Học sinh để tab này ở nền: tiêu đề tab báo khi cô mở câu mới mà con chưa trả lời.
  const r = state.role === 'student' ? state.view?.room : null, a = r ? active(r) : null;
  document.title = a && !a.responses[state.conn.uid] ? '🔔 Cô đang chờ con trả lời · Lớp Mình Live' : BASE_TITLE;
  if (html === lastHtml) return;
  const ae = document.activeElement;
  let keep = null;
  if (ae && root.contains(ae) && ae.dataset?.field) keep = { field: ae.dataset.field, mid: ae.dataset.mid || '', value: ae.value, s: ae.selectionStart, e: ae.selectionEnd };
  const y = window.scrollY;
  root.innerHTML = html; lastHtml = html;
  // Công thức toán trong $…$ (KaTeX tải kèm trang; nếu chưa tải xong thì vẽ lại sau).
  const math = () => window.renderMathInElement?.(root, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }], throwOnError: false, ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'input'] });
  if (window.renderMathInElement) math(); else window.addEventListener('load', math, { once: true });
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
function actOnClick(el, ev) {
  const action = el.dataset.action; const room = getRoom();
  if (el.tagName === 'A') ev?.preventDefault();
  switch (action) {
    case 'newClass': openSetup(false); break;
    case 'customize': openSetup(true); break;
    case 'cancelSetup': if (state.setup?.editing) { state.setup = null; render(); } else { state.setup = null; state.role = 'home'; render(); } break;
    case 'preset': { const p = PRESETS.find((x) => x.id === el.dataset.id); for (const id of ALL_FEATURES) state.setup.features[id] = p.on.includes(id); render(); break; }
    case 'toggleFeat': state.setup.features[el.dataset.id] = !state.setup.features[el.dataset.id]; render(); break;
    case 'toggleKind': state.setup.features.kinds[el.dataset.id] = !state.setup.features.kinds[el.dataset.id]; render(); break;
    case 'saveSetup': saveSetup(); break;
    case 'resume': { const c = state.myClasses.find((r) => r.code === el.dataset.code); resumeTeacher(el.dataset.code, c?.key); break; }
    case 'claim': resumeTeacher(norm(state.claimCode).replace(/\D/g, ''), norm(state.claimKey).toUpperCase()); break;
    case 'join': joinStudent(state.joinCode, state.joinName); break;
    case 'preview': if (state.view?.liveSid) joinStudent(state.code, 'Cô xem thử', true); break;
    case 'teacher': if (conns.teacher?.uid) openTeacher(conns.teacher, state.code); break;
    case 'home': goHome(); break;
    case 'startSession': startSession(); break;
    case 'viewSession': state.viewSid = el.dataset.sid; state.parentPreviewId = null; refresh(); break;
    case 'open': openActivity(el.dataset.kind); break;
    case 'checkin': openActivity('checkin', el.dataset.phase); break;
    case 'bankNew': openBankEditor(null); break;
    case 'bankEdit': openBankEditor(el.dataset.id); break;
    case 'bankCancel': state.bankEdit = null; render(); break;
    case 'bankSave': saveBankQuestion(); break;
    case 'bankDelete': deleteBankQuestion(el.dataset.id); break;
    case 'bankOpen': openBankQuestion(el.dataset.id); break;
    case 'bankKind': { const e = state.bankEdit; if (e.kind !== el.dataset.id) { e.kind = el.dataset.id; e.key = e.kind === 'tf4' ? {} : ''; } render(); break; }
    case 'bankKey': state.bankEdit.key = el.dataset.val; render(); break;
    case 'bankKeyPart': { const e = state.bankEdit; e.key = { ...(typeof e.key === 'object' && e.key ? e.key : {}), [el.dataset.part]: el.dataset.val }; render(); break; }
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
    case 'key': { const a = active(room); if (!a) return; state.keys[keyId(room, a)] = el.dataset.val; saveDraftKey(room, a); render(); break; }
    case 'keypart': { const a = active(room); if (!a) return; const k = keyId(room, a); state.keys[k] = { ...(state.keys[k] || {}), [el.dataset.part]: el.dataset.val }; saveDraftKey(room, a); render(); break; }
    case 'close': closeActivity(false); break;
    case 'skip': closeActivity(true); break;
    case 'end': endClass(); break;
    case 'copy': copyText(state.code, 'Đã sao chép mã lớp'); break;
    case 'copyLink': copyText(linkStudent(), 'Đã sao chép link lớp'); break;
    case 'copyKey': copyText(state.view?.adminKey || '', 'Đã sao chép mã quản lý'); break;
    case 'csv': exportCsv(); break;
    case 'csvCourse': exportCourseCsv(); break;
    case 'deleteClass': deleteClass(); break;
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
      const subject = `Báo cáo buổi ${room.n} lớp ${room.name} - ${formatDate(room.createdAt)} - ${m.name}`;
      window.location.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(parentMessage(room, m));
      markDelivered(m.id); toast('Đã mở ứng dụng email để cô kiểm tra và gửi'); break;
    }
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
document.addEventListener('toggle', (e) => { if (e.target.classList?.contains('roster-add')) state.rosterOpen = e.target.open; }, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (state.role === 'home' && (e.target.id === 'joinName' || e.target.id === 'joinCode')) joinStudent(state.joinCode, state.joinName);
  if (state.role === 'student' && e.target.dataset.field === 'numberDraft') actOnClick({ dataset: { action: 'number' } });
});

// ---------- Khởi động ----------
(async function start() {
  document.getElementById('envPill').textContent = IS_LOCAL ? 'BẢN THỬ TRÊN MÁY' : MODE === 'teacher' ? 'GIÁO VIÊN' : 'LỚP HỌC ONLINE';
  render(); showNet();
  if (MODE === 'teacher') {
    // F5 / mở lại tab: quay về đúng lớp đang điều khiển.
    const code = loadJSON(sessionStorage, 'lopminh:teacherClass', null);
    if (code) { const c = state.myClasses.find((r) => r.code === code); await resumeTeacher(code, c?.key); }
    return;
  }
  const urlCode = (new URLSearchParams(location.search).get('lop') || '').replace(/\D/g, '').slice(0, 6);
  const saved = loadJSON(studentStore, 'lopminh:studentClass', null);
  state.joinCode = urlCode || saved?.code || '';
  state.joinName = saved?.name || '';
  render();
  // Tuần sau mở lại link cũ: vào thẳng lớp với tên đã nhập lần trước.
  if (saved?.code && saved.name && (!urlCode || urlCode === saved.code)) await joinStudent(saved.code, saved.name);
})();
