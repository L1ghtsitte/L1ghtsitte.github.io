/* ============================================================
   CRYPTO PULSE — логика донат-терминала (Vanilla JS)
   Порядок: конфиг → утилиты → загрузка JSON → рендер карточек
            → dropdown → поиск → выбор сети → копирование
            → отправка формы → toast → тема → init
   ============================================================ */

"use strict";

/* ---------- 1. КОНФИГУРАЦИЯ ---------- */

/* URL бэкенда для уведомлений об оплате.
   GitHub Pages не поддерживает переменные окружения, поэтому
   это просто константа — поменяй домен на свой перед деплоем. */
const NOTIFY_API_URL = "https://donati77.mooo.com/api/crypto-notify"; // домен контейнера (nginx -> FastAPI /api/crypto-notify)

/* Путь к данным с адресами — единственный источник истины:
   чистый JSON-файл crypto/addresses.json (файл addresses.all.json удалён).
   Относительный путь работает и на GitHub Pages (/repo/), и локально. */
const DATA_URL = "crypto/addresses.json";

/* Таймаут запроса к бэкенду, мс */
const REQUEST_TIMEOUT_MS = 15000;

/* Локализация: locales/<lang>.json, fallback — en.
   Сохранённый язык пользователя — localStorage("cp-lang"),
   при первом визите — автоопределение по navigator.language. */
const LOCALES = { en: "English", ru: "Русский", zh: "中文", ja: "日本語", es: "Español", de: "Deutsch" };
const FALLBACK_LANG = "en";
const LOCALE_CACHE = new Map(); // lang -> словарь (загружается один раз)
/* Резервный шаблон подвала (если словарь не загрузился вовсе) */
const FOOTER_FALLBACK = "CRYPTO PULSE © {year} — сделано во имя децентрализации.";

/* ---------- 2. СОСТОЯНИЕ ПРИЛОЖЕНИЯ ---------- */
const state = {
  networks: [],      // массив сетей из JSON
  selected: null,    // выбранная сеть (объект из JSON)
  loading: false,    // идёт ли загрузка данных
  lang: "ru",        // активный язык интерфейса
  status: null,      // последний {type,text} статус — для перерисовки при смене языка
};

/* ---------- 2.5 ЗАЩИТА ОТ РАННЕГО ВЫПОЛНЕНИЯ ----------
   Бутстрап выполняется в самом конце файла (см. секцию 14): иначе const-
   ссылки (dom/dict/LOCALES) ещё не инициализированы (TDZ). Если скрипт
   по какой-то причине выполнен до парсинга HTML — ждём DOMContentLoaded. */
function __cpBoot__() {
  if (typeof main === "function") main();
}

/* ---------- 3. ССЫЛКИ НА DOM ---------- */
const dom = {
  cardsGrid:     document.getElementById("cardsGrid"),
  cardTemplate:  document.getElementById("cardTemplate"),
  searchInput:   document.getElementById("searchInput"),
  dropdown:      document.getElementById("networkDropdown"),
  dropToggle:    document.getElementById("dropdownToggle"),
  dropLabel:     document.getElementById("dropdownLabel"),
  dropMenu:      document.getElementById("dropdownMenu"),
  statusDot:     document.getElementById("statusDot"),
  statusText:    document.getElementById("statusText"),
  placeholder:   document.getElementById("paymentPlaceholder"),
  payPanel:      document.getElementById("payPanel"),
  payLogo:       document.getElementById("payLogo"),
  payName:       document.getElementById("payName"),
  payCode:       document.getElementById("payCode"),
  payQr:         document.getElementById("payQr"),
  addressBox:    document.getElementById("addressBox"),
  copyBtn:       document.getElementById("copyBtn"),
  copyBtnText:   document.getElementById("copyBtnText"),
  notifyForm:    document.getElementById("notifyForm"),
  amountInput:   document.getElementById("amountInput"),
  commentInput:  document.getElementById("commentInput"),
  submitBtn:     document.getElementById("submitBtn"),
  tierChips:     document.getElementById("tierChips"),
  resultCount:   document.getElementById("resultCount"),
  toastContainer:document.getElementById("toastContainer"),
  themeToggle:   document.getElementById("themeToggle"),
  year:          document.getElementById("year"),
  clockTicker:   document.getElementById("clockTicker"),
};

