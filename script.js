/* ============================================================
   CRYPTO PULSE — логика донат-терминала (Vanilla JS)
   Порядок: i18n-модуль → конфиг → утилиты → загрузка JSON →
            рендер карточек → dropdown → поиск → выбор сети →
            копирование → отправка формы → toast → тема → init

   CSP-safe: никаких eval/new Function, никаких inline-стилей
   через element.style.* и document.body.style — только классы,
   setAttribute и служебные CSS custom properties.
   ============================================================ */

"use strict";

/* ============================================================
   I18N — единый модуль локализации (namespace window.i18n)
   - словари locales/<lang>.json, fallback — ru;
   - язык: localStorage("cp-lang") > navigator.language > "ru"
     (в разметке по умолчанию — русский);
   - перевод статичной разметки через data-i18n / data-i18n-attr;
   - динамический контент строится через i18n.t(key, vars);
   - подписка на смену языка: i18n.onChange(fn) — UI перерисовывается.
   ============================================================ */
const i18n = (() => {
  const LANGS = ["ru", "en", "zh", "ja", "es", "de"]; // первый — язык по умолчанию в разметке
  const FALLBACK = "ru";
  const STORAGE_KEY = "cp-lang";
  const INTL = { ru: "ru-RU", en: "en-US", zh: "zh-CN", ja: "ja-JP", es: "es-ES", de: "de-DE" };
  const NAMES = { ru: "Русский", en: "English", zh: "中文", ja: "日本語", es: "Español", de: "Deutsch" };

  let dict = {};                 // активный словарь
  let current = FALLBACK;        // активный язык
  const cache = new Map();       // lang -> словарь (один запрос на язык)
  const listeners = new Set();   // подписчики смены языка

  /* Плоский доступ к ключу "toast.copied" + подстановка {плейсхолдеров} */
  function lookup(obj, dotted, vars) {
    let cur = obj;
    for (const p of String(dotted).split(".")) {
      if (cur && typeof cur === "object" && p in cur) cur = cur[p];
      else return null;
    }
    if (typeof cur !== "string") return null;
    if (!vars) return cur;
    return cur.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  async function fetchDict(lang) {
    if (cache.has(lang)) return cache.get(lang);
    try {
      const r = await fetch(`locales/${lang}.json`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      cache.set(lang, json);
      return json;
    } catch (e) {
      console.warn(`[i18n] не удалось загрузить словарь «${lang}»:`, e);
      cache.set(lang, null);
      return null;
    }
  }

  /* Переводит статичную разметку: текст, атрибуты, title, html lang */
  function applyDom(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const text = lookup(dict, el.dataset.i18n) ?? lookup(cache.get(FALLBACK) || {}, el.dataset.i18n);
      if (text != null) el.textContent = text;
    });
    root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.dataset.i18nAttr.split(";").map((s) => s.trim()).filter(Boolean).forEach((pair) => {
        const idx = pair.indexOf(":");
        if (idx < 0) return;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        const val = lookup(dict, key) ?? lookup(cache.get(FALLBACK) || {}, key);
        if (val == null) return;
        if (attr === "content") {
          el.setAttribute("content", val);
        } else if (attr === "title" && document.title) {
          document.title = val;
        } else {
          el.setAttribute(attr, val);
        }
      });
    });
    const t = lookup(dict, "html.title");
    if (t) document.title = t;
    document.documentElement.lang = current;
  }

  async function setLang(lang) {
    if (!LANGS.includes(lang)) lang = FALLBACK;
    let d = await fetchDict(lang);
    if (!d && lang !== FALLBACK) d = await fetchDict(FALLBACK);
    if (!d) d = {};
    current = lang;
    dict = d;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    applyDom();
    listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
    return lang;
  }

  return {
    LANGS,
    names: NAMES,
    locale: () => INTL[current] || undefined,
    get lang() { return current; },
    /** Перевод по ключу "a.b.c" с подстановкой {vars}; fallback — en, затем сам ключ */
    t(key, vars) {
      return lookup(dict, key, vars)
          ?? lookup(cache.get(FALLBACK) || {}, key, vars)
          ?? key;
    },
    setLang,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Язык из localStorage / браузера (или дефолт разметки — ru) */
    detect() {
      let saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
      if (saved && LANGS.includes(saved)) return saved;
      const nav = (navigator.language || "ru").slice(0, 2).toLowerCase();
      return LANGS.includes(nav) ? nav : FALLBACK;
    },
    /** Инициализация: загрузить словарь и перевести статику */
    async init() { await setLang(this.detect()); },
  };
})();

