# 🌤️ Ob-havo va Matematika Telegram Bot

O'zbek tilida ob-havo ma'lumotlari, matematika misollarini yechish, ovozli tushuntirish va rasm yaratish funksiyalari bilan Telegram boti.

## ✨ Funksiyalar

- **🌤️ Ob-havo**: Har qanday O'zbekiston shahri uchun hozirgi ob-havo va 5 kunlik bashorat
- **🧮 Matematika**: Misollarni matn yoki rasm qilib yechish, AI orqali yechim va ovozli tushuntirish
- **🎨 Rasm yaratish**: Sun'iy intellekt orqali tasvirdan rasm yaratish
- **🎥 Video yaratish**: Sayt API orqali video yaratish va Telegramga yuborish
- **🔔 Avtomatik xabarlar**: Har kuni 08:00 va 21:00 da ob-havo bildirishnomasi

## 🚀 Railway'da Deployment

### 1. Bot Token Olish

1. Telegram'da [@BotFather](https://t.me/botfather) ga yozing
2. `/newbot` buyrug'ini union
3. Bot nomini va username'ni kiriting
4. **Token**ni saqlang (masalan: `123456789:ABCDefGhIJKlmnoPQRstuvWXYZ`)

### 2. API Keys Tayyorlash

#### Option A: Google Gemini (TAVSIYA QILINADI - BEPUL)

1. [Google AI Studio](https://aistudio.google.com/) ga kiring
2. **Create API Key** tugmasini bosing
3. **Gemini API Key** ni oling va saqlang

#### Option B: OpenAI (Pullik)

1. [OpenAI Platform](https://platform.openai.com/) ga kiring
2. API Key yarating
3. Kredit qo'shib qo'ying

### 3. Railway'da Deploy Qilish

#### GitHub orqali (tavsiya qilinadi):

1. Repositoriyani GitHub'ga push qiling
2. [Railway.app](https://railway.app/) ga kiring
3. "New Project" → "Deploy from GitHub repository"
4. Repositoriyani tanlang
5. **Environment Variables** bo'limiga qo'shing:

```
TELEGRAM_BOT_TOKEN=123456789:ABCDefGhIJKlmnoPQRstuvWXYZ
GEMINI_API_KEY=your_gemini_api_key
```

#### Manual CLI orqali:

```bash
npm install -g @railway/cli
railway init
railway up
```

### 4. Environment Variables

Railway'da **Variables** bo'limiga qo'shish kerak bo'lgan o'zgaruvchilar:

| Variable | Tavsif | Kerak/Ixtiyoriy | Misol |
|----------|--------|-----------------|--------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API Token | **KERAK** | `123456789:ABC...` |
| `GEMINI_API_KEY` | Google Gemini API Key | Kerak (yoki OpenAI) | `AIzaSy...` |
| `OPENAI_API_KEY` | OpenAI API Key | Kerak (yoki Gemini) | `sk-...` |
| `WEATHER_API_KEY` | OpenWeatherMap API Key | Ixtiyoriy | Default: `cfb18895da0d8bf04a8307cc8550fe0d` |
| `GEMINI_MODEL` | Gemini model nomi | Ixtiyoriy | Default: `gemini-2.5-flash` |
| `VIDEO_API_URL` | Video yaratish uchun sayt API manzili | Ixtiyoriy | `https://example.com/api/video` |
| `VIDEO_API_KEY` | Video API kaliti | Ixtiyoriy | `your_video_api_key_here` |
| `VIDEO_API_KEY_HEADER` | Video API uchun kalit header nomi | Ixtiyoriy | `Authorization` yoki `x-api-key` |
| `VIDEO_API_EXTRA` | Qo'shimcha video API so'rov maydonchasi (JSON) | Ixtiyoriy | `{"model":"video-v1"}` |

### 5. Video API integratsiyasi
Agar sayt orqali botga video yuborish kerak bo'lsa, `POST /create-video` endpoint ishlaydi.

So'rov JSON formatida bo'lishi kerak:
```json
{
  "chat_id": 123456789,
  "text": "Bola ko'chada yoshi kattaroq insonga salom berdi"
}
```

Bot API quyidagi parametrlarni kutadi:
- `chat_id` — Telegram chat ID
- `text` — o'zbek tilidagi sahna tavsifi

Videodagi dialoglar 100% o'zbek tilida bo'lishi kerak, lekin prompt xizmati ingliz tilida yaratiladi.

### 6. Kanal Tekshirish (A'zolik)

Bot default o'rnatish bilan [@pythoncommands](https://t.me/pythoncommands) kanaliga a'zo bo'lishni talab qiladi.

Shu kanalga a'zo bo'lmasangiz, bot javob bermaydi.

**O'zgarish uchun code'da qo'llanish:**
```javascript
const REQUIRED_CHANNEL = "@your_channel_name";
```

## 📋 Local Development

```bash
# Dependencies o'rnatish
npm install

# .env faylni tayyorlash
cp .env.example .env
# .env'ni to'ldirish: TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, VIDEO_API_URL, VIDEO_API_KEY

# Bot ishga tushirish
npm start
```

## 🛠️ Troubleshooting

### Rasm yaratish ishlamayapti

1. **Tavsif masalasi**: O'zbek tilida qisqa tasvir qilib ko'ring (5-20 so'z)
2. **Pollinations API cheklov**: Bir vaqtning ko'piga rasm yaratmaslik
3. **Internet**: Railway'da internet ulanish mavjud ekanligini tekshiring

### Matematika yechishda xatolik

```
❌ AI limit/quota muammosi
```
**Yechim:**
- Gemini API Key to'g'ri yozilganini tekshiring
- OpenAI API'da kredit bo'lganini tekshiring
- Ma'lum vaqtda qayta urinib ko'ring

### Bot javob bermayapti

1. **Channel o'zolik**: [@pythoncommands](https://t.me/pythoncommands) kanalga a'zo bo'ling
2. **Token tekshirish**: `TELEGRAM_BOT_TOKEN` to'g'ri kiritilganini tekshiring
3. **Railway logs**: Railway dashboard'da logs ko'ring

## 📁 Fayllar Tuzilishi

```
├── index.js              # Bot kodi
├── package.json          # Dependencies
├── .env.example          # Environment o'zgaruvchilar misoli
├── Dockerfile            # Docker konfiguratsiyasi
├── railway.json          # Railway deployment konfiguratsiyasi
├── nixpacks.toml         # NIXPACKS konfiguratsiyasi
└── README.md             # Bu faylы
```

## 🔧 Teknis Ma'lumotlar

- **Node.js**: v20+
- **Bot Framework**: node-telegram-bot-api
- **AI Services**: Google Gemini, OpenAI
- **Image Generation**: Pollinations.ai (bepul)
- **Scheduler**: node-cron

## 📞 Bog'lanish

Bot uchun muammolar yoki taklif uchun GitHub issues'da yozing.

---

**Maqsad**: O'zbekiston talebalarining o'quv jarayonini tezlashtirish 📚
