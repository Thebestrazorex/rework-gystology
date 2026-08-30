// =========================================================
// Електронна реєстрація на відробітку – спільна логіка
// Розробник системи: Гаврищук Любомир
// =========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getFirestore, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { firebaseConfig, ADMIN_EMAIL } from "./firebase-config.js";

export { ADMIN_EMAIL };

// ---------- Firebase init ----------
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ---------- Константи ----------
export const REASON = {
  UNEXCUSED: "unexcused",
  EXCUSED: "excused"
};

export const REASON_LABEL = {
  unexcused: "Неповажна причина",
  excused: "Поважна причина / негативна оцінка"
};

export const WEEKDAY_FULL = [
  "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота", "неділя"
];
export const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
export const MONTHS_GEN = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"
];

const DEFAULT_SETTINGS = {
  department: "",
  subject: "",
  frequencyWeeks: 1,
  startDate: "",
  makeupDayOfWeek: 3, // середа
  emailMask: "@ifnmu.edu.ua",
  maxTopicsPerEmail: 2,
  maxUnexcused: 10,
  maxExcused: 10,
  logoBase64: "",
  accentColor: "#A6383C"
};

export const ACCENT_PRESETS = [
  { name: "Цегляний (за замовчуванням)", hex: "#A6383C" },
  { name: "Академічний синій", hex: "#2C4870" },
  { name: "Смарагдовий", hex: "#2F6E4E" },
  { name: "Баклажановий", hex: "#6B3F69" },
  { name: "Теракотовий", hex: "#B4622E" },
  { name: "Графітовий", hex: "#3A3F47" },
  { name: "Бірюзовий", hex: "#1F6E70" }
];

// =========================================================
// Дата й час
// =========================================================

// Повертає {y,m,d} для заданого моменту в таймзоні Europe/Kyiv,
// незалежно від таймзони, виставленої на пристрої користувача.
function kyivParts(date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric", month: "2-digit", day: "2-digit"
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return { y: +parts.year, m: +parts.month, d: +parts.day };
}

