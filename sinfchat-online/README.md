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
Branch: `sinfchat-online-deploy`
Build command: `pip install -r sinfchat-online/requirements.txt`
Start command: `cd sinfchat-online && uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers`

**Eslatma:** SQLite Render Free veb-server diskida **doimiy emas**. Server qayta ishga tushsa foydalanuvchi akkauntlari, xabarlar, rasmlar yo‘qolishi mumkin. Haqiqiy sinf foydalanishidan oldin barqaror ma’lumotlar bazasiga ko‘chirish kerak. Parollar hash qilinadi, lekin end-to-end shifrlash yo‘q.
