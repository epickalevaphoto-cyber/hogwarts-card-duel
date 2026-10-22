import crypto from 'node:crypto';
import cards from './cards.json' with { type: 'json' };

// ============================================================
// HOGWARTS CARD DUEL — APPWRITE TABLESDB BACKEND
// Node.js 22
// ============================================================

// ------------------------------------------------------------
// НАСТРОЙКИ
// ------------------------------------------------------------

const ENDPOINT =
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  process.env.APPWRITE_ENDPOINT ||
  'https://fra.cloud.appwrite.io/v1';

const PROJECT =
  process.env.APPWRITE_FUNCTION_PROJECT_ID ||
  process.env.APPWRITE_PROJECT_ID ||
  '6ad75c6d0024af9d8bab';

const DATABASE_ID = 'hogwarts_duel';

const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '';

const TABLES = {
  PROFILES: 'profiles',
  REWARDS: 'reward_codes',
  REDEMPTIONS: 'redemptions',
  YEARS: 'school_years',
  POINTS: 'tournament_points'
};

// ------------------------------------------------------------
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ------------------------------------------------------------

function now() {
  return new Date().toISOString();
}

function randomId() {
  return crypto.randomBytes(12).toString('hex');
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex');
}

function encode(value) {
  return encodeURIComponent(String(value));
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function equalQuery(attribute, value) {
  return JSON.stringify({
    method: 'equal',
    attribute,
    values: [value]
  });
}

function limitQuery(limit) {
  return JSON.stringify({
    method: 'limit',
    values: [limit]
  });
}

function cursorAfterQuery(cursor) {
  return JSON.stringify({
    method: 'cursorAfter',
    values: [cursor]
  });
}

function normalizeString(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInteger(value, min, max, fallback = min) {
  const number = Number(value ?? fallback);

  if (
    !Number.isInteger(number) ||
    number < min ||
    number > max
  ) {
    fail(`Допустимое значение: от ${min} до ${max}.`);
  }

  return number;
}

// ------------------------------------------------------------
// КАТЕГОРИИ И РЕДКОСТИ
// ------------------------------------------------------------

const CATEGORIES = [
  'Все',
  'Растения',
  'Существа',
  'Персонажи',
  'Зелья',
  'Заклинания',
  'Навыки'
];

const RARITIES = [
  'Все',
  'Обычная',
  'Необычная',
  'Редкая',
  'Эпическая',
  'Легендарная'
];

// Веса используются для случайной выдачи,
// если администратор не выбрал конкретную редкость.

const RARITY_WEIGHTS = {
  'Обычная': 50,
  'Необычная': 28,
  'Редкая': 14,
  'Эпическая': 6,
  'Легендарная': 2
};

function cardRarity(card) {
  return card.rarity || 'Обычная';
}

function weightedRandom(pool) {
  if (!pool.length) {
    fail('Нет подходящих карточек.');
  }

  const weights = pool.map(card => {
    return RARITY_WEIGHTS[cardRarity(card)] || 1;
  });

  const total = weights.reduce((sum, weight) => {
    return sum + weight;
  }, 0);

  let roll = crypto.randomInt(1_000_000) / 1_000_000 * total;

  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];

    if (roll < 0) {
      return pool[i];
    }
  }

  return pool[pool.length - 1];
}

// ------------------------------------------------------------
// ОПИСАНИЕ ТАБЛИЦ
// ------------------------------------------------------------

