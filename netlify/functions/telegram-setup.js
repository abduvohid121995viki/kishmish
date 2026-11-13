// KishMish: Telegram botni sozlash sahifasi (/api/telegram-setup).
// Brauzerda bir marta oching — bot quyidagicha sozlanadi:
//   1) webhook  → shu saytdagi /api/telegram (maxfiy belgi bilan)
//   2) buyruqlar ro'yxati (/start, /bugun, /hafta, /oy, /buyurtmalar) — faqat egasining chatida
//   3) «Menyu» tugmasi → shu saytni Telegram Mini App sifatida ochadi
// Token faqat TELEGRAM_BOT_TOKEN muhit o'zgaruvchisidan olinadi va sahifada ko'rsatilmaydi.

import { createHash } from "node:crypto";

const COMMANDS = {
  uz: [
    { command: "start", description: "Buyruqlar ro'yxati" },
    { command: "bugun", description: "Bugungi buyurtmalar soni va summasi" },
    { command: "hafta", description: "Oxirgi 7 kun: soni va summasi" },
    { command: "oy", description: "Oxirgi 30 kun: soni va summasi" },
    { command: "buyurtmalar", description: "Oxirgi 10 ta buyurtma" }
  ],
  ru: [
    { command: "start", description: "Список команд" },
    { command: "bugun", description: "Заказы за сегодня: количество и сумма" },
    { command: "hafta", description: "Последние 7 дней: количество и сумма" },
    { command: "oy", description: "Последние 30 дней: количество и сумма" },
    { command: "buyurtmalar", description: "Последние 10 заказов" }
  ],
  en: [
    { command: "start", description: "List of commands" },
    { command: "bugun", description: "Today's orders: count and total" },
    { command: "hafta", description: "Last 7 days: count and total" },
    { command: "oy", description: "Last 30 days: count and total" },
    { command: "buyurtmalar", description: "Last 10 orders" }
  ]
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const page = (title, rows, note = "") => new Response(`<!doctype html>
<html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
body{margin:0;background:#FAF6EE;color:#3A1E25;font:16px/1.6 Manrope,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px}
h1{font:600 30px/1.2 "Cormorant Garamond",Georgia,serif;margin:0 0 20px}
ul{list-style:none;padding:0;margin:0 0 20px}
li{background:#fff;border:1px solid #E8DCC8;border-radius:14px;padding:12px 16px;margin-bottom:10px}
li b{display:block}
.ok b::before{content:"✓ ";color:#2BA3A8}
.no b::before{content:"✗ ";color:#B3261E}
small{color:#7A5A60}
p{color:#7A5A60}
</style></head><body><main>
<h1>${esc(title)}</h1>
<ul>${rows.map(r => `<li class="${r.ok ? "ok" : "no"}"><b>${esc(r.name)}</b><small>${esc(r.info)}</small></li>`).join("")}</ul>
${note ? `<p>${esc(note)}</p>` : ""}
</main></body></html>`, {
  status: 200,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
});

export default async req => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerChat = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !ownerChat) {
    return page("Bot sozlanmadi", [{ ok: false, name: "Muhit o'zgaruvchilari", info: "Netlify'da TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID yo'q." }]);
  }

  const site = new URL(req.url).origin;
  if (!site.startsWith("https://")) {
    return page("Bot sozlanmadi", [{ ok: false, name: "Sayt manzili", info: "Telegram faqat https:// manzil bilan ishlaydi. Sahifani https orqali oching." }]);
  }

  // Telegram API'ga so'rov. Xato matnida token bo'lmaydi; tarmoq xatosini umumiy so'z bilan ko'rsatamiz.
  const api = async (method, body) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(8000)
      });
      const data = await res.json().catch(() => ({}));
      return { ok: !!data.ok, result: data.result, error: data.description || `HTTP ${res.status}` };
    } catch (err) {
      console.error("Telegram'ga ulanib bo'lmadi:", method, err?.name);
      return { ok: false, error: "Telegram'ga ulanib bo'lmadi" };
    }
  };

  const rows = [];
  const hookUrl = `${site}/api/telegram`;
  const appUrl = `${site}/`;
  const secret = createHash("sha256").update(token).digest("hex").slice(0, 32);

  const me = await api("getMe");
  rows.push(me.ok
    ? { ok: true, name: "Bot topildi", info: `@${me.result.username}` }
    : { ok: false, name: "Bot topilmadi", info: `Token noto'g'ri bo'lishi mumkin (${me.error}).` });
  if (!me.ok) return page("Bot sozlanmadi", rows);

  const hook = await api("setWebhook", { url: hookUrl, secret_token: secret, allowed_updates: ["message"] });
  rows.push({ ok: hook.ok, name: "Webhook o'rnatildi", info: hook.ok ? hookUrl : `Xato: ${hook.error}` });

  // Buyruqlar faqat egasining chatida ko'rinadi; boshqalar uchun umumiy ro'yxatni tozalaymiz
  await api("deleteMyCommands", { scope: { type: "default" } });
  const scope = { type: "chat", chat_id: ownerChat };
  const cmdResults = await Promise.all([
    api("setMyCommands", { commands: COMMANDS.uz, scope }),
    api("setMyCommands", { commands: COMMANDS.ru, scope, language_code: "ru" }),
    api("setMyCommands", { commands: COMMANDS.en, scope, language_code: "en" })
  ]);
  const cmdBad = cmdResults.find(r => !r.ok);
  rows.push({
    ok: !cmdBad,
    name: "Buyruqlar ro'yxati sozlandi",
    info: cmdBad ? `Xato: ${cmdBad.error}` : "/start, /bugun, /hafta, /oy, /buyurtmalar (o'zbek, rus, ingliz) — faqat sizning chatingizda"
  });

  const menu = await api("setChatMenuButton", { menu_button: { type: "web_app", text: "Menyu", web_app: { url: appUrl } } });
  rows.push({ ok: menu.ok, name: "«Menyu» tugmasi sozlandi", info: menu.ok ? `Mini App: ${appUrl}` : `Xato: ${menu.error}` });

  const info = await api("getWebhookInfo");
  if (info.ok) {
    const w = info.result || {};
    const good = w.url === hookUrl;
    const last = w.last_error_message ? ` Oxirgi xato: ${w.last_error_message}` : "";
    rows.push({ ok: good, name: "Tekshiruv", info: good ? `Webhook ishlayapti. Kutayotgan xabarlar: ${w.pending_update_count || 0}.${last}` : "Webhook manzili mos kelmadi." });
  }

  const allOk = rows.every(r => r.ok);
  return page(
    allOk ? "Bot muvaffaqiyatli sozlandi" : "Bot qisman sozlandi",
    rows,
    allOk ? `Endi Telegram'da @${me.result.username} botiga /start deb yozing.` : "Xatolarni tuzatib, sahifani qayta oching."
  );
};

export const config = { path: "/api/telegram-setup" };
