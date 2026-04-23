const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cron = require("node-cron");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || "cfb18895da0d8bf04a8307cc8550fe0d";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OpenAi || process.env.OPENAI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.Gemini || process.env.GEMINI || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMENI_API_KEY;
const WEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-4o";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
  polling: {
    interval: 1000,
    autoStart: true,
    params: {
      timeout: 10,
    },
  },
});

console.log("Bot ishga tushdi...");
console.log(`Node Environment: ${process.env.NODE_ENV || "development"}`);
console.log(`Bot polling o'rnatildi`);

bot.on("polling_error", (error) => {
  const message = error.response?.body?.description || error.message;
  console.error("Telegram polling error:", message);
});

// ===================== KANAL A'ZOLIGINI TEKSHIRISH =====================

const REQUIRED_CHANNEL = "@pythoncommands";

async function isSubscribed(userId) {
  try {
    const member = await bot.getChatMember(REQUIRED_CHANNEL, userId);
    console.log(`[isSubscribed] User ${userId} status: ${member.status}`);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (error) {
    console.error(`[isSubscribed] Error for user ${userId}:`, error.message);
    return false;
  }
}

async function checkSubscription(chatId, userId) {
  const subscribed = await isSubscribed(userId);
  if (!subscribed) {
    try {
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
    } catch (error) {
      console.error('[checkSubscription] Send message error:', error.message);
    }
    return false;
  }
  return true;
}

// ===================== MATEMATIKA =====================

function isOpenAiReady() {
  return Boolean(OPENAI_API_KEY);
}

function isGeminiReady() {
  return Boolean(GEMINI_API_KEY);
}

function isAiReady() {
  return isGeminiReady() || isOpenAiReady();
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
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\\\(([^)]*)\\\)/g, "$1")
    .replace(/\\\[([^\]]*)\\\]/g, "$1")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^}]*)\}/g, "ildiz($1)")
    .replace(/\\cdot/g, "*")
    .replace(/\\times/g, "*")
    .replace(/\\[a-zA-Z]+\{?/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getOpenAiErrorMessage(error) {
  const data = error.response?.data;
  if (Buffer.isBuffer(data)) return data.toString();
  if (typeof data === "string") return data;
  return data?.error?.message || data?.message || error.message || "Noma'lum xatolik";
}

function getAiErrorForUser(error) {
  const status = error.response?.status;
  const message = getOpenAiErrorMessage(error);
  const cleanMessage = String(message).replace(/\s+/g, " ").slice(0, 450);
  if (status === 400) return `AI so'rov formati yoki rasmda muammo bor: ${cleanMessage}`;
  if (status === 401 || status === 403) return `Gemini/OpenAI API kaliti ishlamayapti yoki ruxsat berilmagan: ${cleanMessage}`;
  if (status === 404) return `AI modeli topilmadi. Railway Variables ichida GEMINI_MODEL bo'lsa o'chirib tashlang yoki gemini-2.5-flash qiling: ${cleanMessage}`;
  if (status === 429) return `AI limit/quota tugagan yoki vaqtincha cheklov bor: ${cleanMessage}`;
  if (status >= 500) return `AI serverida vaqtincha xatolik bor: ${cleanMessage}`;
  return cleanMessage;
}

function isOpenAiQuotaError(error) {
  const message = getOpenAiErrorMessage(error).toLowerCase();
  const code = error.response?.data?.error?.code || "";
  return code === "insufficient_quota" || message.includes("quota") || message.includes("billing");
}

async function askOpenAiForMath({ text, imageBase64, mimeType }) {
  if (!isOpenAiReady()) {
    throw new Error("OPENAI_API_KEY kerak");
  }

  const model = imageBase64 ? OPENAI_IMAGE_MODEL : OPENAI_TEXT_MODEL;
  const content = [
    {
      type: "text",
      text: `${text || "Rasmdagi matematika misolini o'qib yech."}\n\nRasm bo'lsa avval undagi matn, chizma va berilgan qiymatlarni diqqat bilan o'qib ol. Javobni o'zbek tilida ber. Avval misol shartini qisqa yoz, keyin bosqichma-bosqich yech, oxirida yakuniy javobni alohida ko'rsat. O'quvchiga tushunarli, sodda qilib tushuntir. Agar rasmda misol aniq ko'rinmasa, nima yetishmayotganini ayt.`,
    },
  ];

  if (imageBase64 && mimeType) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: "high" },
    });
  }

  const response = await axios.post(
    `${OPENAI_BASE_URL}/chat/completions`,
    {
      model,
      temperature: 0.2,
      max_tokens: 1600,
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

const GEMINI_FALLBACK_MODELS = ["gemini-2.5-pro", "gemini-flash-latest", "gemini-2.0-flash"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGeminiError(error) {
  const status = error.response?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  const message = String(getOpenAiErrorMessage(error)).toLowerCase();
  return message.includes("overload") || message.includes("high demand") || message.includes("unavailable") || message.includes("try again");
}

async function callGeminiOnce(model, body) {
  return axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    body,
    {
      params: { key: GEMINI_API_KEY },
      headers: { "Content-Type": "application/json" },
      timeout: 120000,
    }
  );
}

async function askGeminiForMath({ text, imageBase64, mimeType }) {
  if (!isGeminiReady()) {
    throw new Error("GEMINI_API_KEY kerak");
  }

  const prompt = `${text || "Rasmdagi matematika misolini o'qib yech."}

Quyidagi qoidalarga qat'iy amal qil:
- Faqat oddiy matn yoz, hech qanday markdown belgilarini ishlatma (** _ # \` $ [ ] yo'q).
- LaTeX formulalari yo'q. Daraja uchun ^ va ildiz uchun "ildiz()" yoki "sqrt()" yoz.
- Javob o'zbek tilida bo'lsin.
- Tartibi: 1) "Misol:" so'zi bilan misol shartini bir qator yoz. 2) "Yechish:" deb yozib, qadamlarni 1., 2., 3. tarzida raqamlab yoz. 3) "Javob:" deb oxirgi natijani yoz.
- Qisqa va aniq yoz, keraksiz so'zlarsiz. Har bir qadam 1-2 qatordan oshmasin.
- Agar rasmda misol aniq ko'rinmasa, nima ko'rinmayotganini bir qatorda yoz.`;

  const parts = [{ text: prompt }];
  if (imageBase64 && mimeType) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: imageBase64,
      },
    });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
    },
  };

  const modelsToTry = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== GEMINI_MODEL)];
  let response;
  let lastError;
  outer: for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await callGeminiOnce(model, body);
        lastError = null;
        break outer;
      } catch (error) {
        lastError = error;
        if (!isTransientGeminiError(error)) {
          if (model !== modelsToTry[modelsToTry.length - 1] && error.response?.status === 404) {
            break;
          }
          throw error;
        }
        await sleep(1500 * (attempt + 1));
      }
    }
  }
  if (!response) throw lastError;

  const candidate = response.data.candidates?.[0];
  const blockReason = response.data.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini rasmni qabul qilmadi (blockReason: ${blockReason}). Rasmda ruxsat etilmagan kontent bo'lishi mumkin.`);
  }
  const partsText = candidate?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  if (!partsText) {
    const finishReason = candidate?.finishReason || "noma'lum";
    throw new Error(`Gemini bo'sh javob qaytardi (finishReason: ${finishReason}). Rasmni tiniqroq, yorug'roq qilib qayta yuboring yoki misolni matn qilib yozing.`);
  }
  return partsText;
}

