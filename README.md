# GasKuis ⚡

Platform kuis interaktif real-time: host menampilkan soal di layar besar, pemain menjawab dari HP pakai PIN 6 digit.

## Fitur
- **7 tipe soal**: pilihan ganda (bisa >1 jawaban benar), benar/salah, ketik jawaban (abaikan huruf besar/aksen/tanda baca, hingga 4 variasi), puzzle urutan, slider tebak angka (dengan toleransi), polling, word cloud.
- **Mode permainan**: Klasik, **Mode Tim** (2–6 tim, dibagi otomatis), dan **Tugas/mandiri** (PIN 7 digit, dikerjakan kapan saja sampai batas waktu, hasil diperbarui langsung).
- **Pengaturan game**: acak urutan soal & jawaban, generator nama lucu (bisa ganti 3×), sembunyikan soal di perangkat pemain, musik on/off.
- **Karakter gabungan orisinal**: kepala hewan/robot/monster/alien × 12 warna × 9 telinga × 7 mata × 7 mulut × 9 aksesori × 4 motif — berkedip, menari di lobby, gembira/sedih saat reveal.
- **Animasi & suara**: musik lobby & musik menjawab orisinal (disintesis Web Audio), hitung mundur, gong waktu habis, papan skor yang bergeser, drumroll + podium + konfeti, emoji reaksi melayang dari pemain.
- **Host**: PIN + QR, kunci lobby, keluarkan pemain, lewati waktu, layar penuh; info "X poin di belakang Y" & streak 🔥 di HP pemain.
- **Konten**: upload gambar, kuis publik + halaman Jelajahi + salin kuis orang lain, impor/ekspor JSON, kuis contoh semua tipe.
- **Laporan**: otomatis per game & per tugas (peringkat, tim, % benar, ringkasan jawaban), unduh CSV.

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