window.i18n = i18n; // внешний API для остальных модулей

/* ============================================================
   КОНФИГУРАЦИЯ — замени значения на свои!
   ============================================================ */

/** URL бэкенда для уведомлений об оплате (POST {network, amount, comment, address}) */
const NOTIFY_API_URL = "https://api.mydomain.com/crypto-notify";

/** Путь к данным кошельков (относительно корня сайта на GitHub Pages) */
const ADDRESSES_URL = "crypto/addresses.json";

/** Таймаут сетевого запроса к бэкенду, мс */
const REQUEST_TIMEOUT_MS = 15000;

/* ============================================================
   СОСТОЯНИЕ ПРИЛОЖЕНИЯ
   ============================================================ */
const state = {
  networks: [],       // исходный массив из addresses.json
  selected: null,     // выбранная сеть (объект)
  tier: "all",        // активный фильтр по типу
  query: "",          // строка поиска
  loading: false,
  loadError: null,    // текст ошибки загрузки или null
};

/* ---------- Короткие ссылки на DOM ---------- */
const $ = (sel) => document.querySelector(sel);
const els = {
  statusDot: $("#statusDot"),
  statusText: $("#statusText"),
  statNetworks: $("#statNetworks"),
  cardsGrid: $("#cardsGrid"),
  cardTemplate: $("#cardTemplate"),
  searchInput: $("#searchInput"),
  resultCount: $("#resultCount"),
  tierChips: $("#tierChips"),
  dropdown: $("#networkDropdown"),
  dropdownToggle: $("#dropdownToggle"),
  dropdownLabel: $("#dropdownLabel"),
  dropdownMenu: $("#dropdownMenu"),
  payPanel: $("#payPanel"),
  paymentPlaceholder: $("#paymentPlaceholder"),
  payLogo: $("#payLogo"),
  payName: $("#payName"),
  payCode: $("#payCode"),
  payQr: $("#payQr"),
  qrFrame: $("#qrFrame"),
  addressBox: $("#addressBox"),
  copyBtn: $("#copyBtn"),
  copyBtnText: $("#copyBtnText"),
  notifyForm: $("#notifyForm"),
  amountInput: $("#amountInput"),
  commentInput: $("#commentInput"),
  submitBtn: $("#submitBtn"),
  submitLabel: $("#submitLabel"),
  toastContainer: $("#toastContainer"),
  themeToggle: $("#themeToggle"),
  clockTicker: $("#clockTicker"),
  scrollProgress: $("#scrollProgress"),
  carousel: $("#carousel"),
  carouselPrev: $("#carouselPrev"),
  carouselNext: $("#carouselNext"),
  carouselThumb: $("#carouselThumb"),
  langSwitch: $("#langSwitch"),
  year: $("#year"),
  modal: $("#qrModal"),
  modalBackdrop: $("#qrModalBackdrop"),
  modalClose: $("#qrModalClose"),
  modalImg: $("#qrModalImg"),
  modalTitle: $("#qrModalTitle"),
  modalCopy: $("#qrModalCopy"),
  modalCoin: $("#qrModalCoin"),
};

/* ============================================================
   УТИЛИТЫ
   ============================================================ */

/** Экранирование текста для безопасного попадания в innerHTML */
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Дебаунт: функция срабатывает через `wait` мс после последнего вызова */
function debounce(fn, wait = 160) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