const SCHEMA = {
  profiles: [
    {
      name: 'nickname',
      type: 'string',
      size: 120,
      required: true
    },
    {
      name: 'login',
      type: 'string',
      size: 120,
      required: false
    },
    {
      name: 'approved',
      type: 'boolean',
      required: false,
      default: false
    },
    {
      name: 'collectionPublic',
      type: 'boolean',
      required: false,
      default: false
    },
    {
      name: 'createdAt',
      type: 'string',
      size: 40,
      required: false
    }
  ],

  reward_codes: [
    {
      name: 'hash',
      type: 'string',
      size: 64,
      required: true
    },
    {
      name: 'mode',
      type: 'string',
      size: 30,
      required: true
    },
    {
      name: 'cardId',
      type: 'string',
      size: 40,
      required: false
    },
    {
      name: 'category',
      type: 'string',
      size: 60,
      required: false
    },
    {
      name: 'rarity',
      type: 'string',
      size: 30,
      required: false
    },
    {
      name: 'count',
      type: 'integer',
      required: true
    },
    {
      name: 'newOnly',
      type: 'boolean',
      required: false,
      default: false
    },
    {
      name: 'reason',
      type: 'string',
      size: 500,
      required: false
    },
    {
      name: 'createdBy',
      type: 'string',
      size: 36,
      required: true
    },
    {
      name: 'createdAt',
      type: 'string',
      size: 40,
      required: true
    },
    {
      name: 'usedBy',
      type: 'string',
      size: 36,
      required: false
    },
    {
      name: 'usedAt',
      type: 'string',
      size: 40,
      required: false
    }
  ],

  redemptions: [
    {
      name: 'userId',
      type: 'string',
      size: 36,
      required: true
    },
    {
      name: 'cardId',
      type: 'string',
      size: 40,
      required: true
    },
    {
      name: 'codeId',
      type: 'string',
      size: 36,
      required: true
    },
    {
      name: 'redeemedAt',
      type: 'string',
      size: 40,
      required: true
    }
  ]
};

// ============================================================
// ГЛАВНАЯ ФУНКЦИЯ APPWRITE
// ============================================================