async function askAiForMath(options) {
  if (isGeminiReady()) {
    try {
      return await askGeminiForMath(options);
    } catch (error) {
      console.error("Gemini math error:", getOpenAiErrorMessage(error));
      if (!isOpenAiReady()) throw error;
      try {
        return await askOpenAiForMath(options);
      } catch (openaiError) {
        console.error("OpenAI math fallback error:", getOpenAiErrorMessage(openaiError));
        throw error;
      }
    }
  }
  return askOpenAiForMath(options);
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

function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}

async function createGeminiAudioExplanation(solution) {
  if (!isGeminiReady()) {
    throw new Error("GEMINI_API_KEY kerak");
  }
  const voiceText = stripMarkdown(solution).replace(/\s+/g, " ").trim().slice(0, 1500);
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent`,
    {
      contents: [{ parts: [{ text: `O'qib ber: ${voiceText}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
        },
      },
    },
    {
      params: { key: GEMINI_API_KEY },
      headers: { "Content-Type": "application/json" },
      timeout: 120000,
    }
  );
  const audioBase64 = response.data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    || response.data.candidates?.[0]?.content?.parts?.[0]?.inline_data?.data;
  if (!audioBase64) {
    throw new Error("Gemini ovoz qaytarmadi.");
  }
  const pcm = Buffer.from(audioBase64, "base64");
  return pcmToWav(pcm, 24000, 1, 16);
}

