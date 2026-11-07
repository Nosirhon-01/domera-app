# Eskiz.uz: haqiqiy SMS OTP testi

Maqsad: Eskiz orqali haqiqiy SMS kelishini va OTP bilan kirish ishlashini tekshirish.
Taxminiy vaqt: 15 daqiqa (shablon tasdiqlangan bo'lsa).

> **Xavfsizlik qoidalari**
> - Eskiz email/parolini faqat `.env` fayliga yozing. Buyruq qatoriga yozmang (`ESKIZ_PASSWORD=... npm run`), aks holda u shell tarixiga tushadi
> - `.env` ni `cat` qilmang, skrinshot olmang, chatga yubormang
> - `npm run sms:check` va backend loglari login, parol, token va OTP kodni chiqarmaydi. Telefon raqami ham qisman yashiriladi
> - Test uchun **faqat o'zingizning** raqamingizdan foydalaning

## 1. Eskiz kabinetida tayyorgarlik ([my.eskiz.uz](https://my.eskiz.uz))

- [ ] Akkaunt tasdiqlangan, shartnoma tuzilgan, balans bor
- [ ] **Test rejimi.** Yangi akkaunt odatda test rejimida bo'ladi va faqat Eskiz bergan test matnini (masalan `Bu Eskiz dan test`) yubora oladi. Aniq matnni kabinetdan ko'ring. Bu rejimda OTP shablonini yuborib bo'lmaydi: 3-qadamda 502 olasiz
- [ ] **Shablon** moderatsiyaga yuborilgan va tasdiqlangan. Tavsiya etilgan matn:
  ```
  DOMERA: tasdiqlash kodingiz {code}
  ```
  Eskiz kabinetida kod o'rniga ular ko'rsatgan belgi (masalan `%d` yoki `XXXXXX`) ishlatilishi mumkin. Backendda esa doim `{code}` yoziladi. Qolgan matn (bo'shliqlar, tinish belgilari, harflar) **belgima-belgi bir xil** bo'lishi shart
- [ ] Yuboruvchi nomi: `4546` (Eskiz standarti) yoki tasdiqlangan o'z nomingiz

## 2. `.env` ni to'ldirish

Lokal kompyuterda `.env` (gitga tushmaydi) yoki serverda `/root/domera-app/.env`. Matn muharriri bilan (`nano .env`) qo'shing:

```
SMS_PROVIDER=eskiz
ESKIZ_EMAIL=<Eskiz kabinetiga kiradigan email>
ESKIZ_PASSWORD=<Eskiz API paroli>
ESKIZ_FROM=4546
OTP_MESSAGE_TEMPLATE="DOMERA: tasdiqlash kodingiz {code}"
```

- `OTP_MESSAGE_TEMPLATE` qo'shtirnoqda bo'lsin: tirnoqsiz qiymatda `#` izoh boshlanishi deb o'qiladi
- `{code}` bo'lmasa, backend SMS yubormaydi (503)
- Serverda: `chmod 600 .env`

## 3. Sozlama va Eskiz loginini tekshirish (SMS yuborilmaydi, bepul)

```bash
npm run sms:check
```

Kutilgan natija:

```
SMS_PROVIDER           : eskiz
ESKIZ_EMAIL            : set
ESKIZ_PASSWORD         : set
ESKIZ_FROM             : 4546
OTP_MESSAGE_TEMPLATE   : "DOMERA: tasdiqlash kodingiz {code}"
  SMS will look like   : "DOMERA: tasdiqlash kodingiz 123456"
Eskiz login            : OK (credentials accepted)
No SMS sent. ...
```

`SMS will look like` qatori Eskiz'dagi tasdiqlangan matn bilan bir xil bo'lishi kerak.

| Natija | Sabab | Nima qilish kerak |
|---|---|---|
| `PROBLEM: ... ESKIZ_EMAIL is not set` | `.env` da yo'q yoki boshqa papkadan ishga tushirilgan | Loyiha papkasida ishga tushiring, `.env` ni tekshiring |
| `PROBLEM: ... must contain {code}` | Shablonda `{code}` yo'q | Shablonni tuzating |
| `FAILED: ... (HTTP 503 in the API)` va logda `Eskiz login failed: HTTP 401` | Email yoki parol noto'g'ri | Kabinetdagi API ma'lumotlarini tekshiring |
| `FAILED: ... (HTTP 503 in the API)` va `request failed (TimeoutError)` | Eskiz'ga ulanib bo'lmadi | Internet yoki firewall (`notify.eskiz.uz:443` ga chiqish) |

## 4. Bitta test SMS yuborish (pullik, 1 ta SMS)

Test rejimida (shablon hali tasdiqlanmagan bo'lsa), Eskiz bergan test matni bilan yuboring:

```bash
npm run sms:check -- --send +998XXXXXXXXX --text "Bu Eskiz dan test"
```

Shablon tasdiqlangan bo'lsa, haqiqiy OTP matni bilan (tasodifiy kod, login uchun ishlatilmaydi):

```bash
npm run sms:check -- --send +998XXXXXXXXX
```

- [ ] `Eskiz accepted the SMS to +99890*****67` chiqdi
- [ ] SMS 10–60 soniyada telefonga keldi
- [ ] Eskiz kabinetida (SMS tarixi) holat `delivered`

| Natija | Ma'nosi |
|---|---|
| `FAILED: SMS could not be sent ... (HTTP 502 in the API)` | Eskiz rad etdi: matn tasdiqlangan shablonga mos emas, test rejim, balans yo'q yoki yuboruvchi nomi tasdiqlanmagan. Sabab yuqoridagi `Eskiz rejected SMS: HTTP ...` qatorida |
| `FAILED: ... +998XXXXXXXXX (HTTP 400 in the API)` | Raqam O'zbekiston raqami emas |
| `accepted`, lekin SMS kelmadi | Eskiz kabinetidagi holatni ko'ring (`rejected`, `expired`). Operator bloklagan bo'lishi mumkin, Eskiz qo'llab-quvvatlashiga yozing |

## 5. To'liq OTP oqimini API orqali tekshirish

Backendni ishga tushiring (lokal: `npm run start:dev`; serverda: `pm2 restart domera-api --update-env`). Ishga tushganda logda `SmsService` xatosi bo'lmasligi kerak.

```bash
API=http://localhost:3000/api        # serverda: https://api.domera.uz/api
PHONE=+998XXXXXXXXX                  # o'zingizning raqam

# 1) Kod yuborish → 200, data.expiresIn=120, data.retryAfter=60
curl -s -X POST "$API/auth/otp/send" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}"; echo

# 2) 60 s ichida qayta yuborish → 429 va retryAfter (SMS ketmaydi)
curl -s -X POST "$API/auth/otp/send" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}"; echo

# 3) SMS dagi kodni kiriting (ekranda ko'rinmaydi, tarixga tushmaydi)
read -s -p 'SMS code: ' CODE; echo
curl -s -X POST "$API/auth/otp/verify" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" \
  | node -pe 'const r=JSON.parse(require("fs").readFileSync(0));r.success?`OK isNewUser=${r.data.isNewUser} role=${r.data.user.role} token=${!!r.data.accessToken}`:`FAIL ${r.message}`'
unset CODE

# 4) Shu kodni qayta ishlatish → 400 "Code expired or not requested"
```

- [ ] 1-qadam 200 va SMS keldi
- [ ] 2-qadam 429 va `retryAfter` bor
- [ ] 3-qadam `OK isNewUser=true role=USER token=true` (raqam bazada bo'lmasa) yoki `isNewUser=false`
- [ ] Noto'g'ri kod: 400 `Invalid code. Attempts left: 4`
- [ ] Logda faqat `Eskiz accepted SMS id=... status=waiting`. Kod, token va parol logda yo'q:

```bash
pm2 logs domera-api --lines 50 --nostream | grep -i sms      # yoki lokal terminal chiqishi
```

## 6. Xavfsiz holatlarni tekshirish (ixtiyoriy)

| Holat | Kutilgan javob `/auth/otp/send` dan |
|---|---|
| `SMS_PROVIDER` o'chirilgan (production) | 503 `SMS service is not configured`, SMS va kod yaratilmaydi |
| `ESKIZ_PASSWORD` noto'g'ri | 503 `SMS service is temporarily unavailable`, logda `Eskiz login failed: HTTP 401` |
| Shablon tasdiqlanmagan | 502 `SMS could not be sent`, logda Eskiz sababi |
| `+7...` raqam | 400 |

Bu holatlarning hammasida 60 soniyalik cooldown boshlanmaydi: muammo tuzatilgach darhol qayta urinish mumkin.

## 7. Testdan keyin

- [ ] Test uchun yaratilgan akkaunt kerak bo'lmasa, ilovadan "akkauntni o'chirish" orqali o'chiring (`DELETE /auth/me`)
- [ ] Lokal `.env` dagi Eskiz ma'lumotlari kerak bo'lmasa, o'chiring
- [ ] Parol biror joyga tasodifan tushgan bo'lsa (chat, skrinshot, shell tarixi), Eskiz kabinetida almashtiring