// «Дата-тільки» об'єкт Date, опівночі за локальним годинником –
// зручно для арифметики тижнів/днів, незалежно від таймзони.
export function dateOnlyFromParts({ y, m, d }) {
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function kyivDateOnly(date) {
  return dateOnlyFromParts(kyivParts(date));
}

export function parseISODate(str) {
  // "YYYY-MM-DD" -> Date (опівночі, локально)
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function toISODate(dateOnly) {
  const y = dateOnly.getFullYear();
  const m = String(dateOnly.getMonth() + 1).padStart(2, "0");
  const d = String(dateOnly.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDateUA(dateOnly, { withWeekday = false } = {}) {
  const d = dateOnly.getDate();
  const m = MONTHS_GEN[dateOnly.getMonth()];
  const y = dateOnly.getFullYear();
  let s = `${d} ${m} ${y}`;
  if (withWeekday) {
    s += ` (${WEEKDAY_FULL[isoWeekday(dateOnly) - 1]})`;
  }
  return s;
}

export function formatDateShort(dateOnly) {
  const d = String(dateOnly.getDate()).padStart(2, "0");
  const m = String(dateOnly.getMonth() + 1).padStart(2, "0");
  const y = dateOnly.getFullYear();
  return `${d}.${m}.${y}`;
}

// Поточні дата й час: спершу пробуємо мережевий час (Kyiv),
// якщо недоступно – беремо локальний час пристрою.
export async function getCurrentDateTime() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch("https://worldtimeapi.org/api/timezone/Europe/Kyiv", {
      signal: controller.signal, cache: "no-store"
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error("network time unavailable");
    const data = await res.json();
    return { date: new Date(data.datetime), source: "network" };
  } catch (e) {
    return { date: new Date(), source: "local" };
  }
}

// ISO-номер дня тижня: понеділок=1 ... неділя=7
export function isoWeekday(dateOnly) {
  const js = dateOnly.getDay(); // нд=0 ... сб=6
  return js === 0 ? 7 : js;
}

export function getMondayOfWeek(dateOnly) {
  const wd = isoWeekday(dateOnly); // 1..7
  const d = new Date(dateOnly);
  d.setDate(d.getDate() - (wd - 1));
  return d;
}

function addDays(dateOnly, n) {
  const d = new Date(dateOnly);
  d.setDate(d.getDate() + n);
  return d;
}

function weeksBetweenMondays(mondayA, mondayB) {
  return Math.round((mondayB - mondayA) / (7 * 86400000));
}

// Основний алгоритм: обчислює дату найближчої відробітки.
// today, startDate – об'єкти «дата-тільки» (опівночі).
// Кидає помилку (Error), якщо конфігурація некоректна.
export function computeTargetDate(today, startDate, frequencyWeeks, makeupDayOfWeek) {
  if (!startDate) {
    throw new Error("Не вказано дату старту відліку тижнів у налаштуваннях.");
  }
  if (![1, 2].includes(Number(frequencyWeeks))) {
    throw new Error("Некоректна періодичність відробітки у налаштуваннях.");
  }
  if (!(makeupDayOfWeek >= 1 && makeupDayOfWeek <= 7)) {
    throw new Error("Некоректний день відробітки у налаштуваннях.");
  }

  const startMonday = getMondayOfWeek(startDate);
  const thisMonday = getMondayOfWeek(today);
  const weekIndex0 = weeksBetweenMondays(startMonday, thisMonday);

  if (weekIndex0 < 0) {
    throw new Error(
      `Дата старту відліку тижнів (${formatDateShort(startDate)}) ще не настала. ` +
      `Виправте дату старту в адмінпанелі.`
    );
  }

  const dayOffset = makeupDayOfWeek - 1;
  const freq = Number(frequencyWeeks);

  for (let w = weekIndex0; w < weekIndex0 + 80; w++) {
    if (freq === 2 && w % 2 !== 0) continue;
    const weekMonday = addDays(startMonday, w * 7);
    const candidate = addDays(weekMonday, dayOffset);
    if (candidate.getTime() >= today.getTime()) {
      return candidate;
    }
  }
  throw new Error("Не вдалося обчислити дату відробітки. Перевірте налаштування.");
}

// Наступна дата відробітки ПІСЛЯ заданої (для повідомлень
// «місць більше немає, наступна дата – ...».
export function computeNextTargetDate(afterDate, startDate, frequencyWeeks, makeupDayOfWeek) {
  const nextSearchFrom = addDays(afterDate, 1);
  return computeTargetDate(nextSearchFrom, startDate, frequencyWeeks, makeupDayOfWeek);
}

export function getWindowOpenDate(targetDate) {
  return addDays(targetDate, -3);
}

// Обгортка: обчислює стан «дата відробітки / вікно реєстрації»
// і ловить помилки конфігурації в одному місці.
export function computeHeaderState(settings, todayDateOnly) {
  if (!settings) {
    return { ok: false, message: "Систему ще не налаштовано. Зверніться до адміністратора (значок 🔑)." };
  }
  try {
    const startDate = settings.startDate ? parseISODate(settings.startDate) : null;
    const targetDate = computeTargetDate(
      todayDateOnly, startDate, settings.frequencyWeeks, settings.makeupDayOfWeek
    );
    const windowOpenDate = getWindowOpenDate(targetDate);
    const windowIsOpen = todayDateOnly.getTime() >= windowOpenDate.getTime()
      && todayDateOnly.getTime() <= targetDate.getTime();
    let nextTargetDate = null, nextWindowOpenDate = null;
    try {
      nextTargetDate = computeNextTargetDate(targetDate, startDate, settings.frequencyWeeks, settings.makeupDayOfWeek);
      nextWindowOpenDate = getWindowOpenDate(nextTargetDate);
    } catch (e) { /* не критично для відображення */ }
    return { ok: true, targetDate, windowOpenDate, windowIsOpen, nextTargetDate, nextWindowOpenDate };
  } catch (e) {
    return { ok: false, message: e.message || "Помилка обчислення дати відробітки." };
  }
}

// =========================================================
// Налаштування
// =========================================================

export async function loadSettings() {
  const snap = await getDoc(doc(db, "settings", "main"));
  if (!snap.exists()) return null;
  return { ...DEFAULT_SETTINGS, ...snap.data() };
}

export function defaultSettings() {
  const today = kyivDateOnly(new Date());
  return { ...DEFAULT_SETTINGS, startDate: toISODate(getMondayOfWeek(today)) };
}

export function emailMatchesMask(email, mask) {
  if (!mask) return true;
  return email.trim().toLowerCase().endsWith(mask.trim().toLowerCase());
}

export function emailKey(email) {
  return email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
}

// =========================================================
// Акцентний колір теми
// =========================================================

function hexToRgb(hex) {
  const m = hex.replace("#", "").match(/.{1,2}/g);
  return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
}

function rgbToHex({ r, g, b }) {
  const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function darkenHex(hex, amount = 0.24) {
  try {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex({ r: r * (1 - amount), g: g * (1 - amount), b: b * (1 - amount) });
  } catch (e) {
    return hex;
  }
}

// Застосовує акцентний колір із налаштувань до всієї сторінки
// (через CSS-змінні --accent/--accent-dark). Викликати одразу
// після завантаження налаштувань, до відображення вмісту.
export function applyAccentColor(hex) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(hex || "") ? hex : "#A6383C";
  document.documentElement.style.setProperty("--accent", safe);
  document.documentElement.style.setProperty("--accent-dark", darkenHex(safe, 0.24));
}

// =========================================================
// Утиліти
// =========================================================

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Стискає й зменшує зображення логотипу до розумного розміру,
// повертає base64 data URL (щоб зберігати прямо в Firestore
// без потреби у Firebase Storage – той тепер вимагає платний план).
export function resizeImageFile(file, maxDim = 320, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Файл не є коректним зображенням."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// =========================================================
// Шапка сторінки (спільна для всіх трьох сторінок)
// =========================================================

export function renderHeaderInto(rootEl, { settings, headerState, activePage, timeSource }) {
  const dept = settings?.department ? escapeHtml(settings.department) : "";
  const subj = settings?.subject ? escapeHtml(settings.subject) : "";
  const metaParts = [dept, subj].filter(Boolean);

  let stampHtml;
  if (headerState.ok) {
    stampHtml = `
      <div class="stamp" title="Дата, на яку триває запис">
        <span class="stamp-label">Відробітка</span>
        <span class="stamp-date">${formatDateShort(headerState.targetDate)}</span>
        <span class="stamp-weekday">${WEEKDAY_FULL[isoWeekday(headerState.targetDate) - 1]}</span>
      </div>`;
  } else {
    stampHtml = `
      <div class="stamp is-muted" title="${escapeHtml(headerState.message)}">
        <span class="stamp-label">Дата не визначена</span>
        <span class="stamp-date">–.–.–</span>
      </div>`;
  }

  const timeNote = timeSource
    ? `<div style="text-align:right;font-size:.68rem;color:var(--slate-light);margin-top:4px">${escapeHtml(timeSourceNote(timeSource))}</div>`
    : "";

  rootEl.innerHTML = `
    <header class="site-header">
      <div class="site-header-inner">
        <div class="brand">
          ${settings?.logoBase64 ? `<img class="brand-logo" src="${settings.logoBase64}" alt="Лого кафедри">` : ""}
          <div class="brand-text">
            <span class="eyebrow">Електронна реєстрація на відробітку</span>
            <div class="brand-title">${metaParts.length ? metaParts.join(" · ") : "Кафедру та предмет ще не вказано"}</div>
          </div>
        </div>
        <div>${stampHtml}${timeNote}</div>
      </div>
      <nav class="site-nav">
        <a class="nav-tab ${activePage === "register" ? "active" : ""}" href="index.html">Реєстрація</a>
        <a class="nav-tab ${activePage === "stats" ? "active" : ""}" href="stats.html">Статистика</a>
        <span class="nav-spacer"></span>
        ${activePage !== "admin" ? `<a class="key-link" href="admin.html" title="Адмінпанель">🔑</a>` : ""}
      </nav>
    </header>`;
}

export function errorBannerHtml(message) {
  return `<div class="banner banner-error"><strong>Потрібна увага адміністратора</strong>${escapeHtml(message)}</div>`;
}

export function timeSourceNote(source) {
  return source === "network"
    ? "час звірено через інтернет"
    : "час пристрою (мережевий час недоступний)";
}