export default async ({ req, res, log, error }) => {

  // ----------------------------------------------------------
  // КОНТЕКСТ ВЫПОЛНЕНИЯ
  // ----------------------------------------------------------

  const apiKey = req.headers['x-appwrite-key'];

  const userId = req.headers['x-appwrite-user-id'];

  const isAdmin =
    Boolean(userId) &&
    Boolean(ADMIN_USER_ID) &&
    userId === ADMIN_USER_ID;

  let body = {};

  try {
    body =
      req.bodyJson &&
      typeof req.bodyJson === 'object'
        ? req.bodyJson
        : JSON.parse(req.bodyText || '{}');

  } catch {
    return res.json({
      ok: false,
      error: 'Некорректный JSON в запросе.',
      status: 400
    }, 400);
  }

  // ----------------------------------------------------------
  // ЗАПРОСЫ К APPWRITE API
  // ----------------------------------------------------------

  async function api(method, path, data) {
    const response = await fetch(
      ENDPOINT + path,
      {
        method,

        headers: {
          'X-Appwrite-Project': PROJECT,
          'X-Appwrite-Key': apiKey,
          'Content-Type': 'application/json'
        },

        body:
          data === undefined
            ? undefined
            : JSON.stringify(data)
      }
    );

    const result = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      const err = new Error(
        result.message ||
        `Ошибка Appwrite: ${response.status}`
      );

      err.status = response.status;
      err.code = result.code;

      throw err;
    }

    return result;
  }

  // ----------------------------------------------------------
  // TABLESDB: ТАБЛИЦЫ
  // ----------------------------------------------------------

  async function createTable(tableId) {
    return api(
      'POST',
      `/tablesdb/${DATABASE_ID}/tables`,
      {
        tableId,
        name: tableId,
        permissions: [],
        rowSecurity: false
      }
    );
  }

  async function createColumn(tableId, column) {
    const path =
      `/tablesdb/${DATABASE_ID}/tables/${tableId}` +
      `/columns/${column.type}`;

    const data = {
      key: column.name,
      required: column.required
    };

    if (column.type === 'string') {
      data.size = column.size;
    }

    if (column.default !== undefined) {
      data.default = column.default;
    }

    return api('POST', path, data);
  }

  // ----------------------------------------------------------
  // TABLESDB: СТРОКИ
  // ----------------------------------------------------------

  function rowsPath(tableId) {
    return (
      `/tablesdb/${DATABASE_ID}` +
      `/tables/${encode(tableId)}/rows`
    );
  }

  async function getRow(tableId, rowId) {
    return api(
      'GET',
      `${rowsPath(tableId)}/${encode(rowId)}`
    );
  }

  async function createRow(tableId, rowId, data) {
    return api(
      'POST',
      rowsPath(tableId),
      {
        rowId,
        data,
        permissions: []
      }
    );
  }

  async function updateRow(tableId, rowId, data) {
    return api(
      'PATCH',
      `${rowsPath(tableId)}/${encode(rowId)}`,
      {
        data
      }
    );
  }

  async function listRows(tableId, filters = []) {
    const results = [];

    let cursor = null;

    while (true) {
      const queries = [
        ...filters,
        limitQuery(100)
      ];

      if (cursor) {
        queries.push(cursorAfterQuery(cursor));
      }

      const params = new URLSearchParams();

      for (const query of queries) {
        params.append('queries[]', query);
      }

      const response = await api(
        'GET',
        `${rowsPath(tableId)}?${params.toString()}`
      );

      const batch = response.rows || [];

      results.push(...batch);

      if (batch.length < 100) {
        break;
      }

      cursor = batch[batch.length - 1].$id;

      if (results.length >= 5000) {
        fail(
          'Слишком много записей для одного запроса.',
          400
        );
      }
    }

    return results;
  }

  // ----------------------------------------------------------
  // ПРОФИЛИ
  // ----------------------------------------------------------

  async function getOrCreateProfile() {
    try {
      return await getRow(
        TABLES.PROFILES,
        userId
      );

    } catch (err) {
      if (err.status !== 404) {
        throw err;
      }
    }

    const account = await api(
      'GET',
      `/users/${encode(userId)}`
    );

    const nickname =
      normalizeString(account.name, 120) ||
      'Игрок';

    const login =
      normalizeString(
        account.email?.split('@')[0] || '',
        120
      );

    try {
      return await createRow(
        TABLES.PROFILES,
        userId,
        {
          nickname,
          login,
          approved: isAdmin,
          collectionPublic: false,
          createdAt: now()
        }
      );

    } catch (err) {
      if (err.status === 409) {
        return getRow(
          TABLES.PROFILES,
          userId
        );
      }

      throw err;
    }
  }

  // ----------------------------------------------------------
  // ПРОВЕРКА АДМИНИСТРАТОРА
  // ----------------------------------------------------------

  function requireAdmin() {
    if (!isAdmin) {
      fail(
        'Это действие доступно только главному администратору.',
        403
      );
    }
  }

  // ----------------------------------------------------------
  // ОСНОВНАЯ ЛОГИКА
  // ----------------------------------------------------------

  try {

    if (!apiKey) {
      fail(
        'Appwrite не предоставил серверный API-ключ.',
        503
      );
    }

    const action = body.action;
    if (!userId && action !== 'tournament') {
      fail('Сначала войдите в аккаунт.', 401);
    }


    // Турнирные годы и начисления. Только администратор может изменять данные.
    // Гостям разрешено только читать общую таблицу.
    if (action === 'tournament' || action === 'adminYears' ||
        action === 'saveYear' || action === 'setYearStatus' ||
        action === 'addPoints' || action === 'pointHistory') {
      const adminAction = action !== 'tournament';
      if (adminAction) requireAdmin();

      const years = await listRows(TABLES.YEARS);
      const orderedYears = years.sort((a, b) =>
        Number(b.number) - Number(a.number));
      const today = new Date().toISOString().slice(0, 10);
      const effectiveStatus = y => y.status === 'active' && y.endDate < today
        ? 'finished' : y.status;
      const yearView = y => ({
        id: y.$id, number: y.number, startDate: y.startDate,
        endDate: y.endDate, status: effectiveStatus(y)
      });

      if (action === 'adminYears') {
        return res.json({ok:true, years:orderedYears.map(yearView)});
      }

      if (action === 'saveYear') {
        const number = positiveInteger(body.number, 1, 99999);
        const startDate = normalizeString(body.startDate, 10);
        const endDate = normalizeString(body.endDate, 10);
        const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(value)) &&
          new Date(value).toISOString().slice(0,10) === value;
        if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) {
          fail('Проверьте даты начала и окончания.');
        }
        const existing = orderedYears.find(y => y.$id === body.yearId);
        if (orderedYears.some(y => Number(y.number) === number &&
            y.$id !== existing?.$id)) fail('Такой номер учебного года уже существует.');
        if (existing) {
          if (effectiveStatus(existing) === 'finished') {
            fail('Завершённый год нельзя редактировать.');
          }
          await updateRow(TABLES.YEARS, existing.$id, {number,startDate,endDate});
        } else {
          await createRow(TABLES.YEARS, randomId(),
            {number,startDate,endDate,status:'planned',createdAt:now()});
        }
        return res.json({ok:true,message:'Учебный год сохранён.'});
      }

      if (action === 'setYearStatus') {
        const year = years.find(y => y.$id === body.yearId);
        if (!year) fail('Учебный год не найден.',404);
        const status = normalizeString(body.status, 20);
        if (!['active','finished'].includes(status)) fail('Недопустимый статус.');
        if (effectiveStatus(year) === 'finished') fail('Завершённый год нельзя возобновить.');
        if (status === 'active') {
          if (year.status !== 'planned') fail('Год уже запущен.');
          if (year.endDate < today) fail('Дата окончания уже прошла.');
          if (years.some(y => y.$id !== year.$id && effectiveStatus(y) === 'active')) {
            fail('Сначала завершите текущий учебный год.');
          }
        }
        await updateRow(TABLES.YEARS, year.$id, {status});
        return res.json({ok:true,message:status === 'active' ? 'Учебный год начат.' : 'Учебный год завершён.'});
      }

      if (action === 'addPoints') {
        const year = years.find(y => y.$id === body.yearId);
        if (!year || effectiveStatus(year) !== 'active' ||
            year.startDate > today) fail('Учебный год не активен.');
        const targetId = normalizeString(body.userId,36);
        if (!/^[a-zA-Z0-9_]{1,36}$/.test(targetId)) fail('Некорректный игрок.');
        await getRow(TABLES.PROFILES,targetId);
        const points = Number(body.points);
        if (!Number.isSafeInteger(points) || points === 0 ||
            Math.abs(points) > 1000000) fail('Укажите целое число очков от -1000000 до 1000000 (не ноль).');
        const reason = normalizeString(body.reason,500);
        if (!reason) fail('Укажите причину начисления или списания.');
        await createRow(TABLES.POINTS,randomId(),{
          yearId:year.$id,userId:targetId,points,reason,
          adminId:userId,createdAt:now()
        });
        return res.json({ok:true,message:'Очки сохранены в истории.'});
      }

      if (action === 'pointHistory') {
        const yearId = normalizeString(body.yearId,36);
        const year = years.find(y => y.$id === yearId);
        if (!year) fail('Учебный год не найден.');
        const rows = await listRows(TABLES.POINTS,[equalQuery('yearId',yearId)]);
        const profiles = await listRows(TABLES.PROFILES);
        const names = Object.fromEntries(profiles.map(p => [p.$id,p.nickname]));
        return res.json({ok:true,history:rows.sort((a,b) =>
          b.createdAt.localeCompare(a.createdAt)).map(p => ({
          id:p.$id,nickname:names[p.userId] || p.userId,
          points:p.points,reason:p.reason,createdAt:p.createdAt
        }))});
      }

      // Публичная турнирная таблица; приватные данные профилей не выдаём.
      const requested = orderedYears.find(y => y.$id === body.yearId);
      const selected = requested || orderedYears.find(y => effectiveStatus(y) === 'active') ||
        orderedYears[0];
      if (!selected) return res.json({ok:true,years:[],year:null,ranking:[]});
      const [points, profiles] = await Promise.all([
        listRows(TABLES.POINTS,[equalQuery('yearId',selected.$id)]),
        listRows(TABLES.PROFILES)
      ]);
      const totals = {};
      for (const row of points) totals[row.userId] =
        (totals[row.userId] || 0) + Number(row.points || 0);
      const ranking = profiles.filter(p => p.approved === true ||
        p.$id === ADMIN_USER_ID).map(p => ({
        nickname:p.nickname || 'Игрок',
        points:totals[p.$id] || 0
      })).sort((a,b) => b.points-a.points ||
        a.nickname.localeCompare(b.nickname,'ru'));
      return res.json({ok:true,years:orderedYears.map(yearView),
        year:yearView(selected),ranking});
    }

    // ========================================================
    // ME — ПРОФИЛЬ ТЕКУЩЕГО ИГРОКА
    // ========================================================

    if (action === 'me') {
      const profile = await getOrCreateProfile();

      return res.json({
        ok: true,

        profile: {
          id: userId,
          nickname: profile.nickname,
          login: profile.login,
          approved:
            isAdmin || profile.approved === true,
          collectionPublic:
            profile.collectionPublic === true,
          admin: isAdmin
        }
      });
    }

    // ========================================================
    // PRIVACY — ПРИВАТНОСТЬ КОЛЛЕКЦИИ
    // ========================================================

    if (action === 'privacy') {
      await getOrCreateProfile();

      await updateRow(
        TABLES.PROFILES,
        userId,
        {
          collectionPublic: body.public === true
        }
      );

      return res.json({
        ok: true
      });
    }

    // ========================================================
    // INVENTORY — КОЛЛЕКЦИЯ ИГРОКА
    // ========================================================

    if (action === 'inventory') {
      const profile = await getOrCreateProfile();

      if (!profile.approved && !isAdmin) {
        return res.json({
          ok: true,
          counts: {}
        });
      }

      const mine = await listRows(
        TABLES.REDEMPTIONS,
        [
          equalQuery('userId', userId)
        ]
      );

      const counts = {};

      for (const row of mine) {
        const cardId = String(row.cardId);

        counts[cardId] =
          (counts[cardId] || 0) + 1;
      }

      return res.json({
        ok: true,
        counts
      });
    }

    // ========================================================
    // ADMIN LIST — СПИСОК ИГРОКОВ
    // ========================================================

    if (action === 'adminList') {
      requireAdmin();

      const profiles = await listRows(
        TABLES.PROFILES
      );

      return res.json({
        ok: true,

        profiles: profiles.map(profile => ({
          id: profile.$id,
          nickname: profile.nickname,
          login: profile.login,
          approved:
            profile.$id === ADMIN_USER_ID ||
            profile.approved === true,
          createdAt: profile.createdAt
        }))
      });
    }

    // ========================================================
    // APPROVE — ПОДТВЕРЖДЕНИЕ ИГРОКА
    // ========================================================

    if (action === 'approve') {
      requireAdmin();

      const targetId = normalizeString(
        body.userId,
        36
      );

      if (!/^[a-zA-Z0-9_]{1,36}$/.test(targetId)) {
        fail(
          'Некорректный идентификатор игрока.'
        );
      }

      if (targetId === ADMIN_USER_ID) {
        fail(
          'Нельзя изменить доступ главного администратора.'
        );
      }

      await updateRow(
        TABLES.PROFILES,
        targetId,
        {
          approved: body.approved === true
        }
      );

      return res.json({
        ok: true,
        message:
          body.approved === true
            ? 'Игрок подтверждён.'
            : 'Доступ игрока отозван.'
      });
    }

    // ========================================================
    // GENERATE — ГЕНЕРАЦИЯ КОДОВ
    // ========================================================

    if (action === 'generate') {
      requireAdmin();

      const mode = normalizeString(
        body.mode,
        30
      );

      if (!['chosen', 'random', 'new'].includes(mode)) {
        fail(
          'Неизвестный режим награды.'
        );
      }

      const cardId = normalizeString(
        body.cardId,
        40
      );

      if (
        mode === 'chosen' &&
        !cards.some(
          card => String(card.id) === cardId
        )
      ) {
        fail(
          'Выбранная карточка не найдена.'
        );
      }

      const amount = positiveInteger(
        body.amount,
        1,
        30,
        1
      );

      const count = positiveInteger(
        body.count,
        1,
        10,
        1
      );

      const category = normalizeString(
        body.category || 'Все',
        60
      );

      const rarity = normalizeString(
        body.rarity || 'Все',
        30
      );

      if (!CATEGORIES.includes(category)) {
        fail(
          'Неизвестная категория карточек.'
        );
      }

      if (!RARITIES.includes(rarity)) {
        fail(
          'Неизвестная редкость карточек.'
        );
      }

      const reason = normalizeString(
        body.reason,
        500
      );

      const generatedCodes = [];

      for (let i = 0; i < amount; i++) {
        const code =
          'HCD-' +
          crypto
            .randomBytes(9)
            .toString('hex')
            .toUpperCase();

        await createRow(
          TABLES.REWARDS,
          randomId(),
          {
            hash: sha256(code),
            mode,
            cardId:
              mode === 'chosen'
                ? cardId
                : '',
            category,
            rarity,
            count,
            newOnly: mode === 'new',
            reason,
            createdBy: userId,
            createdAt: now(),
            usedBy: '',
            usedAt: ''
          }
        );

        generatedCodes.push(code);
      }

      return res.json({
        ok: true,
        codes: generatedCodes
      });
    }

    // ========================================================
    // REDEEM — АКТИВАЦИЯ КОДА
    // ========================================================

    if (action === 'redeem') {
      const profile = await getOrCreateProfile();

      if (!profile.approved && !isAdmin) {
        fail(
          'Аккаунт ещё не подтверждён администрацией.',
          403
        );
      }

      const code = normalizeString(
        body.code,
        50
      ).toUpperCase();

      if (!/^HCD-[A-F0-9]{18}$/.test(code)) {
        fail(
          'Неверный формат кода.'
        );
      }

      const matches = await listRows(
        TABLES.REWARDS,
        [
          equalQuery(
            'hash',
            sha256(code)
          )
        ]
      );

      const reward = matches[0];

      if (!reward) {
        fail(
          'Код не найден.'
        );
      }

      if (reward.usedBy) {
        fail(
          'Этот код уже использован.'
        );
      }

      // ------------------------------------------------------
      // ПОЛУЧЕННЫЕ КАРТОЧКИ
      // ------------------------------------------------------

      const mine = await listRows(
        TABLES.REDEMPTIONS,
        [
          equalQuery('userId', userId)
        ]
      );

      const owned = new Set(
        mine.map(row => String(row.cardId))
      );

      // ------------------------------------------------------
      // ПОДБОР КАРТОЧЕК
      // ------------------------------------------------------

      let pool = cards.filter(card => {
        const categoryMatches =
          reward.category === 'Все' ||
          card.type === reward.category;

        const rarityMatches =
          reward.rarity === 'Все' ||
          cardRarity(card) === reward.rarity;

        return categoryMatches && rarityMatches;
      });

      if (reward.mode === 'chosen') {
        pool = cards.filter(card => {
          return String(card.id) ===
            String(reward.cardId);
        });
      }

      if (reward.mode === 'new') {
        pool = pool.filter(card => {
          return !owned.has(String(card.id));
        });
      }

      if (!pool.length) {
        fail(
          'Нет подходящих карточек. Код не потрачен.'
        );
      }

      const picks = [];

      const rewardCount = Number(
        reward.count || 1
      );

      for (let i = 0; i < rewardCount; i++) {
        if (!pool.length) {
          break;
        }

        let selected;

        if (reward.mode === 'chosen') {
          selected = pool[0];

        } else if (reward.rarity !== 'Все') {
          selected = pool[
            crypto.randomInt(pool.length)
          ];

        } else {
          selected = weightedRandom(pool);
        }

        picks.push(selected);

        if (reward.mode === 'new') {
          pool = pool.filter(card => {
            return String(card.id) !==
              String(selected.id);
          });
        }
      }

      if (!picks.length) {
        fail(
          'Не удалось подобрать награду.'
        );
      }

      // ------------------------------------------------------
      // ЗАЩИТА ОТ ПОВТОРНОЙ АКТИВАЦИИ
      // ------------------------------------------------------

      // Первый экземпляр награды получает постоянный ID,
      // зависящий от ID кода.
      //
      // Повторная попытка создать строку с тем же ID
      // должна завершиться конфликтом 409.

      const claimId = sha256(
        reward.$id
      ).slice(0, 32);

      try {
        await createRow(
          TABLES.REDEMPTIONS,
          claimId,
          {
            userId,
            cardId: String(picks[0].id),
            codeId: reward.$id,
            redeemedAt: now()
          }
        );

      } catch (err) {
        if (err.status === 409) {
          fail(
            'Этот код уже активирован.',
            409
          );
        }

        throw err;
      }

      // ------------------------------------------------------
      // ОСТАЛЬНЫЕ ЭКЗЕМПЛЯРЫ
      // ------------------------------------------------------

      for (let i = 1; i < picks.length; i++) {
        await createRow(
          TABLES.REDEMPTIONS,
          randomId(),
          {
            userId,
            cardId: String(picks[i].id),
            codeId: reward.$id,
            redeemedAt: now()
          }
        );
      }

      // ------------------------------------------------------
      // ПОМЕЧАЕМ КОД ИСПОЛЬЗОВАННЫМ
      // ------------------------------------------------------

      await updateRow(
        TABLES.REWARDS,
        reward.$id,
        {
          usedBy: userId,
          usedAt: now()
        }
      );

      return res.json({
        ok: true,

        cards: picks.map(card => ({
          id: card.id,
          name: card.name,
          image: card.image
        }))
      });
    }

    // ========================================================
    // НЕИЗВЕСТНОЕ ДЕЙСТВИЕ
    // ========================================================

    fail(
      'Неизвестное действие.'
    );

  } catch (err) {

    error(
      err.stack || err.message
    );

    return res.json(
      {
        ok: false,
        error:
          err.message ||
          'Внутренняя ошибка сервера.',
        status: err.status || 500
      },
      err.status || 500
    );
  }
};
