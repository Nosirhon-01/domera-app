# DOMERA backend: production deploy checklist

Telefon bilan ro'yxatdan o'tish 3 bosqichli (kod → tasdiqlash → parol). Kod Eskiz SMS orqali yuboriladi (`SMS_MODE=live`).
Server: `162.35.179.239`, papka `/root/domera-app`, PM2 jarayoni `domera-api`, port `3000`, prefiks `/api`.

> **Qoida:** parol, token, `.env` mazmuni hech qachon kodga, gitga, chatga yoki skrinshotga tushmasin.
> Quyidagi `<...>` joylar faqat serverdagi `.env` ga yoziladi. Batafsil buyruqlar: [DEPLOYMENT.md](../DEPLOYMENT.md).

Belgilar: 🟢 faqat o'qiydi · 🟡 kod/jarayonni o'zgartiradi · 🔴 production bazasini o'zgartiradi

---

## 0. Deploydan oldin (bir kun oldin bo'lsa yaxshi)

- [ ] Domen tanlangan, masalan `api.domera.uz` (keyingi bo'limlarda shu nom ishlatiladi)
- [ ] Review uchun telefon raqami tanlangan: o'zingizga tegishli, hech kimning shaxsiy raqami emas
- [ ] Flutter ilovaning yangi versiyasi `https://api.domera.uz/api` bilan tayyorlanmoqda (8-bo'lim)
- [ ] Commit GitHub'ga push qilingan va `main` ga merge qilingan (serverda `git pull` shuni oladi)
- [ ] Deploy vaqti kam foydalanuvchi bo'lgan paytga belgilangan

## 1. VPS holati 🟢

```bash
ssh root@162.35.179.239
cd /root/domera-app
git status --short && git log --oneline -1
node -v                                   # v18.18+ (v20 tavsiya)
df -h / && free -m                        # diskda > 1 GB bo'sh joy
pm2 describe domera-api | grep -E 'status|script path'
ss -ltnp | grep -E ':80 |:443 |:3000 '    # 80/443 bo'sh bo'lishi kerak (nginx/apache band qilmagan)
ufw status                                # firewall yoqilganmi
```

- [ ] `git status` toza (o'zgarishlar bo'lsa: `git stash`, keyin tekshirish)
- [ ] 80 va 443 portlarni boshqa dastur egallamagan. Agar nginx bo'lsa: uni o'chirish yoki Caddy o'rniga nginx + certbot ishlatish
- [ ] VPS provayderi panelida (cloud firewall) 80 va 443 kirish ruxsat etilgan

## 2. Domen DNS

DNS provayderingiz panelida:

| Turi | Nomi | Qiymati | TTL |
|---|---|---|---|
| A | `api` | `162.35.179.239` | 300 |

- [ ] AAAA (IPv6) yozuvi **yo'q** yoki to'g'ri IPv6 ga qaratilgan (noto'g'ri AAAA sertifikat olishni buzadi)
- [ ] Domenda CAA yozuvi bo'lsa, unda `letsencrypt.org` ruxsat etilgan
- [ ] Tarqalganini tekshirish 🟢:

```bash
getent hosts api.domera.uz        # 162.35.179.239 chiqishi kerak
dig +short api.domera.uz AAAA     # bo'sh bo'lishi kerak
```

## 3. Caddy va HTTPS 🟡

Caddy serverga to'g'ridan-to'g'ri o'rnatiladi (Docker emas). Buyruqlar [DEPLOYMENT.md §10](../DEPLOYMENT.md) da.

- [ ] Caddy o'rnatildi: `caddy version`
- [ ] `deploy/Caddyfile.pm2` → `/etc/caddy/Caddyfile`, ichidagi `api.domera.uz` o'zingizning domenga almashtirildi
- [ ] `caddy validate --config /etc/caddy/Caddyfile` xatosiz
- [ ] `systemctl enable --now caddy && systemctl reload caddy`
- [ ] Sertifikat olindi: `journalctl -u caddy --since "10 min ago" | grep -i certificate`
- [ ] `curl -s https://api.domera.uz/api/health` → `"status":"ok"`
- [ ] `curl -sI http://api.domera.uz/api/health` → `308` va HTTPS ga yo'naltiradi
- [ ] Sertifikat avtomatik yangilanadi (Caddy o'zi qiladi, cron kerak emas)

**Hozircha 3000-port ochiq qoladi.** Eski ilova versiyalari `http://162.35.179.239:3000` dan foydalanadi.
Uni yopish: 9-bo'lim.

## 4. Production `.env`

Fayl: `/root/domera-app/.env`. Huquqlar: `chmod 600 .env`. Gitga tushmaydi (`.gitignore` da bor).

Tasodifiy maxfiy qiymat yaratish (ekranga chiqadi, darhol `.env` ga qo'ying):

```bash
openssl rand -base64 48
```

### Asosiy

| O'zgaruvchi | Qiymat | Izoh |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `3000` | |
| `API_PREFIX` | `api` | |
| `DATABASE_URL` | `<mavjud qiymat>` | O'zgartirmang |
| `JWT_ACCESS_SECRET` | `<32+ belgili tasodifiy>` | ⚠️ pastdagi eslatmaga qarang |
| `JWT_REFRESH_SECRET` | `<32+ belgili tasodifiy, boshqasi>` | ⚠️ |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | |
| `TRUST_PROXY` | `true` | Caddy ortida: rate limit haqiqiy IP ni ko'radi |
| `CORS_ORIGINS` | `https://domera.uz,...` | Faqat web sahifalar uchun. Mobil ilovaga kerak emas |
| `SWAGGER_ENABLED` | `false` (tavsiya) | `/api/docs` ni yashiradi |
| `HOST` | **hozircha qo'shmang** | 9-bo'limda `127.0.0.1` bo'ladi |

> ⚠️ Agar hozirgi JWT kalitlari `.env.example` dagi `..._change_in_prod` qiymatlari bo'lsa, ularni almashtirish **shart**.
> Lekin almashtirsangiz, barcha foydalanuvchilar tizimdan chiqib qoladi va qayta kirishi kerak bo'ladi. Ilova buni
> to'g'ri hal qilishi kerak (401 → login ekrani). Shu bilan birga hali ishlatilmagan ro'yxatdan o'tish kodlari ham
> bekor bo'ladi (ular 3 daqiqa amal qiladi, shuning uchun bu muammo emas).

### Ixtiyoriy

| O'zgaruvchi | Standart qiymat | Izoh |
|---|---|---|
| `AUTH_RATE_LIMIT` | `10` | login/register/kod: bir IP dan daqiqasiga urinishlar soni |
| `THROTTLE_TTL`, `THROTTLE_LIMIT` | `60`, `100` | umumiy limit |
| `FIREBASE_SERVICE_ACCOUNT_PATH` yoki `FIREBASE_SERVICE_ACCOUNT_BASE64` | yo'q | push bildirishnomalar |

`ADMIN_*` o'zgaruvchilari faqat seed uchun ishlatiladi va seed productionda ishlamaydi. Ularni serverda saqlash shart emas.

> `docker-compose.yml` dagi parollar faqat lokal ishlab chiqish uchun. Productionda ishlatmang.

## 5. Eskiz SMS va telefon bilan ro'yxatdan o'tish

- [ ] [my.eskiz.uz](https://my.eskiz.uz) da akkaunt, shartnoma va balans bor
- [ ] Akkaunt **test rejimidan chiqqan** va SMS shabloni moderatsiyadan o'tgan. Matn `OTP_MESSAGE_TEMPLATE` bilan **belgima-belgi bir xil**, kod o'rnida `{code}`
- [ ] Productionda `.env` da `OTP_DEV_MODE` **yo'q** yoki `false` (`true` bo'lsa server **ishga tushmaydi**)
- [ ] Eski `SMS_PROVIDER` va `REVIEW_OTP_CODE` qatorlarini o'chiring (endi ishlatilmaydi)

`.env`:

```
SMS_MODE=live
ESKIZ_EMAIL=<Eskiz kabinetidagi email>
ESKIZ_PASSWORD=<Eskiz paroli>
ESKIZ_FROM=4546
OTP_MESSAGE_TEMPLATE="DOMERA: tasdiqlash kodingiz {code}"
```

- Eskiz hali **test rejimida** bo'lsa: `SMS_MODE=test`. Bunda faqat Eskiz test matni yuboriladi (kodsiz), productionda
  `request-code` **503** qaytaradi va yangi raqam bilan ro'yxatdan o'tib bo'lmaydi. Parol bilan login ishlaydi
- Tekshirish: `npm run sms:check` (faqat login, SMS yo'q), `npm run sms:check -- --send +998XXXXXXXXX` (bitta SMS)
- Xatolar: Eskiz rad etsa **502**, Eskiz ishlamasa yoki login xato bo'lsa **503**, +998 bo'lmagan raqam **400**. Bu holatlarda cooldown boshlanmaydi
- Limitlar: kod `OTP_EXPIRY_MINUTES` (3) daqiqa, qayta so'rash 60 s dan keyin, raqamga soatiga 5 ta kod, kodga `OTP_MAX_ATTEMPTS` (5) urinish,
  verification token 10 daqiqa va bir martalik

## 6. Review account (App Store / Google Play)

Reviewer ilovaga oddiy foydalanuvchi kabi kiradi: **telefon → kod → Tasdiqlash**. SMS yuborilmaydi.

Serverdagi `.env` (gitga yozilmaydi):

```
REVIEW_NAME=App Review
REVIEW_PHONE=+998900000000
REVIEW_OTP_CODE=123456
REVIEW_PASSWORD=123456
```

- [ ] **Avval tekshiring**: bu raqam admin/manager/agent'ga tegishli emas (eski seed admin'ga `+998900000000` berardi):
  `psql "${DATABASE_URL%%\?*}" -tAc "SELECT role FROM users WHERE phone IN ('+998900000000','998900000000')"`
  Natija bo'sh yoki `USER` bo'lishi kerak. `ADMIN` bo'lsa, admin raqamini o'zgartiring (🔴, avval zaxira):
  `UPDATE users SET phone = NULL WHERE phone = '+998900000000' AND role = 'ADMIN';`
  Aks holda server review kodini **o'chiradi** va logga xato yozadi
- [ ] Server har ishga tushganda akkauntni yaratadi yoki parolini yangilaydi. Roli `USER`, ismi `REVIEW_NAME`
- [ ] Restartdan keyin logda `Review account created` yoki `Review account ready` chiqadi
- [ ] `REVIEW_PHONE` uchun: SMS yo'q, cooldown/limit yo'q, kod har doim `REVIEW_OTP_CODE`. Eskiz test rejimida bo'lsa ham ishlaydi
- [ ] **App Store Connect → App Review Information → Sign-in required** va **Play Console → App access** ga yozing:
  ```
  Phone: +998 90 000 00 00
  Code / password: 123456
  Enter the phone number, tap "Davom etish", enter 123456 and tap "Tasdiqlash". No SMS is sent for this number.
  ```
- ⚠️ `123456` oddiy kod: raqamni bilgan har kim bu USER akkauntga kira oladi (e'lon qo'shishi mumkin). Unda
  maxfiy ma'lumot saqlamang. Review tugagach `REVIEW_OTP_CODE` ni o'chirib `pm2 restart domera-api --update-env` qilsangiz,
  raqam oddiy SMS rejimiga o'tadi

## 7. Database migration

Ikkita holat bor. Avval holatni aniqlang 🟢:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/^"//; s/"$//')"
psql "${DATABASE_URL%%\?*}" -tAc "SELECT to_regclass('public._prisma_migrations')"
```

- **Bo'sh natija** (migratsiyalar hali hech qachon ishlamagan): [DEPLOYMENT.md](../DEPLOYMENT.md) §1–6 ni to'liq bajaring. Undagi `migrate deploy` barcha migratsiyalarni, jumladan yangisini ham qo'llaydi
- **`_prisma_migrations`** (oldingi deploy qilingan): faqat yangi migratsiya qo'shiladi

Checklist:

- [ ] 🟢 Zaxira nusxa olindi va tekshirildi (DEPLOYMENT.md §2: `pg_dump -Fc` + `pg_restore --list`)
- [ ] 🟡 `git pull --ff-only origin main && npm ci && npx prisma generate && npm run build && ls -l dist/main.js`
- [ ] 🟢 `npx prisma migrate status`: faqat `20261109120000_registration_challenges_drop_otp_codes` (va hali qo'llanmagan bo'lsa `20261107120000_add_otp_codes`) kutilayotgan bo'lishi kerak (yoki birinchi deployda §5 dagi ro'yxat)
- [ ] 🔴 `npx prisma migrate deploy`
- [ ] 🟢 `npx prisma migrate status` → `Database schema is up to date`
- [ ] 🟢 `psql "${DATABASE_URL%%\?*}" -c '\d registration_challenges'` → jadval mavjud, `otp_codes` yo'q
- [ ] 🟢 Eski formatdagi telefonlar soni: `psql "${DATABASE_URL%%\?*}" -tAc "SELECT count(*) FROM users WHERE phone IS NOT NULL AND phone !~ '^\+[0-9]{9,15}$'"`.
  0 bo'lmasa, bu raqamlar bilan qayta ro'yxatdan o'tish bloklanmay qolishi mumkin. Ularni qo'lda `+998XXXXXXXXX` ga keltirish kerak (🔴, avval zaxira; dublikat yo'qligini tekshiring)

Yangi migratsiya `otp_codes` jadvalini o'chiradi (unda faqat 2 daqiqalik login kodlari bo'lgan) va `registration_challenges` ni yaratadi. Boshqa jadvallar o'zgarmaydi.

## 8. Flutter ilova bilan integratsiya

**Server manzili**

- [ ] Base URL: `https://api.domera.uz/api`
- [ ] Rasmlar `/uploads/...` ko'rinishida (nisbiy) qaytadi. To'liq URL: `https://api.domera.uz` + `url`
- [ ] Android: HTTPS manzilga o'tgach, `usesCleartextTraffic` / `network_security_config` dagi HTTP ruxsatini olib tashlang
- [ ] iOS: `Info.plist` dagi `NSAppTransportSecurity` istisnolarini (IP/HTTP uchun) olib tashlang

**Javob formati**: muvaffaqiyatli `{ success: true, message, data }`, xato `{ success: false, message, error, details? }`

**Telefon bilan ro'yxatdan o'tish**

```
POST /auth/register/request-code { "phone": "+998901234567" }
  200 → data: { phone, expiresIn: 180, retryAfter: 60, delivery: "sms", devCode? }   devCode faqat OTP_DEV_MODE=true da
  400 → raqam noto'g'ri yoki +998 emas, 409 → raqam allaqachon ro'yxatdan o'tgan, 429 → kutish kerak (retryAfter),
  502/503 → SMS yuborilmadi, keyinroq qayta urinish mumkin (cooldown boshlanmaydi)
POST /auth/register/verify-code  { "phone": "+998901234567", "code": "123456" }
  200 → data: { phone, verificationToken, expiresIn: 600 }
  400 → kod noto'g'ri (message da qolgan urinishlar), eskirgan, ishlatilgan yoki 5 urinish tugagan
POST /auth/register/complete     { "verificationToken": "...", "password": "Secret123", "passwordConfirmation": "Secret123", "name": "Ali" }
  201 → data: { user, accessToken, refreshToken }
  400 → parollar mos emas / parol talabga javob bermaydi / token yaroqsiz, 409 → raqam band
```

- [ ] Parol: 8–72 belgi, bo'shliqsiz, kamida bitta harf va bitta raqam
- [ ] Telefon `+998 90 123-45-67`, `998901234567` yoki `901234567` ko'rinishida yuborilishi mumkin. Server o'zi `+998901234567` ga keltiradi
- [ ] "Qayta yuborish" taymeri: `data.retryAfter` (60). 429 bo'lsa, qolgan soniyalar `retryAfter` maydonida (body ning yuqori darajasida) va `Retry-After` headerida
- [ ] `POST /auth/register` endi faqat email uchun: telefon yuborilsa 400 qaytadi
**Telefon bilan kirish (ilovadagi "Kirish" ekrani)** — yangi raqam uchun akkaunt shu yerda ochiladi, parol so'ralmaydi

```
POST /auth/otp/send    { "phone": "+998901234567" }
  200 → data: { phone, expiresIn: 180, retryAfter: 60, delivery, devCode? }
  400 / 429 / 502 / 503 — request-code bilan bir xil
POST /auth/otp/verify  { "phone": "+998901234567", "code": "123456" }
  200 → data: { user, accessToken, refreshToken, isNewUser, needsName }
  400 → kod noto'g'ri / eskirgan / ishlatilgan / urinishlar tugagan, 401 → akkaunt bloklangan
```

- [ ] "Tasdiqlash" → `/auth/otp/verify`. `needsName: true` bo'lsa **"Ism familiya"** ekrani →
  `PATCH /auth/me { "name": "Ali Valiyev" }` (2–100 belgi) → bosh sahifa. `false` bo'lsa to'g'ri bosh sahifaga
- [ ] "Demo rejim: tasdiqlash kodi ..." matnini **faqat javobda `devCode` bo'lsa** ko'rsating (productionda hech qachon kelmaydi)
- [ ] "Kodni qayta yuborish": `retryAfter` soniyadan keyin faol bo'lsin
- [ ] Tokenlarni saqlash va yangilash avvalgidek: `POST /auth/refresh`
- [ ] Email/telefon + parol bilan kirish (`/auth/login`) ishlashda davom etadi

**E'lon joylash**

- [ ] "E'lon qo'shish" tugmasi rolidan qat'i nazar har bir tizimga kirgan foydalanuvchiga ko'rsatiladi
- [ ] `POST /properties` → 201. Tahrirlash va o'chirish faqat egasi (`ownerId == user.id`) uchun

**Chiqarish**

- [ ] Yangi versiya TestFlight va Play internal testing da production serverga qarshi sinab ko'rilgan
- [ ] Review ma'lumotlari do'konlarga kiritilgan (6-bo'lim)

## 9. Deploydan keyingi tekshiruvlar 🟢

Restart: `pm2 restart domera-api --update-env` (yoki DEPLOYMENT.md §7).

**Server**

- [ ] `pm2 status domera-api` → `online`, restartlar soni oshmayapti
- [ ] `pm2 logs domera-api --lines 80 --nostream`: xato yo'q, `Review account ...` qatori bor, `[SECURITY WARNING]` yo'q
- [ ] `curl -s https://api.domera.uz/api/health` → `ok`, database `UP`
- [ ] `curl -s http://162.35.179.239:3000/api/health` → hali ishlaydi (eski ilovalar uchun)
- [ ] Ma'lumotlar soni deploydan oldingisi bilan bir xil (DEPLOYMENT.md §8)

**Funksiyalar** (parolni `read -s` bilan kiriting, terminal tarixiga tushmasin)

- [ ] Review: `+998900000000` → `/auth/otp/send` → 200, SMS yo'q; `/auth/otp/verify` kod `123456` → token, `role: USER`
- [ ] O'z raqamingiz bilan `POST /api/auth/register/request-code` → 200, `delivery: "sms"`, javobda `devCode` **yo'q**, SMS 10–30 soniyada keladi va kod `verify-code` da ishlaydi
- [ ] 60 soniya ichida qayta so'rash → 429
- [ ] Oddiy USER token bilan `POST /api/properties` → 201, keyin shu e'lonni o'chirish
- [ ] Yangi ilova build: login, ro'yxatdan o'tish, e'lon qo'shish, rasm yuklash, chat, push bildirishnoma

**Kuzatish (birinchi 24 soat)**

- [ ] `pm2 logs domera-api | grep OTP_DEV_MODE`: bo'sh (productionda dev rejim yoqilmagan)
- [ ] `pm2 logs domera-api | grep -iE 'eskiz'`: `Eskiz rejected SMS`, `Eskiz send:` va `Eskiz login failed` yo'q
- [ ] Eskiz kabinetida SMS lar `delivered` holatida, balans yetarli
- [ ] `journalctl -u caddy`: sertifikat bilan bog'liq xato yo'q

**Keyinroq: HTTP ni yopish** (yangi ilova versiyasini foydalanuvchilarning ko'pchiligi o'rnatganidan keyin)

- [ ] `.env` ga `HOST=127.0.0.1` qo'shilib, `pm2 restart domera-api --update-env`
- [ ] `ss -ltnp | grep 3000` → faqat `127.0.0.1:3000`
- [ ] Tashqaridan `curl -m 5 http://162.35.179.239:3000/api/health` → ulanmaydi
- [ ] HTTPS hamon ishlaydi
- [ ] Ilovada server minimal versiyasini majburlash bo'lsa, eski versiyalarni yangilashga undang

## 10. Rollback

- **Kod:** DEPLOYMENT.md §9 (oldingi commitga `git checkout`, build, PM2 restart). eski kod `otp_codes` jadvalini kutadi: kerak bo'lsa `20261107120000_add_otp_codes` dagi SQL ni qayta ishga tushiring (`IF NOT EXISTS`)
- **Caddy:** `systemctl stop caddy`. Ilova `:3000` da HTTP orqali ishlashda davom etadi (agar `HOST=127.0.0.1` hali qo'yilmagan bo'lsa)
- **Baza:** odatda kerak emas. `registration_challenges` jadvali qolishi zarar qilmaydi
