// KishMish: Telegram bot webhook'i (/api/telegram).
// Telegram har bir xabarni shu manzilga yuboradi.
// Kalitlar faqat Netlify muhit o'zgaruvchilaridan olinadi:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_URL, SUPABASE_SECRET_KEY
//
// Xavfsizlik: so'rovda X-Telegram-Bot-Api-Secret-Token sarlavhasi
// sha256(TELEGRAM_BOT_TOKEN) ning birinchi 32 belgisiga teng bo'lishi shart.
// Buyurtma ma'lumoti faqat TELEGRAM_CHAT_ID chatiga beriladi.

import { createHash, timingSafeEqual } from "node:crypto";

const TZ_OFFSET = 5 * 60 * 60 * 1000;   // Toshkent = UTC+5 (yozgi vaqt yo'q)

/* ===== Bot matnlari: o'zbek, rus, ingliz ===== */
const TXT = {
  uz: {
    menu: "Buyurtma berish uchun pastdagi «Menyu» tugmasini bosing.",
    help: "KishMish bot buyruqlari:\n\n/bugun — bugungi buyurtmalar soni va jami summasi\n/buyurtmalar — oxirgi 10 ta buyurtma\n/start — shu ro'yxat",
    today: (n, sum, date) => `📅 Bugun (${date}, Toshkent vaqti)\n\n🛒 Buyurtmalar: ${n} ta\n💰 Jami: ${sum}`,
    lastTitle: "🧾 Oxirgi buyurtmalar:",
    none: "Hozircha buyurtma yo'q.",
    dbErr: "Bazadan ma'lumot olib bo'lmadi. Keyinroq qayta urinib ko'ring.",
    cur: "so'm"
  },
  ru: {
    menu: "Чтобы сделать заказ, нажмите кнопку «Menyu» внизу.",
    help: "Команды бота KishMish:\n\n/bugun — количество и сумма заказов за сегодня\n/buyurtmalar — последние 10 заказов\n/start — этот список",
    today: (n, sum, date) => `📅 Сегодня (${date}, ташкентское время)\n\n🛒 Заказов: ${n}\n💰 Итого: ${sum}`,
    lastTitle: "🧾 Последние заказы:",
    none: "Заказов пока нет.",
    dbErr: "Не удалось получить данные из базы. Попробуйте позже.",
    cur: "сум"
  },
  en: {
    menu: "To place an order, tap the «Menyu» button below.",
    help: "KishMish bot commands:\n\n/bugun — today's order count and total\n/buyurtmalar — last 10 orders\n/start — this list",
    today: (n, sum, date) => `📅 Today (${date}, Tashkent time)\n\n🛒 Orders: ${n}\n💰 Total: ${sum}`,
    lastTitle: "🧾 Latest orders:",
    none: "No orders yet.",
    dbErr: "Couldn't read data from the database. Please try again later.",
    cur: "UZS"
  }
};

// Telegram ilovasi tiliga qarab: ru / en, qolgan hammasi o'zbekcha
const pickLang = code => {
  const c = String(code || "").toLowerCase();
  return c.startsWith("ru") ? "ru" : c.startsWith("en") ? "en" : "uz";
};

const money = (n, L) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " " + TXT[L].cur;
const pad = n => String(n).padStart(2, "0");
const tashkent = d => new Date(new Date(d).getTime() + TZ_OFFSET);   // getUTC* = Toshkent vaqti
const fmtDate = d => { const x = tashkent(d); return `${pad(x.getUTCDate())}.${pad(x.getUTCMonth() + 1)}.${x.getUTCFullYear()}`; };
const fmtTime = d => { const x = tashkent(d); return `${pad(x.getUTCDate())}.${pad(x.getUTCMonth() + 1)} ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`; };

const secretFor = token => createHash("sha256").update(token).digest("hex").slice(0, 32);

function sameSecret(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ===== Supabase'dan o'qish ===== */
async function supabase(query, extraHeaders = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase sozlanmagan");
  const headers = { apikey: key, Accept: "application/json", ...extraHeaders };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;   // eski (JWT) service_role kaliti uchun
  const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/buyurtmalar?${query}`, {
    headers,
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return { rows: await res.json(), range: res.headers.get("content-range") };
}

async function todayReport(L) {
  const now = tashkent(Date.now());
  const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - TZ_OFFSET;
  const from = new Date(startMs).toISOString();
  const to = new Date(startMs + 24 * 60 * 60 * 1000).toISOString();
  const q = `select=jami&yaratilgan=gte.${encodeURIComponent(from)}&yaratilgan=lt.${encodeURIComponent(to)}&limit=10000`;
  const { rows, range } = await supabase(q, { Prefer: "count=exact" });
  const total = rows.reduce((a, r) => a + (Number(r.jami) || 0), 0);
  const counted = Number(String(range || "").split("/")[1]);
  const n = Number.isFinite(counted) ? counted : rows.length;
  return TXT[L].today(n, money(total, L), fmtDate(Date.now()));
}

async function lastOrders(L) {
  const { rows } = await supabase("select=yaratilgan,ism,telefon,jami&order=yaratilgan.desc&limit=10");
  if (!rows.length) return TXT[L].none;
  const lines = rows.map((r, i) => `${i + 1}. ${fmtTime(r.yaratilgan)} · ${r.ism} · ${r.telefon} · ${money(r.jami, L)}`);
  return [TXT[L].lastTitle, "", ...lines].join("\n");
}

async function send(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) console.error("Telegram xatosi:", res.status, (await res.text().catch(() => "")).slice(0, 200));
}

const ok = () => new Response("ok", { status: 200 });

export default async req => {
  if (req.method !== "POST") return new Response("Not found", { status: 404 });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerChat = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !ownerChat) return new Response("config", { status: 500 });

  // Faqat Telegram'dan (to'g'ri maxfiy belgi bilan) kelgan so'rovlar
  if (!sameSecret(req.headers.get("x-telegram-bot-api-secret-token"), secretFor(token))) {
    return new Response("Forbidden", { status: 403 });
  }

  let update;
  try { update = await req.json(); } catch { return ok(); }
  const msg = update?.message;
  if (!msg?.chat?.id) return ok();               // boshqa turdagi yangilanishlarni e'tiborsiz qoldiramiz

  const L = pickLang(msg.from?.language_code);
  const chatId = msg.chat.id;

  // Egasidan boshqa hamma — faqat «Menyu» haqida eslatma
  if (String(chatId) !== ownerChat) {
    await send(token, chatId, TXT[L].menu);
    return ok();
  }

  const cmd = String(msg.text || "").trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  let reply;
  try {
    if (cmd === "/bugun") reply = await todayReport(L);
    else if (cmd === "/buyurtmalar") reply = await lastOrders(L);
    else reply = TXT[L].help;                    // /start va boshqa har qanday matn
  } catch (err) {
    console.error("Buyruq xatosi:", err?.message);   // kalitlar logga chiqmaydi
    reply = TXT[L].dbErr;
  }
  await send(token, chatId, reply);
  return ok();
};

export const config = { path: "/api/telegram" };
