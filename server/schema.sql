-- База «Мой рацион» на Cloudflare D1
CREATE TABLE IF NOT EXISTS keys (
  key TEXT PRIMARY KEY,           -- ключ доступа, выдаёт Telegram-бот
  tg_user TEXT,                   -- id пользователя Telegram
  until TEXT NOT NULL,            -- подписка активна до (ISO-дата)
  ai_calls INTEGER DEFAULT 0,     -- счётчик обращений к нейросети
  created TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,  -- имя без пробелов и регистра, защита от дублей
  types TEXT NOT NULL,            -- b, l, d, s и сочетания
  cuisine TEXT,
  section INTEGER NOT NULL,       -- 0 простое, 1 среднее, 2 сложное, 3 шедевр
  allergens TEXT DEFAULT '',      -- через запятую: milk,eggs,…
  data TEXT NOT NULL,             -- полный рецепт JSON
  shown INTEGER DEFAULT 0, taken INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0,
  created TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dishes_pick ON dishes (section, cuisine, hidden);
CREATE INDEX IF NOT EXISTS idx_dishes_created ON dishes (created);
