const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cron = require("node-cron");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || "cfb18895da0d8bf04a8307cc8550fe0d";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OpenAi || process.env.OPENAI;
const WEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log("Bot ishga tushdi...");

// ===================== KANAL A'ZOLIGINI TEKSHIRISH =====================

const REQUIRED_CHANNEL = "@pythoncommands";

async function isSubscribed(userId) {
  try {
    const member = await bot.getChatMember(REQUIRED_CHANNEL, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

async function checkSubscription(chatId, userId) {
  const subscribed = await isSubscribed(userId);
  if (!subscribed) {
    await bot.sendMessage(
      chatId,
      `❗️ Botdan foydalanish uchun avval kanalimizga a'zo bo'ling!\n\n` +
      `👇 A'zo bo'lgach, /start bosing`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 Kanalga a'zo bo'lish", url: "https://t.me/pythoncommands" }],
            [{ text: "✅ A'zo bo'ldim", callback_data: "check_sub" }],
          ],
        },
      }
    );
    return false;
  }
  return true;
}

// ===================== MATEMATIKA =====================

function isOpenAiReady() {
  return Boolean(OPENAI_API_KEY);
}

function looksLikeMath(text) {
  const value = text.toLowerCase();
  return /\d/.test(value) && /[+\-*/=^√()xxyy]/i.test(value) ||
    /tenglama|misol|hisobla|yech|foiz|kasr|ildiz|daraja|integral|limit|geometriya|algebra/.test(value);
}

function chunkText(text, maxLength = 3800) {
  const chunks = [];
  let rest = text;
  while (rest.length > maxLength) {
    const cut = rest.lastIndexOf("\n", maxLength);
    const index = cut > 1000 ? cut : maxLength;
    chunks.push(rest.slice(0, index));
    rest = rest.slice(index).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function stripMarkdown(text) {
  return text
    .replace(/[*_`#>\[\]()]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function askOpenAiForMath({ text, imageBase64, mimeType }) {
  if (!isOpenAiReady()) {
    throw new Error("OPENAI_API_KEY kerak");
  }

  const content = [
    {
      type: "text",
      text: `${text || "Rasmdagi matematika misolini o'qib yech."}\n\nJavobni o'zbek tilida ber. Avval misolni qisqa yoz, keyin bosqichma-bosqich yech, oxirida yakuniy javobni alohida ko'rsat. O'quvchiga tushunarli, sodda qilib tushuntir. Agar rasmda misol aniq ko'rinmasa, nima yetishmayotganini ayt.`,
    },
  ];

  if (imageBase64 && mimeType) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${imageBase64}` },
    });
  }

  const response = await axios.post(
    `${OPENAI_BASE_URL}/chat/completions`,
    {
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "Sen tajribali matematika o'qituvchisisan. O'zbek tilida juda sodda, bosqichma-bosqich tushuntirasan. Noto'g'ri ishonch bilan javob berma.",
        },
        { role: "user", content },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 90000,
    }
  );

  return response.data.choices?.[0]?.message?.content?.trim() || "Yechim topilmadi.";
}

async function createVoiceExplanation(solution) {
  if (!isOpenAiReady()) {
    throw new Error("OPENAI_API_KEY kerak");
  }

  const voiceText = stripMarkdown(solution).slice(0, 1800);
  const response = await axios.post(
    `${OPENAI_BASE_URL}/audio/speech`,
    {
      model: "tts-1",
      voice: "alloy",
      input: `Quyidagi matematika yechimini o'zbek tilida o'quvchiga sekin va tushunarli qilib aytib ber: ${voiceText}`,
      response_format: "opus",
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
      timeout: 90000,
    }
  );

  return Buffer.from(response.data);
}

