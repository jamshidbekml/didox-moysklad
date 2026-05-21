# MoySklad ↔ Didox Integratsiya Flow

> Vendor ilova: MoySklad'da yaratilgan ilova orqali Didox (O'zbekiston e-faktura) bilan ikki tomonlama integratsiya.

---

## 1. Umumiy arxitektura

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────┐
│                 │  HTTP   │                  │  HTTP   │             │
│   MoySklad      │◄───────►│  Sizning Backend │◄───────►│   Didox     │
│   (Vendor API + │         │  (Vendor + JSON  │         │   API       │
│    JSON API)    │         │   API orchestr.) │         │             │
│                 │         │                  │         │             │
└─────────────────┘         └──────────────────┘         └─────────────┘
        ▲                            ▲
        │                            │
        │  iframe (descriptor UI)    │
        └────────────────────────────┘
              foydalanuvchi brauzeri
```

**Uchta asosiy komponent:**

1. **MoySklad Vendor API** (`/api/moysklad/vendor/1.0/`) — ilovani o'rnatish, sozlash, account lifecycle
2. **MoySklad JSON API 1.2** (`/api/remap/1.2/`) — amaliy ma'lumotlar (tovar, schyot, kontragent)
3. **Didox API** — faktura olish/yuborish

---

## 2. Vendor API: ilova lifecycle

### 2.1. Activate (ilova o'rnatildi)

Foydalanuvchi MoySklad'da ilovangizni o'rnatganda, MoySklad **sizning backendingizga** so'rov yuboradi:

```
PUT https://your-backend.com/api/moysklad/vendor/1.0/apps/{appId}/{accountId}
```

**Request body** (MoySklad → siz):
```json
{
  "appId": "...",
  "accountId": "...",
  "access": [
    { "feature": "ApiSetup", "endpoint": "..." }
  ],
  "cause": "Install"
}
```

**Siz qaytarishingiz kerak** (200 OK):
```json
{
  "status": "Activated",       // yoki "SettingsRequired" - sozlash kerak bo'lsa
  "access": [...]
}
```

→ Bu yerda DB'da yangi `accounts` yozuvi yaratasiz: `{ accountId, appId, status, didoxCreds: null }`.

### 2.2. Settings (foydalanuvchi sozlash sahifasini ochdi)

Ilova kartochkasida foydalanuvchi **"Настройки"** tugmasini bosganda — MoySklad iframe ichida sizning URL'ingizni ochadi:

```
GET https://your-backend.com/settings?appId=...&accountId=...&contextKey=...
```

`contextKey` — bir martalik token, JSON API'ga kirish uchun ishlatiladi:

```
POST https://online.moysklad.ru/api/remap/1.2/context/employee
  Header: X-Lognex-WebUI-Auth: {contextKey}
```

Bu yerda siz **descriptor sozlamalari** uchun UI ko'rsatasiz (3-bo'limda batafsil).

### 2.3. Delete (ilova o'chirildi)

```
DELETE https://your-backend.com/api/moysklad/vendor/1.0/apps/{appId}/{accountId}
```
→ DB'dan tegishli yozuvni o'chirib yuboring (yoki `status: Deleted` belgilang).

### 2.4. Status

MoySklad vaqti-vaqti bilan tekshirib turadi:
```
GET https://your-backend.com/api/moysklad/vendor/1.0/apps/{appId}/{accountId}
```
→ `{ "status": "Activated" }` qaytarish kerak.

---

## 3. Descriptor: sozlash UI

Foydalanuvchi sozlash sahifasida quyidagilarni belgilashi kerak (har bir akkaunt uchun bir marta):

### 3.1. Didox credentials
- Didox login / parol / API kalit
- Tashkilot STIR (INN)

### 3.2. Default Counterparty mapping
Foydalanuvchi quyidagini tanlaydi:
- **"Auto-create"** rejimi — Didox'dan kelgan STIR bo'yicha kontragent yaratiladi (agar mavjud bo'lmasa)
- **"Manual map"** — qo'lda jadval: `Didox INN → MoySklad Counterparty`

### 3.3. Default Product mapping rules
Mahsulot bazada bo'lmasa nima qilish kerak:
- **"Auto-create"** — yangi `product` yaratiladi (artikul = Didox `ИКПУ`/barcode bo'yicha)
- **"Skip & notify"** — hujjat yaratilmaydi, foydalanuvchiga xato ko'rsatiladi
- **"Manual map"** — har safar tanlash kerak

### 3.4. Default Store (ombor)
Default ombor — Didox'dan kelgan tovarlar qaysi omborga tushadi (foydalanuvchi import paytida o'zgartirishi mumkin).

### 3.5. Default Organization
Sizning kompaniyangiz (agar MoySklad'da bir nechta `organization` bo'lsa).

**DB sxema (taxminiy):**
```
account_settings {
  accountId         string  PK
  didoxLogin        string  (encrypted)
  didoxApiKey       string  (encrypted)
  organizationHref  string  (MoySklad meta)
  defaultStoreHref  string
  counterpartyMode  enum    (AUTO_CREATE | MANUAL_MAP)
  productMode       enum    (AUTO_CREATE | SKIP | MANUAL_MAP)
}

