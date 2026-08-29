import {
  db, REASON_LABEL,
  loadSettings, kyivDateOnly, getCurrentDateTime, computeHeaderState,
  renderHeaderInto, errorBannerHtml,
  formatDateUA, formatDateShort, parseISODate, escapeHtml
} from "./common.js";
import {
  collection, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const headerRoot = document.getElementById("header-root");
const content = document.getElementById("content");

let settings = null;
let headerState = null;
let allRegs = [];

init();

async function init() {
  const [s, timeInfo] = await Promise.all([
    loadSettings().catch(() => null),
    getCurrentDateTime()
  ]);
  settings = s;
  const today = kyivDateOnly(timeInfo.date);
  headerState = computeHeaderState(settings, today);

  renderHeaderInto(headerRoot, { settings, headerState, activePage: "stats", timeSource: timeInfo.source });

  if (!settings) {
    content.innerHTML = errorBannerHtml("Систему ще не налаштовано.");
    return;
  }

  // Єдине сортування по createdAt (без композитного індексу),
  // групування за датою відробітки робимо на клієнті.
  const q = query(collection(db, "registrations"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    allRegs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    console.error(err);
    content.innerHTML = errorBannerHtml("Не вдалося завантажити дані статистики.");
  });
}

function render() {
  const groups = new Map();
  for (const r of allRegs) {
    if (!groups.has(r.targetDate)) groups.set(r.targetDate, []);
    groups.get(r.targetDate).push(r);
  }
  const sortedDates = [...groups.keys()].sort((a, b) => b.localeCompare(a));

  const totalUnexcused = allRegs.filter(r => r.reasonType === "unexcused").length;
  const totalExcused = allRegs.filter(r => r.reasonType === "excused").length;

  let html = `
    <div class="card no-print">
      <div class="card-title">Зведена статистика</div>
      <div class="card-subtitle">Дані оновлюються в реальному часі. Сторінку видно всім.</div>
      <div class="summary-grid">
        <div class="summary-tile">
          <div class="num">${allRegs.length}</div>
          <div class="cap">Реєстрацій за весь час</div>
        </div>
        <div class="summary-tile seal">
          <div class="num">${totalUnexcused}</div>
          <div class="cap">${escapeHtml(REASON_LABEL.unexcused)}</div>
        </div>
        <div class="summary-tile gold">
          <div class="num">${totalExcused}</div>
          <div class="cap">${escapeHtml(REASON_LABEL.excused)}</div>
        </div>
      </div>
      ${headerState.ok ? renderCurrentQuota() : ""}
      <div class="actions-row">
        <button class="btn btn-ghost" id="btn-print">🖨️ Роздрукувати</button>
        <button class="btn btn-ghost" id="btn-csv">⬇️ Завантажити CSV</button>
      </div>
    </div>`;

  if (sortedDates.length === 0) {
    html += `
      <div class="card empty-state">
        <h3>Поки що немає жодної реєстрації</h3>
        <p>Щойно хтось зареєструється на відробітку, запис з'явиться тут.</p>
      </div>`;
  } else {
    for (const dateISO of sortedDates) {
      html += renderGroup(dateISO, groups.get(dateISO));
    }
  }

  content.innerHTML = html;
  document.getElementById("btn-print")?.addEventListener("click", () => window.print());
  document.getElementById("btn-csv")?.addEventListener("click", downloadCsv);
}

function renderCurrentQuota() {
  return `
    <div class="banner banner-info" style="margin-top:14px">
      <strong>Поточна дата відробітки: ${formatDateUA(headerState.targetDate, { withWeekday: true })}</strong>
      Реєстрація ${headerState.windowIsOpen ? "зараз відкрита" : "поки закрита"}.
    </div>`;
}

function renderGroup(dateISO, regs) {
  const dateOnly = parseISODate(dateISO);
  const ordered = [...regs].reverse(); // хронологічно: перший зареєстрований — перший у списку
  const unex = regs.filter(r => r.reasonType === "unexcused").length;
  const exc = regs.filter(r => r.reasonType === "excused").length;

  const entries = ordered.map(r => `
    <div class="entry">
      <div class="entry-name">${escapeHtml(r.fullName)}
        <span class="tag ${r.reasonType === "unexcused" ? "tag-unexcused" : "tag-excused"}">
          ${r.reasonType === "unexcused" ? "неповажна" : "поважна / н.о."}
        </span>
      </div>
      <div class="entry-meta">
        <span>Курс ${escapeHtml(r.course)}</span>
        <span>Група ${escapeHtml(r.group)}</span>
        <span>Пропуск: ${r.absenceDate ? formatDateShort(parseISODate(r.absenceDate)) : "—"}</span>
      </div>
      <div class="entry-topic">${escapeHtml(r.topic)}</div>
    </div>`).join("");

  return `
    <section class="date-group">
      <div class="date-divider">
        <div class="stamp">
          <span class="stamp-label">Відробітка</span>
          <span class="stamp-date">${formatDateShort(dateOnly)}</span>
        </div>
      </div>
      <div class="group-summary">
        <span class="pill">Всього: ${regs.length}</span>
        <span class="pill">Неповажна причина: ${unex}</span>
        <span class="pill">Поважна причина / негативна оцінка: ${exc}</span>
      </div>
      <div class="timeline">${entries}</div>
    </section>`;
}

function downloadCsv() {
  const header = ["Дата відробітки","ПІБ","Курс","Група","Причина","Дата пропуску","Тема"];
  const rows = allRegs.map(r => [
    r.targetDate || "",
    r.fullName || "",
    r.course ?? "",
    r.group || "",
    r.reasonType === "unexcused" ? REASON_LABEL.unexcused : REASON_LABEL.excused,
    r.absenceDate || "",
    r.topic || ""
  ]);
  const csv = [header, ...rows]
    .map(row => row.map(csvCell).join(";"))
    .join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vidrobitka_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
