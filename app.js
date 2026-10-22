import {
  Client,
  Account,
  ID,
  Functions
} from 'https://cdn.jsdelivr.net/npm/appwrite@21.0.0/+esm';

// ==========================================
// НАСТРОЙКИ APPWRITE
// ==========================================

const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';

const APPWRITE_PROJECT_ID = '6ad75c6d0024af9d8bab';

const REWARDS_FUNCTION_ID = '6ad7690b002d25e9769e';

// ==========================================
// ПОДКЛЮЧЕНИЕ
// ==========================================

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

const account = new Account(client);

const fn = new Functions(client);

// ==========================================
// СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// ==========================================

let user = null;
let all = [];
let filter = 'Все';
let rewardProfile = null;

const $ = selector => document.querySelector(selector);

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================

function safe(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character])
  );
}

function show(selector, text) {
  const element = $(selector);

  if (element) {
    element.textContent = text;
  }
}

function message(text, error = false) {
  const element = $('#authMessage');

  if (!element) return;

  element.textContent = text;

  element.style.color = error
    ? '#ffb7ad'
    : '#d6bb7d';
}

// ==========================================
// НАВИГАЦИЯ
// ==========================================

function page(name) {
  document.querySelectorAll('.page').forEach(element => {
    element.classList.toggle(
      'shown',
      element.id === name
    );
  });

  document.querySelectorAll('nav button').forEach(element => {
    element.classList.toggle(
      'active',
      element.dataset.page === name
    );
  });

  window.scrollTo(0, 0);

  if (name === 'mycards') {
    drawInventory();
  }

  if (name === 'admin') {
    updateRewardsUI();
  }
}

document.querySelectorAll('[data-page]').forEach(element => {
  element.onclick = () => page(element.dataset.page);
});

document.querySelectorAll('[data-go]').forEach(element => {
  element.onclick = () => page(element.dataset.go);
});

// ==========================================
// МОДАЛЬНОЕ ОКНО
// ==========================================

const modal = $('#modal');

$('#close').onclick = () => modal.close();

// ==========================================
// РЕГИСТРАЦИЯ ПО ЛОГИНУ
// ==========================================

// Appwrite использует email для стандартной
// авторизации по паролю.
//
// Поэтому создаётся технический идентификатор.
// Игрок не вводит электронную почту.
//
// Это временное решение для текущей версии.
// Восстановление пароля по почте недоступно.

const LOGIN_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;

function emailForLogin(login) {
  return `${login}@players.hogwarts-card-duel.invalid`;
}

// ==========================================
// ФОРМА ВХОДА И РЕГИСТРАЦИИ
// ==========================================

function authForm(mode = 'login') {
  const registering = mode === 'register';

  $('#modalBody').innerHTML = `
    <h3>
      ${registering ? 'Регистрация' : 'Вход в Хогвартс'}
    </h3>

    <form id="authForm" class="auth-form">

      <label>
        Логин

        <input
          name="username"
          required
          minlength="3"
          maxlength="24"
          pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,23}"
          autocomplete="username"
          placeholder="Например, evitaluna"
        >
      </label>

      ${
        registering
          ? `
            <label>
              Игровой никнейм

              <input
                name="nickname"
                required
                maxlength="60"
                placeholder="Как тебя будут видеть другие"
              >
            </label>
          `
          : ''
      }

      <label>
        Пароль

        <input
          name="password"
          type="password"
          minlength="8"
          required
          autocomplete="${
            registering ? 'new-password' : 'current-password'
          }"
        >
      </label>

      ${
        registering
          ? `
            <label>
              Повторите пароль

              <input
                name="confirm"
                type="password"
                minlength="8"
                required
                autocomplete="new-password"
              >
            </label>
          `
          : ''
      }

      <button class="primary" type="submit">
        ${registering ? 'Создать аккаунт' : 'Войти'}
      </button>

    </form>

    <p class="auth-hint">
      Логин: 3–24 символа.
      Латинские буквы, цифры, _ или -.
      Электронная почта не нужна.
    </p>

    <p id="authMessage" role="status"></p>

    <button class="secondary" id="authSwitch">
      ${
        registering
          ? 'Уже есть аккаунт? Войти'
          : 'Нет аккаунта? Зарегистрироваться'
      }
    </button>
  `;

  $('#authSwitch').onclick = () => {
    authForm(registering ? 'login' : 'register');
  };

  $('#authForm').onsubmit = async event => {
    event.preventDefault();

    const form = event.currentTarget;

    const value = name => {
      return form.elements.namedItem(name).value;
    };

    const login = value('username')
      .trim()
      .toLowerCase();

    const password = value('password');

    const button = form.querySelector('[type=submit]');

    if (!LOGIN_RE.test(login)) {
      message(
        'Логин должен содержать 3–24 символа: латиницу, цифры, _ или -.',
        true
      );

      return;
    }

    button.disabled = true;

    message('Подождите…');

    try {
      const email = emailForLogin(login);

      if (registering) {
        if (password !== value('confirm')) {
          throw new Error('Пароли не совпадают');
        }

        const nickname = value('nickname').trim();

        if (!nickname) {
          throw new Error('Укажите игровой никнейм');
        }

        await account.create({
          userId: ID.unique(),
          email,
          password,
          name: nickname
        });

        await account.createEmailPasswordSession({
          email,
          password
        });

        await account.updatePrefs({
          prefs: {
            collectionPublic: false,
            login
          }
        });

      } else {
        await account.createEmailPasswordSession({
          email,
          password
        });
      }

      await refresh();

      modal.close();

      page('profile');

    } catch (error) {
      const text = String(error.message || '');

      let result = text;

      if (text.includes('already exists')) {
        result = 'Этот логин уже занят. Выбери другой.';
      }

      if (text.includes('Invalid email')) {
        result = 'Appwrite отклонил внутренний идентификатор.';
      }

      if (text.includes('Invalid credentials')) {
        result = 'Неверный логин или пароль.';
      }

      message(
        result || 'Ошибка подключения к Appwrite.',
        true
      );

    } finally {
      button.disabled = false;
    }
  };

  modal.showModal();
}

