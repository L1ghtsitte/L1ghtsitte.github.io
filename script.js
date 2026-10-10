/* ============================================================
   CRYPTO PULSE — логика донат-терминала (Vanilla JS)
   Порядок: i18n-модуль → конфиг → утилиты → загрузка JSON →
            рендер карточек → dropdown → поиск → выбор сети →
            копирование → отправка формы → toast → тема → init
   ============================================================ */

"use strict";

/* ============================================================
   I18N — единый модуль локализации (namespace window.i18n)
   - словари locales/<lang>.json, fallback — en;
   - язык: localStorage("cp-lang") > navigator.language > "en";
   - перевод статичной разметки через data-i18n / data-i18n-attr;
   - динамический контент строится через i18n.t(key, vars);
   - подписка на смену языка: i18n.onChange(fn) — UI перерисовывается.
   ============================================================ */
const i18n = (() => {
  const LANGS = ["ru", "en", "zh", "ja", "es", "de"]; // первый — язык по умолчанию в разметке
  const FALLBACK = "en";
  const STORAGE_KEY = "cp-lang";
  const INTL = { ru: "ru-RU", en: "en-US", zh: "zh-CN", ja: "ja-JP", es: "es-ES", de: "de-DE" };
  const NAMES = { ru: "Русский", en: "English", zh: "中文", ja: "日本語", es: "Español", de: "Deutsch" };

  let dict = {};                 // активный словарь
  let current = FALLBACK;        // активный язык
  const cache = new Map();       // lang -> словарь (один запрос на язык)
  const listeners = new Set();   // подписчики смены языка

  /* Плоский доступ к ключу "toast.copied" + подстановка {плейсхолдеров} */
  function t(key, vars) {
    const val = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), dict);
    let str = typeof val === "string" ? val : key;
    if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
    return str;
  }

  /** Язык: сохранённый пользователем > совпадение navigator.language > ru */
  function detect() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGS.includes(saved)) return saved;
    const nav = (navigator.language || "").slice(0, 2).toLowerCase();
    return LANGS.includes(nav) ? nav : FALLBACK;
  }

  /** Загружает locales/<lang>.json с кэшем; при сбое — fallback на en */
  async function loadLocale(lang) {
    if (cache.has(lang)) return cache.get(lang);
    try {
      const res = await fetch(`locales/${lang}.json`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: locales/${lang}.json`);
      const data = await res.json();
      cache.set(lang, data);
      return data;
    } catch (err) {
      console.warn(`[i18n] Не удалось загрузить локализацию "${lang}"`, err);
      if (lang !== FALLBACK) return loadLocale(FALLBACK);
      return null;
    }
  }

  /* ---------- применение словаря к DOM ---------- */

  /** Живой год в подвале: шаблон из словаря, <span id="year"> не затирается */
  function renderYear() {
    const el = document.querySelector('[data-i18n="html.footerMain"]');
    if (!el) return;
    const year = String(new Date().getFullYear());
    let tmpl = i18n.t("html.footerMain");
    if (tmpl === "html.footerMain") tmpl = "CRYPTO PULSE © {year}";
    if (!tmpl.includes("{year}")) {
      const i = tmpl.indexOf("—");
      tmpl = (i > -1 ? tmpl.slice(0, i) : tmpl + " ") + "{year} " + (i > -1 ? tmpl.slice(i) : "");
    }
    if (el.textContent.replace(/\s+/g, " ").trim() === tmpl.replace("{year}", year).replace(/\s+/g, " ").trim()) return;

    el.textContent = "";
    const [before, ...rest] = tmpl.split("{year}");
    el.append(document.createTextNode(before));
    const span = document.createElement("span");
    span.id = "year";
    span.textContent = year;
    el.appendChild(span);
    el.append(document.createTextNode(rest.join("{year}")));
  }

  /** Переводит статичную разметку: текст, атрибуты, title, html lang, glitch-текст */
  function applyToDOM() {
    document.documentElement.lang = current;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const text = i18n.t(el.dataset.i18n);
      if (text === el.dataset.i18n) return; // ключа нет — оставляем исходный текст
      if (el.querySelector("#year")) return; // подвал с живым годом — см. renderYear()
      el.textContent = text;
      if (el.classList.contains("glitch")) el.setAttribute("data-text", text);
    });

    /* Плейсхолдеры с переменными: data-i18n-tpl="ключ|var=значение" */
    document.querySelectorAll("[data-i18n-tpl]").forEach((el) => {
      const [key, ...varPairs] = el.dataset.i18nTpl.split("|");
      const vars = {};
      varPairs.forEach((p) => { const [k, v] = p.split("="); if (k && v !== undefined) vars[k] = v; });
      const text = i18n.t(key, vars);
      if (text !== key) el.textContent = text;
    });

    /* Атрибуты: data-i18n-attr="placeholder:ключ;aria-label:ключ;alt:ключ" */
    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.dataset.i18nAttr.split(";").forEach((pair) => {
        const [attr, key] = pair.split(":");
        if (!attr || !key) return;
        const text = i18n.t(key);
        if (text !== key) el.setAttribute(attr, text);
      });
    });

    if (i18n.t("html.title") !== "html.title") document.title = i18n.t("html.title");
    renderYear();
  }

  /* ---------- переключение языка ---------- */

  async function setLang(lang) {
    if (!LANGS.includes(lang) || (lang === current && cache.size > 0)) return false;
    const data = await loadLocale(lang);
    if (!data) return false;
    current = lang;
    dict = data;
    localStorage.setItem(STORAGE_KEY, lang);
    applyToDOM();
    listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error("[i18n] onChange:", e); } });
    return true;
  }

  /** Инициализация: определить язык, загрузить словарь, перевести страницу */
  async function init() {
    const initial = detect();
    const data = await loadLocale(initial);
    if (data) { current = initial; dict = data; }
    applyToDOM();
    return current;
  }

  return {
    init,
    setLang,
    t,
    detect,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    get lang() { return current; },
    get intl() { return INTL[current] ?? "en-US"; },
    langs: LANGS,
    names: NAMES,
  };
})();
window.i18n = i18n; // отладка/расширения: i18n.setLang('de')

/* ---------- 1. КОНФИГУРАЦИЯ ---------- */

/* URL бэкенда для уведомлений об оплате.
   GitHub Pages не поддерживает переменные окружения, поэтому
   это просто константа — поменяй домен на свой перед деплоем. */
const NOTIFY_API_URL = "https://donati77.mooo.com/api/crypto-notify"; // домен контейнера (nginx -> FastAPI /api/crypto-notify)

/* Путь к данным с адресами — единственный источник истины:
   чистый JSON-файл crypto/addresses.json (файл addresses.all.json удалён).

   ВАЖНО: путь вычисляется ОТ АБСОЛЮТНОЙ базы относительно фактического
   расположения index.html (document.baseURI), поэтому:
   - опечатка в URL («adresses.json») больше не приведёт к 404 на другом хостинге;
   - работает и в корне домена, и в подпадке GitHub Pages (/repo/);
   - если файл по пути отсутствует — понятная ошибка в консоль + retry в UI. */
const DATA_PATH = "crypto/addresses.json"; // относительный путь от корня сайта
const DATA_URL = new URL(DATA_PATH, document.baseURI).href;

/* Таймаут запроса к бэкенду, мс */
const REQUEST_TIMEOUT_MS = 15000;

/* Языковые метаданные для переключателя в шапке (флаг + короткое имя).
   Полные словари и логика — в модуле i18n (секция 0). */
const LANG_META = {
  ru: { flag: "🇷🇺", short: "RU" },
  en: { flag: "🇺🇸", short: "EN" },
  zh: { flag: "🇨🇳", short: "中" },
  ja: { flag: "🇯🇵", short: "日" },
  es: { flag: "🇪🇸", short: "ES" },
  de: { flag: "🇩🇪", short: "DE" },
};

/* ---------- 2. СОСТОЯНИЕ ПРИЛОЖЕНИЯ ---------- */
const state = {
  networks: [],      // массив сетей из JSON
  selected: null,    // выбранная сеть (объект из JSON)
  loading: false,    // идёт ли загрузка данных
  status: null,      // последний {type} статус — текст всегда через i18n.t()
};

/* ---------- 3. ССЫЛКИ НА DOM ---------- */
const dom = {
  cardsGrid:        document.getElementById("cardsGrid"),   // горизонтальный трек карусели
  cardTemplate:     document.getElementById("cardTemplate"),
  searchInput:      document.getElementById("searchInput"),
  dropdown:         document.getElementById("networkDropdown"),
  dropToggle:       document.getElementById("dropdownToggle"),
  dropLabel:        document.getElementById("dropdownLabel"),
  dropMenu:         document.getElementById("dropdownMenu"),
  statusDot:        document.getElementById("statusDot"),
  statusText:       document.getElementById("statusText"),
  placeholder:      document.getElementById("paymentPlaceholder"),
  payPanel:         document.getElementById("payPanel"),
  payLogo:          document.getElementById("payLogo"),
  payName:          document.getElementById("payName"),
  payCode:          document.getElementById("payCode"),
  payQr:            document.getElementById("payQr"),
  qrFrame:          document.getElementById("qrFrame"),
  addressBox:       document.getElementById("addressBox"),
  copyBtn:          document.getElementById("copyBtn"),
  copyBtnText:      document.getElementById("copyBtnText"),
  notifyForm:       document.getElementById("notifyForm"),
  amountInput:      document.getElementById("amountInput"),
  commentInput:     document.getElementById("commentInput"),
  submitBtn:        document.getElementById("submitBtn"),
  tierChips:        document.getElementById("tierChips"),
  resultCount:      document.getElementById("resultCount"),
  toastContainer:   document.getElementById("toastContainer"),
  themeToggle:      document.getElementById("themeToggle"),
  year:             document.getElementById("year"),
  clockTicker:      document.getElementById("clockTicker"),
  /* новый дизайн: карусель, счётчик сетей, прогресс скролла, модалка QR */
  carousel:         document.getElementById("carousel"),
  carouselPrev:     document.getElementById("carouselPrev"),
  carouselNext:     document.getElementById("carouselNext"),
  carouselThumb:    document.getElementById("carouselThumb"),
  scrollProgress:   document.getElementById("scrollProgress"),
  statNetworks:     document.getElementById("statNetworks"),
  qrModal:          document.getElementById("qrModal"),
  qrModalBackdrop:  document.getElementById("qrModalBackdrop"),
  qrModalClose:     document.getElementById("qrModalClose"),
  qrModalTitle:     document.getElementById("qrModalTitle"),
  qrModalImg:       document.getElementById("qrModalImg"),
  qrModalCoin:      document.getElementById("qrModalCoin"),
  qrModalCopy:      document.getElementById("qrModalCopy"),
};

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
 * @param {"loading"|"ok"|"error"} type — текст берётся из словаря i18n
 */
function setStatus(type) {
  state.status = type;                 // запоминаем тип — статус перерисовывается при смене языка
  dom.statusDot.className = "status-dot status-dot--" + type;
  const key = type === "ok" ? "status.online" : type === "error" ? "status.offline" : "status.loading";
  dom.statusText.textContent = i18n.t(key, type === "ok" ? { count: state.networks.length } : undefined);
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
  setStatus("loading");

  try {
    const data = await fetchNetworksJson();

    // Поддержка двух форматов: массив объектов OR объект вида { networks: [...] }
    const list = Array.isArray(data) ? data : (Array.isArray(data.networks) ? data.networks : null);

    if (!list || list.length === 0) {
      throw new Error(i18n.t("errors.badData"));
    }

    // Сортировка по алфавиту — так список выглядит аккуратно и предсказуемо
    list.sort((a, b) => String(a.name ?? a.code).localeCompare(String(b.name ?? b.code)));

    // Нормализация: раскрываем относительные пути qr/img из корня /crypto
    state.networks = list.map((net) => ({
      id: net.id,
      code: String(net.code ?? ""),
      name: String(net.name ?? net.code ?? i18n.t("errors.untitled")),
      address: String(net.address ?? ""),
      qr: net.qr ? `crypto/${String(net.qr).replace(/^\.?\//, "")}` : "",
      img: net.img ? `crypto/${String(net.img).replace(/^\.?\//, "")}` : "",
      tier: String(net.tier ?? "l1"), // тир сети для группировки карточек (core/evm/l1/privacy/meme)
    }));

    buildTierChips();
    refreshLists();

    setStatus("ok");
    animateCounter(dom.statNetworks, state.networks.length); // «N сетей» в hero — count-up

    // Восстанавливаем выбранную сеть после перезагрузки, если она ещё существует
    const savedNetId = Number(localStorage.getItem("cp-net"));
    if (savedNetId) {
      const restored = state.networks.find((n) => n.id === savedNetId);
      if (restored && restored.address) selectNetwork(restored, { silent: true });
    }
    showToast(i18n.t("toast.listUpdated", { count: state.networks.length }), "info", 2500);
  } catch (error) {
    console.error("[CryptoPulse] Ошибка загрузки данных:", error);

    const isAbort = error.name === "AbortError";
    const message = isAbort ? i18n.t("errors.timeout") : i18n.t("errors.loadFailed");

    setStatus("error");
    renderLoadError(message);
    showToast(message + i18n.t("errors.checkConnection"), "error", 6000);
  } finally {
    state.loading = false;
  }
}