async function sendMathSolution(chatId, options) {
  if (!isAiReady()) {
    await bot.sendMessage(chatId, "🧮 Matematika funksiyasi uchun Railway Variables ichiga GEMINI_API_KEY yoki OPENAI_API_KEY qo'shish kerak.");
    return;
  }

  await bot.sendMessage(chatId, "🧮 Misolni yechyapman, biroz kuting...");

  let solution;
  try {
    solution = await askAiForMath(options);
  } catch (error) {
    console.error("AI math error:", getOpenAiErrorMessage(error));
    if (isOpenAiQuotaError(error)) {
      await bot.sendMessage(chatId, `❌ AI limit/quota muammosi: ${getAiErrorForUser(error)}\n\nRailway Variables ichida GEMINI_API_KEY to'g'ri qo'yilganini tekshiring.`);
      return;
    }
    if (options.imageBase64) {
      await bot.sendMessage(chatId, `❌ Rasmni AI orqali o'qishda xatolik bo'ldi.\n\nSabab: ${getAiErrorForUser(error)}\n\nRasm tiniq bo'lsa ham shu chiqsa, Railway Variables ichida GEMINI_API_KEY va GEMINI_MODEL ni tekshiring.`);
    } else {
      await bot.sendMessage(chatId, `❌ Misolni yechishda xatolik bo'ldi.\n\nSabab: ${getAiErrorForUser(error)}`);
    }
    return;
  }
  const cleanSolution = stripMarkdown(solution);
  for (const part of chunkText(`🧮 Yechim:\n\n${cleanSolution}`)) {
    await bot.sendMessage(chatId, part);
  }

  let voiceSent = false;
  let lastVoiceError = null;
  if (isGeminiReady()) {
    try {
      const audio = await createGeminiAudioExplanation(solution);
      await bot.sendAudio(chatId, audio, {
        caption: "🔊 Ovozli tushuntirish",
        filename: "tushuntirish.wav",
        contentType: "audio/wav",
      });
      voiceSent = true;
    } catch (error) {
      lastVoiceError = error;
      console.error("Gemini TTS error:", getOpenAiErrorMessage(error));
    }
  }
  if (!voiceSent && isOpenAiReady()) {
    try {
      const voice = await createVoiceExplanation(solution);
      await bot.sendVoice(chatId, voice, {
        filename: "tushuntirish.ogg",
        contentType: "audio/ogg",
      });
      voiceSent = true;
    } catch (error) {
      lastVoiceError = error;
      console.error("OpenAI TTS error:", getOpenAiErrorMessage(error));
    }
  }
  if (!voiceSent && lastVoiceError) {
    await bot.sendMessage(chatId, `Yozma yechim tayyor. Ovozli tushuntirish ishlamadi.\nSabab: ${getAiErrorForUser(lastVoiceError)}`);
  }
}

// ===================== RASM YARATISH (Pollinations - tekin) =====================

async function generateImageWithPollinations(promptText, retryCount = 0) {
  console.log('[generateImageWithPollinations] Start with retry:', retryCount);
  if (!promptText || promptText.trim().length === 0) {
    throw new Error("Tasvir bo'sh bo'lishi mumkin emas.");
  }

  const seed = Math.floor(Math.random() * 1000000);
  const encodedPrompt = encodeURIComponent(promptText.slice(0, 300));
  const url = `https://enter.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&seed=${seed}`;
  
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 150000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "image/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://pollinations.ai",
      },
    });
    
    const contentType = response.headers["content-type"] || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      if (retryCount < 3) {
        await sleep(3000 * (retryCount + 1));
        return generateImageWithPollinations(promptText, retryCount + 1);
      }
      throw new Error("Pollinations server error. DeepAI yoki HuggingFace orqali urinalmoqda...");
    }
    
    const buffer = Buffer.from(response.data);
    if (buffer.length === 0 || buffer.length < 1000) {
      throw new Error("Rasm hajmi juda kichik yoki bo'sh.");
    }
    
    return { buffer, mimeType: contentType };
  } catch (error) {
    const msg = String(error.message).toLowerCase();
    if (error.response?.status === 503 || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || msg.includes("html")) {
      if (retryCount < 3) {
        await sleep(3000 * (retryCount + 1));
        return generateImageWithPollinations(promptText, retryCount + 1);
      }
      throw new Error("Pollinations xizmat muammoli. DeepAI yoki HuggingFace orqali urinalmoqda...");
    }
    if (error.response?.status === 400) {
      throw new Error("Tasvir noto'g'ri. O'zbek tilida qisqa tasvirlab yozing.");
    }
    throw error;
  }
}