async function sendMathSolution(chatId, options) {
  if (!isOpenAiReady()) {
    await bot.sendMessage(chatId, "🧮 Matematika funksiyasi uchun Railway Variables ichiga OPENAI_API_KEY qo'shish kerak.");
    return;
  }

  await bot.sendMessage(chatId, "🧮 Misolni yechyapman, biroz kuting...");

  const solution = await askOpenAiForMath(options);
  for (const part of chunkText(`🧮 Yechim:\n\n${solution}`)) {
    await bot.sendMessage(chatId, part);
  }

  try {
    const voice = await createVoiceExplanation(solution);
    await bot.sendVoice(chatId, voice, {}, { filename: "tushuntirish.ogg", contentType: "audio/ogg" });
  } catch (error) {
    console.error("Voice error:", error.response?.data?.toString?.() || error.message);
    await bot.sendMessage(chatId, "Yozma yechim tayyor. Ovozli tushuntirishni yuborishda xatolik bo'ldi.");
  }
}

async function downloadTelegramPhoto(fileId) {
  const fileUrl = await bot.getFileLink(fileId);
  const response = await axios.get(fileUrl, { responseType: "arraybuffer", timeout: 60000 });
  const mimeType = response.headers["content-type"] || "image/jpeg";
  return {
    imageBase64: Buffer.from(response.data).toString("base64"),
    mimeType,
  };
}

// ===================== WEATHER =====================

function getWeatherEmoji(icon) {
  const code = icon.slice(0, 2);
  const isDay = icon.endsWith("d");
  switch (code) {
    case "01": return isDay ? "☀️" : "🌙";
    case "02": return "⛅";
    case "03": return "🌤️";
    case "04": return "☁️";
    case "09": return "🌧️";
    case "10": return isDay ? "🌦️" : "🌧️";
    case "11": return "⛈️";
    case "12": return "🌨️";
    case "13": return "❄️";
    case "50": return "🌫️";
    default: return "🌡️";
  }
}

async function getCurrentWeather(cityQuery) {
  const res = await axios.get(`${WEATHER_BASE_URL}/weather`, {
    params: { q: cityQuery, appid: WEATHER_API_KEY, units: "metric", lang: "uz" },
  });
  const d = res.data;
  return {
    city: d.name,
    temp: Math.round(d.main.temp),
    feelsLike: Math.round(d.main.feels_like),
    humidity: d.main.humidity,
    windSpeed: d.wind.speed,
    description: d.weather[0].description,
    icon: d.weather[0].icon,
  };
}

async function getForecast(cityQuery) {
  const res = await axios.get(`${WEATHER_BASE_URL}/forecast`, {
    params: { q: cityQuery, appid: WEATHER_API_KEY, units: "metric", lang: "uz", cnt: 40 },
  });
  const dailyMap = new Map();
  for (const item of res.data.list) {
    const date = item.dt_txt.split(" ")[0];
    if (!dailyMap.has(date)) dailyMap.set(date, { temps: [], descriptions: [], icons: [] });
    const day = dailyMap.get(date);
    day.temps.push(item.main.temp);
    day.descriptions.push(item.weather[0].description);
    day.icons.push(item.weather[0].icon);
  }
  const result = [];
  for (const [date, data] of dailyMap.entries()) {
    const mid = Math.floor(data.descriptions.length / 2);
    result.push({
      date,
      minTemp: Math.round(Math.min(...data.temps)),
      maxTemp: Math.round(Math.max(...data.temps)),
      description: data.descriptions[mid],
      icon: data.icons[mid],
    });
  }
  return result.slice(1, 6);
}