/** Приводит относительный путь из JSON к пути от корня сайта (для GitHub Pages) */
function sitePath(p) {
  if (!p) return "";
  if (/^(https?:)?\/\//i.test(p) || p.startsWith("data:") || p.startsWith("blob:")) return p;
  const base = document.baseURI || location.href;
  try { return new URL(p.replace(/^\/+/, ""), base).href; } catch (_) { return p; }
}

/** Извлекает чистое имя монеты из названия сети: "USDT TRC20" -> "USDT" */
function coinOf(networkName) {
  const parts = String(networkName || "").trim().split(/\s+/);
  return (parts[0] || networkName || "").toUpperCase();
}

/** Возвращает тир (цвет) сети: из JSON, иначе — эвристика по имени */
function tierOf(net) {
  const raw = net.tier || net.category || net.group || "";
  const known = ["core", "evm", "l1", "privacy", "meme"];
  if (known.includes(raw)) return raw;
  const n = String(net.network).toUpperCase();
  if (/XMR|ZEC|DASH|STEALTH/i.test(n)) return "privacy";
  if (/DOGE|SHIB|PEPE|WIF|BONK|FLOKI|MEME|TRUMP/i.test(n)) return "meme";
  if (/BSC|POLYGON|ARBITRUM|OPTIMISM|BASE|AVAX|FANTOM|TRON|HECO|LINEA|SCROLL|ZKSYNC/i.test(n)) return "evm";
  if (/BTC|LTC|DOGE-BTC|BITCOIN|USD/i.test(n)) return "core";
  return "l1";
}

/** Форматирование числа с разделителями тысяч в активной локали */
function fmtInt(n) {
  return new Intl.NumberFormat(i18n.locale()).format(n);
}

/** Count-up анимация числа в элементе */
function countUp(el, target, duration = 900) {
  const start = performance.now();
  function frame(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.textContent = fmtInt(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ============================================================
   TOAST — стильные всплывающие уведомления
   type: success | error | info
   ============================================================ */
const ICONS = { success: "✓", error: "✕", info: "⚡" };

/**
 * Длительность toast задаётся классом (.toast--4s / --6s),
 * а НЕ inline-стилем: страница работает под строгой CSP.
 */
function toast(message, type = "info", duration = 3600) {
  const secs = duration <= 2500 ? 3 : duration <= 4500 ? 5 : 7;
  const el = document.createElement("div");
  el.className = `toast toast--${type} toast--${secs}s`;
  el.innerHTML = `<span class="toast__icon" aria-hidden="true">${ICONS[type] || ICONS.info}</span><span>${esc(message)}</span>`;
  els.toastContainer.appendChild(el);

  // Авто-скрытие с fade-out
  setTimeout(() => {
    el.classList.add("is-hiding");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, duration);

  // Клик по toast — закрыть сразу
  el.addEventListener("click", () => el.remove());
}

/* ============================================================
   СТАТУС-БАР (загрузка / онлайн / ошибка)
   ============================================================ */
function setStatus(kind, textKey) {
  els.statusDot.className = `status-dot status-dot--${kind}`;
  els.statusText.textContent = i18n.t(textKey);
}

/* ============================================================
   ЗАГРУЗКА ДАННЫХ: fetch('crypto/addresses.json')
   ============================================================ */
async function loadNetworks() {
  state.loading = true;
  state.loadError = null;
  setStatus("loading", "status.loading");
  renderSkeletons(6);

  try {
    const res = await fetch(ADDRESSES_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new TypeError("bad data");
    }

    state.networks = data.map((raw, i) => ({
      id: i,
      network: String(raw.network || raw.name || `#${i}`),
      address: String(raw.address || raw.wallet || ""),
      logo: sitePath(raw.logo || ""),
      qr: sitePath(raw.qr || ""),
      tier: tierOf(raw),
    }));

    state.loading = false;
    setStatus("ok", "status.online");
    els.statNetworks.textContent = "0";
    countUp(els.statNetworks, state.networks.length);

    buildTierChips();
    renderAll();
  } catch (err) {
    console.error("[CryptoPulse] Ошибка загрузки данных:", err);
    state.loading = false;
    state.loadError = err instanceof TypeError ? i18n.t("errors.badData") : i18n.t("errors.loadFailed");
    setStatus("error", "errors.checkConnection");
    renderLoadError();
    toast(state.loadError, "error", 6000);
  }
}

/** Скелетоны на время загрузки */
function renderSkeletons(count) {
  const track = els.cardsGrid;
  clearTrack();
  const tpl = `
    <div class="skeleton-card">
      <span class="skeleton skeleton--circle"></span>
      <span class="skeleton skeleton--line"></span>
      <span class="skeleton skeleton--line skeleton--short"></span>
    </div>`;
  track.insertAdjacentHTML("beforeend", tpl.repeat(count));
}

/** Удаляет всё содержимое карусели (кроме <template>) */
function clearTrack() {
  [...els.cardsGrid.children].forEach((ch) => {
    if (ch.tagName.toLowerCase() !== "template") ch.remove();
  });
}

/** Сообщение об ошибке загрузки внутри карусели */
function renderLoadError() {
  clearTrack();
  els.cardsGrid.insertAdjacentHTML("beforeend", `
    <div class="track-message">
      <span class="payment__placeholder-icon" aria-hidden="true">⚠</span>
      <strong>${esc(i18n.t("errors.loadFailed"))}</strong>
      <span>${esc(i18n.t("errors.checkConnection"))}</span>
      <button class="btn btn--ghost" type="button" data-action="retry">${esc(i18n.t("errors.retry"))}</button>
    </div>`);
  els.cardsGrid.querySelector('[data-action="retry"]').addEventListener("click", loadNetworks);
  updateCarouselChrome();
}

/** Пустой результат поиска */
function renderEmpty() {
  clearTrack();
  els.cardsGrid.insertAdjacentHTML("beforeend", `
    <div class="track-message">
      <span class="payment__placeholder-icon" aria-hidden="true">∅</span>
      <strong>${esc(i18n.t("errors.empty"))}</strong>
    </div>`);
  updateCarouselChrome();
}

/* ============================================================
   ФИЛЬТРЫ: чипы типов сетей
   ============================================================ */
const TIER_ORDER = ["core", "evm", "l1", "privacy", "meme"];

function buildTierChips() {
  const counts = { all: state.networks.length };
  state.networks.forEach((n) => { counts[n.tier] = (counts[n.tier] || 0) + 1; });

  const chips = [{ key: "all", label: i18n.t("ui.tier.all") }]
    .concat(TIER_ORDER.filter((t) => counts[t]).map((t) => ({ key: t, label: i18n.t(`ui.tier.${t}`) })));

  els.tierChips.innerHTML = chips
    .map((c) => `<button class="chip${state.tier === c.key ? " is-active" : ""}" type="button" data-tier="${c.key}">${esc(c.label)}${c.key !== "all" && counts[c.key] ? ` <small>${counts[c.key]}</small>` : ""}</button>`)
    .join("");
}

els.tierChips.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  state.tier = chip.dataset.tier;
  els.tierChips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c === chip));
  renderAll();
});

/* ============================================================
   ПОИСК
   ============================================================ */
const onSearch = debounce(() => {
  state.query = els.searchInput.value.trim().toLowerCase();
  renderAll();
}, 140);

els.searchInput.addEventListener("input", onSearch);

/* Хоткей "/" — фокус на поиск (как в терминалах) */
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) {
    e.preventDefault();
    els.searchInput.focus();
  }
  if (e.key === "Escape") {
    closeDropdown();
    closeModal();
  }
});