// ==========================================
// КНОПКА ВХОДА
// ==========================================

$('#login').onclick = () => {
  if (user) {
    page('profile');
  } else {
    authForm();
  }
};

// ==========================================
// ОБНОВЛЕНИЕ ЛИЧНОГО КАБИНЕТА
// ==========================================

async function refresh() {
  try {
    user = await account.get();
  } catch {
    user = null;
  }

  $('#login').textContent = user
    ? 'Мой кабинет ↗'
    : 'Войти / Регистрация';

  const area = $('#profileArea');

  if (!user) {
    area.innerHTML = `
      <h3>Вход не выполнен</h3>

      <p>
        Войдите или создайте аккаунт,
        чтобы открыть личный кабинет.
      </p>

      <button class="primary" id="profileLogin">
        Войти
      </button>
    `;

    $('#profileLogin').onclick = () => authForm();

    await updateRewardsUI();

    return;
  }

  const publicCollection =
    user.prefs?.collectionPublic === true;

  area.innerHTML = `
    <span>✦</span>

    <h3>${safe(user.name)}</h3>

    <p>
      Логин:
      <strong>
        ${safe(user.prefs?.login || user.email.split('@')[0])}
      </strong>
    </p>

    <p>
      Добро пожаловать в Дуэльный клуб Хогвартса!
    </p>

    <label class="privacy-toggle">

      <input
        id="publicCollection"
        type="checkbox"
        ${publicCollection ? 'checked' : ''}
      >

      Показывать мою коллекцию другим игрокам

    </label>

    <p id="prefMessage"></p>

    <button class="secondary" id="logout">
      Выйти
    </button>
  `;

  $('#publicCollection').onchange = async event => {
    try {
      await account.updatePrefs({
        prefs: {
          ...user.prefs,
          collectionPublic: event.target.checked
        }
      });

      user = await account.get();

      show('#prefMessage', 'Настройка сохранена');

    } catch (error) {
      show('#prefMessage', error.message);

      event.target.checked = !event.target.checked;
    }
  };

  $('#logout').onclick = async () => {
    try {
      await account.deleteSession({
        sessionId: 'current'
      });

      await refresh();

      page('home');

    } catch (error) {
      alert(error.message);
    }
  };

  await updateRewardsUI();
}

// ==========================================
// КАРТОЧКИ
// ==========================================

function card(data) {
  const button = document.createElement('button');

  button.className = 'card';

  button.innerHTML = `
    <img
      src="${encodeURI(data.image)}"
      alt="${safe(data.name)}"
      loading="lazy"
    >

    <label>${safe(data.name)}</label>

    <small>${safe(data.type)}</small>
  `;

  button.onclick = () => {
    $('#modalBody').innerHTML = `
      <img
        src="${encodeURI(data.image)}"
        alt="${safe(data.name)}"
      >

      <h3>${safe(data.name)}</h3>

      <p>
        ${safe(data.type)}
        · Карта № ${safe(data.id)}
      </p>
    `;

    modal.showModal();
  };

  return button;
}

