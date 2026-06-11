# 🎮 No Risk No Fun

لعبة جماعية تفاعلية (خداع وتوقّع) يتحكم بها المقدم بالكامل — كل لاعب من جواله، بطاقته الزرقاء يراها الجميع... إلا هو!

---

## المزايا

- ✅ واجهتان منفصلتان: **لوحة المقدم** (`/host`) و**واجهة اللاعب** (`/`)
- ✅ غرف برمز من 6 أرقام
- ✅ بطاقات زرقاء (الزرقاء) + صفّان أحمران سرّيان — اختيار أعمى من 10 بطاقات مخلوطة
- ✅ المقدم يتحكم بدور كل لاعب، والكشف، واحتساب الفائز (يدوي أو تلقائي)
- ✅ تحدّي / انسحاب آمن، قلوب وإقصاء، كؤوس للفائزين
- ✅ إدارة قلوب كاملة: فردي وجماعي، إضافة/خصم/تحديد، قيمة افتراضية 1–99، مع سجل كامل
- ✅ مجموعات وجولات لمجموعة محددة
- ✅ انضمام أثناء اللعب بموافقة المقدم
- ✅ **إعادة اتصال تلقائية**: إغلاق المتصفح أو انقطاع النت أو حتى إعادة تشغيل الخادم — كل شيء يُستعاد
- ✅ تصدير/استيراد حالة اللعبة
- ✅ عربي RTL، تصميم موبايل أولاً، حركات عند الكشف والفوز وخسارة القلب
- ✅ SQLite بدون أي حزم native (مدمج في Node.js) — نشر سهل جداً

---

## المتطلبات

| المتطلب | الإصدار |
|---|---|
| Node.js | **22.5 أو أحدث** (إلزامي — قاعدة البيانات تستخدم `node:sqlite` المدمج) |
| npm | 10+ |

---

## 1️⃣ التشغيل المحلي (التطوير)

```bash
# 1. فك الضغط وادخل المجلد
cd no-risk-no-fun

# 2. ثبّت الحزم
npm install

# 3. شغّل بوضع التطوير
npm run dev
```

ثم افتح:
- المقدم: http://localhost:3000/host
- اللاعبون: http://localhost:3000/

لتجربة اللاعبين من جوالات على نفس الشبكة: استخدم IP جهازك، مثل `http://192.168.1.10:3000`

### التشغيل المحلي بوضع الإنتاج

```bash
npm install
npm run build
npm start
```

---

## 2️⃣ هيكل المشروع

```
no-risk-no-fun/
├── server.js              # الخادم: Express + Next.js + Socket.IO (كل أحداث اللعبة)
├── lib/
│   ├── db.js              # SQLite (node:sqlite) — الغرف + سجل الأحداث
│   └── game.js            # منطق اللعبة كاملاً (بطاقات، مراحل، نقاط، رؤية)
├── pages/
│   ├── index.js           # واجهة اللاعب
│   ├── host.js            # لوحة المقدم
│   ├── _app.js
│   └── _document.js       # RTL + الخطوط العربية
├── styles/globals.css     # التصميم كاملاً
├── data/                  # قاعدة البيانات game.db (تُنشأ تلقائياً)
├── deploy/nginx.conf      # إعداد Nginx جاهز
├── ecosystem.config.js    # إعداد PM2
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 3️⃣ قاعدة البيانات (SQLite)

تُنشأ تلقائياً في `data/game.db` عند أول تشغيل. لا تحتاج أي إعداد.

```sql
-- الغرف: الحالة الكاملة لكل غرفة (لاعبون، بطاقات، مراحل) بصيغة JSON
CREATE TABLE rooms (
  code        TEXT PRIMARY KEY,   -- رمز الغرفة (6 أرقام)
  state       TEXT NOT NULL,      -- JSON كامل لحالة الغرفة
  updated_at  TEXT NOT NULL
);