counterparty_map {
  accountId         string  PK
  didoxInn          string  PK
  msCounterpartyHref string
}

product_map {
  accountId         string  PK
  didoxProductCode  string  PK   (ИКПУ/штрихкод)
  msProductHref     string
  msStoreHref       string         // har bir product uchun alohida ombor
}
```

---

## 4. Custom Action button (descriptor → tugma)

MoySklad ilova manifesti orqali siz **hujjat ro'yxati sahifasiga** va **bitta hujjat sahifasiga** tugma qo'shishingiz mumkin. Bu `descriptor.json` (yoki vendor settings) orqali e'lon qilinadi:

```json
{
  "iframes": {
    "list": {
      "invoicein": {
        "name": "Импорт из Didox",
        "openUrl": "https://your-backend.com/import/invoicein?accountId={accountId}&contextKey={contextKey}"
      },
      "invoiceout": {
        "name": "Отправить в Didox",
        "openUrl": "https://your-backend.com/export/invoiceout?accountId={accountId}&contextKey={contextKey}&selected={selectedIds}"
      }
    }
  }
}
```

> **Eslatma:** descriptor formati MoySklad tomonidan rasmiy hujjatda yangilanib turadi. Yuqorisi konseptual — aniq format uchun [api-vendor-1.0-doc](https://github.com/moysklad/api-vendor-1.0-doc) repository'sini tekshiring.

---

## 5. Flow: Invoice In (Счёт поставщика) — Didox → MoySklad

```
┌──────────────────────────────────────────────────────────────────┐
│  1. User MoySklad → Закупки → Счета поставщиков ro'yxatini ochadi │
│  2. "Импорт из Didox" tugmasini bosadi                            │
│  3. Sizning iframe ochiladi → Didox'dan keladigan fakturalar      │
│  4. User bittasini tanlaydi → "Импортировать" bosadi              │
│  5. Backend bajaradi:                                              │
│     ┌─ Counterparty (yetkazib beruvchi) — bor/yo'q tekshiriladi   │
│     │   yo'q bo'lsa → POST /entity/counterparty                   │
│     ├─ Har bir tovar uchun:                                       │
│     │   bor/yo'q? → POST /entity/product (agar AUTO_CREATE)       │
│     │   foydalanuvchi UI'da har bir tovar uchun ombor tanlaydi    │
│     └─ POST /entity/invoicein (positions bilan)                   │
│  6. UI'ga link qaytariladi: "Hujjat yaratildi: {url}"              │
└──────────────────────────────────────────────────────────────────┘
```

### 5.1. State diagram

```
    [Didox invoice]
          │
          ▼
   ┌──────────────┐
   │   FETCHED    │  Didox'dan olindi, UI'da ko'rsatildi
   └──────┬───────┘
          │ user tanlaydi
          ▼
   ┌──────────────┐
   │   MAPPING    │  counterparty + products tekshirilmoqda
   └──────┬───────┘
          │
     ┌────┴─────┐
     │          │
     ▼          ▼
  ┌──────┐  ┌──────────────┐
  │ ERROR│  │ READY_TO_PUSH│  hammasi map qilindi
  └──────┘  └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │   CREATING   │  POST /entity/invoicein
            └──────┬───────┘
                   │
            ┌──────┴───────┐
            │              │
            ▼              ▼
       ┌──────┐       ┌─────────┐
       │ FAIL │       │ CREATED │
       └──────┘       └─────────┘