/**
 * Замена трека карточек на сообщение об ошибке с кнопкой «Повторить».
 * @param {string} message
 */
function renderLoadError(message) {
  dom.cardsGrid.innerHTML = `
    <div class="track-message">
      <span class="payment__placeholder-icon" aria-hidden="true">⚠</span>
      <span>${escapeHtml(message)}</span>
      <button class="btn btn--gold" type="button" id="retryBtn">
        ${escapeHtml(i18n.t("errors.retry"))}
      </button>
    </div>`;
  document.getElementById("retryBtn")?.addEventListener("click", loadNetworks);
}

/* ---------- 6. РЕНДЕР КАРТОЧЕК СЕТЕЙ (карусель) ---------- */

/**
 * Отрисовывает сетку карточек из переданного списка сетей.
 * @param {Array} list - фильтрованный или полный список
 */
function renderCards(list) {
  // Удаляем скелетоны/старые карточки, оставляя только <template>
  dom.cardsGrid.querySelectorAll(":scope > *:not(template)").forEach((el) => el.remove());

  if (list.length === 0) {
    dom.cardsGrid.innerHTML = `
      <div class="track-message">
        <span class="payment__placeholder-icon" aria-hidden="true">∅</span>
        <span>${escapeHtml(i18n.t("errors.empty"))}</span>
      </div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  list.forEach((net) => {
    // Клонируем карточку из <template> — быстрый и безопасный способ
    const node = dom.cardTemplate.content.cloneNode(true);
    const card = node.querySelector(".card");

    card.dataset.id = net.id;
    card.setAttribute("aria-label", `${i18n.t("html.cardSelectAria")} ${net.name}`);

    const logo = node.querySelector(".card__logo");
    if (net.img) {
      logo.src = net.img;
      logo.alt = `${i18n.t("html.cardLogoAlt")} ${net.name}`;
      // Битый логотип прячем (без inline-обработчика — CSP-friendly)
      logo.addEventListener("error", () => logo.classList.add("is-missing"), { once: true });
    } else {
      logo.remove(); // если логотипа нет — не показываем битую картинку
    }

    node.querySelector(".card__name").textContent = net.name;
    node.querySelector(".card__code").textContent = net.code;
    node.querySelector(".card__select").textContent = i18n.t("ui.select"); // «выбрать» — появляется на hover

    // Бейдж тира сети (CORE / EVM / L1 / PRIVACY / MEME) — цветовая группировка
    const badge = node.querySelector(".card__tier");
    if (badge) {
      badge.textContent = i18n.t(`ui.tier.${net.tier}`) !== `ui.tier.${net.tier}` ? i18n.t(`ui.tier.${net.tier}`) : (TIER_LABELS[net.tier] ?? "L1");
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
  updateCarouselNav(); // пересчитать стрелки/ползунок под новую длину трека
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
    dom.resultCount.textContent = i18n.t("ui.shownOf", { shown: filtered.length, total: state.networks.length });
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

  makeChip(null, i18n.t("ui.all"));
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

  dom.dropLabel.innerHTML = `${escapeHtml(net.name)} <span class="dropdown__label-code">[${escapeHtml(net.code)}]</span>`;

  dom.placeholder.hidden = true;
  dom.payPanel.hidden = false;

  if (net.img) {
    dom.payLogo.src = net.img;
    dom.payLogo.alt = `${i18n.t("html.cardLogoAlt")} ${net.name}`;
    dom.payLogo.style.display = "";
  } else {
    dom.payLogo.style.display = "none";
  }

  dom.payName.textContent = net.name;
  dom.payCode.textContent = "// " + net.code;
  dom.payQr.alt = `${i18n.t("html.qrAltPrefix")} ${net.name}`;
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
 * @param {{silent?: boolean}} [opts] - silent: без toast и скролла (автовосстановление)
 */
function selectNetwork(net, opts = {}) {
  if (!net.address) {
    showToast(i18n.t("toast.noAddress", { name: net.name }), "error");
    return;
  }

  state.selected = net;
  localStorage.setItem("cp-net", String(net.id)); // выбор сети живёт до перезагрузки

  // Подсветка выбранной карточки в сетке
  dom.cardsGrid.querySelectorAll(".card").forEach((card) => {
    card.classList.toggle("is-selected", Number(card.dataset.id) === net.id);
  });

  syncPaymentPanel(true);

  if (!opts.silent) {
    // Плавная прокрутка к панели (если она уже за пределами экрана)
    const panelTop = dom.payPanel.getBoundingClientRect().top;
    if (panelTop < 0 || panelTop > window.innerHeight * 0.7) {
      dom.payPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    showToast(i18n.t("toast.networkSelected", { name: net.name }), "success", 2200);
  }
}

/* ---------- 9.5 КАРУСЕЛЬ: стрелки, drag, колесо, ползунок, glow за курсором ---------- */

/** Прокрутить трек на ~3 карточки в нужную сторону */
function scrollCarousel(dir) {
  dom.cardsGrid.scrollBy({ left: dir * Math.min(dom.cardsGrid.clientWidth * 0.8, 560), behavior: "smooth" });
}

/** Актуальное состояние стрелок + ширина/позиция ползунка-скроллбара */
function updateCarouselNav() {
  const track = dom.cardsGrid;
  const max = track.scrollWidth - track.clientWidth;
  if (dom.carouselPrev) dom.carouselPrev.classList.toggle("is-disabled", track.scrollLeft <= 4);
  if (dom.carouselNext) dom.carouselNext.classList.toggle("is-disabled", track.scrollLeft >= max - 4);

  if (dom.carouselThumb && max > 0) {
    const ratio = track.clientWidth / track.scrollWidth;
    dom.carouselThumb.style.width = `${Math.max(ratio * 100, 12)}%`;
    const travel = 100 - Math.max(ratio * 100, 12);
    dom.carouselThumb.style.transform = `translateX(${(track.scrollLeft / max) * travel}%)`;
  }
}

/** Инициализация карусели — вызывается из main() */
function initCarousel() {
  const track = dom.cardsGrid;
  if (!track || !dom.carousel) return;

  dom.carouselPrev?.addEventListener("click", () => scrollCarousel(-1));
  dom.carouselNext?.addEventListener("click", () => scrollCarousel(1));
  track.addEventListener("scroll", updateCarouselNav, { passive: true });
  window.addEventListener("resize", updateCarouselNav);

  // Горизонтальный скролл колесом (вертикальный жест превращаем в горизонтальный)
  track.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && track.scrollWidth > track.clientWidth) {
      e.preventDefault();
      track.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  // Drag мышью для прокрутки (клик по карточке после драга не выбирает сеть)
  let dragging = false, startX = 0, startScroll = 0, moved = 0;
  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return;
    dragging = true; moved = 0;
    startX = e.clientX; startScroll = track.scrollLeft;
    track.classList.add("is-dragging");
  });
  track.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    moved = Math.abs(dx);
    track.scrollLeft = startScroll - dx;
  });
  const endDrag = () => { dragging = false; track.classList.remove("is-dragging"); };
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointerleave", endDrag);
  // Подача события «схлопывания» клика после драга — ловим на capture-фазе
  track.addEventListener("click", (e) => {
    if (moved > 8) { e.stopPropagation(); e.preventDefault(); moved = 0; }
  }, true);

  // Мягкое золотое свечение под курсором (переменные --mx/--my для .card__glow)
  track.addEventListener("pointermove", (e) => {
    const card = e.target.closest?.(".card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  });

  updateCarouselNav();
}

/* ---------- 9.6 МОДАЛКА QR (увеличение по клику) ---------- */

function openQrModal() {
  const net = state.selected;
  if (!net || !net.qr || !dom.qrModal) return;
  dom.qrModalImg.src = net.qr;
  dom.qrModalImg.alt = `${i18n.t("html.qrAltPrefix")} ${net.name}`;
  dom.qrModalTitle.textContent = `${net.name} (${net.code})`;
  dom.qrModalCoin.textContent = i18n.t("ui.copyAddress");
  dom.qrModal.hidden = false;
  document.body.style.overflow = "hidden";
  dom.qrModalClose?.focus();
}

function closeQrModal() {
  if (!dom.qrModal || dom.qrModal.hidden) return;
  dom.qrModal.hidden = true;
  document.body.style.overflow = "";
  dom.qrFrame?.focus({ preventScroll: true });
}

function initQrModal() {
  dom.qrFrame?.addEventListener("click", openQrModal);
  dom.qrFrame?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openQrModal(); }
  });
  dom.qrModalBackdrop?.addEventListener("click", closeQrModal);
  dom.qrModalClose?.addEventListener("click", closeQrModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeQrModal(); });

  // Копирование адреса прямо из модалки
  dom.qrModalCopy?.addEventListener("click", async () => {
    const text = dom.addressBox?.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast(i18n.t("toast.copied"), "success", 2200);
    } catch {
      showToast(i18n.t("toast.copyFailed"), "error", 4000);
    }
  });
}

/* ---------- 9.7 ПРОЧИЕ ЭФФЕКТЫ НОВОГО ДИЗАЙНА ---------- */

/** Плавный count-up числа в hero-статистике */
function animateCounter(el, to, duration = 1200) {
  if (!el) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = String(to); return; }
  const start = performance.now();
  const from = Number(el.textContent) || 0;
  const step = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- 12. ГЛОБАЛЬНЫЕ ОБРАБОТЧИКИ ---------- */

/** Обновление полосы прогресса скролла (общий обработчик для scroll-событий) */
function updateScrollProgressBar() {
  const bar = dom.scrollProgress;
  if (!bar) return;
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;
  bar.style.width = `${max > 0 ? (doc.scrollTop / max) * 100 : 0}%`;
}

/**
 * Единый window-scroll: полоса прогресса + параллакс орбов фона.
 * Параллакс отключается при prefers-reduced-motion.
 */
function onWindowScroll() {
  updateScrollProgressBar();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const y = window.scrollY;
  document.querySelectorAll(".bg-orb").forEach((el, i) => {
    el.style.translate = `0 ${y * (i % 2 === 0 ? -0.04 : 0.03)}px`;
  });
}

/** Тонкая градиентная полоса прогресса скролла под верхним краем окна */
function initScrollProgress() {
  if (!dom.scrollProgress) return;
  document.addEventListener("scroll", onWindowScroll, { passive: true });
  onWindowScroll();
}

/* ---------- 10. КОПИРОВАНИЕ АДРЕСА ---------- */

/** Возвращает кнопку копирования в исходное состояние */
function resetCopyButton() {
  dom.copyBtn.classList.remove("is-copied");
  dom.copyBtnText.textContent = i18n.t("html.copyBtn");
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
    dom.copyBtnText.textContent = i18n.t("html.copiedBtn");
    showToast(i18n.t("toast.copied"), "success", 2500);
    setTimeout(resetCopyButton, 2000);
  } else {
    showToast(i18n.t("toast.copyFailed"), "error", 5000);
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
      showToast(i18n.t("errors.positiveAmount"), "error");
      valid = false;
    }
  }

  if (!state.selected) {
    showToast(i18n.t("errors.selectFirst"), "error");
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
  label.textContent = i18n.t("html.sendingBtn");

  try {
    const response = await fetchWithTimeout(NOTIFY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(i18n.t("errors.serverStatus", { code: response.status }));
    }

    // Успех: чистим поля формы, оставляем выбранную сеть
    showToast(i18n.t("toast.sent"), "success", 5000);
    dom.notifyForm.reset();
  } catch (error) {
    console.error("[CryptoPulse] Ошибка отправки уведомления:", error);

    const isAbort = error.name === "AbortError";
    showToast(
      isAbort ? i18n.t("toast.sendTimeout") : i18n.t("toast.sendFailed", { message: error.message }),
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

/* ---------- 12.5 ПЕРЕКЛЮЧАТЕЛЬ ЯЗЫКА (UI-слой над i18n) ---------- */

/** Один тик часов: HH:MM:SS в формате активного языка */
function tickClock() {
  if (!dom.clockTicker) return;
  dom.clockTicker.textContent = new Date().toLocaleTimeString(i18n.intl, { hour12: false });
}

/** Подсветка активной кнопки языка + aria-атрибуты */
function syncLangButtons() {
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    const active = btn.dataset.lang === i18n.lang;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

/** Клик по кнопке 🇷🇺/🇺🇸/🇨🇳/🇯🇵/🇪🇸/🇩🇪 — меняем язык всего интерфейса */
function initLangSwitch() {
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => i18n.setLang(btn.dataset.lang));
  });
}

/* ---------- 13. ИНИЦИАЛИЗАЦИЯ ---------- */

/** Точка входа */
async function main() {
  applySavedTheme();

  // Локализация: инициализация модуля i18n (язык → словарь → перевод страницы)
  initLangSwitch();
  await i18n.init();

  /* Реакция UI на смену языка: динамические списки, статус, часы, панель оплаты.
     Статичная разметка переводится внутри i18n.applyToDOM() до этого колбэка. */
  i18n.onChange(() => {
    syncLangButtons();
    buildTierChips();   // чипы «ВСЕ/CORE/…» переводятся
    refreshLists();     // карточки, dropdown, счётчик, aria-атрибуты
    if (state.status) setStatus(state.status); // статус-строка hero
    if (state.selected) syncPaymentPanel();    // alt/label панели выбранной сетью
    tickClock();        // часы в локализованном формате
  });

  syncLangButtons();
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
    document.querySelectorAll(".section, .reveal").forEach((el) => secIo.observe(el));

    // Карточки карусели: появление по мере прокрутки трека (каскад через --delay)
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 400px" });

    const gridEl = dom.cardsGrid;
    new MutationObserver(() => {
      gridEl.querySelectorAll(".card:not(.is-visible)").forEach((el, i) => {
        el.style.setProperty("--delay", `${Math.min(i * 35, 600)}ms`);
        io.observe(el);
      });
    }).observe(gridEl, { childList: true });
  } else {
    // Нет поддержки — сразу всё видимо (анимации не блокируют контент)
    document.querySelectorAll(".reveal, .card").forEach((el) => el.classList.add("is-visible"));
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

  // Механика нового дизайна: карусель, модалка QR, прогресс скролла
  initCarousel();
  initQrModal();
  initScrollProgress();

  // Если данные уже есть в кеше браузера — fetch вернёт их мгновенно
  loadNetworks();
}

/* ---------- 14. БУТСТРАП (script defer — DOM гарантированно готов) ---------- */
main().catch((err) => console.error("[CryptoPulse] Ошибка инициализации:", err));