// ==========================================
// КАТАЛОГ КАРТОЧЕК
// ==========================================

function draw() {
  const query = $('#search').value
    .toLowerCase()
    .trim();

  const list = all.filter(data => {
    const categoryMatches =
      filter === 'Все' || data.type === filter;

    const nameMatches =
      data.name.toLowerCase().includes(query);

    return categoryMatches && nameMatches;
  });

  $('#cards').replaceChildren(
    ...list.map(card)
  );
}

// ==========================================
// ЗАГРУЗКА КАТАЛОГА
// ==========================================

async function loadCards() {
  try {
    const response = await fetch('cards.json');

    if (!response.ok) {
      throw new Error('Не удалось загрузить карты');
    }

    all = await response.json();

    draw();

    const select = $('#chooseCard');

    if (select) {
      select.replaceChildren();

      for (const data of all) {
        const option = document.createElement('option');

        option.value = data.id;

        option.textContent =
          `${data.name} (${data.type})`;

        select.append(option);
      }
    }

  } catch (error) {
    console.error('Ошибка загрузки карт:', error);
  }
}

$('#search').oninput = draw;

document.querySelectorAll('.chip').forEach(button => {
  button.onclick = () => {
    filter = button.dataset.filter;

    document.querySelectorAll('.chip').forEach(element => {
      element.classList.toggle(
        'selected',
        element === button
      );
    });

    draw();
  };
});

// ==========================================
// ОБРАЩЕНИЕ К СЕРВЕРУ APPWRITE
// ==========================================

async function server(action, extra = {}) {
  if (!user) {
    throw new Error('Сначала войдите в аккаунт.');
  }

  const execution = await fn.createExecution({
    functionId: REWARDS_FUNCTION_ID,

    body: JSON.stringify({
      action,
      ...extra
    }),

    async: false,

    method: 'POST',

    headers: {
      'content-type': 'application/json'
    }
  });

  let result;

  try {
    result = JSON.parse(
      execution.responseBody || '{}'
    );

  } catch {
    throw new Error(
      'Сервер вернул неверный ответ: ' +
      execution.responseBody
    );
  }

  if (!result.ok) {
    throw new Error(
      result.error || 'Ошибка сервера'
    );
  }

  return result;
}

// ==========================================
// ПРОВЕРКА ПРАВ ИГРОКА
// ==========================================

async function updateRewardsUI() {
  const tools = $('#adminTools');
  const locked = $('#adminLocked');

  if (!user) {
    rewardProfile = null;

    tools?.classList.add('hidden');
    locked?.classList.remove('hidden');

    return;
  }

  try {
    const response = await server('me');

    rewardProfile = response.profile;

    const isAdmin = rewardProfile.admin === true;

    tools?.classList.toggle('hidden', !isAdmin);
    locked?.classList.toggle('hidden', isAdmin);

    if (!rewardProfile.approved) {
      show(
        '#inventoryStatus',
        'Аккаунт ожидает подтверждения администрации.'
      );

    } else {
      show(
        '#inventoryStatus',
        'Карты, полученные по одноразовым кодам.'
      );
    }

  } catch (error) {
    rewardProfile = null;

    show('#inventoryStatus', error.message);

    tools?.classList.add('hidden');
    locked?.classList.remove('hidden');

    if (locked) {
      locked.textContent =
        'Не удалось получить данные аккаунта: ' +
        error.message;
    }
  }
}

// ==========================================
// ЛИЧНАЯ КОЛЛЕКЦИЯ
// ==========================================

async function drawInventory() {
  const container = $('#inventoryCards');

  if (!user) {
    show(
      '#inventoryStatus',
      'Сначала войдите в аккаунт.'
    );

    container?.replaceChildren();

    return;
  }

  try {
    const response = await server('inventory');

    const counts = response.counts || {};

    const elements = [];

    for (const [cardId, quantity] of Object.entries(counts)) {
      const data = all.find(
        item => String(item.id) === String(cardId)
      );

      if (!data) continue;

      const element = card(data);

      const tag = document.createElement('span');

      tag.className = 'count-tag';

      tag.textContent = '× ' + quantity;

      element.append(tag);

      elements.push(element);
    }

    container?.replaceChildren(...elements);

    const total = Object.values(counts).reduce(
      (sum, quantity) => sum + Number(quantity),
      0
    );

    if (elements.length) {
      show(
        '#inventoryStatus',
        `Уникальных карт: ${elements.length}. ` +
        `Всего экземпляров: ${total}.`
      );

    } else {
      show(
        '#inventoryStatus',
        'В коллекции пока нет карт. ' +
        'Получи первую награду по коду!'
      );
    }

  } catch (error) {
    show('#inventoryStatus', error.message);
  }
}