/* ============================================================
   РЕНДЕР: карточки + dropdown (учитывают фильтр и поиск)
   ============================================================ */
function filteredNetworks() {
  return state.networks.filter((n) => {
    const okTier = state.tier === "all" || n.tier === state.tier;
    const q = state.query;
    const okQuery = !q || n.network.toLowerCase().includes(q) || coinOf(n.network).toLowerCase().includes(q);
    return okTier && okQuery;
  });
}

function renderAll() {
  const list = filteredNetworks();
  renderCards(list);
  renderDropdownItems(list);
  els.resultCount.textContent = list.length === state.networks.length
    ? `${fmtInt(list.length)} ${i18n.t("ui.networksUnit")}`
    : i18n.t("ui.shownOf", { shown: fmtInt(list.length), total: fmtInt(state.networks.length) });
}

function renderCards(list) {
  clearTrack();
  if (!list.length) { renderEmpty(); return; }

  const frag = document.createDocumentFragment();
  list.forEach((net, i) => {
    const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = net.id;
    node.setAttribute("aria-label", i18n.t("html.cardSelectAria", { network: net.network }));
    node.style.setProperty("--delay", `${Math.min(i, 10) * 40}ms`);

    const logo = node.querySelector(".card__logo");
    logo.src = net.logo;
    logo.alt = net.network;
    logo.addEventListener("error", () => logo.classList.add("is-missing"));

    const tierEl = node.querySelector(".card__tier");
    tierEl.dataset.tier = net.tier;
    tierEl.textContent = i18n.t(`ui.tier.${net.tier}`);

    node.querySelector(".card__name").textContent = coinOf(net.network);
    node.querySelector(".card__code").textContent = net.network.toUpperCase().replace(coinOf(net.network), "").trim() || net.network.toUpperCase();
    node.querySelector(".card__select").textContent = i18n.t("ui.select");

    if (state.selected && state.selected.id === net.id) node.classList.add("is-selected");
    frag.appendChild(node);
  });

  els.cardsGrid.appendChild(frag);

  // Появление карточек через IntersectionObserver
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); }
    });
  }, { root: els.cardsGrid, threshold: 0.15 });
  els.cardsGrid.querySelectorAll(".card").forEach((c) => io.observe(c));

  updateCarouselChrome();
}

