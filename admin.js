import {
  db, auth, ADMIN_EMAIL,
  loadSettings, defaultSettings, kyivDateOnly, getCurrentDateTime, computeHeaderState,
  renderHeaderInto, formatDateUA, toISODate, parseISODate, getMondayOfWeek,
  resizeImageFile, escapeHtml, WEEKDAY_FULL, applyAccentColor, ACCENT_PRESETS
} from "./common.js";
import {
  doc, setDoc, getDocs, collection, writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const headerRoot = document.getElementById("header-root");
const content = document.getElementById("content");

let settings = null;
let headerState = null;
let pendingLogoBase64 = null;
let pendingAccentColor = null;

boot();

async function boot() {
  const [s, timeInfo] = await Promise.all([
    loadSettings().catch(() => null),
    getCurrentDateTime()
  ]);
  settings = s;
  applyAccentColor(settings?.accentColor);
  const today = kyivDateOnly(timeInfo.date);
  headerState = computeHeaderState(settings, today);
  renderHeaderInto(headerRoot, { settings, headerState, activePage: "admin", timeSource: timeInfo.source });

  onAuthStateChanged(auth, (user) => {
    if (user && user.email === ADMIN_EMAIL) {
      renderPanel();
    } else {
      renderGate();
    }
  });
}

// =========================================================
// Вхід
// =========================================================

function renderGate() {
  content.innerHTML = `
    <div class="gate">
      <span class="key-icon">🔑</span>
      <h2>Адмінпанель</h2>
      <div class="card">
        <div id="gate-banner"></div>
        <form id="gate-form">
          <div class="field">
            <label for="gate-pass">Пароль</label>
            <input type="password" id="gate-pass" required autofocus>
          </div>
          <button type="submit" class="btn btn-primary btn-block">Увійти</button>
        </form>
      </div>
    </div>`;

  document.getElementById("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const banner = document.getElementById("gate-banner");
    const pass = document.getElementById("gate-pass").value;
    banner.innerHTML = "";
    try {
      await signInWithEmailAndPassword(auth, ADMIN_EMAIL, pass);
    } catch (err) {
      banner.innerHTML = describeAuthError(err);
    }
  });
}

function describeAuthError(err) {
  const code = err?.code || "";
  if (code === "auth/too-many-requests") {
    return `<div class="banner banner-error"><strong>Забагато спроб</strong>Зачекайте трохи і спробуйте знову.</div>`;
  }
  if (code === "auth/user-not-found") {
    return `<div class="banner banner-error"><strong>Обліковий запис адміністратора не створено</strong>
      Виконайте крок 3 з інструкції README.md – створіть користувача ${escapeHtml(ADMIN_EMAIL)} у Firebase Authentication.</div>`;
  }
  return `<div class="banner banner-error"><strong>Невірний пароль</strong>Спробуйте ще раз.</div>`;
}

// =========================================================
// Панель адміністратора
// =========================================================