```

### 5.2. JSON API: counterparty yaratish

```http
POST https://online.moysklad.ru/api/remap/1.2/entity/counterparty
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "name": "ООО Поставщик",
  "inn": "123456789",
  "companyType": "legal",
  "legalTitle": "ООО Поставщик",
  "phone": "+998901234567"
}
```

→ Javobda `meta.href` keladi — uni saqlab qo'ying.

### 5.3. JSON API: product yaratish

```http
POST https://online.moysklad.ru/api/remap/1.2/entity/product

{
  "name": "Coca-Cola 1L",
  "code": "ИКПУ-12345",
  "article": "CC-1L",
  "uom": { "meta": { "href": "...", "type": "uom", "mediaType": "application/json" } }
}
```

### 5.4. JSON API: invoicein (Счёт поставщика) yaratish

```http
POST https://online.moysklad.ru/api/remap/1.2/entity/invoicein

{
  "organization": { "meta": { "href": "...organization/{id}", "type": "organization", "mediaType": "application/json" } },
  "agent":        { "meta": { "href": "...counterparty/{id}", "type": "counterparty", "mediaType": "application/json" } },
  "moment": "2026-05-21 14:00:00.000",
  "incomingNumber": "DDX-2026-001",
  "incomingDate":   "2026-05-21 12:00:00.000",
  "positions": [
    {
      "quantity": 10,
      "price": 50000,
      "vat": 12,
      "assortment": {
        "meta": { "href": "...product/{id}", "type": "product", "mediaType": "application/json" }
      }
    }
  ]
}
```

> **Diqqat:** `price` — tiyinda (kopeykada) ko'rsatiladi. 500 so'm = 50000.

> **Eslatma:** `invoicein` o'zi qoldiqqa ta'sir qilmaydi. Tovar haqiqatan omborga kirgani uchun keyin `supply` (Приёмка) hujjati ham yaratilishi kerak. Bu loyihaga kiritiladimi — qaytadan muhokama qilish kerak.

---

## 6. Flow: Invoice Out (Счёт покупателю) — MoySklad → Didox

```
┌────────────────────────────────────────────────────────────────────┐
│  1. User MoySklad → Продажи → Счета покупателям ro'yxatini ochadi  │
│  2. Bir yoki bir nechta invoice'ni belgilab oladi                  │
│  3. "Отправить в Didox" tugmasini bosadi                            │
│  4. Sizning iframe ochiladi → preview ko'rsatadi                   │
│  5. User "Подтвердить" bosadi                                       │
│  6. Backend bajaradi:                                                │
│     ┌─ GET /entity/invoiceout/{id}?expand=agent,positions.assortment│
│     ├─ Didox formatiga konvert qiladi                              │
│     ├─ POST Didox API                                              │
│     └─ Javob: Didox ID + status                                    │
│  7. MoySklad invoice'ga `attribute` qo'shadi: "Didox ID: ..."       │
└────────────────────────────────────────────────────────────────────┘
```

### 6.1. State diagram

```
   [MoySklad invoiceout]
          │
          ▼
   ┌──────────────┐
   │   SELECTED   │  user tanladi
   └──────┬───────┘
          │
          ▼
   ┌──────────────┐
   │   VALIDATED  │  positions, agent, INN — hammasi joyida?
   └──────┬───────┘
          │
     ┌────┴─────┐
     ▼          ▼
  ┌──────┐  ┌──────────────┐
  │ERROR │  │   SENDING    │  Didox'ga POST
  └──────┘  └──────┬───────┘
                   │
            ┌──────┴───────┐
            ▼              ▼
       ┌──────┐       ┌─────────┐
       │ FAIL │       │  SENT   │  Didox'da qabul qilindi
       └──────┘       └────┬────┘
                           │ webhook (Didox → siz)
                           ▼
                    ┌─────────────┐
                    │  ACCEPTED / │
                    │  REJECTED   │
                    └─────────────┘
```

### 6.2. JSON API: invoiceout ma'lumotlarini olish

```http
GET https://online.moysklad.ru/api/remap/1.2/entity/invoiceout/{id}
    ?expand=agent,organization,positions.assortment
