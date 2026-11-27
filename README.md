# GasKuis ⚡

Platform kuis interaktif real-time: host menampilkan soal di layar besar, pemain menjawab dari HP pakai PIN 6 digit.

## Fitur
- **Host**: daftar/login, buat & edit kuis (pilihan ganda 2–4 opsi, benar/salah, gambar, batas waktu, poin standar/ganda/tanpa poin), salin, impor/ekspor JSON.
- **Game live**: PIN + QR code, kunci lobby, keluarkan pemain, hitung mundur, distribusi jawaban, papan skor, podium juara.
- **Pemain**: tanpa akun, cukup PIN + nama. Skor berdasarkan kecepatan (50–100%) + bonus streak.
- **Laporan** otomatis setelah game selesai (peringkat, % benar per soal), unduh CSV.

## Ketangguhan (robustness)
- Server memegang semua logika (timer, skor, validasi) — jawaban benar tidak pernah dikirim ke pemain sebelum reveal.
- Auto-reconnect: pemain & host yang refresh/putus sinyal kembali ke game dengan skor utuh (kunci sesi rahasia).
- Validasi semua input dengan zod (HTTP & socket), rate-limit login/join/event, proteksi CSRF, header keamanan (helmet/CSP), password di-hash scrypt.
- Toleransi latensi 600 ms untuk jawaban di detik terakhir, sinkronisasi jam klien–server.
- Pembersihan otomatis game lama, graceful shutdown, database SQLite (WAL).

## Menjalankan
Butuh Node.js ≥ 22.13.

```bash
npm install
npm run dev          # server :3000 + Vite :5173 → buka http://localhost:5173
npm test             # unit + end-to-end tests
npm run build && npm start   # mode produksi di :3000
```

Environment variable: `PORT` (default 3000), `DATA_DIR` (lokasi database, default `./data`), `NODE_ENV=production` (cookie secure — wajib HTTPS), `INSECURE_COOKIES=1` (produksi tanpa HTTPS, untuk tes saja).

## Deploy
Butuh server Node yang berjalan terus (WebSocket) + disk persisten — misalnya Railway, Render, Fly.io, atau VPS. Ada `Dockerfile`; pasang volume ke `/data`. Jalankan **satu instance** saja (state game ada di memori).
