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
<<<<<<< HEAD
const NOTIFY_API_URL = "https://donati77.mooo.com/api/crypto-notify"; // домен контейнера (nginx -> FastAPI /api/crypto-notify)

/* Пути к данным с адресами (по пробованы оба варианта имени файла).
   GitHub Pages отдаёт 404 для строк из README.md, поэтому основной вариант —
   чистый JSON-файл crypto/addresses.json; запасной — историческое имя
   "adresses.json" (без буквы s), которое ранее лежало в репозитории.
   Относительные пути работают и на GitHub Pages (/repo/), и локально. */
const DATA_URL_CANDIDATES = ["crypto/addresses.json", "crypto/adresses.json"];
=======
const NOTIFY_API_URL = "https://donati77.mooo.com/api/crypto-notify"; // путь совпадает с эндпоинтом из api/server.js

/* Путь к данным с адресами. Файл лежит в папке /crypto рядом с index.html.
   ВНИМАНИЕ: в репозитории файл называется "adresses.json" (без буквы s),
   а не "addresses.json", как в ТЗ — путь ниже соответствует реальному файлу. */
const DATA_URL = "crypto/addresses.json";
>>>>>>> 63f43d0742dca3c96b35d5d74933e2158c5854e5

/* Таймаут запроса к бэкенду, мс */
const REQUEST_TIMEOUT_MS = 15000;

/* ---------- 2. СОСТОЯНИЕ ПРИЛОЖЕНИЯ ---------- */
const state = {
  networks: [],      // массив сетей из JSON
  selected: null,    // выбранная сеть (объект из JSON)
  loading: false,    // идёт ли загрузка данных
};

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
  toastContainer:document.getElementById("toastContainer"),
  themeToggle:   document.getElementById("themeToggle"),
  year:          document.getElementById("year"),
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
 * @param {"loading"|"ok"|"error"} type
 * @param {string} text
 */