async function generateImageWithDeepAI(promptText) {
  const DEEPAI_API_KEY = process.env.DEEPAI_API_KEY;
  if (!DEEPAI_API_KEY) {
    throw new Error("DEEPAI_API_KEY kerak");
  }

  const response = await axios.post(
    "https://api.deepai.org/api/text2img",
    {
      text: promptText,
    },
    {
      headers: {
        "Api-Key": DEEPAI_API_KEY,
      },
      timeout: 60000,
    }
  );

  const imageUrl = response.data.output_url;
  if (!imageUrl) {
    throw new Error("DeepAI rasm yaratmadi");
  }

  const imageResponse = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
  });

  return { buffer: Buffer.from(imageResponse.data), mimeType: "image/png" };
}

async function generateImageWithHuggingFace(promptText) {
  const HF_API_KEY = process.env.HF_API_KEY;
  if (!HF_API_KEY) {
    throw new Error("HF_API_KEY kerak");
  }

  const response = await axios.post(
    "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2-1",
    {
      inputs: promptText,
    },
    {
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
      },
      responseType: "arraybuffer",
      timeout: 60000,
    }
  );

  return { buffer: Buffer.from(response.data), mimeType: "image/png" };
}

async function generateImageWithDallE3(promptText) {
  if (!isOpenAiReady()) {
    throw new Error("OPENAI_API_KEY kerak");
  }

  const response = await axios.post(
    `${OPENAI_BASE_URL}/images/generations`,
    {
      model: "dall-e-3",
      prompt: promptText.slice(0, 1000),
      n: 1,
      size: "1024x1024",
      quality: "standard",
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  const imageUrl = response.data.data?.[0]?.url;
  if (!imageUrl) throw new Error("DALL-E 3 rasm URL qaytarmadi");

  const imageResponse = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
  });

  return { buffer: Buffer.from(imageResponse.data), mimeType: "image/png" };
}

async function generateImage(promptText) {
  console.log('[generateImage] Start');
  let lastError;
  try {
    return await generateImageWithPollinations(promptText);
  } catch (error) {
    console.error("Pollinations error:", error.message);
    lastError = error;
  }

  if (process.env.DEEPAI_API_KEY) {
    try {
      console.log("DeepAI orqali urinalmoqda...");
      return await generateImageWithDeepAI(promptText);
    } catch (deepaiError) {
      console.error("DeepAI error:", deepaiError.message);
      lastError = deepaiError;
    }
  }

  if (process.env.HF_API_KEY) {
    try {
      console.log("HuggingFace orqali urinalmoqda...");
      return await generateImageWithHuggingFace(promptText);
    } catch (hfError) {
      console.error("HuggingFace error:", hfError.message);
      lastError = hfError;
    }
  }

  // Gemini Imagen not free
  // if (isGeminiReady()) {
  //   try {
  //     console.log("Gemini Imagen orqali urinalmoqda...");
  //     return await generateImageWithGemini(promptText);
  //   } catch (geminiError) {
  //     console.error("Gemini Imagen error:", geminiError.message);
  //     lastError = geminiError;
  //   }
  // }

  // DALL-E disabled for free version
  // if (isOpenAiReady()) {
  //   try {
  //     console.log("DALL-E 3 orqali urinalmoqda...");
  //     return await generateImageWithDallE3(promptText);
  //   } catch (dalleError) {
  //     console.error("DALL-E 3 error:", dalleError.message);
  //     lastError = dalleError;
  //   }
  // }

  console.error('[generateImage] All attempts failed:', lastError?.message);
  throw lastError || new Error("Rasm yaratish xizmatlar mavjud emas");
}

async function handleImageGeneration(chatId, userId, promptText) {
  try {
    console.log('[handleImageGeneration] Start for:', promptText.slice(0, 50));
    promptText = promptText.trim();
    if (!promptText) {
      await bot.sendMessage(chatId, "❌ Tasvir bo'sh bo'lishi mumkin emas. O'zbek tilida qanday rasm xohlayotganingizni yozing.");
      return;
    }

    console.log('[handleImageGeneration] Sending waiting message...');
    await bot.sendMessage(chatId, "🎨 Rasm yaratyapman, biroz kuting (30 soniyagacha)...");
    
    console.log('[handleImageGeneration] Calling generateImage...');
    const { buffer, mimeType } = await generateImage(promptText);
    console.log('[handleImageGeneration] Got image, buffer size:', buffer.length);
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const caption = `🎨 ${promptText.slice(0, 900)}`;
    
    // Telegram API uchun to'g'ri format
    await bot.sendPhoto(chatId, buffer, {
      caption,
      filename: `rasm.${ext}`,
      contentType: mimeType,
    });
  } catch (error) {
    console.error("Image generation error:", error.message);
    const userMessage = getAiErrorForUser(error);
    await bot.sendMessage(
      chatId, 
      `❌ Rasm yaratishda xatolik bo'ldi.\n\nSabab: ${userMessage}\n\n💡 Almashtirish:\n• Rasmdagi Uzbek tilida yozing\n• Qisqa tasvir qilib ko'ring (5-20 so'z)\n• Boshqa tasvir bilan urinib ko'ring\n• Biroz keyinroq qayta yuboring`
    );
  }
}