/* ---------- 3.5 ЛОКАЛИЗАЦИЯ (i18n) ---------- */

/** Плоский доступ к ключу вида "toast.copied" в словаре */
function t(key, vars) {
  const val = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), dict);
  let str = typeof val === "string" ? val : key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
  return str;
}

let dict = {}; // текущий активный словарь

/** Определяет язык: сохранённый > совпадение из navigator.language > en */
function detectLang() {
  const saved = localStorage.getItem("cp-lang");
  if (saved && LOCALES[saved]) return saved;
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return LOCALES[nav] ? nav : FALLBACK_LANG;
}

/** Загружает locales/<lang>.json с кэшем; при сбое — fallback на en */
async function loadLocale(lang) {
  if (LOCALE_CACHE.has(lang)) return LOCALE_CACHE.get(lang);
  try {
    const res = await fetch(`locales/${lang}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    LOCALE_CACHE.set(lang, data);
    return data;
  } catch (err) {
    console.warn(`[CryptoPulse] Не удалось загрузить локализацию "${lang}"`, err);
    if (lang !== FALLBACK_LANG) {
      if (LOCALE_CACHE.has(FALLBACK_LANG)) return LOCALE_CACHE.get(FALLBACK_LANG);
      const res = await fetch(`locales/${FALLBACK_LANG}.json`, { cache: "no-store" });
      const data = await res.json();
      LOCALE_CACHE.set(FALLBACK_LANG, data);
      return data;
    }
    return null;
  }
}

/** Форматы дат/чисел для Intl (часы, год) */
const LOCALE_INTL = { en: "en-US", ru: "ru-RU", zh: "zh-CN", ja: "ja-JP", es: "es-ES", de: "de-DE" };

/** Применяет словарь к DOM: текст, атрибуты, title, html lang */
function applyI18n() {
  document.documentElement.lang = state.lang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const text = t(key);
    if (text === key) return; // ключ отсутствует — не трогаем исходный текст
    if (el.querySelector("#year")) return; // подвал с живым годом — см. renderYear()
    el.textContent = text;
    if (el.classList.contains("glitch")) el.setAttribute("data-text", text); // glitch-псевдоэлементы
    if (el.id === "year") return; // год управляется отдельно (см. renderYear)
  });

  document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.dataset.i18nAttr.split(";").forEach((pair) => {
      const [attr, key] = pair.split(":");
      if (!attr || !key) return;
      const text = t(key);
      if (text !== key) el.setAttribute(attr, text);
    });
  });

  // <title> и meta description
  const titleKey = "html.title";
  if (t(titleKey) !== titleKey) document.title = t(titleKey);

  // Кнопки языка — нативные названия из словарей
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.lang === state.lang);
  });

  // Статус-строка hero: пересобираем текст из активного словаря
  if (state.status) {
    const { type } = state.status;
    const key = type === "ok" ? "status.online" : type === "error" ? "status.offline" : "status.loading";
    const vars = type === "ok" ? { count: state.networks.length } : undefined;
    dom.statusDot.className = "status-dot status-dot--" + type;
    dom.statusText.textContent = t(key, vars);
  }

  renderYear();
}

/** Подвал: «CRYPTO PULSE © {year} — …» c живым годом внутри перевода.
   Шаблон берётся из словаря; если перевод не содержит {year}, год дописывается
   после первого блока текста (как в исходной русской разметке). */
function renderYear() {
  const el = document.querySelector('[data-i18n="html.footerMain"]');
  if (!el) return;
  const year = String(new Date().getFullYear());
  let tmpl = t("html.footerMain");
  if (tmpl === "html.footerMain") tmpl = FOOTER_FALLBACK;
  if (!tmpl.includes("{year}")) {
    const i = tmpl.indexOf("—");
    tmpl = (i > -1 ? tmpl.slice(0, i) : tmpl + " ") + "{year} " + (i > -1 ? tmpl.slice(i) : "");
  }

  const want = tmpl.replace("{year}", year);
  if (el.textContent.trim() === want.trim()) { dom.year = el.querySelector("#year"); return; }

  el.textContent = "";
  const [before, ...rest] = tmpl.split("{year}");
  el.append(document.createTextNode(before));
  const span = document.createElement("span");
  span.id = "year";
  span.textContent = year;
  el.appendChild(span);
  el.append(document.createTextNode(rest.join("{year}")));
  dom.year = span;
}

/** Перезапрос живой ссылки на span года (его узел пересоздаётся при переводе подвала) */
function refreshYearRef() {
  dom.year = document.getElementById("year");
}

/** Полное переключение языка: словарь → UI → динамические списки */
async function setLanguage(lang) {
  if (!LOCALES[lang]) return;
  const data = await loadLocale(lang);
  if (!data) return;
  state.lang = lang;
  dict = data;
  localStorage.setItem("cp-lang", lang);
  refreshYearRef();
  applyI18n();
  buildTierChips();   // чипы «ВСЕ/CORE/…» переводятся
  refreshLists();     // карточки, dropdown, счётчик, aria-атрибуты
  if (state.selected) syncPaymentPanel(); // панель оплаты выбранный сетью
  tickClock();        // часы в локализованном формате
}

/* ---------- 4. УТИЛИТЫ ---------- */

/**
 * Безопасное экранирование HTML (все данные из JSON вставляются через него).
 * @param {string} str - произвольная строка
 * @returns {string} строка без опасных символов
 */
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Показ статус-индикатора в hero-секции.
 * @param {"loading"|"ok"|"error"} type
 * @param {string} text
 */
function setStatus(type, text) {
  state.status = { type, text };       // запоминаем — статус перерисовывается при смене языка
  dom.statusDot.className = "status-dot status-dot--" + type;
  dom.statusText.textContent = text;
}

/**
 * Стильные всплывающие toast-уведомления.
 * @param {string} message - текст
 * @param {"success"|"error"|"info"} [type="info"]
 * @param {number} [duration=3500] - время показа, мс
 */
function showToast(message, type = "info", duration = 3500) {
  const icons = { success: "✔", error: "✖", info: "ℹ" };

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span class="toast__icon">${icons[type]}</span><span>${escapeHtml(message)}</span>`;
  dom.toastContainer.appendChild(toast);

  // Автоскрытие с анимацией выхода
  setTimeout(() => {
    toast.classList.add("is-hiding");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, duration);
}

/**
 * Fetch с таймаутом через AbortController.
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 5. ЗАГРУЗКА ДАННЫХ (addresses.json) ---------- */

/**
 * Загружает JSON со списком сетей (единственный источник — crypto/addresses.json).
 * Бросает ошибку при HTTP-ошибке или битом JSON.
 */
async function fetchNetworksJson() {
  const response = await fetch(DATA_URL, { cache: "no-store" }); // no-store — свежий файл без кэша браузера

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${DATA_URL}`);
  }

  // GitHub Pages иногда отдаёт HTML-страницу 404 с кодом 200 —
  // response.json() в этом случае упадёт с понятной ошибкой парсинга.
  return response.json();
}

/**
 * Асинхронно подгружает JSON со списком сетей и запускает рендер.
 * Обрабатывает сетевые ошибки, HTTP-ошибки и битый JSON.
 */
async function loadNetworks() {
  state.loading = true;
  setStatus("loading", t("status.loading"), );

  try {
    const data = await fetchNetworksJson();

    // Поддержка двух форматов: массив объектов OR объект вида { networks: [...] }
    const list = Array.isArray(data) ? data : (Array.isArray(data.networks) ? data.networks : null);

    if (!list || list.length === 0) {
      throw new Error(t("errors.badData"));
    }

    // Сортировка по алфавиту — так список выглядит аккуратно и предсказуемо
    list.sort((a, b) => String(a.name ?? a.code).localeCompare(String(b.name ?? b.code)));

    // Нормализация: раскрываем относительные пути qr/img из корня /crypto
    state.networks = list.map((net) => ({
      id: net.id,
      code: String(net.code ?? ""),
      name: String(net.name ?? net.code ?? t("errors.untitled")),
      address: String(net.address ?? ""),
      qr: net.qr ? `crypto/${String(net.qr).replace(/^\.?\//, "")}` : "",
      img: net.img ? `crypto/${String(net.img).replace(/^\.?\//, "")}` : "",
      tier: String(net.tier ?? "l1"), // тир сети для группировки карточек (core/evm/l1/privacy/meme)
    }));

    buildTierChips();
    refreshLists();

    setStatus("ok", t("status.online", { count: state.networks.length }));

  // Восстанавливаем выбранную сеть после перезагрузки, если она ещё существует
  const savedNetId = Number(localStorage.getItem("cp-net"));
  if (savedNetId) {
    const restored = state.networks.find((n) => n.id === savedNetId);
    if (restored && restored.address) selectNetwork(restored);
  }
    showToast(t("toast.listUpdated", { count: state.networks.length }), "info", 2500);
  } catch (error) {
    console.error("[CryptoPulse] Ошибка загрузки данных:", error);

    const isAbort = error.name === "AbortError";
    const message = isAbort ? t("errors.timeout") : t("errors.loadFailed");

    setStatus("error", t("status.offline"));
    renderLoadError(message);
    showToast(message + t("errors.checkConnection"), "error", 6000);
  } finally {
    state.loading = false;
  }
}

/**
 * Замена сетки карточек на сообщение об ошибке с кнопкой «Повторить».
 * @param {string} message
 */
function renderLoadError(message) {
  dom.cardsGrid.innerHTML = `
    <div class="payment__placeholder" style="grid-column: 1 / -1;">
      <span class="payment__placeholder-icon" aria-hidden="true">⚠</span>
      ${escapeHtml(message)}
      <br><br>
      <button class="btn btn--copy" type="button" id="retryBtn" style="max-width:220px;margin:0 auto;">
        ${escapeHtml(t("errors.retry"))}
      </button>
    </div>`;
  document.getElementById("retryBtn")?.addEventListener("click", loadNetworks);
}

/* ---------- 6. РЕНДЕР КАРТОЧЕК СЕТЕЙ ---------- */

/**
 * Отрисовывает сетку карточек из переданного списка сетей.
 * @param {Array} list - фильтрованный или полный список
 */
function renderCards(list) {
  // Удаляем скелетоны/старые карточки, оставляя только <template>
  dom.cardsGrid.querySelectorAll(":scope > *:not(template)").forEach((el) => el.remove());

  if (list.length === 0) {
    dom.cardsGrid.innerHTML = `
      <div class="payment__placeholder" style="grid-column: 1 / -1;">
        <span class="payment__placeholder-icon" aria-hidden="true">∅</span>
        ${escapeHtml(t("errors.empty"))}
      </div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  list.forEach((net) => {
    // Клонируем карточку из <template> — быстрый и безопасный способ
    const node = dom.cardTemplate.content.cloneNode(true);
    const card = node.querySelector(".card");

    card.dataset.id = net.id;
    card.setAttribute("aria-label", `${t("html.cardSelectAria")} ${net.name}`);

    const logo = node.querySelector(".card__logo");
    if (net.img) {
      logo.src = net.img;
      logo.alt = `${t("html.cardLogoAlt")} ${net.name}`;
      // Битый логотип прячем (без inline-обработчика — CSP-friendly)
      logo.addEventListener("error", () => logo.classList.add("is-missing"), { once: true });
    } else {
      logo.remove(); // если логотипа нет — не показываем битую картинку
    }

    node.querySelector(".card__name").textContent = net.name;
    node.querySelector(".card__code").textContent = net.code;

    // Бейдж тира сети (CORE / EVM / L1 / PRIVACY / MEME) — цветовая группировка
    const badge = node.querySelector(".card__tier");
    if (badge) {
      badge.textContent = t(`ui.tier.${net.tier}`) !== `ui.tier.${net.tier}` ? t(`ui.tier.${net.tier}`) : (TIER_LABELS[net.tier] ?? "L1");
      badge.dataset.tier = net.tier;
    }

    // Клик и Enter/Space выбирают сеть
    card.addEventListener("click", () => selectNetwork(net));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectNetwork(net);
      }
    });

    // Подсвечиваем, если эта сеть уже выбрана
    if (state.selected?.id === net.id) card.classList.add("is-selected");

    fragment.appendChild(node);
  });

  dom.cardsGrid.appendChild(fragment);
}

/* ---------- 7. КАСТОМНЫЙ ВЫПАДАЮЩИЙ СПИСОК ---------- */

/**
 * Наполняет меню dropdown пунктами со списком сетей.
 * @param {Array} list
 */
function renderDropdownItems(list) {
  dom.dropMenu.innerHTML = "";

  list.forEach((net) => {
    const li = document.createElement("li");
    li.className = "dropdown__item";
    li.setAttribute("role", "option");
    li.tabIndex = -1;
    li.innerHTML = `
      ${net.img ? `<img src="${escapeHtml(net.img)}" alt="" loading="lazy">` : ""}
      <b>${escapeHtml(net.name)}</b>
      <span>${escapeHtml(net.code)}</span>`;
    li.addEventListener("click", () => {
      selectNetwork(net);
      closeDropdown();
    });
    dom.dropMenu.appendChild(li);
  });
}

/** Открыть/закрыть меню */
function toggleDropdown() {
  const isOpen = dom.dropdown.classList.toggle("is-open");
  dom.dropToggle.setAttribute("aria-expanded", String(isOpen));
}
function closeDropdown() {
  dom.dropdown.classList.remove("is-open");
  dom.dropToggle.setAttribute("aria-expanded", "false");
}

dom.dropToggle.addEventListener("click", toggleDropdown);

// Клик мимо dropdown'а закрывает его
document.addEventListener("click", (e) => {
  if (!dom.dropdown.contains(e.target)) closeDropdown();
});

// Escape закрывает меню
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDropdown();
});

/* ---------- 8. ЖИВОЙ ПОИСК + ФИЛЬТРЫ ПО ТИПАМ ---------- */

/** Активный фильтр по тиру: null | "core" | "evm" | "l1" | "privacy" | "meme" */
let tierFilter = null;

const TIER_LABELS = { core: "CORE", evm: "EVM", l1: "L1", privacy: "PRIVACY", meme: "MEME" };

/** Возвращает список сетей с учётом строки поиска и выбранного чипа-фильтра */
function getFilteredNetworks() {
  const query = dom.searchInput.value.trim().toLowerCase();

  return state.networks.filter((net) => {
    if (tierFilter && net.tier !== tierFilter) return false;
    if (!query) return true;
    return (
      net.code.toLowerCase().includes(query) ||
      net.name.toLowerCase().includes(query) ||
      net.address.toLowerCase().includes(query)
    );
  });
}

/** Перерисовывает сетку, dropdown и счётчик найденных сетей */
function refreshLists() {
  const filtered = getFilteredNetworks();
  renderCards(filtered);
  renderDropdownItems(filtered);

  if (dom.resultCount) {
    dom.resultCount.textContent = t("ui.shownOf", { shown: filtered.length, total: state.networks.length });
  }
}

dom.searchInput.addEventListener("input", refreshLists);

/* Чипы-фильтры по типам сетей (строятся динамически из данных JSON) */
function buildTierChips() {
  if (!dom.tierChips) return;
  dom.tierChips.innerHTML = "";

  const makeChip = (tier, label) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (tier === null ? " is-active" : "");
    chip.dataset.tier = tier ?? "all";
    chip.textContent = label;
    chip.addEventListener("click", () => {
      tierFilter = tier;
      dom.tierChips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c === chip));
      refreshLists();
    });
    dom.tierChips.appendChild(chip);
  };

  makeChip(null, t("ui.all"));
  Object.keys(TIER_LABELS).forEach((tier) => {
    if (state.networks.some((n) => n.tier === tier)) makeChip(tier, TIER_LABELS[tier]);
  });
}

/* ---------- 9. ВЫБОР СЕТИ -> ОБНОВЛЕНИЕ БЛОКА ОПЛАТЫ ---------- */

/**
 * Заполняет панель оплаты данными выбранной сети (без QR-перезагрузки).
 * Вызывается при выборе сети и при смене языка (перевод alt/label).
 * @param {boolean} [reloadQr=false] — перезагружать ли картинку QR
 */
function syncPaymentPanel(reloadQr = false) {
  const net = state.selected;
  if (!net) return;

  dom.dropLabel.innerHTML = `${escapeHtml(net.name)} <span style="color:var(--cyan)">[${escapeHtml(net.code)}]</span>`;

  dom.placeholder.hidden = true;
  dom.payPanel.hidden = false;

  if (net.img) {
    dom.payLogo.src = net.img;
    dom.payLogo.alt = `${t("html.cardLogoAlt")} ${net.name}`;
    dom.payLogo.style.display = "";
  } else {
    dom.payLogo.style.display = "none";
  }

  dom.payName.textContent = net.name;
  dom.payCode.textContent = "// " + net.code;
  dom.payQr.alt = `${t("html.qrAltPrefix")} ${net.name}`;
  dom.addressBox.value = net.address;

  if (reloadQr) {
    // QR: перечитаем src и проигрываем анимацию «проявки» при каждой смене сети
    dom.payQr.classList.remove("is-loading");
    dom.payQr.src = "";
    if (net.qr) {
      dom.payQr.src = net.qr;
      dom.payQr.classList.add("is-loading");
      dom.payQr.addEventListener("load", () => dom.payQr.classList.remove("is-loading"), { once: true });
      dom.payQr.addEventListener("error", () => dom.payQr.classList.remove("is-loading"), { once: true });
    }
  }

  resetCopyButton();
}

/**
 * Динамически заполняет панель: логотип, QR, адрес, подсветка карточки.
 * @param {Object} net - объект сети из state.networks
 */
function selectNetwork(net) {
  if (!net.address) {
    showToast(t("toast.noAddress", { name: net.name }), "error");
    return;
  }

  state.selected = net;
  localStorage.setItem("cp-net", String(net.id)); // выбор сети живёт до перезагрузки

  // Подсветка выбранной карточки в сетке
  dom.cardsGrid.querySelectorAll(".card").forEach((card) => {
    card.classList.toggle("is-selected", Number(card.dataset.id) === net.id);
  });

  syncPaymentPanel(true);

  // Плавная прокрутка к панели (если она уже за пределами экрана)
  const panelTop = dom.payPanel.getBoundingClientRect().top;
  if (panelTop < 0 || panelTop > window.innerHeight * 0.7) {
    dom.payPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  showToast(t("toast.networkSelected", { name: net.name }), "success", 2200);
}

/* ---------- 10. КОПИРОВАНИЕ АДРЕСА ---------- */

/** Возвращает кнопку копирования в исходное состояние */
function resetCopyButton() {
  dom.copyBtn.classList.remove("is-copied");
  dom.copyBtnText.textContent = t("html.copyBtn");
}

/**
 * Копирует адрес в буфер обмена с визуальным подтверждением.
 * Использует современный Clipboard API с fallback на execCommand
 * для старых браузеров / небезопасного контекста (http).
 */
async function copyAddress() {
  const text = dom.addressBox.value;
  if (!text) return;

  let copied = false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    } else {
      // Fallback: выделяем readonly-текстареа и просим браузер скопировать
      dom.addressBox.select();
      copied = document.execCommand("copy");
      window.getSelection()?.removeAllRanges();
    }
  } catch (err) {
    console.error("[CryptoPulse] Ошибка копирования:", err);
    copied = false;
  }

  if (copied) {
    // Визуальное подтверждение: кнопка меняет вид на 2 секунды
    dom.copyBtn.classList.add("is-copied");
    dom.copyBtnText.textContent = t("html.copiedBtn");
    showToast(t("toast.copied"), "success", 2500);
    setTimeout(resetCopyButton, 2000);
  } else {
    showToast(t("toast.copyFailed"), "error", 5000);
  }
}

dom.copyBtn.addEventListener("click", copyAddress);

/* ---------- 11. ФОРМА «Я ОПЛАТИЛ / УВЕДОМИТЬ» ---------- */

/**
 * Валидация формы перед отправкой.
 * @returns {boolean} валидна ли форма
 */
function validateForm() {
  let valid = true;
  const rawAmount = dom.amountInput.value.trim();

  // Сумма опциональна, но если указана — должна быть положительным числом
  [dom.amountInput, dom.commentInput].forEach((el) => el.classList.remove("input--invalid"));

  if (rawAmount !== "") {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      dom.amountInput.classList.add("input--invalid");
      showToast(t("errors.positiveAmount"), "error");
      valid = false;
    }
  }

  if (!state.selected) {
    showToast(t("errors.selectFirst"), "error");
    valid = false;
  }

  return valid;
}

/**
 * Отправка POST-запроса на бэкенд с JSON:
 * { network, amount, comment, address }
 */
async function submitNotification(event) {
  event.preventDefault();

  if (!validateForm()) return;

  const payload = {
    network: state.selected.code,                                  // код сети, напр. "BTC"
    amount:  dom.amountInput.value.trim() === ""                   // пустая сумма -> null
               ? null
               : Number(dom.amountInput.value.trim()),
    comment: dom.commentInput.value.trim(),                        // может быть ""
    address: state.selected.address,                               // адрес выбранной сети
  };

  // Состояние загрузки кнопки
  dom.submitBtn.disabled = true;
  dom.submitBtn.classList.add("is-loading");
  const label = dom.submitBtn.querySelector(".btn__label");
  const originalLabel = label.textContent;
  label.textContent = t("html.sendingBtn");

  try {
    const response = await fetchWithTimeout(NOTIFY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(t("errors.serverStatus", { code: response.status }));
    }

    // Успех: чистим поля формы, оставляем выбранную сеть
    showToast(t("toast.sent"), "success", 5000);
    dom.notifyForm.reset();
  } catch (error) {
    console.error("[CryptoPulse] Ошибка отправки уведомления:", error);

    const isAbort = error.name === "AbortError";
    showToast(
      isAbort ? t("toast.sendTimeout") : t("toast.sendFailed", { message: error.message }),
      "error",
      6000
    );
  } finally {
    // Сброс состояния кнопки в любом случае
    dom.submitBtn.disabled = false;
    dom.submitBtn.classList.remove("is-loading");
    label.textContent = originalLabel;
  }
}

dom.notifyForm.addEventListener("submit", submitNotification);

/* ---------- 12. ПЕРЕКЛЮЧАТЕЛЬ ТЕМЫ ---------- */

/** Читает сохранённую тему из localStorage и применяет её */
function applySavedTheme() {
  const saved = localStorage.getItem("cp-theme");
  if (saved === "light") document.documentElement.setAttribute("data-theme", "light");
}

dom.themeToggle.addEventListener("click", () => {
  // Разрешаем CSS-crossfade только после первого клика (не при загрузке)
  document.documentElement.classList.add("cp-theme-anim");

  // Если сейчас активна светлая тема — возвращаем тёмную, иначе — включаем светлую
  const nowLight = document.documentElement.getAttribute("data-theme") === "light";

  if (nowLight) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("cp-theme", "dark");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("cp-theme", "light");
  }
});

/* ---------- 12.5 ПЕРЕКЛЮЧАТЕЛЬ ЯЗЫКА ---------- */

/** Один тик часов: HH:MM:SS в формате активного языка */
function tickClock() {
  if (!dom.clockTicker) return;
  dom.clockTicker.textContent = new Date().toLocaleTimeString(LOCALE_INTL[state.lang] ?? "en-US", { hour12: false });
}

/** Клик по кнопке 🇷🇺/🇺🇸/🇨🇳/🇯🇵/🇪🇸/🇩🇪 — меняем язык всего интерфейса */
function initLangSwitch() {
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => setLanguage(btn.dataset.lang));
  });
}

/* ---------- 13. ИНИЦИАЛИЗАЦИЯ ---------- */

/** Точка входа — вызывается бутстрапом (см. секцию 2.5) */
async function main() {
  applySavedTheme();

  // Локализация: определяем язык, грузим словарь, применяем к статичному HTML
  initLangSwitch();
  const initialLang = detectLang();
  const data = await loadLocale(initialLang);
  if (data) { state.lang = initialLang; dict = data; }
  refreshYearRef();
  applyI18n();
  tickClock();

  // Появление секций и карточек при скролле (scroll reveal)
  if ("IntersectionObserver" in window) {
    const secIo = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          secIo.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll(".section").forEach((el) => secIo.observe(el));
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    const gridEl = dom.cardsGrid;
    new MutationObserver(() => {
      gridEl.querySelectorAll(".card:not(.is-visible)").forEach((el, i) => {
        el.style.setProperty("--delay", `${Math.min(i * 35, 600)}ms`);
        io.observe(el);
      });
    }).observe(gridEl, { childList: true });
  }

  // Хоткей "/" — фокус на поиск (как в GitHub / неактивных полях)
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) {
      e.preventDefault();
      dom.searchInput.focus();
    }
  });

  // Живые часы в статус-строке — «терминальный» тик (формат активного языка)
  if (dom.clockTicker) {
    tickClock();
    setInterval(tickClock, 1000);
  }

  // Если данные уже есть в кеше браузера — fetch вернёт их мгновенно
  loadNetworks();
}

/* ---------- 14. БУТСТРАП (в конце файла — все const уже инициализированы) ---------- */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", __cpBoot__, { once: true });
} else {
  __cpBoot__();
}