function formatWeather(w, label) {
  const emoji = getWeatherEmoji(w.icon);
  const now = new Date();
  const dateStr = now.toLocaleDateString("uz-UZ", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  return (
    `${emoji} <b>${label} — Hozirgi ob-havo</b>\n` +
    `📅 ${dateStr} | 🕐 ${timeStr}\n\n` +
    `🌡️ <b>Harorat:</b> ${w.temp}°C\n` +
    `🤔 <b>His qilinish:</b> ${w.feelsLike}°C\n` +
    `📝 <b>Holat:</b> ${w.description}\n` +
    `💧 <b>Namlik:</b> ${w.humidity}%\n` +
    `💨 <b>Shamol:</b> ${w.windSpeed} m/s\n`
  );
}

function formatForecast(forecast, label) {
  let msg = `📅 <b>${label} — 5 kunlik bashorat</b>\n\n`;
  for (const day of forecast) {
    const date = new Date(day.date);
    const dayName = date.toLocaleDateString("uz-UZ", { weekday: "long", day: "numeric", month: "short" });
    const emoji = getWeatherEmoji(day.icon);
    msg += `${emoji} <b>${dayName}</b>\n   🌡️ ${day.minTemp}°C — ${day.maxTemp}°C | ${day.description}\n\n`;
  }
  return msg;
}

function formatDailyReport(w, label, isEvening) {
  const emoji = getWeatherEmoji(w.icon);
  if (isEvening) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tStr = tomorrow.toLocaleDateString("uz-UZ", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    return (
      `🌙 <b>${label} — Ertangi kun bashorati</b>\n📅 ${tStr}\n\n` +
      `${emoji} <b>Holat:</b> ${w.description}\n` +
      `🌡️ <b>Harorat:</b> ~${w.temp}°C\n` +
      `💧 <b>Namlik:</b> ${w.humidity}%\n` +
      `💨 <b>Shamol:</b> ${w.windSpeed} m/s\n\n` +
      `🌙 Yaxshi tunlar! Ertangi kunga tayyorlanib qo'ying.`
    );
  }
  const today = new Date();
  const dStr = today.toLocaleDateString("uz-UZ", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return (
    `☀️ <b>${label} — Bugungi ob-havo</b>\n📅 ${dStr}\n\n` +
    `${emoji} <b>Holat:</b> ${w.description}\n` +
    `🌡️ <b>Harorat:</b> ${w.temp}°C (his: ${w.feelsLike}°C)\n` +
    `💧 <b>Namlik:</b> ${w.humidity}%\n` +
    `💨 <b>Shamol:</b> ${w.windSpeed} m/s\n\n` +
    `🌅 Xayrli kun! Bugungi kuningiz yaxshi o'tsin!`
  );
}

// ===================== CITIES =====================

const CITIES = [
  { name: "toshkent",  label: "🏙️ Toshkent",         query: "Tashkent,UZ"  },
  { name: "samarqand", label: "🕌 Samarqand",          query: "Samarkand,UZ" },
  { name: "buxoro",    label: "🕌 Buxoro",             query: "Bukhara,UZ"   },
  { name: "namangan",  label: "🌿 Namangan",           query: "Namangan,UZ"  },
  { name: "andijon",   label: "🏭 Andijon",            query: "Andijan,UZ"   },
  { name: "fargona",   label: "🌾 Farg'ona",           query: "Fergana,UZ"   },
  { name: "qarshi",    label: "🏜️ Qarshi",             query: "Karshi,UZ"    },
  { name: "nukus",     label: "🌊 Nukus",              query: "Nukus,UZ"     },
  { name: "urganch",   label: "🏛️ Urganch",            query: "Urgench,UZ"   },
  { name: "termiz",    label: "☀️ Termiz",             query: "Termez,UZ"    },
  { name: "guliston",  label: "🌺 Guliston",           query: "Guliston,UZ"  },
  { name: "jizzax",    label: "🌄 Jizzax viloyati",    query: "Jizzax,UZ"    },
  { name: "zomin",     label: "⛰️ Zomin (Jizzax)",     query: "Zomin,UZ"     },
  { name: "navoi",     label: "⛏️ Navoiy",             query: "Navoi,UZ"     },
];

const DEFAULT_CITY = CITIES.find(c => c.name === "jizzax");

const CITY_KEYBOARD = {
  inline_keyboard: [
    [{ text: "🏙️ Toshkent",  callback_data: "city:toshkent"  }, { text: "🕌 Samarqand", callback_data: "city:samarqand" }],
    [{ text: "🕌 Buxoro",    callback_data: "city:buxoro"    }, { text: "🌿 Namangan",  callback_data: "city:namangan"  }],
    [{ text: "🏭 Andijon",   callback_data: "city:andijon"   }, { text: "🌾 Farg'ona",  callback_data: "city:fargona"   }],
    [{ text: "🏜️ Qarshi",    callback_data: "city:qarshi"    }, { text: "🌊 Nukus",     callback_data: "city:nukus"     }],
    [{ text: "🏛️ Urganch",   callback_data: "city:urganch"   }, { text: "☀️ Termiz",    callback_data: "city:termiz"    }],
    [{ text: "🌺 Guliston",  callback_data: "city:guliston"  }, { text: "⛏️ Navoiy",    callback_data: "city:navoi"     }],
    [{ text: "🌄 Jizzax",    callback_data: "city:jizzax"    }, { text: "⛰️ Zomin",     callback_data: "city:zomin"     }],
  ],
};

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: "🌤️ Hozirgi ob-havo" }, { text: "📅 5 kunlik bashorat" }],
    [{ text: "🏙️ Viloyatlar ro'yxati" }, { text: "⭐ Jizzax / Zomin" }],
    [{ text: "🧮 Matematik misol yechish" }, { text: "ℹ️ Yordam" }],
    [{ text: "🔔 Avtomatik bildirishnomalar" }, { text: "❌ Bildirishnomani o'chirish" }],
  ],
  resize_keyboard: true,
};