function renderPanel() {
  const s = settings || defaultSettings();

  content.innerHTML = `
    <div class="card">
      <div class="card-title">Поточний стан</div>
      <div class="card-subtitle">Так систему бачать студенти прямо зараз.</div>
      ${headerState.ok ? `
        <div class="status-line">
          Дата відробітки: <strong>${formatDateUA(headerState.targetDate, { withWeekday: true })}</strong> ·
          реєстрація ${headerState.windowIsOpen ? "відкрита" : "закрита"},
          відкриється/відкрилась: ${formatDateUA(headerState.windowOpenDate)}
        </div>` : `<div class="banner banner-error" style="margin-top:0"><strong>Помилка конфігурації</strong>${escapeHtml(headerState.message)}</div>`}
      <div class="actions-row">
        <button class="btn btn-ghost btn-sm" id="btn-logout">Вийти з адмінпанелі</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Налаштування</div>
      <div id="settings-banner"></div>
      <form id="settings-form">

        <div class="settings-section">
          <h3>Кафедра та предмет</h3>
          <p class="desc">Показуються в шапці програми. Можна лишити порожнім.</p>
          <div class="field-row">
            <div class="field">
              <label for="s-department">Назва кафедри</label>
              <input type="text" id="s-department" value="${escapeHtml(s.department || "")}" placeholder="напр. Кафедра пропедевтики">
            </div>
            <div class="field">
              <label for="s-subject">Назва предмету</label>
              <input type="text" id="s-subject" value="${escapeHtml(s.subject || "")}" placeholder="напр. Внутрішня медицина">
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Лого кафедри</h3>
          <p class="desc">Необов'язково. Зображення буде автоматично стиснуто.</p>
          ${s.logoBase64 ? `<img class="logo-preview" id="logo-preview" src="${s.logoBase64}">` : `<img class="logo-preview" id="logo-preview" style="display:none">`}
          <div class="actions-row">
            <input type="file" id="s-logo-file" accept="image/*">
            <button type="button" class="btn btn-ghost btn-sm" id="btn-remove-logo">Прибрати лого</button>
          </div>
        </div>

        <div class="settings-section">
          <h3>Акцентний колір</h3>
          <p class="desc">Колір штампу з датою, кнопок і виділень по всій програмі. Оберіть готовий варіант або вкажіть свій.</p>
          <div class="color-swatches" id="color-swatches">
            ${ACCENT_PRESETS.map(p => `
              <button type="button" class="color-swatch ${sameHex(s.accentColor, p.hex) ? "selected" : ""}"
                data-hex="${p.hex}" style="background:${p.hex}" title="${escapeHtml(p.name)}"></button>
            `).join("")}
          </div>
          <div class="color-picker-row">
            <input type="color" id="s-accent" value="${sanitizeHex(s.accentColor)}">
            <span class="hex-label" id="accent-hex-label">${sanitizeHex(s.accentColor)}</span>
          </div>
        </div>

        <div class="settings-section">
          <h3>Розклад відробіток</h3>
          <p class="desc">Визначає дату відробітки, яку бачать студенти під час реєстрації.</p>
          <div class="field-row">
            <div class="field">
              <label for="s-frequency">Періодичність</label>
              <select id="s-frequency">
                <option value="1" ${Number(s.frequencyWeeks) === 1 ? "selected" : ""}>1 раз в 1 тиждень</option>
                <option value="2" ${Number(s.frequencyWeeks) === 2 ? "selected" : ""}>1 раз в 2 тижні</option>
              </select>
            </div>
            <div class="field">
              <label for="s-day">День відробітки</label>
              <select id="s-day">
                ${WEEKDAY_FULL.map((w, i) => `<option value="${i+1}" ${Number(s.makeupDayOfWeek) === i+1 ? "selected" : ""}>${cap(w)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="field">
            <label for="s-start">Дата старту відліку тижнів</label>
            <input type="date" id="s-start" value="${escapeHtml(s.startDate || "")}">
            <div class="hint">Тиждень починається з понеділка – дату буде автоматично скориговано на понеділок цього тижня.</div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Доступ студентів</h3>
          <div class="field">
            <label for="s-mask">Маска пошти для реєстрації</label>
            <input type="text" id="s-mask" value="${escapeHtml(s.emailMask || "")}" placeholder="@ifnmu.edu.ua">
          </div>
        </div>

        <div class="settings-section">
          <h3>Ліміти реєстрації</h3>
          <div class="field-row">
            <div class="field">
              <label for="s-max-topics">Максимум тем на 1 пошту за 1 дату</label>
              <input type="number" id="s-max-topics" min="1" value="${Number(s.maxTopicsPerEmail) || 2}">
            </div>
            <div class="field"></div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="s-max-unexcused">Максимум реєстрацій – неповажна причина</label>
              <input type="number" id="s-max-unexcused" min="1" value="${Number(s.maxUnexcused) || 10}">
            </div>
            <div class="field">
              <label for="s-max-excused">Максимум реєстрацій – поважна причина / негативна оцінка</label>
              <input type="number" id="s-max-excused" min="1" value="${Number(s.maxExcused) || 10}">
            </div>
          </div>
        </div>

        <button type="submit" class="btn btn-primary" id="btn-save-settings">Зберегти налаштування</button>
      </form>
    </div>

    <div class="card">
      <div class="card-title">Змінити пароль адміністратора</div>
      <div id="pass-banner"></div>
      <form id="pass-form">
        <div class="field">
          <label for="p-current">Поточний пароль</label>
          <input type="password" id="p-current" required>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="p-new">Новий пароль</label>
            <input type="password" id="p-new" required minlength="6">
          </div>
          <div class="field">
            <label for="p-confirm">Повторіть новий пароль</label>
            <input type="password" id="p-confirm" required minlength="6">
          </div>
        </div>
        <button type="submit" class="btn btn-ghost">Змінити пароль</button>
      </form>
    </div>

    <div class="card">
      <div class="card-title">Небезпечна зона</div>
      <div class="danger-zone">
        <h3>Очистити статистику</h3>
        <p class="desc">Видаляє УСІ реєстрації та лічильники безповоротно. Дію не можна скасувати.</p>
        <div id="clear-banner"></div>
        <div class="field" style="margin-top:10px">
          <label for="clear-confirm">Щоб підтвердити, введіть слово <strong>ОЧИСТИТИ</strong></label>
          <input type="text" id="clear-confirm" autocomplete="off">
        </div>
        <button type="button" class="btn btn-danger" id="btn-clear" disabled>Очистити всю статистику</button>
      </div>
    </div>`;

  wirePanelEvents();
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function sanitizeHex(hex) {
  return /^#[0-9a-fA-F]{6}$/.test(hex || "") ? hex : "#A6383C";
}
function sameHex(a, b) {
  return sanitizeHex(a).toLowerCase() === sanitizeHex(b).toLowerCase();
}

function wirePanelEvents() {
  document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

  // лого
  const preview = document.getElementById("logo-preview");
  document.getElementById("s-logo-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingLogoBase64 = await resizeImageFile(file);
      preview.src = pendingLogoBase64;
      preview.style.display = "block";
    } catch (err) {
      alertBanner("settings-banner", "error", "Не вдалося обробити зображення", err.message);
    }
  });
  document.getElementById("btn-remove-logo").addEventListener("click", () => {
    pendingLogoBase64 = "";
    preview.src = "";
    preview.style.display = "none";
  });

  // акцентний колір
  const colorInput = document.getElementById("s-accent");
  const hexLabel = document.getElementById("accent-hex-label");
  const swatchesBox = document.getElementById("color-swatches");

  function setAccent(hex) {
    pendingAccentColor = hex;
    colorInput.value = hex;
    hexLabel.textContent = hex.toUpperCase();
    applyAccentColor(hex);
    swatchesBox.querySelectorAll(".color-swatch").forEach(btn => {
      btn.classList.toggle("selected", sameHex(btn.dataset.hex, hex));
    });
  }

  swatchesBox.querySelectorAll(".color-swatch").forEach(btn => {
    btn.addEventListener("click", () => setAccent(btn.dataset.hex));
  });
  colorInput.addEventListener("input", () => setAccent(colorInput.value));

  // налаштування
  document.getElementById("settings-form").addEventListener("submit", onSaveSettings);

  // пароль
  document.getElementById("pass-form").addEventListener("submit", onChangePassword);

  // очищення
  const clearInput = document.getElementById("clear-confirm");
  const clearBtn = document.getElementById("btn-clear");
  clearInput.addEventListener("input", () => {
    clearBtn.disabled = clearInput.value.trim() !== "ОЧИСТИТИ";
  });
  clearBtn.addEventListener("click", onClearStats);
}

async function onSaveSettings(e) {
  e.preventDefault();
  const btn = document.getElementById("btn-save-settings");
  btn.disabled = true;
  try {
    const rawStart = document.getElementById("s-start").value;
    if (!rawStart) throw new Error("Вкажіть дату старту відліку тижнів.");
    const monday = getMondayOfWeek(parseISODate(rawStart));
    const startISO = toISODate(monday);

    const mask = document.getElementById("s-mask").value.trim();
    if (mask && !mask.startsWith("@")) throw new Error("Маска пошти має починатися з символу @.");

    const newSettings = {
      department: document.getElementById("s-department").value.trim(),
      subject: document.getElementById("s-subject").value.trim(),
      frequencyWeeks: Number(document.getElementById("s-frequency").value),
      startDate: startISO,
      makeupDayOfWeek: Number(document.getElementById("s-day").value),
      emailMask: mask,
      maxTopicsPerEmail: Number(document.getElementById("s-max-topics").value) || 1,
      maxUnexcused: Number(document.getElementById("s-max-unexcused").value) || 1,
      maxExcused: Number(document.getElementById("s-max-excused").value) || 1,
      logoBase64: pendingLogoBase64 !== null ? pendingLogoBase64 : (s0().logoBase64 || ""),
      accentColor: sanitizeHex(pendingAccentColor || s0().accentColor)
    };

    await setDoc(doc(db, "settings", "main"), newSettings);
    settings = newSettings;
    pendingLogoBase64 = null;
    pendingAccentColor = null;

    const startNote = rawStart !== startISO
      ? ` Дату старту скориговано на понеділок: ${escapeHtml(startISO)}.`
      : "";
    alertBanner("settings-banner", "success", "Налаштування збережено", "Зміни вже діють для студентів." + startNote);

    // перерахувати шапку/поточний стан
    const timeInfo = await getCurrentDateTime();
    headerState = computeHeaderState(settings, kyivDateOnly(timeInfo.date));
    renderHeaderInto(headerRoot, { settings, headerState, activePage: "admin", timeSource: timeInfo.source });
    renderPanel();
  } catch (err) {
    alertBanner("settings-banner", "error", "Не вдалося зберегти", err.message);
  } finally {
    btn.disabled = false;
  }
}

function s0() { return settings || defaultSettings(); }

async function onChangePassword(e) {
  e.preventDefault();
  const current = document.getElementById("p-current").value;
  const next = document.getElementById("p-new").value;
  const confirm = document.getElementById("p-confirm").value;

  if (next !== confirm) {
    alertBanner("pass-banner", "error", "Паролі не збігаються", "Новий пароль і підтвердження мають бути однаковими.");
    return;
  }
  if (next.length < 6) {
    alertBanner("pass-banner", "error", "Занадто короткий пароль", "Мінімум 6 символів.");
    return;
  }
  try {
    const cred = EmailAuthProvider.credential(ADMIN_EMAIL, current);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, next);
    alertBanner("pass-banner", "success", "Пароль змінено", "Використовуйте новий пароль для входу в адмінпанель.");
    document.getElementById("pass-form").reset();
  } catch (err) {
    alertBanner("pass-banner", "error", "Не вдалося змінити пароль", "Перевірте, чи правильно введено поточний пароль.");
  }
}

async function onClearStats() {
  const btn = document.getElementById("btn-clear");
  btn.disabled = true;
  btn.textContent = "Очищення…";
  try {
    for (const colName of ["registrations", "counters", "emailCounters"]) {
      const snap = await getDocs(collection(db, colName));
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 450) {
        const chunk = docs.slice(i, i + 450);
        const batch = writeBatch(db);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
    alertBanner("clear-banner", "success", "Статистику очищено", "Усі реєстрації та лічильники видалено.");
    document.getElementById("clear-confirm").value = "";
  } catch (err) {
    alertBanner("clear-banner", "error", "Не вдалося очистити статистику", err.message);
  } finally {
    btn.textContent = "Очистити всю статистику";
    btn.disabled = true;
  }
}

function alertBanner(containerId, type, title, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="banner banner-${type}"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
}
