# SinfChat Online

Sinfdoshlar uchun taklif kodi bilan himoyalangan, guruh va shaxsiy yozishmalar, rasm, ovozli xabar, shikoyat va admin cheklovi mavjud web-messenjer.

## Ishga tushirish
```sh
pip install -r requirements.txt
export INVITE_CODE='kamida8belgili-maxfiy-kod'
export ADMIN_SETUP_CODE='kamida12belgili-kod'
uvicorn main:app --reload
```

## Render
Branch: `sinfchat-durable-history`
Build command: `pip install -r sinfchat-online/requirements.txt`
Start command: `cd sinfchat-online && uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers`

## Doimiy tarix va onlayn ro‘yxat

Render xizmati uchun alohida, muddati tugamaydigan PostgreSQL bazasining ulanish satrini `DATABASE_URL` maxfiy muhit o‘zgaruvchisida saqlang. Baza ulanmasa, server vaqtinchalik bazaga yozishni boshlamaydi. Xabarlar, fayllar, akkauntlar va seanslar bir bazada saqlanadi. Zaxiralash va xotira hajmi tanlangan baza xizmatiga bog‘liq. Onlayn ro‘yxat uchun ilovani bitta Uvicorn ishchi jarayonida ishga tushiring.

Eski SQLite bazasini ko‘chirish uchun avval yozuvlarni to‘xtating va bazaning yaxlit SQLite nusxasini oling. Yangi, bo‘sh PostgreSQL bazasi uchun `DATABASE_URL` o‘rnatilgan muhitda `python migrate_sqlite.py /path/to/backup.db` buyrug‘ini bajaring. Buyruq foydalanuvchi va xabar IDlarini saqlaydi, to‘ldirilgan manzilni o‘zgartirmaydi. Dastlabki nusxani olishdan oldin vaqtinchalik diskli ishlab turgan xizmatni qayta joylashtirish undagi ma’lumotlarni yo‘qotadi.

Yopiq D1 saqlash xizmati ham qo‘llanadi. Bu variantda Render muhitiga xizmat manzili `CLASS_STORE_URL`, Sites xizmat tokeni `CLASS_STORE_ACCESS` va ikki xizmat uchun bir xil maxfiy `CLASS_STORE_SECRET` o‘rnatiladi. D1 migratsiyalari saqlash xizmatiga joylashtiriladi. Veb-serverning mahalliy diski ishlatilmaydi.