// ===================== SCHEDULER =====================

const scheduledChats = new Map();

// Doimiy kanallar — bot qayta ishga tushsa ham eslab turadi
const DEFAULT_CHANNELS = [
  { chatId: "@pythoncommands", cityQuery: "Jizzax,UZ", cityLabel: "🌄 Jizzax viloyati" },
];

DEFAULT_CHANNELS.forEach(ch => {
  scheduledChats.set(String(ch.chatId), ch);
});

function addChat(chatId, cityQuery, cityLabel) {
  scheduledChats.set(String(chatId), { chatId, cityQuery: cityQuery || DEFAULT_CITY.query, cityLabel: cityLabel || DEFAULT_CITY.label });
}
function removeChat(chatId) { scheduledChats.delete(String(chatId)); }
function updateChatCity(chatId, q, l) {
  const c = scheduledChats.get(String(chatId));
  if (c) { c.cityQuery = q; c.cityLabel = l; }
}

async function sendScheduled(isEvening) {
  for (const [, chat] of scheduledChats) {
    try {
      const w = await getCurrentWeather(chat.cityQuery);
      const msg = formatDailyReport(w, chat.cityLabel, isEvening);
      await bot.sendMessage(chat.chatId, msg, { parse_mode: "HTML" });
    } catch (e) {
      console.error("Scheduled send error:", e.message);
    }
  }
}

// Ertalab 08:00 Toshkent vaqti
cron.schedule("0 8 * * *", () => sendScheduled(false), { timezone: "Asia/Tashkent" });
// Kechqurun 21:00 Toshkent vaqti
cron.schedule("0 21 * * *", () => sendScheduled(true),  { timezone: "Asia/Tashkent" });

console.log("Scheduler ishga tushdi (08:00 va 21:00 Toshkent vaqti)");

// ===================== USER STATE =====================

const userCity = new Map();

function getUserQuery(userId) { return userCity.get(userId) || DEFAULT_CITY.query; }
function getUserLabel(userId) {
  const q = userCity.get(userId) || DEFAULT_CITY.query;
  return (CITIES.find(c => c.query === q) || DEFAULT_CITY).label;
}

