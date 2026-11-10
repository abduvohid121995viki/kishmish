// KishMish: saytdagi buyurtmani Supabase bazasiga yozadi va Telegram'ga yuboradi.
// Barcha kalitlar faqat Netlify muhit o'zgaruvchilaridan olinadi:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
//   SUPABASE_URL, SUPABASE_SECRET_KEY
// (Netlify → Site configuration → Environment variables)

const MAX_BODY = 8000;          // juda katta so'rovlarni qabul qilmaymiz
const MAX_ITEMS = 30;
const RATE_WINDOW = 10 * 60 * 1000;   // 10 daqiqa
const RATE_LIMIT = 5;                 // bitta IP'dan 10 daqiqada 5 tagacha buyurtma
const hits = new Map();

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });

// Boshqaruv belgilarini olib tashlaydi, bo'shliqlarni qisqartiradi
const clean = (v, keepLines = false) => {
  if (typeof v !== "string") return "";
  let s = v.replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E]/g, "");
  s = keepLines ? s.replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim();
};

const money = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";

// Buyurtmani Supabase'dagi «buyurtmalar» jadvaliga yozadi.
// Xato bo'lsa faqat logga yozadi — Telegram xabari baribir yuboriladi.
async function saveToSupabase(row) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) { console.error("Supabase sozlanmagan: SUPABASE_URL yoki SUPABASE_SECRET_KEY yo'q"); return; }
  const headers = { "Content-Type": "application/json", apikey: key, Prefer: "return=minimal" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;   // eski (JWT) service_role kaliti uchun
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/buyurtmalar`, {
      method: "POST",
      headers,
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) console.error("Supabase xatosi:", res.status, (await res.text().catch(() => "")).slice(0, 300));
  } catch (err) {
    console.error("Supabase'ga ulanib bo'lmadi:", err?.name, err?.cause?.code || "");   // kalitni logga chiqarmaymiz
  }
}

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > RATE_WINDOW) hits.delete(k);
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_LIMIT;
}

export default async (req, context) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });

  // Faqat o'z saytimizdan kelgan so'rovlar
  const origin = req.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== new URL(req.url).host) return json(403, { ok: false, error: "origin" }); }
    catch { return json(403, { ok: false, error: "origin" }); }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return json(500, { ok: false, error: "config" });

  const raw = await req.text();
  if (!raw || raw.length > MAX_BODY) return json(413, { ok: false, error: "size" });
  let d;
  try { d = JSON.parse(raw); } catch { return json(400, { ok: false, error: "json" }); }
  if (!d || typeof d !== "object" || Array.isArray(d)) return json(400, { ok: false, error: "json" });

  // Spam: yashirin maydon to'ldirilgan bo'lsa — bot. Jim turib "ok" qaytaramiz.
  if (d.website) return json(200, { ok: true });
  // Spam: forma juda tez to'ldirilgan
  if (typeof d.elapsed !== "number" || d.elapsed < 2000) return json(429, { ok: false, error: "fast" });

  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (rateLimited(ip)) return json(429, { ok: false, error: "rate" });

  // Forma tekshiruvi
  const name = clean(d.name);
  const phone = clean(d.phone);
  const note = clean(d.note, true);
  const digits = phone.replace(/\D/g, "");
  if (name.length < 2 || name.length > 60 || !/\p{L}/u.test(name)) return json(400, { ok: false, error: "name" });
  if (!/^[+\d\s()-]+$/.test(phone) || digits.length < 9 || digits.length > 15) return json(400, { ok: false, error: "phone" });
  if (note.length > 500) return json(400, { ok: false, error: "note" });
  if (d.rozilik !== true) return json(400, { ok: false, error: "consent" });

  // Savat tekshiruvi
  if (!Array.isArray(d.items) || d.items.length < 1 || d.items.length > MAX_ITEMS) return json(400, { ok: false, error: "items" });
  const items = [];
  for (const it of d.items) {
    const title = clean(it?.name);
    const qty = it?.qty, price = it?.price;
    if (!title || title.length > 80 || !Number.isInteger(qty) || qty < 1 || qty > 100 ||
        !Number.isInteger(price) || price < 1 || price > 10_000_000) return json(400, { ok: false, error: "items" });
    items.push({ title, qty, price });
  }
  const total = items.reduce((a, i) => a + i.qty * i.price, 0);
  const langs = { uz: "O'zbek", ru: "Rus", en: "Ingliz" };

  // Avval bazaga yozamiz (xato bo'lsa ham davom etamiz)
  await saveToSupabase({
    ism: name,
    telefon: phone,
    izoh: note || null,
    taomlar: items.map(i => ({ nomi: i.title, miqdor_kg: i.qty, narx: i.price, summa: i.qty * i.price })),
    jami: total,
    rozilik: true
  });

  const text = [
    "🛒 Yangi buyurtma (saytdan)",
    "",
    `👤 Ism: ${name}`,
    `📞 Telefon: ${phone}`,
    `📍 Manzil / izoh: ${note || "—"}`,
    `🌐 Sayt tili: ${langs[d.lang] || "—"}`,
    "",
    ...items.map((i, k) => `${k + 1}. ${i.title} — ${i.qty} kg × ${money(i.price)} = ${money(i.qty * i.price)}`),
    "",
    `💰 Jami: ${money(total)}`
  ].join("\n");

  try {
    const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
    });
    if (!tg.ok) {
      console.error("Telegram xatosi:", tg.status, await tg.text().catch(() => ""));
      return json(502, { ok: false, error: "telegram" });
    }
  } catch (err) {
    console.error("Telegram'ga ulanib bo'lmadi:", err?.name, err?.cause?.code || "");   // tokenni logga chiqarmaymiz
    return json(502, { ok: false, error: "telegram" });
  }

  return json(200, { ok: true });
};

export const config = { path: "/api/order" };