-- سجل الأحداث (القلوب، الكشف، الانضمام... إلخ)
CREATE TABLE logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code   TEXT NOT NULL,
  time        TEXT NOT NULL,      -- وقت الحدث ISO
  action      TEXT NOT NULL,      -- نوع الإجراء
  player_name TEXT,               -- اللاعب المتأثر
  prev_value  TEXT,               -- القيمة السابقة
  new_value   TEXT,               -- القيمة الجديدة
  details     TEXT
);
```

**نسخة احتياطية:** انسخ ملف `data/game.db` فقط.

---

## 4️⃣ متغيرات البيئة

انسخ `.env.example` إلى `.env` (اختياري — القيم الافتراضية تعمل مباشرة):

```env
PORT=3000            # منفذ التشغيل
NODE_ENV=production
DATA_DIR=./data      # مجلد قاعدة البيانات
```

---

## 5️⃣ النشر على VPS (أوبنتو) — خطوة بخطوة

> مناسب لـ Ubuntu 22.04 / 24.04. نفّذ الأوامر بالترتيب.

### أ. تثبيت Node.js 22

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # يجب أن يكون v22.x
```

### ب. رفع المشروع

```bash
# الطريقة 1: رفع ملف مضغوط من جهازك
scp no-risk-no-fun.zip root@SERVER_IP:/var/www/
ssh root@SERVER_IP
cd /var/www && sudo apt install -y unzip && unzip no-risk-no-fun.zip
cd no-risk-no-fun

# الطريقة 2: من Git (إن رفعته على مستودع)
# git clone YOUR_REPO_URL /var/www/no-risk-no-fun && cd /var/www/no-risk-no-fun
```

### ج. التثبيت والبناء

```bash
npm install
npm run build
```

### د. تجربة سريعة

```bash
NODE_ENV=production node server.js
# افتح http://SERVER_IP:3000/host — إذا اشتغل، أوقفه بـ Ctrl+C وكمّل
```

---

## 6️⃣ التشغيل الدائم بـ PM2

```bash
# تثبيت PM2
sudo npm install -g pm2

# تشغيل اللعبة
cd /var/www/no-risk-no-fun
mkdir -p logs
pm2 start ecosystem.config.js

# التشغيل التلقائي بعد إعادة تشغيل السيرفر
pm2 save
pm2 startup
# انسخ والصق الأمر الذي يطبعه لك ثم نفّذه

# أوامر مفيدة
pm2 status                  # الحالة
pm2 logs no-risk-no-fun     # السجلات المباشرة
pm2 restart no-risk-no-fun  # إعادة تشغيل
pm2 stop no-risk-no-fun     # إيقاف
```

> ⚠️ **مهم:** لا تشغّل أكثر من نسخة (instances: 1) — حالة اللعبة و Socket.IO تتطلب نسخة واحدة.

---

## 7️⃣ ربط الدومين

1. من لوحة مزود الدومين (Namecheap / GoDaddy / Cloudflare...) أضف سجلين:

| النوع | الاسم | القيمة |
|---|---|---|
| A | @ | IP السيرفر |
| A | www | IP السيرفر |

2. انتظر دقائق حتى ينتشر الـ DNS (تحقق: `ping yourdomain.com`)

---

## 8️⃣ إعداد Nginx

```bash
sudo apt install -y nginx

# انسخ الإعداد الجاهز
sudo cp deploy/nginx.conf /etc/nginx/sites-available/no-risk-no-fun

# عدّل الدومين داخل الملف
sudo nano /etc/nginx/sites-available/no-risk-no-fun
# استبدل yourdomain.com بدومينك (موجود في سطرين)

# فعّل الموقع
sudo ln -s /etc/nginx/sites-available/no-risk-no-fun /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # تأكد: syntax is ok
sudo systemctl reload nginx
```

الآن اللعبة تعمل على `http://yourdomain.com` 🎉

- اللاعبون: `http://yourdomain.com`
- المقدم: `http://yourdomain.com/host`

---

## 9️⃣ شهادة SSL مجانية (HTTPS)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
# أدخل بريدك، وافق على الشروط، واختر إعادة التوجيه التلقائي (Redirect)

# التجديد تلقائي — للتأكد:
sudo certbot renew --dry-run
```

انتهى! الموقع الآن على `https://yourdomain.com` ✅

---