```

Javob:
```json
{
  "id": "...",
  "name": "00012",
  "agent":        { "name": "ООО Покупатель", "inn": "987654321", ... },
  "organization": { "name": "Моя Компания",   "inn": "123456789", ... },
  "positions": {
    "rows": [
      {
        "quantity": 5,
        "price": 100000,
        "vat": 12,
        "assortment": { "name": "Coca-Cola 1L", "code": "ИКПУ-12345", ... }
      }
    ]
  }
}
```

### 6.3. Status'ni MoySklad'da yangilash

Hujjatga custom attribute yoki state qo'yish:
```http
PUT https://online.moysklad.ru/api/remap/1.2/entity/invoiceout/{id}

{
  "attributes": [
    { "meta": { "href": "...attribute/didoxId" }, "value": "DDX-OUT-2026-042" },
    { "meta": { "href": "...attribute/didoxStatus" }, "value": "ACCEPTED" }
  ]
}
```

---

## 7. Authentication: tokenlar va kalitlar

Uchta token bor:

| Token | Kim beradi | Nima uchun | Lifetime |
|-------|------------|------------|----------|
| **Vendor App Secret** | MoySklad (ilova ro'yxatdan o'tganda) | Vendor API call'lariga `Authorization: Bearer` | Permanent |
| **Account Access Token** | MoySklad (har bir account uchun) | JSON API 1.2 — account ma'lumotlariga kirish | Permanent (yoki revoke'gacha) |
| **Context Key** | MoySklad (iframe ochilganda) | Foydalanuvchi shaxsini tasdiqlash | Bir martalik |

**DB'da har bir account uchun:**
```
accounts {
  accountId      string  PK
  msAccessToken  string  (encrypted) — JSON API uchun
  didoxToken     string  (encrypted)
  status         enum    (Activated | Suspended | Deleted)
  createdAt      timestamp
}
```

---

## 8. Xato holatlari (edge cases)

| Holat | Tavsiya etilgan harakat |
|-------|-------------------------|
| Didox'da kontragent bor, MoySklad'da yo'q | Auto-create yoki user'dan tanlash |
| Tovar Didox'da nomi bilan, MoySklad'da boshqa nom | `code` (ИКПУ) bo'yicha match qilish, nom bo'yicha emas |
| Bir nechta ombor — qaysi biriga? | Default ombor + UI'da o'zgartirish imkoni |
| MoySklad token expired/revoked | `Activate` callback'ni qayta chaqirishni so'rash |
| Didox bir xil invoice'ni qayta yuborgan | `idempotency` — Didox ID bo'yicha duplicate check |
| Net xato (Didox / MoySklad down) | Retry queue (3 marta, exponential backoff) |
| Foydalanuvchi `invoicein` ni MoySklad'da o'chirgan, Didox'da hali bor | Webhook orqali — Didox tomonida ham status update |

---

## 9. Eslatma: nima ilk versiyada bo'lmasligi mumkin

Birinchi versiya uchun ortiqcha bo'lishi mumkin (keyin qo'shasiz):
- Bulk import (10+ faktura bir vaqtda)
- Auto-import (har soatda Didox'dan tekshirish)
- Webhook'lar (real-time sinxronizatsiya)
- `Supply` (Приёмка) avtomatik yaratish — `invoicein` bilan birga
- Multi-organization support
- Audit log UI

---

## 10. Tartib: nimadan boshlash

1. **Auth qismi** — Vendor API `Activate`/`Delete`/`Status` callback'lari
2. **Settings UI** — credentials va default'lar uchun oddiy forma
3. **Invoice In MVP** — bitta-bittadan, Didox'dan ko'chirish (auto-create OFF)
4. **Mapping logic** — counterparty + product map jadvallari
5. **Invoice Out MVP** — bitta-bittadan yuborish
6. **Auto-create flow** — yangi product/counterparty yaratish
7. **Bulk + webhook'lar** — keyingi iteratsiyada

---

## 11. Foydali havolalar

- Vendor API doc: https://github.com/moysklad/api-vendor-1.0-doc
- JSON API 1.2 doc: https://dev.moysklad.ru/doc/api/remap/1.2/
- Counterparty: `/entity/counterparty`
- Product: `/entity/product`
- InvoiceIn (Счёт поставщика): `/entity/invoicein`
- InvoiceOut (Счёт покупателю): `/entity/invoiceout`
- Supply (Приёмка): `/entity/supply`
- Demand (Отгрузка): `/entity/demand`
- Store (ombor): `/entity/store`
- Organization: `/entity/organization`
- Didox API: https://didox.uz (rasmiy hujjat — partner panel orqali olinadi)