// ===================== HANDLERS =====================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id || chatId;
  if (!(await checkSubscription(chatId, userId))) return;
  const name = msg.from?.first_name || "Foydalanuvchi";
  bot.sendMessage(chatId,
    `Salom, <b>${name}</b>! 🌤️\n\n` +
    `Men <b>Ob-havo va Matematika Botman</b>.\n\n` +
    `🌟 <b>Imkoniyatlarim:</b>\n` +
    `• Har qanday viloyat ob-havosi\n` +
    `• ⭐ Jizzax viloyati va Zomin tumani\n` +
    `• 📅 5 kunlik bashorat\n` +
    `• 🧮 Matematika misolini rasm yoki matndan yechish\n` +
    `• 🔊 Yechimni ovozli tushuntirish\n` +
    `• 🔔 Har kuni 08:00 ertalab va 21:00 kechqurun avtomatik xabar\n\n` +
    `Quyidagi tugmalardan foydalaning 👇`,
    { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
  );
});

bot.onText(/\/math(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id || chatId;
  if (!(await checkSubscription(chatId, userId))) return;
  const problem = match?.[1]?.trim();
  if (!problem) {
    await bot.sendMessage(chatId, "🧮 Misolni /math dan keyin yozing yoki rasm qilib yuboring.\nMasalan: /math 2x + 5 = 13");
    return;
  }
  try {
    await sendMathSolution(chatId, { text: problem });
  } catch (error) {
    console.error("Math error:", error.response?.data || error.message);
    await bot.sendMessage(chatId, "❌ Misolni yechishda xatolik bo'ldi. Keyinroq qayta urinib ko'ring.");
  }
});

bot.onText(/\/jizzax/, async (msg) => {
  await sendCityWeather(msg.chat.id, "Jizzax,UZ", "🌄 Jizzax viloyati");
});

bot.onText(/\/zomin/, async (msg) => {
  await sendCityWeather(msg.chat.id, "Zomin,UZ", "⛰️ Zomin tumani (Jizzax viloyati)");
});

bot.onText(/\/weather/, async (msg) => {
  const userId = msg.from?.id || msg.chat.id;
  await sendCityWeather(msg.chat.id, getUserQuery(userId), getUserLabel(userId));
});

bot.onText(/\/forecast/, async (msg) => {
  const userId = msg.from?.id || msg.chat.id;
  await sendForecastMsg(msg.chat.id, getUserQuery(userId), getUserLabel(userId));
});

bot.onText(/\/cities/, (msg) => {
  bot.sendMessage(msg.chat.id, "🏙️ <b>Shahar tanlang:</b>", { parse_mode: "HTML", reply_markup: CITY_KEYBOARD });
});

bot.onText(/\/subscribe/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id || chatId;
  addChat(chatId, getUserQuery(userId), getUserLabel(userId));
  bot.sendMessage(chatId,
    `✅ <b>Avtomatik bildirishnoma yoqildi!</b>\n\n` +
    `📍 ${getUserLabel(userId)}\n` +
    `🌅 Har kuni ertalab <b>08:00</b>\n` +
    `🌙 Har kuni kechqurun <b>21:00</b>\n` +
    `(Toshkent vaqti bo'yicha)`,
    { parse_mode: "HTML" }
  );
});

