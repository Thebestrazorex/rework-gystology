import {
  db, REASON, REASON_LABEL,
  loadSettings, kyivDateOnly, getCurrentDateTime, computeHeaderState,
  renderHeaderInto, errorBannerHtml, applyAccentColor,
  formatDateUA, toISODate, parseISODate, emailMatchesMask, emailKey,
  escapeHtml
} from "./common.js";
import {
  doc, collection, getDoc, onSnapshot, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

class QuotaError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const headerRoot = document.getElementById("header-root");
const content = document.getElementById("content");

init();

async function init() {
  const [settings, timeInfo] = await Promise.all([
    loadSettings().catch(() => null),
    getCurrentDateTime()
  ]);
  applyAccentColor(settings?.accentColor);
  const today = kyivDateOnly(timeInfo.date);
  const headerState = computeHeaderState(settings, today);

  renderHeaderInto(headerRoot, { settings, headerState, activePage: "register", timeSource: timeInfo.source });

  if (!headerState.ok) {
    content.innerHTML = errorBannerHtml(headerState.message);
    return;
  }

  if (!headerState.windowIsOpen) {
    renderClosed(settings, headerState, today);
    return;
  }

  renderForm(settings, headerState, timeInfo);
}

function renderClosed(settings, headerState, today) {
  const beforeWindow = today.getTime() < headerState.windowOpenDate.getTime();
  const msg = beforeWindow
    ? `Реєстрація на відробітку <strong>${formatDateUA(headerState.targetDate, { withWeekday: true })}</strong> ще не відкрита.<br>
       Відкриється: <strong>${formatDateUA(headerState.windowOpenDate, { withWeekday: true })} о 00:01</strong>.`
    : `Реєстрація на найближчу відробітку наразі закрита.`;
  content.innerHTML = `
    <div class="card">
      <div class="card-title">Реєстрація ще не відкрита</div>
      <div class="banner banner-info" style="margin-top:0">${msg}</div>
      <p class="hint" style="color:var(--slate)">Реєстрація відкривається за 3 дні до дати відробітки.</p>
    </div>`;
}

async function renderForm(settings, headerState, timeInfo) {
  const targetISO = toISODate(headerState.targetDate);
  const todayISO = toISODate(kyivDateOnly(timeInfo.date));

  content.innerHTML = `
    <div class="card">
      <div class="card-title">Реєстрація на відробітку</div>
      <div class="card-subtitle">
        Дата відробітки: <strong>${formatDateUA(headerState.targetDate, { withWeekday: true })}</strong>.
        Усі поля обов'язкові.
      </div>

      <div id="quota-line" class="status-line"></div>
      <div id="form-banner"></div>

      <form id="reg-form" novalidate style="margin-top:18px">
        <div class="field">
          <label for="f-email">Електронна пошта</label>
          <input type="email" id="f-email" required placeholder="ivan.petrenko${escapeHtml(settings.emailMask || "")}">
          <div class="hint">Приймається лише пошта з доменом ${escapeHtml(settings.emailMask || "–")}</div>
        </div>

        <div class="field">
          <label for="f-name">Прізвище Ім'я По батькові</label>
          <input type="text" id="f-name" required placeholder="Петренко Іван Олександрович">
        </div>

        <div class="field-row">
          <div class="field">
            <label for="f-course">Курс</label>
            <select id="f-course" required>
              <option value="">Оберіть курс</option>
              ${[1,2,3,4,5,6].map(n => `<option value="${n}">${n}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="f-group">Номер групи</label>
            <input type="text" id="f-group" required placeholder="напр. 302-А">
          </div>
        </div>

        <div class="field">
          <label>Причина пропуску</label>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="reason" value="${REASON.UNEXCUSED}" required>
              <span>
                <span class="opt-title">${REASON_LABEL.unexcused}</span>
              </span>
            </label>
            <label class="radio-option">
              <input type="radio" name="reason" value="${REASON.EXCUSED}" required>
              <span>
                <span class="opt-title">${REASON_LABEL.excused}</span>
              </span>
            </label>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="f-absence-date">Дата пропуску</label>
            <input type="date" id="f-absence-date" required>
          </div>
          <div class="field">
            <label for="f-topic">Назва пропущеної теми</label>
            <input type="text" id="f-topic" required placeholder="напр. Тема 4. ...">
          </div>
        </div>

        <button type="submit" class="btn btn-primary btn-block" id="submit-btn">Зареєструватися на відробітку</button>
      </form>
    </div>`;

  // дата пропуску не може бути в майбутньому
  document.getElementById("f-absence-date").max = todayISO;

  refreshQuotaLine(targetISO, settings);
  onSnapshot(doc(db, "counters", targetISO), () => refreshQuotaLine(targetISO, settings));

  document.getElementById("reg-form").addEventListener("submit", (e) => {
    e.preventDefault();
    handleSubmit(settings, headerState, targetISO);
  });
}

async function refreshQuotaLine(targetISO, settings) {
  const el = document.getElementById("quota-line");
  if (!el) return;
  try {
    const snap = await getDoc(doc(db, "counters", targetISO));
    const c = snap.exists() ? snap.data() : { unexcused: 0, excused: 0 };
    el.textContent =
      `Зайнято місць – неповажна причина: ${c.unexcused || 0}/${settings.maxUnexcused}, ` +
      `поважна причина/негативна оцінка: ${c.excused || 0}/${settings.maxExcused}`;
  } catch (e) {
    el.textContent = "";
  }
}

async function handleSubmit(settings, headerState, targetISO) {
  const banner = document.getElementById("form-banner");
  const btn = document.getElementById("submit-btn");
  banner.innerHTML = "";

  const email = document.getElementById("f-email").value.trim();
  const fullName = document.getElementById("f-name").value.trim();
  const course = Number(document.getElementById("f-course").value);
  const group = document.getElementById("f-group").value.trim();
  const reasonInput = document.querySelector('input[name="reason"]:checked');
  const absenceDate = document.getElementById("f-absence-date").value;
  const topic = document.getElementById("f-topic").value.trim();

  if (!email || !fullName || !course || !group || !reasonInput || !absenceDate || !topic) {
    banner.innerHTML = `<div class="banner banner-error"><strong>Не всі поля заповнено</strong>Будь ласка, заповніть усі поля форми.</div>`;
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    banner.innerHTML = `<div class="banner banner-error"><strong>Некоректна пошта</strong>Перевірте формат електронної пошти.</div>`;
    return;
  }
  if (!emailMatchesMask(email, settings.emailMask)) {
    banner.innerHTML = `<div class="banner banner-error"><strong>Невідповідна пошта</strong>Реєструватися можна лише з поштою ${escapeHtml(settings.emailMask)}.</div>`;
    return;
  }

  const reasonType = reasonInput.value;

  btn.disabled = true;
  btn.textContent = "Реєструємо…";

  try {
    await submitRegistration({ email, fullName, course, group, reasonType, absenceDate, topic }, targetISO, settings);
    banner.innerHTML = `
      <div class="banner banner-success">
        <strong>Реєстрацію прийнято</strong>
        Ви зареєстровані на відробітку ${formatDateUA(headerState.targetDate, { withWeekday: true })}.
        Побачити повний список можна на сторінці «Статистика».
      </div>`;
    document.getElementById("reg-form").reset();
    refreshQuotaLine(targetISO, settings);
  } catch (err) {
    banner.innerHTML = buildErrorBanner(err, settings, headerState);
  } finally {
    btn.disabled = false;
    btn.textContent = "Зареєструватися на відробітку";
  }
}

function buildErrorBanner(err, settings, headerState) {
  const nextInfo = headerState.nextTargetDate
    ? ` Наступна реєстрація буде на <strong>${formatDateUA(headerState.nextTargetDate, { withWeekday: true })}</strong>` +
      (headerState.nextWindowOpenDate ? `, відкриється <strong>${formatDateUA(headerState.nextWindowOpenDate)} о 00:01</strong>.` : ".")
    : "";

  if (err.code === "QUOTA_UNEXCUSED" || err.code === "QUOTA_EXCUSED") {
    return `<div class="banner banner-warn"><strong>Місць більше немає</strong>
      Вибачте, на цю відробітку вже зареєстровано максимальну кількість учасників за цією причиною.${nextInfo}</div>`;
  }
  if (err.code === "EMAIL_LIMIT") {
    return `<div class="banner banner-warn"><strong>Ліміт тем вичерпано</strong>
      Ви вже зареєстрували максимальну кількість тем (${settings.maxTopicsPerEmail}) на цю дату відробітки.</div>`;
  }
  console.error("Registration error:", err.code || "(без коду)", err.message || err);
  return `<div class="banner banner-error"><strong>Сталася помилка</strong>Спробуйте, будь ласка, ще раз.
    ${err.code ? `<div class="hint">Код помилки (для діагностики): ${escapeHtml(err.code)}</div>` : ""}</div>`;
}

async function submitRegistration(values, targetISO, settings) {
  const regRef = doc(collection(db, "registrations"));
  const counterRef = doc(db, "counters", targetISO);
  const emailCounterRef = doc(db, "emailCounters", `${targetISO}_${emailKey(values.email)}`);

  await runTransaction(db, async (tx) => {
    const [counterSnap, emailSnap] = await Promise.all([tx.get(counterRef), tx.get(emailCounterRef)]);
    const counter = counterSnap.exists() ? counterSnap.data() : { unexcused: 0, excused: 0 };
    const emailCount = emailSnap.exists() ? (emailSnap.data().count || 0) : 0;

    if (emailCount >= settings.maxTopicsPerEmail) throw new QuotaError("EMAIL_LIMIT");
    if (values.reasonType === REASON.UNEXCUSED && (counter.unexcused || 0) >= settings.maxUnexcused) {
      throw new QuotaError("QUOTA_UNEXCUSED");
    }
    if (values.reasonType === REASON.EXCUSED && (counter.excused || 0) >= settings.maxExcused) {
      throw new QuotaError("QUOTA_EXCUSED");
    }

    tx.set(regRef, {
      email: values.email,
      fullName: values.fullName,
      course: values.course,
      group: values.group,
      reasonType: values.reasonType,
      absenceDate: values.absenceDate,
      topic: values.topic,
      targetDate: targetISO,
      targetDateTS: parseISODate(targetISO),
      createdAt: serverTimestamp()
    });

    tx.set(counterRef, {
      unexcused: (counter.unexcused || 0) + (values.reasonType === REASON.UNEXCUSED ? 1 : 0),
      excused: (counter.excused || 0) + (values.reasonType === REASON.EXCUSED ? 1 : 0)
    });

    tx.set(emailCounterRef, { count: emailCount + 1 });
  });
}