function setStatus(type, text) {
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
<<<<<<< HEAD
 * Пробует загрузить JSON по очереди из DATA_URL_CANDIDATES.
 * Возвращает первый успешный ответ; если все 404 — бросает ошибку.
 */
async function fetchNetworksJson() {
  let lastError = null;

  for (const url of DATA_URL_CANDIDATES) {
    try {
      const response = await fetch(url, { cache: "no-store" }); // no-store — чтобы свежий файл не кэшировался браузером

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}: ${url}`);
        continue; // пробуем следующий вариант имени файла
      }

      // GitHub Pages может отдать HTML-страницу 404 с кодом 200 (крайне редко),
      // поэтому дополнительно проверяем содержимое через response.json() ниже.
      return await response.json();
    } catch (error) {
      lastError = error; // сеть/битый JSON — пробуем следующий кандидат
    }
  }

  throw lastError ?? new Error("Не удалось загрузить данные сетей");
}

/**
=======
>>>>>>> 63f43d0742dca3c96b35d5d74933e2158c5854e5
 * Асинхронно подгружает JSON со списком сетей и запускает рендер.
 * Обрабатывает сетевые ошибки, HTTP-ошибки и битый JSON.
 */
async function loadNetworks() {
  state.loading = true;
  setStatus("loading", "Загрузка данных сетей…");

  try {
<<<<<<< HEAD
    const data = await fetchNetworksJson();
=======
    const response = await fetch(DATA_URL);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: не удалось загрузить ${DATA_URL}`);
    }

    const data = await response.json();
>>>>>>> 63f43d0742dca3c96b35d5d74933e2158c5854e5

    // Поддержка двух форматов: массив объектов OR объект вида { networks: [...] }
    const list = Array.isArray(data) ? data : (Array.isArray(data.networks) ? data.networks : null);

    if (!list || list.length === 0) {
      throw new Error("В файле addresses.json нет корректных данных");
    }

    // Нормализация: раскрываем относительные пути qr/img из корня /crypto
    state.networks = list.map((net) => ({
      id: net.id,
      code: String(net.code ?? ""),
      name: String(net.name ?? net.code ?? "Без названия"),
      address: String(net.address ?? ""),
      qr: net.qr ? `crypto/${String(net.qr).replace(/^\.?\//, "")}` : "",
      img: net.img ? `crypto/${String(net.img).replace(/^\.?\//, "")}` : "",
<<<<<<< HEAD
      tier: String(net.tier ?? "l1"), // тир сети для группировки карточек (core/evm/l1/privacy/meme)
=======
>>>>>>> 63f43d0742dca3c96b35d5d74933e2158c5854e5
    }));

    renderCards(state.networks);
    renderDropdownItems(state.networks);

    setStatus("ok", `ONLINE — загружено сетей: ${state.networks.length}`);
    showToast(`Список сетей обновлён (${state.networks.length})`, "info", 2500);
  } catch (error) {
    console.error("[CryptoPulse] Ошибка загрузки данных:", error);

    const isAbort = error.name === "AbortError";
    const message = isAbort
      ? "Превышено время ожидания ответа сервера"
      : "Не удалось загрузить список сетей";

    setStatus("error", "OFFLINE — ошибка загрузки данных");
    renderLoadError(message);
    showToast(`${message}. Проверь соединение и обнови страницу`, "error", 6000);
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
        ↻ Повторить загрузку
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
        Ничего не найдено. Попробуй другой запрос.
      </div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  list.forEach((net) => {
    // Клонируем карточку из <template> — быстрый и безопасный способ
    const node = dom.cardTemplate.content.cloneNode(true);
    const card = node.querySelector(".card");

    card.dataset.id = net.id;
    card.setAttribute("aria-label", `Выбрать сеть ${net.name}`);

    const logo = node.querySelector(".card__logo");
    if (net.img) {
      logo.src = net.img;
      logo.alt = `Логотип ${net.name}`;
    } else {
      logo.remove(); // если логотипа нет — не показываем битую картинку
    }

    node.querySelector(".card__name").textContent = net.name;
    node.querySelector(".card__code").textContent = net.code;

<<<<<<< HEAD
    // Бейдж тира сети (CORE / EVM / L1 / PRIVACY / MEME) — «прикольная» группировка
    const TIER_LABELS = { core: "CORE", evm: "EVM", l1: "L1", privacy: "PRIVACY", meme: "MEME" };
    const badge = node.querySelector(".card__tier");
    if (badge) {
      badge.textContent = TIER_LABELS[net.tier] ?? "L1";
      badge.dataset.tier = net.tier;
    }

=======
>>>>>>> 63f43d0742dca3c96b35d5d74933e2158c5854e5
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

/* ---------- 8. ЖИВОЙ ПОИСК ПО СЕТЯМ ---------- */
dom.searchInput.addEventListener("input", () => {
  const query = dom.searchInput.value.trim().toLowerCase();

  // Фильтр по коду, названию или адресу
  const filtered = state.networks.filter((net) =>
    net.code.toLowerCase().includes(query) ||
    net.name.toLowerCase().includes(query) ||
    net.address.toLowerCase().includes(query)
  );

  renderCards(filtered);
  renderDropdownItems(filtered);
});

/* ---------- 9. ВЫБОР СЕТИ -> ОБНОВЛЕНИЕ БЛОКА ОПЛАТЫ ---------- */

/**
 * Динамически заполняет панель: логотип, QR, адрес, подсветка карточки.
 * @param {Object} net - объект сети из state.networks
 */
function selectNetwork(net) {
  if (!net.address) {
    showToast(`Для сети ${net.name} адрес не настроен`, "error");
    return;
  }

  state.selected = net;

  // Синхронизируем label выпадающего списка
  dom.dropLabel.innerHTML = `${escapeHtml(net.name)} <span style="color:var(--cyan)">[${escapeHtml(net.code)}]</span>`;

  // Подсветка выбранной карточки в сетке
  dom.cardsGrid.querySelectorAll(".card").forEach((card) => {
    card.classList.toggle("is-selected", Number(card.dataset.id) === net.id);
  });

  // Заполняем панель оплаты
  dom.placeholder.hidden = true;
  dom.payPanel.hidden = false;

  if (net.img) {
    dom.payLogo.src = net.img;
    dom.payLogo.alt = `Логотип ${net.name}`;
    dom.payLogo.style.display = "";
  } else {
    dom.payLogo.style.display = "none";
  }

  dom.payName.textContent = net.name;
  dom.payCode.textContent = "// " + net.code;
  dom.payQr.src = net.qr || "";
  dom.payQr.alt = `QR-код для перевода в сеть ${net.name}`;
  dom.addressBox.value = net.address;

  // Сбрасываем состояние кнопки копирования
  resetCopyButton();

  // Плавная прокрутка к панели (если она уже за пределами экрана)
  const panelTop = dom.payPanel.getBoundingClientRect().top;
  if (panelTop < 0 || panelTop > window.innerHeight * 0.7) {
    dom.payPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  showToast(`Сеть ${net.name} выбрана`, "success", 2200);
}

/* ---------- 10. КОПИРОВАНИЕ АДРЕСА ---------- */

/** Возвращает кнопку копирования в исходное состояние */
function resetCopyButton() {
  dom.copyBtn.classList.remove("is-copied");
  dom.copyBtnText.textContent = "Копировать адрес";
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
    dom.copyBtnText.textContent = "✓ Скопировано!";
    showToast("Адрес скопирован в буфер обмена", "success", 2500);
    setTimeout(resetCopyButton, 2000);
  } else {
    showToast("Не удалось скопировать — выдели адрес вручную (Ctrl+C)", "error", 5000);
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
      showToast("Сумма должна быть положительным числом", "error");
      valid = false;
    }
  }

  if (!state.selected) {
    showToast("Сначала выбери сеть для доната", "error");
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
  label.textContent = "Отправка…";

  try {
    const response = await fetchWithTimeout(NOTIFY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Сервер ответил ${response.status}`);
    }

    // Успех: чистим поля формы, оставляем выбранную сеть
    showToast("Уведомление отправлено — спасибо за донат! ⚡", "success", 5000);
    dom.notifyForm.reset();
  } catch (error) {
    console.error("[CryptoPulse] Ошибка отправки уведомления:", error);

    const isAbort = error.name === "AbortError";
    showToast(
      isAbort
        ? "Сервер не отвечает (таймаут). Попробуй ещё раз позже"
        : `Не удалось отправить уведомление: ${error.message}`,
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

/* ---------- 13. ИНИЦИАЛИЗАЦИЯ ---------- */

/** Точка входа: запускается после полной загрузки DOM */
function init() {
  applySavedTheme();
  dom.year.textContent = new Date().getFullYear(); // год в подвале

  // Если данные уже есть в кеше браузера — fetch вернёт их мгновенно
  loadNetworks();
}

document.addEventListener("DOMContentLoaded", init);
