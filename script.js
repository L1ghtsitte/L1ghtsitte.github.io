/* ============================================================
   CRYPTO PULSE — логика донат-терминала (Vanilla JS)
   Порядок: конфиг → утилиты → загрузка JSON → рендер карточек
            → dropdown → поиск → выбор сети → копирование
            → отправка формы → toast → тема → init
   ============================================================ */

"use strict";

/* ---------- 1. КОНФИГУРАЦИЯ ---------- */

/* URL бэкенда для уведомлений об оплате. */
const NOTIFY_API_URL = "https://donati77.mooo.com/api/crypto-notify";

/* Путь к данным с адресами. 
   ВНИМАНИЕ: Убедитесь, что файл лежит по пути crypto/addresses.json 
   (или измените имя файла здесь, если у вас adresses.json без двойной s) */
const DATA_URL = "crypto/addresses.json";

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
 * Безопасное экранирование HTML.
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
 */
function setStatus(type, text) {
  dom.statusDot.className = "status-dot status-dot--" + type;
  dom.statusText.textContent = text;
}

/**
 * Стильные всплывающие toast-уведомления.
 */
function showToast(message, type = "info", duration = 3500) {
  const icons = { success: "✔", error: "✖", info: "ℹ" };

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span class="toast__icon">${icons[type]}</span><span>${escapeHtml(message)}</span>`;
  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("is-hiding");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, duration);
}

/**
 * Fetch с таймаутом через AbortController.
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
 * Асинхронно подгружает JSON со списком сетей и запускает рендер.
 */
async function loadNetworks() {
  state.loading = true;
  setStatus("loading", "Загрузка данных сетей…");

  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: не удалось загрузить ${DATA_URL}`);
    }

    const data = await response.json();

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
      tier: String(net.tier ?? "l1"), // тир сети для группировки карточек
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
    // Клонируем карточку из <template>
    const node = dom.cardTemplate.content.cloneNode(true);
    const card = node.querySelector(".card");

    card.dataset.id = net.id;
    card.setAttribute("aria-label", `Выбрать сеть ${net.name}`);

    const logo = node.querySelector(".card__logo");
    if (net.img) {
      logo.src = net.img;
      logo.alt = `Логотип ${net.name}`;
    } else {
      logo.remove();
    }

    node.querySelector(".card__name").textContent = net.name;
    node.querySelector(".card__code").textContent = net.code;

    // Бейдж тира сети (CORE / EVM / L1 / PRIVACY / MEME)
    const TIER_LABELS = { core: "CORE", evm: "EVM", l1: "L1", privacy: "PRIVACY", meme: "MEME" };
    const badge = node.querySelector(".card__tier");
    if (badge) {
      badge.textContent = TIER_LABELS[net.tier] ?? "L1";
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

  // Плавная прокрутка к панели
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
 * Копирует адрес в буфер обмена.
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
      // Fallback для старых браузеров
      dom.addressBox.select();
      copied = document.execCommand("copy");
      window.getSelection()?.removeAllRanges();
    }
  } catch (err) {
    console.error("[CryptoPulse] Ошибка копирования:", err);
    copied = false;
  }

  if (copied) {
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
 */
function validateForm() {
  let valid = true;
  const rawAmount = dom.amountInput.value.trim();

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
 * Отправка POST-запроса на бэкенд.
 */
async function submitNotification(event) {
  event.preventDefault();

  if (!validateForm()) return;

  const payload = {
    network: state.selected.code,
    amount:  dom.amountInput.value.trim() === ""
               ? null
               : Number(dom.amountInput.value.trim()),
    comment: dom.commentInput.value.trim(),
    address: state.selected.address,
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
    dom.submitBtn.disabled = false;
    dom.submitBtn.classList.remove("is-loading");
    label.textContent = originalLabel;
  }
}

dom.notifyForm.addEventListener("submit", submitNotification);

/* ---------- 12. ПЕРЕКЛЮЧАТЕЛЬ ТЕМЫ ---------- */

function applySavedTheme() {
  const saved = localStorage.getItem("cp-theme");
  if (saved === "light") document.documentElement.setAttribute("data-theme", "light");
}

dom.themeToggle.addEventListener("click", () => {
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

function init() {
  applySavedTheme();
  dom.year.textContent = new Date().getFullYear();
  loadNetworks();
}

document.addEventListener("DOMContentLoaded", init);