/* ---------- Клик / Enter по карточке → выбрать сеть ---------- */
els.cardsGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) selectNetwork(Number(card.dataset.id));
});
els.cardsGrid.addEventListener("keydown", (e) => {
  const card = e.target.closest(".card");
  if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selectNetwork(Number(card.dataset.id)); }
});

/* Glow-подсветка карточки следует за курсором (CSS custom props) */
els.cardsGrid.addEventListener("pointermove", (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - rect.left}px`);
  card.style.setProperty("--my", `${e.clientY - rect.top}px`);
});

/* ============================================================
   КАРУСЕЛЬ: стрелки, drag-скролл, мини-скроллбар
   ============================================================ */
function scrollTrack(dir) {
  els.cardsGrid.scrollBy({ left: dir * Math.max(els.cardsGrid.clientWidth * 0.8, 320), behavior: "smooth" });
}
els.carouselPrev.addEventListener("click", () => scrollTrack(-1));
els.carouselNext.addEventListener("click", () => scrollTrack(1));

function updateCarouselChrome() {
  const t = els.cardsGrid;
  const overflow = t.scrollWidth > t.clientWidth + 4;
  els.carouselPrev.classList.toggle("is-disabled", !overflow || t.scrollLeft <= 4);
  els.carouselNext.classList.toggle("is-disabled", !overflow || t.scrollLeft >= t.scrollWidth - t.clientWidth - 4);
  updateThumb();
}

function updateThumb() {
  const t = els.cardsGrid;
  if (!els.carouselThumb) return;
  const ratio = t.clientWidth / Math.max(t.scrollWidth, 1);
  const w = Math.max(ratio, 0.08);
  // Позиция и размер ползунка — через CSS custom properties (CSP-safe)
  els.carouselThumb.style.setProperty("--tw", `${w * 100}%`);
  const maxScroll = Math.max(t.scrollWidth - t.clientWidth, 1);
  els.carouselThumb.style.setProperty("--tx", `${(t.scrollLeft / maxScroll) * (100 - w * 100)}%`);
}

els.cardsGrid.addEventListener("scroll", () => requestAnimationFrame(updateCarouselChrome), { passive: true });
window.addEventListener("resize", debounce(updateCarouselChrome, 120));

/* Drag мышью как в нативных каруселях */
(() => {
  const track = els.cardsGrid;
  let down = false, startX = 0, startLeft = 0, moved = false;
  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return;
    down = true; moved = false;
    startX = e.clientX; startLeft = track.scrollLeft;
    track.classList.add("is-dragging");
  });
  window.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) moved = true;
    track.scrollLeft = startLeft - dx;
  });
  window.addEventListener("pointerup", () => {
    if (!down) return;
    down = false;
    track.classList.remove("is-dragging");
  });
  // После драга подавляем "ложный" клик по карточке
  track.addEventListener("click", (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
})();

/* ============================================================
   DROPDOWN (combobox) — стильный выпадающий список
   ============================================================ */
function renderDropdownItems(list) {
  els.dropdownMenu.innerHTML = list.map((net) => `
    <li class="dropdown__item" role="option" tabindex="-1" data-id="${net.id}"
        aria-selected="${state.selected && state.selected.id === net.id}">
      <img src="${esc(net.logo)}" alt="" loading="lazy">
      <b>${esc(coinOf(net.network))}</b>
      <span>${esc(net.network)}</span>
    </li>`).join("");
}

function openDropdown() {
  els.dropdown.classList.add("is-open");
  els.dropdownToggle.setAttribute("aria-expanded", "true");
}
function closeDropdown() {
  els.dropdown.classList.remove("is-open");
  els.dropdownToggle.setAttribute("aria-expanded", "false");
}

els.dropdownToggle.addEventListener("click", () => {
  els.dropdown.classList.contains("is-open") ? closeDropdown() : openDropdown();
});

els.dropdownMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".dropdown__item");
  if (!item) return;
  selectNetwork(Number(item.dataset.id));
  closeDropdown();
});

document.addEventListener("click", (e) => {
  if (!els.dropdown.contains(e.target)) closeDropdown();
});

/* Клавиатура: стрелки по опциям, Enter — выбрать */
els.dropdown.addEventListener("keydown", (e) => {
  const items = [...els.dropdownMenu.querySelectorAll(".dropdown__item")];
  if (!items.length) return;
  const active = document.activeElement;
  let idx = items.indexOf(active);
  if (e.key === "ArrowDown") { e.preventDefault(); openDropdown(); items[Math.min(idx + 1, items.length - 1)]?.focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(idx - 1, 0)]?.focus(); }
  else if (e.key === "Enter" && active.classList.contains("dropdown__item")) { e.preventDefault(); active.click(); els.dropdownToggle.focus(); }
});

/* ============================================================
   ВЫБОР СЕТИ → обновление блока оплаты
   ============================================================ */
function selectNetwork(id) {
  const net = state.networks.find((n) => n.id === id);
  if (!net) return;
  state.selected = net;

  // Подсветка карточки и пункт дропдауна
  els.cardsGrid.querySelectorAll(".card").forEach((c) => c.classList.toggle("is-selected", Number(c.dataset.id) === id));
  els.dropdownMenu.querySelectorAll(".dropdown__item").forEach((li) => {
    const sel = Number(li.dataset.id) === id;
    li.setAttribute("aria-selected", String(sel));
  });

  // Лейбл дропдауна: КОИН + сеть
  els.dropdownLabel.innerHTML = `${esc(coinOf(net.network))} <span class="dropdown__label-code">${esc(net.network)}</span>`;

  // Панель оплаты
  els.paymentPlaceholder.hidden = true;
  els.payPanel.hidden = false;

  els.payLogo.src = net.logo;
  els.payLogo.alt = net.network;
  els.payName.textContent = net.network;
  els.payCode.textContent = net.tier ? i18n.t(`ui.tier.${net.tier}`) : "";

  els.payQr.classList.add("is-loading");
  els.payQr.src = net.qr;
  els.payQr.alt = `${i18n.t("html.qrAltPrefix")} ${net.network}`;
  els.payQr.addEventListener("load", () => els.payQr.classList.remove("is-loading"), { once: true });
  els.payQr.addEventListener("error", () => els.payQr.classList.remove("is-loading"), { once: true });

  els.addressBox.value = net.address;

  // Модалка тоже знает про текущую сеть
  els.modalTitle.textContent = net.network;
  els.modalCoin.textContent = coinOf(net.network);

  toast(`${i18n.t("toast.selected")}: ${net.network}`, "success", 2400);

  // Мягко подводим к блоку реквизитов (без рывка на мобильных)
  const y = els.payPanel.getBoundingClientRect().top + window.scrollY - 90;
  window.scrollTo({ top: y, behavior: "smooth" });
}

/* ============================================================
   КОПИРОВАНИЕ АДРЕСА (с визуальным подтверждением)
   ============================================================ */
async function copyAddress(source) {
  const net = state.selected;
  if (!net || !net.address) { toast(i18n.t("errors.noAddress"), "error"); return; }

  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(net.address);
      ok = true;
    } else {
      // Fallback для http/старых браузеров: временная textarea + execCommand
      const ta = document.createElement("textarea");
      ta.value = net.address;
      ta.setAttribute("readonly", "");
      ta.className = "visually-hidden-copy";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
  } catch (e) {
    console.warn("[CryptoPulse] Clipboard API недоступен:", e);
  }

  if (ok) {
    toast(i18n.t("toast.copied"), "success", 2200);
    flashCopied(source);
  } else {
    toast(i18n.t("errors.copyFailed"), "error", 4200);
  }
}

/** Визуальное подтверждение: галочка + зелёная кнопка на 1.8 c */
let copyTimer = null;
function flashCopied(source) {
  const btn = source === "modal" ? els.modalCopy : els.copyBtn;
  const original = els.copyBtnText.textContent;
  els.copyBtn.classList.add("is-copied");
  els.copyBtnText.textContent = i18n.t("html.copiedBtn");
  if (source === "modal") btn.classList.add("is-copied");
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    els.copyBtn.classList.remove("is-copied");
    els.copyBtnText.textContent = original;
    btn.classList.remove("is-copied");
  }, 1800);
}

els.copyBtn.addEventListener("click", () => copyAddress("panel"));
els.modalCopy.addEventListener("click", () => copyAddress("modal"));

/* ============================================================
   МОДАЛКА QR (увеличение при клике)
   ============================================================ */
function openModal() {
  if (!state.selected) return;
  els.modalImg.src = state.selected.qr;
  els.modalImg.alt = `${i18n.t("html.qrAltPrefix")} ${state.selected.network}`;
  els.modalTitle.textContent = state.selected.network;
  els.modalCoin.textContent = coinOf(state.selected.network);
  els.modal.hidden = false;
  document.documentElement.classList.add("no-scroll");
  els.modalClose.focus();
}
function closeModal() {
  if (els.modal.hidden) return;
  els.modal.hidden = true;
  document.documentElement.classList.remove("no-scroll");
}

els.qrFrame.addEventListener("click", openModal);
els.qrFrame.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(); } });
els.modalClose.addEventListener("click", closeModal);
els.modalBackdrop.addEventListener("click", closeModal);

/* ============================================================
   ФОРМА «Я ОПЛАТИЛ» → POST {network, amount, comment, address}
   ============================================================ */
els.notifyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const net = state.selected;

  if (!net) { toast(i18n.t("errors.selectFirst"), "error"); return; }

  const rawAmount = els.amountInput.value.trim();
  const amount = rawAmount === "" ? null : Number(rawAmount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    els.amountInput.classList.add("input--invalid");
    toast(i18n.t("errors.positiveAmount"), "error");
    return;
  }
  els.amountInput.classList.remove("input--invalid");

  const payload = {
    network: net.network,
    amount: amount,                       // null, если не указана
    comment: els.commentInput.value.trim(),
    address: net.address,
  };

  setLoading(true);
  try {
    // AbortController = кросс-браузерный таймаут запроса
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(NOTIFY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    toast(i18n.t("toast.sent"), "success", 5000);
    els.notifyForm.reset();
  } catch (err) {
    console.error("[CryptoPulse] Ошибка отправки:", err);
    const msg = err.name === "AbortError" ? i18n.t("errors.timeout") : i18n.t("errors.sendFailed");
    toast(msg, "error", 5200);
  } finally {
    setLoading(false);
  }
});

/** Состояние кнопки «отправка…»: спиннер + блокировка */
function setLoading(on) {
  els.submitBtn.disabled = on;
  els.submitBtn.classList.toggle("is-loading", on);
  els.submitLabel.textContent = on ? i18n.t("html.sendingBtn") : i18n.t("html.submitBtn");
}

/* ============================================================
   ТЕМА (тёмная по умолчанию ↔ светлая) + БЛОКИРОВКА СКРОЛЛА
   ============================================================ */
const THEME_KEY = "cp-theme";

/* Скролл страницы блокируется, когда открыта модалка (класс на <html>) */
document.documentElement.classList.toggle("no-scroll", !els.modal.hidden);

function applyTheme(theme, animate = false) {
  if (animate) document.body.classList.add("cp-theme-anim");
  document.documentElement.dataset.theme = theme;
  els.themeToggle.setAttribute("aria-checked", String(theme === "light"));
  els.themeToggle.setAttribute("aria-label", i18n.t(theme === "light" ? "html.themeToDark" : "html.themeToLight"));
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
}

els.themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next, true);
  setTimeout(() => document.body.classList.remove("cp-theme-anim"), 600);
});

/* ============================================================
   ЧАСЫ в статус-баре + прогресс скролла + footer year
   ============================================================ */
function tickClock() {
  els.clockTicker.textContent = new Date().toLocaleTimeString(i18n.locale(), { hour12: false });
}

function onScrollProgress() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;
  const p = max > 0 ? (doc.scrollTop / max) * 100 : 0;
  // CSP-safe: ширина полосы — через CSS custom property, не inline-стиль
  els.scrollProgress.style.setProperty("--p", `${p}%`);
}

/* ============================================================
   ПЕРЕКЛЮЧАТЕЛЬ ЯЗЫКА + ГОД В ФУТЕРЕ
   ============================================================ */

/** Подставляет текущий год в строки футера вида "© {year}" */
function fillYear() {
  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = el.getAttribute("data-year").replace("{year}", String(new Date().getFullYear()));
  });
}

els.langSwitch.addEventListener("click", async (e) => {
  const btn = e.target.closest(".lang-btn");
  if (!btn || btn.classList.contains("is-active")) return;
  await i18n.setLang(btn.dataset.lang);
});

function syncLangButtons() {
  els.langSwitch.querySelectorAll(".lang-btn").forEach((b) => {
    const active = b.dataset.lang === i18n.lang;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-pressed", String(active));
  });
}

/* При смене языка перерисовываем весь динамический UI */
i18n.onChange(() => {
  syncLangButtons();
  fillYear();
  els.themeToggle.setAttribute("aria-label", i18n.t(document.documentElement.dataset.theme === "light" ? "html.themeToDark" : "html.themeToLight"));
  if (state.loadError) { setStatus("error", "errors.checkConnection"); renderLoadError(); return; }
  if (!state.networks.length) return;
  buildTierChips();
  renderAll();
  if (state.selected) {
    els.payCode.textContent = i18n.t(`ui.tier.${state.selected.tier}`);
    els.payQr.alt = `${i18n.t("html.qrAltPrefix")} ${state.selected.network}`;
    els.dropdownLabel.innerHTML = `${esc(coinOf(state.selected.network))} <span class="dropdown__label-code">${esc(state.selected.network)}</span>`;
  }
  setStatus(state.loadError ? "error" : "ok", state.loadError ? "errors.checkConnection" : "status.online");
});

/* ============================================================
   SCROLL REVEAL для секций
   ============================================================ */
function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

/* ============================================================
   INIT
   ============================================================ */
(async function init() {
  // Тема до первого paint-перехода
  let savedTheme = "dark";
  try { savedTheme = localStorage.getItem(THEME_KEY) || "dark"; } catch (_) {}
  applyTheme(savedTheme === "light" ? "light" : "dark", false);

  // Год в футере
  fillYear();

  // Локализация (RU default) + UI
  await i18n.init();
  syncLangButtons();

  // Живые элементы
  tickClock();
  setInterval(tickClock, 1000);
  window.addEventListener("scroll", onScrollProgress, { passive: true });
  onScrollProgress();
  initReveal();

  // Данные кошельков
  await loadNetworks();
})();