async function downloadTelegramPhoto(fileId) {
  const fileUrl = await bot.getFileLink(fileId);
  const response = await axios.get(fileUrl, { responseType: "arraybuffer", timeout: 60000 });
  let mimeType = response.headers["content-type"] || "image/jpeg";
  if (!mimeType.startsWith("image/")) mimeType = "image/jpeg";
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
    [{ text: "🧮 Matematik misol yechish" }],
    [{ text: "ℹ️ Yordam" }],
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
const pendingImagePrompt = new Set();

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
    `• 🎨 Tasvirdan rasm yaratish (sun'iy intellekt)\n` +
    `• 🔔 Har kuni 08:00 ertalab va 21:00 kechqurun avtomatik xabar\n\n` +
    `Quyidagi tugmalardan foydalaning 👇`,
    { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
  );
});

bot.onText(/\/rasm(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id || chatId;
  // if (!(await checkSubscription(chatId, userId))) return;
  const promptText = match?.[1]?.trim();
  if (!promptText) {
    pendingImagePrompt.add(userId);
    await bot.sendMessage(chatId, 
      "🎨 Qanday rasm xohlaysiz? O'zbek tilida qisqa tasvirlab yozing.\n\n" +
      "Misollar:\n" +
      "• \"Tog' tepasida quyosh chiqishi\"\n" +
      "• \"Samarqand Registon kechqurun\"\n" +
      "• \"O'zbek milliy oshpazi tayyor qilayotgan plov\""
    );
    return;
  }
  await handleImageGeneration(chatId, userId, promptText);
});

bot.onText(/\/math(?:\s+(.+))?/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from?.id || chatId;
  // if (!(await checkSubscription(chatId, userId))) return;
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
  const rawText = msg.text || msg.caption || "";
  const text = rawText.trim();
  const isImageCommand = /rasm yaratish/i.test(text);

  console.log('[message handler] Incoming text:', text, 'user:', userId);
  if (text.startsWith("/")) return;
  // Temporarily disabled subscription check
  // try {
  //   if (!(await checkSubscription(chatId, userId))) return;
  // } catch (error) {
  //   console.error('[message handler] Subscription check error:', error.message);
  //   return;
  // }

  if (pendingImagePrompt.has(userId) && text && !isImageCommand) {
    try {
      console.log('[message handler] Image prompt detected:', text.slice(0, 50));
      pendingImagePrompt.delete(userId);
      await handleImageGeneration(chatId, userId, text);
    } catch (error) {
      console.error('[message handler] Image generation error:', error);
      await bot.sendMessage(chatId, "❌ Rasm yaratishda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.");
    }
    return;
  }

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

  if (isImageCommand) {
    pendingImagePrompt.add(userId);
    await bot.sendMessage(chatId,
      "🎨 Qanday rasm xohlaysiz? O'zbek tilida qisqa tasvirlab yozing.\n\n" +
      "Misollar:\n" +
      "• \"Tog' tepasida quyosh chiqishi\"\n" +
      "• \"Samarqand Registon kechqurun\"\n" +
      "• \"O'zbek milliy oshpazi tayyor qilayotgan plov\"\n\n" +
      "⏱️ Rasm yaratish 20-30 soniya vaqt olishi mumkin."
    );
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
    console.log('[message handler] Math button pressed');
    pendingImagePrompt.delete(userId);
    try {
      await bot.sendMessage(chatId, "🧮 Misolingizni matn qilib yozing yoki rasm yuboring.\nMasalan: 3x + 7 = 22");
    } catch (error) {
      console.error('[message handler] Send math message error:', error.message);
    }
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

async function shutdown(signal) {
  console.log(`${signal} qabul qilindi, bot to'xtatilmoqda...`);
  try {
    await bot.stopPolling();
  } catch (error) {
    console.error("Polling to'xtatishda xatolik:", error.message);
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => console.error("Xatolik:", err.message));
process.on("unhandledRejection", (err) => console.error("Promise xatolik:", err));