bot.onText(/\/unsubscribe/, (msg) => {
  removeChat(msg.chat.id);
  bot.sendMessage(msg.chat.id, "❌ Avtomatik bildirishnoma o'chirildi.");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id || chatId;
  const text = msg.text || msg.caption || "";
  if (text.startsWith("/")) return;
  if (!(await checkSubscription(chatId, userId))) return;

  if (msg.photo?.length) {
    try {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      const image = await downloadTelegramPhoto(largestPhoto.file_id);
      await sendMathSolution(chatId, { text: text || "Rasmdagi matematika misolini yech.", ...image });
    } catch (error) {
      console.error("Photo math error:", error.response?.data || error.message);
      await bot.sendMessage(chatId, "❌ Rasmni o'qish yoki misolni yechishda xatolik bo'ldi. Rasm tiniqroq bo'lsa, qayta yuboring.");
    }
    return;
  }

  if (text === "🌤️ Hozirgi ob-havo") {
    await sendCityWeather(chatId, getUserQuery(userId), getUserLabel(userId));
  } else if (text === "📅 5 kunlik bashorat") {
    await sendForecastMsg(chatId, getUserQuery(userId), getUserLabel(userId));
  } else if (text === "🏙️ Viloyatlar ro'yxati") {
    bot.sendMessage(chatId, "🏙️ <b>Shahar tanlang:</b>", { parse_mode: "HTML", reply_markup: CITY_KEYBOARD });
  } else if (text === "⭐ Jizzax / Zomin") {
    await sendJizzaxZomin(chatId);
  } else if (text === "🧮 Matematik misol yechish") {
    bot.sendMessage(chatId, "🧮 Misolingizni matn qilib yozing yoki rasm yuboring.\nMasalan: 3x + 7 = 22");
  } else if (text === "🔔 Avtomatik bildirishnomalar") {
    addChat(chatId, getUserQuery(userId), getUserLabel(userId));
    bot.sendMessage(chatId,
      `✅ <b>Avtomatik bildirishnoma yoqildi!</b>\n\n📍 ${getUserLabel(userId)}\n🌅 08:00 va 🌙 21:00 (Toshkent vaqti)`,
      { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
    );
  } else if (text === "❌ Bildirishnomani o'chirish") {
    removeChat(chatId);
    bot.sendMessage(chatId, "❌ Avtomatik bildirishnoma o'chirildi.", { reply_markup: MAIN_KEYBOARD });
  } else if (text === "ℹ️ Yordam") {
    sendHelp(chatId);
  } else if (text.length > 2) {
    const city = CITIES.find(c => text.toLowerCase().includes(c.name));
    if (city) {
      userCity.set(userId, city.query);
      updateChatCity(chatId, city.query, city.label);
      await sendCityWeather(chatId, city.query, city.label);
    } else if (looksLikeMath(text)) {
      try {
        await sendMathSolution(chatId, { text });
      } catch (error) {
        console.error("Math text error:", error.response?.data || error.message);
        await bot.sendMessage(chatId, "❌ Misolni yechishda xatolik bo'ldi. Keyinroq qayta urinib ko'ring.");
      }
    } else {
      try {
        const w = await getCurrentWeather(`${text},UZ`);
        bot.sendMessage(chatId, formatWeather(w, `📍 ${w.city}`), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD });
      } catch {
        bot.sendMessage(chatId, `❌ "${text}" shahri topilmadi.\n\nMatematika misoli bo'lsa /math bilan yuboring yoki rasm tashlang.`, { reply_markup: CITY_KEYBOARD });
      }
    }
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  const userId = query.from.id;
  if (!chatId) return;
  const data = query.data || "";

  if (data === "check_sub") {
    const subscribed = await isSubscribed(userId);
    if (subscribed) {
      await bot.answerCallbackQuery(query.id, { text: "✅ Rahmat! Endi botdan foydalanishingiz mumkin!" });
      const name = query.from.first_name || "Foydalanuvchi";
      await bot.sendMessage(chatId,
        `Salom, <b>${name}</b>! 🌤️ Xush kelibsiz!\n\nQuyidagi tugmalardan foydalaning 👇`,
        { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
      );
    } else {
      await bot.answerCallbackQuery(query.id, { text: "❌ Siz hali kanalga a'zo bo'lmagansiz!", show_alert: true });
    }
    return;
  }

  if (data.startsWith("city:")) {
    const cityName = data.replace("city:", "");
    const city = CITIES.find(c => c.name === cityName);
    if (city) {
      userCity.set(userId, city.query);
      updateChatCity(chatId, city.query, city.label);
      await bot.answerCallbackQuery(query.id, { text: `${city.label} tanlandi` });
      await sendCityWeather(chatId, city.query, city.label);
    }
  }
});

bot.on("my_chat_member", (msg) => {
  const chatId = msg.chat.id;
  const status = msg.new_chat_member.status;
  if (status === "member" || status === "administrator") {
    addChat(chatId, DEFAULT_CITY.query, DEFAULT_CITY.label);
    if (msg.chat.type !== "private") {
      bot.sendMessage(chatId,
        `Salom! 🌤️ <b>Ob-havo Bot</b> shu kanal/guruhga qo'shildi!\n\n` +
        `📍 Standart shahar: <b>Jizzax viloyati</b>\n` +
        `🌅 Har kuni <b>08:00</b> — bugungi ob-havo\n` +
        `🌙 Har kuni <b>21:00</b> — ertangi kun bashorati\n\n` +
        `Shaharni o'zgartirish: /cities`,
        { parse_mode: "HTML" }
      );
    }
  } else if (status === "left" || status === "kicked") {
    removeChat(chatId);
  }
});

// ===================== HELPERS =====================

async function sendCityWeather(chatId, cityQuery, cityLabel) {
  try {
    const w = await getCurrentWeather(cityQuery);
    bot.sendMessage(chatId, formatWeather(w, cityLabel), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD });
  } catch (e) {
    console.error("Weather error:", e.message);
    bot.sendMessage(chatId, "❌ Ob-havo ma'lumotini olishda xatolik. Keyinroq urinib ko'ring.");
  }
}

async function sendForecastMsg(chatId, cityQuery, cityLabel) {
  try {
    const forecast = await getForecast(cityQuery);
    bot.sendMessage(chatId, formatForecast(forecast, cityLabel), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD });
  } catch (e) {
    console.error("Forecast error:", e.message);
    bot.sendMessage(chatId, "❌ Bashorat ma'lumotini olishda xatolik.");
  }
}