## 🔟 النشر بـ Docker (بديل عن PM2)

```bash
# على السيرفر (بعد تثبيت Docker)
cd /var/www/no-risk-no-fun
docker compose up -d --build

# السجلات
docker compose logs -f

# إيقاف
docker compose down
```

قاعدة البيانات محفوظة في مجلد `./data` خارج الحاوية، فلا تضيع عند التحديث.

> مع Docker تحتاج Nginx + SSL بنفس خطوات 8 و 9 (الحاوية تستمع على المنفذ 3000).

---

## 🧯 حل المشاكل الشائعة

| المشكلة | الحل |
|---|---|
| `node:sqlite` غير موجود | حدّث Node إلى 22.5+ (`node -v`) |
| اللاعبون لا يتصلون عبر الدومين | تأكد من إعداد WebSocket في Nginx (موجود في `deploy/nginx.conf`) |
| المنفذ 3000 مستخدم | غيّر `PORT` في `.env` و `ecosystem.config.js` و Nginx |
| ضاعت الغرف بعد إعادة التشغيل | تأكد أن مجلد `data/` قابل للكتابة وأنك تشغّل من مجلد المشروع |
| تحذير "SQLite is an experimental feature" | طبيعي ولا يؤثر — مجرد تنبيه من Node |

---

## 🎯 ملخص سير اللعبة

1. المقدم ينشئ غرفة → يرسل رمز الغرفة ورابط اللاعبين
2. اللاعبون ينضمون → المقدم يقبلهم
3. المقدم يبدأ جولة (للكل أو لمجموعة) — **اللعبة 10 جولات**، والبطاقات لا تتكرر: جولة 1 = 10 زرقاء + 20 حمراء، جولة 2 = 9 + 18... وهكذا
4. **المرحلة الزرقاء:** المقدم يعطي الدور لاعباً لاعباً → كلٌّ يختار بطاقته الزرقاء (عمياء — لا يرى قيمتها أبداً)، ولا تظهر للمنافسين إلا عند ضغط المقدم **«كشف البطاقة الزرقاء» (F8)** فتنكشف للجميع بنفس اللحظة (عدا صاحبها)
5. **المرحلة الحمراء:** كل لاعب بدوره يختار بطاقتين سرّيتين (A ثم B)، ثم **يختار واحدة منهما يعرضها للمنافسين** 👁 (نهائي — لا تبديل)، والأخرى تبقى سرّه. زر **«كشف البطاقة الحمراء» (F8)** يكشف الحمراء للجميع
6. كل لاعب يقرر: **تحدّي 🔥** أو **انسحاب آمن 🛡️** — مع رسالة تأكيد، والقرار **نهائي** ولا يلغيه إلا المقدم (زر ✖ بجانب موقفه أو اختصار **F9** لآخر قرار)
7. المقدم يضغط **«إعلان الجولة» (F5)**: تنكشف كل البطاقات والمجاميع ويُحدَّد الفائز — **شاشة المقدم مخصصة للعرض (بروجكتر)** فلا تُظهر أي سرّ قبل هذه اللحظة
8. الأعلى مجموعاً من المتحدّين يفوز بكأس 🏆، وكل متحدٍّ أقل منه يخسر قلباً 💔، ومن وصل 0 قلوب يُقصى ☠️
9. بعد انتهاء البطاقات (10 جولات): المقدم مخيّر بين **🃏 إعادة البطاقات** (القلوب والكؤوس تبقى) أو **إعادة اللعبة كاملة**

### خيارات إضافية للمقدم
- **👁 الحمراء للاعبين (فوق يمين):** يتحكم هل تظهر البطاقات الحمراء (المعروضة أو المكشوفة) بشاشات اللاعبين أم لا
- **اختصارات المقدم:** F5 إعلان الجولة · F8 كشف بطاقات المرحلة الحالية · F9 إلغاء آخر قرار
- **🖥️ لوحة العرض:** مستطيل لكل مشارك (الاسم، القلوب، الكؤوس، البطاقة المعروضة، وموقفه: متحدٍّ/منسحب) — آمنة للعرض على شاشة مشتركة
