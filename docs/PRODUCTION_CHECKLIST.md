# DOMERA backend: production deploy checklist

Commit: `c6ecc56` (OTP login, hamma uchun e'lon joylash, review account, HTTPS).
Server: `162.35.179.239`, papka `/root/domera-app`, PM2 jarayoni `domera-api`, port `3000`, prefiks `/api`.

> **Qoida:** parol, token, `.env` mazmuni hech qachon kodga, gitga, chatga yoki skrinshotga tushmasin.
> Quyidagi `<...>` joylar faqat serverdagi `.env` ga yoziladi. Batafsil buyruqlar: [DEPLOYMENT.md](../DEPLOYMENT.md).

Belgilar: 🟢 faqat o'qiydi · 🟡 kod/jarayonni o'zgartiradi · 🔴 production bazasini o'zgartiradi

---

## 0. Deploydan oldin (bir kun oldin bo'lsa yaxshi)

- [ ] Domen tanlangan, masalan `api.domera.uz` (keyingi bo'limlarda shu nom ishlatiladi)
- [ ] Eskiz.uz akkaunti ochilgan va SMS shabloni **moderatsiyadan o'tgan** (5-bo'lim, bir necha kun olishi mumkin)
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
> to'g'ri hal qilishi kerak (401 → login ekrani). Shu bilan birga yuborilgan, lekin hali ishlatilmagan OTP kodlar ham
> bekor bo'ladi (ular 2 daqiqa amal qiladi, shuning uchun bu muammo emas).

### Ixtiyoriy

| O'zgaruvchi | Standart qiymat | Izoh |
|---|---|---|
| `AUTH_RATE_LIMIT` | `10` | login/register/OTP: bir IP dan daqiqasiga urinishlar soni |
| `THROTTLE_TTL`, `THROTTLE_LIMIT` | `60`, `100` | umumiy limit |
| `FIREBASE_SERVICE_ACCOUNT_PATH` yoki `FIREBASE_SERVICE_ACCOUNT_BASE64` | yo'q | push bildirishnomalar |

`ADMIN_*` o'zgaruvchilari faqat seed uchun ishlatiladi va seed productionda ishlamaydi. Ularni serverda saqlash shart emas.

> `docker-compose.yml` dagi parollar faqat lokal ishlab chiqish uchun. Productionda ishlatmang.

## 5. Eskiz SMS

- [ ] [my.eskiz.uz](https://my.eskiz.uz) da akkaunt ochilgan, shartnoma tuzilgan, balans to'ldirilgan
- [ ] SMS shabloni moderatsiyadan o'tgan. Matn `OTP_MESSAGE_TEMPLATE` bilan **belgima-belgi bir xil** bo'lishi kerak, faqat kod o'rnida `{code}` turadi.
  Standart matn: `DOMERA: tasdiqlash kodingiz {code}`
- [ ] Yuboruvchi nomi: `4546` (Eskiz standarti) yoki tasdiqlangan o'z nomingiz
- [ ] Test rejimida Eskiz faqat o'zining test matnlarini yuborishi mumkin. Haqiqiy kod yuborishdan oldin akkaunt test rejimidan chiqqanini tekshiring

`.env`:

```
SMS_PROVIDER=eskiz
ESKIZ_EMAIL=<Eskiz kabinetidagi email>
ESKIZ_PASSWORD=<Eskiz API paroli/kaliti>
ESKIZ_FROM=4546
OTP_MESSAGE_TEMPLATE=DOMERA: tasdiqlash kodingiz {code}
```

- Token kodda saqlanmaydi: server Eskiz'ga login qiladi va token muddati tugasa o'zi yangilaydi
- `SMS_PROVIDER` bo'lmasa yoki `console` bo'lsa, productionda `/auth/otp/send` **503** qaytaradi (kod logga yozilmaydi)
- Limitlar (kodda): kod 120 s amal qiladi, qayta yuborish 60 s dan keyin, raqamga soatiga 5 ta kod, kodga 5 ta urinish

## 6. Review account (App Store / Google Play)

`.env`:

```
REVIEW_NAME=App Review
REVIEW_EMAIL=review@domera.uz
REVIEW_PASSWORD=<tasodifiy, 12+ belgi>
REVIEW_PHONE=<siz egalik qiladigan raqam, masalan +99890xxxxxxx>
REVIEW_OTP_CODE=<6 xonali, tasodifiy>
```

- [ ] Server har safar ishga tushganda akkauntni yaratadi yoki parolini yangilaydi. Roli `USER`
- [ ] `REVIEW_EMAIL`/`REVIEW_PHONE` admin, manager yoki agent akkauntiga tegishli bo'lsa, server unga **tegmaydi** va logga xato yozadi. Alohida email va raqam ishlating
- [ ] `REVIEW_PHONE` ga SMS yuborilmaydi va u uchun limitlar yo'q. Faqat `REVIEW_OTP_CODE` qabul qilinadi
- [ ] Restartdan keyin logda `Review account created` yoki `Review account ready` chiqadi
- [ ] Ma'lumotlarni **App Store Connect → App Review Information** va **Play Console → App access** ga kiriting:
  email + parol, hamda telefon + OTP kod ("SMS kelmaydi, shu kodni kiriting" deb yozing)
- [ ] Review tugagach: `REVIEW_PASSWORD` va `REVIEW_OTP_CODE` ni almashtiring yoki o'chiring, keyin `pm2 restart domera-api --update-env`.
  `REVIEW_PASSWORD` o'chirilsa, akkaunt qoladi, lekin env bilan sinxronlanmaydi. Uning parolini almashtirish yoki
  akkauntni o'chirish (admin orqali) kerak. `REVIEW_OTP_CODE` o'chirilsa, raqam oddiy SMS rejimiga o'tadi

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
- [ ] 🟢 `npx prisma migrate status`: faqat `20261107120000_add_otp_codes` kutilayotgan bo'lishi kerak (yoki birinchi deployda §5 dagi ro'yxat)
- [ ] 🔴 `npx prisma migrate deploy`
- [ ] 🟢 `npx prisma migrate status` → `Database schema is up to date`
- [ ] 🟢 `psql "${DATABASE_URL%%\?*}" -c '\d otp_codes'` → jadval mavjud

Yangi migratsiya faqat `otp_codes` jadvalini qo'shadi (`IF NOT EXISTS`). Mavjud jadvallar o'zgarmaydi, eski kod ham shu bazada ishlayveradi.

## 8. Flutter ilova bilan integratsiya

**Server manzili**

- [ ] Base URL: `https://api.domera.uz/api`
- [ ] Rasmlar `/uploads/...` ko'rinishida (nisbiy) qaytadi. To'liq URL: `https://api.domera.uz` + `url`
- [ ] Android: HTTPS manzilga o'tgach, `usesCleartextTraffic` / `network_security_config` dagi HTTP ruxsatini olib tashlang
- [ ] iOS: `Info.plist` dagi `NSAppTransportSecurity` istisnolarini (IP/HTTP uchun) olib tashlang

**Javob formati**: muvaffaqiyatli `{ success: true, message, data }`, xato `{ success: false, message, error, details? }`

**OTP bilan kirish**

```
POST /auth/otp/send    { "phone": "+998901234567" }
  200 → data: { phone, expiresIn: 120, retryAfter: 60 }
  429 → kutish kerak (yoki soatlik limit), 503 → SMS xizmati ishlamayapti
POST /auth/otp/verify  { "phone": "+998901234567", "code": "123456", "name": "Ali" }
  200 → data: { user, accessToken, refreshToken, isNewUser }
  400 → kod noto'g'ri, eskirgan yoki ishlatilgan (message da qolgan urinishlar soni), 401 → akkaunt bloklangan
```

- [ ] Telefon `+998 90 123-45-67`, `998901234567` yoki `901234567` ko'rinishida yuborilishi mumkin. Server o'zi `+998901234567` ga keltiradi
- [ ] "Qayta yuborish" tugmasi uchun 60 soniyalik taymerni ilovaning o'zida yuriting. 429 javobida `retryAfter` maydoni yo'q, faqat matn bor
- [ ] `isNewUser: true` bo'lsa va ism so'ralmagan bo'lsa, ism kiritish ekranini ko'rsating → `PATCH /auth/me { "name": "..." }`
- [ ] Tokenlarni saqlash va yangilash avvalgidek: `POST /auth/refresh`
- [ ] Email/parol bilan kirish (`/auth/login`) ishlashda davom etadi. U review uchun kerak, shuning uchun ilovada **qolishi kerak**

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

- [ ] Review: email + parol bilan login → `role: USER`
- [ ] Review: `REVIEW_PHONE` + `REVIEW_OTP_CODE` bilan OTP → token qaytadi, SMS yuborilmaydi
- [ ] O'z raqamingizga OTP → SMS 10–30 soniyada keladi, kod ishlaydi
- [ ] 60 soniya ichida qayta so'rash → 429
- [ ] Oddiy USER token bilan `POST /api/properties` → 201, keyin shu e'lonni o'chirish
- [ ] Yangi ilova build: login, OTP, e'lon qo'shish, rasm yuklash, chat, push bildirishnoma

**Kuzatish (birinchi 24 soat)**

- [ ] `pm2 logs domera-api | grep -iE 'eskiz|sms'`: `Eskiz send failed` yo'q
- [ ] Eskiz kabinetida SMS lar `delivered` holatida, balans yetarli
- [ ] `journalctl -u caddy`: sertifikat bilan bog'liq xato yo'q

**Keyinroq: HTTP ni yopish** (yangi ilova versiyasini foydalanuvchilarning ko'pchiligi o'rnatganidan keyin)

- [ ] `.env` ga `HOST=127.0.0.1` qo'shilib, `pm2 restart domera-api --update-env`
- [ ] `ss -ltnp | grep 3000` → faqat `127.0.0.1:3000`
- [ ] Tashqaridan `curl -m 5 http://162.35.179.239:3000/api/health` → ulanmaydi
- [ ] HTTPS hamon ishlaydi
- [ ] Ilovada server minimal versiyasini majburlash bo'lsa, eski versiyalarni yangilashga undang

## 10. Rollback

- **Kod:** DEPLOYMENT.md §9 (oldingi commitga `git checkout`, build, PM2 restart). `otp_codes` jadvali qolishi zarar qilmaydi
- **Caddy:** `systemctl stop caddy`. Ilova `:3000` da HTTP orqali ishlashda davom etadi (agar `HOST=127.0.0.1` hali qo'yilmagan bo'lsa)
- **OTP ishlamasa:** ilova email/parol bilan kirishga tayanadi, server tomonda hech narsa o'chirish shart emas
- **Baza:** odatda kerak emas. Faqat zarurat bo'lsa: `DROP TABLE IF EXISTS otp_codes;` va
  `DELETE FROM _prisma_migrations WHERE migration_name = '20261107120000_add_otp_codes';` (🔴, avval zaxira)