// ==========================================
// АКТИВАЦИЯ КОДОВ НАГРАД
// ==========================================

$('#redeemForm').onsubmit = async event => {
  event.preventDefault();

  show('#redeemMessage', 'Проверяем код…');

  $('#rewardReveal').replaceChildren();

  try {
    const response = await server('redeem', {
      code: $('#rewardCode').value.trim()
    });

    show(
      '#redeemMessage',
      '✨ Награда получена! Карты добавлены в коллекцию.'
    );

    for (const reward of response.cards || []) {
      const data = all.find(
        item => String(item.id) === String(reward.id)
      );

      if (data) {
        $('#rewardReveal').append(card(data));
      }
    }

    $('#rewardCode').value = '';

  } catch (error) {
    show('#redeemMessage', error.message);
  }
};

// ==========================================
// ПЕРВОНАЧАЛЬНАЯ НАСТРОЙКА БАЗЫ
// ==========================================

$('#bootstrap').onclick = async () => {
  show(
    '#bootstrapMsg',
    'Создаём структуру базы данных…'
  );

  try {
    const response = await server('bootstrap');

    show(
      '#bootstrapMsg',
      response.message || 'Операция выполнена.'
    );

    await updateRewardsUI();

  } catch (error) {
    show('#bootstrapMsg', error.message);
  }
};

// ==========================================
// АДМИНИСТРАТИВНАЯ ПАНЕЛЬ
// ==========================================

// Загрузка списка игроков

$('#loadUsers').onclick = async () => {
  show('#usersList', 'Загрузка…');

  try {
    const response = await server('adminList');

    const target = $('#usersList');

    target.replaceChildren();

    for (const profile of response.profiles || []) {
      const row = document.createElement('div');

      row.className = 'admin-row';

      const label = document.createElement('span');

      label.textContent =
        `${profile.nickname} (${profile.login}) — ` +
        (
          profile.approved
            ? 'Подтверждён'
            : 'Ожидает'
        );

      const button = document.createElement('button');

      button.className = 'secondary';

      button.textContent = profile.approved
        ? 'Отозвать допуск'
        : 'Одобрить';

      button.onclick = async () => {
        button.disabled = true;

        try {
          await server('approve', {
            userId: profile.id,
            approved: !profile.approved
          });

          $('#loadUsers').click();

        } catch (error) {
          alert(error.message);

          button.disabled = false;
        }
      };

      row.append(label, button);

      target.append(row);
    }

  } catch (error) {
    show('#usersList', error.message);
  }
};

// ==========================================
// РЕЖИМЫ ВЫДАЧИ НАГРАД
// ==========================================

function updateMode() {
  const chosen =
    $('#rewardMode').value === 'chosen';

  $('#chooseCardWrap').classList.toggle(
    'hidden',
    !chosen
  );

  $('#rewardCategory').disabled = chosen;

  $('#rewardRarity').disabled = chosen;
}

$('#rewardMode').onchange = updateMode;

updateMode();

// ==========================================
// ГЕНЕРАТОР ОДНОРАЗОВЫХ КОДОВ
// ==========================================

$('#generateForm').onsubmit = async event => {
  event.preventDefault();

  show('#generateMessage', 'Создаём коды…');

  show('#generatedCodes', '');

  try {
    const response = await server('generate', {
      mode: $('#rewardMode').value,

      cardId: $('#chooseCard').value,

      category: $('#rewardCategory').value,

      rarity: $('#rewardRarity').value,

      count: Number($('#rewardCount').value),

      amount: Number($('#rewardAmount').value),

      reason: $('#rewardReason').value
    });

    const codes = response.codes || [];

    show(
      '#generateMessage',
      `Создано кодов: ${codes.length}. ` +
      'Скопируй их сейчас: повторно увидеть ' +
      'полные коды будет нельзя.'
    );

    show(
      '#generatedCodes',
      codes.join('\n')
    );

  } catch (error) {
    show('#generateMessage', error.message);
  }
};

// ==========================================
// ЗАПУСК ПРИЛОЖЕНИЯ
// ==========================================

await loadCards();

await refresh();