async function sendJizzaxZomin(chatId) {
  try {
    const [j, z] = await Promise.all([
      getCurrentWeather("Jizzax,UZ"),
      getCurrentWeather("Zomin,UZ"),
    ]);
    await bot.sendMessage(chatId, formatWeather(j, "🌄 Jizzax viloyati"), { parse_mode: "HTML" });
    await bot.sendMessage(chatId, formatWeather(z, "⛰️ Zomin tumani"), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD });
  } catch (e) {
    bot.sendMessage(chatId, "❌ Jizzax/Zomin ob-havosini olishda xatolik.");
  }
}

function sendHelp(chatId) {
  bot.sendMessage(chatId,
    `ℹ️ <b>Ob-havo va Matematika Bot — Yordam</b>\n\n` +
    `<b>Buyruqlar:</b>\n` +
    `/start — Botni ishga tushirish\n` +
    `/weather — Hozirgi ob-havo\n` +
    `/forecast — 5 kunlik bashorat\n` +
    `/jizzax — Jizzax viloyati\n` +
    `/zomin — Zomin tumani\n` +
    `/cities — Shaharlar ro'yxati\n` +
    `/math misol — Matematik misolni yechish\n` +
    `/subscribe — Bildirishnomani yoqish\n` +
    `/unsubscribe — Bildirishnomani o'chirish\n\n` +
    `<b>Matematika:</b>\n` +
    `🧮 Misolni matn qilib yozing yoki rasm qilib yuboring. Bot yozma yechim va ovozli tushuntirish yuboradi.\n\n` +
    `<b>Avtomatik xabarlar:</b>\n` +
    `🌅 08:00 — Bugungi ob-havo\n` +
    `🌙 21:00 — Ertangi kun bashorati\n` +
    `(Toshkent vaqti bo'yicha)`,
    { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
  );
}

process.on("uncaughtException", (err) => console.error("Xatolik:", err.message));
process.on("unhandledRejection", (err) => console.error("Promise xatolik:", err));
