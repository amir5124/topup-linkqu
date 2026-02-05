const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const FormData = require('form-data');


const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Konfigurasi kredensial
const clientId = "5f5aa496-7e16-4ca1-9967-33c768dac6c7";
const clientSecret = "TM1rVhfaFm5YJxKruHo0nWMWC";
const username = "LI9019VKS";
const pin = "5m6uYAScSxQtCmU";
const serverKey = "QtwGEr997XDcmMb1Pq8S5X1N";


const db = mysql.createPool({
    host: process.env.DB_HOST || 'hco8kksk4k4cc088cockkk4g',
    user: process.env.DB_USER || 'mysql',
    password: process.env.DB_PASSWORD || 'uZ4RH8Ef7vynMciS9QEbLlTDpCL2Z4tdMR55owuSasccnbYjoXUdRq04V5RauZp2',
    database: process.env.DB_NAME || 'topup',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});


// 📝 Fungsi untuk menulis log ke stderr.log
function logToFile(message) {
    const logPath = path.join(__dirname, 'stderr.log');
    const timestamp = new Date().toISOString();
    const fullMessage = `[${timestamp}] ${message}\n`;

    fs.appendFile(logPath, fullMessage, (err) => {
        if (err) {
            console.error("❌ Gagal menulis log:", err);
        }
    });
}

// 🔄 Fungsi expired format YYYYMMDDHHmmss
function getExpiredTimestamp(minutesFromNow = 15) {
    return moment.tz('Asia/Jakarta').add(minutesFromNow, 'minutes').format('YYYYMMDDHHmmss');
}

const getFormatNow = () => {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

// 🔐 Fungsi membuat signature untuk request POST VA
function generateSignaturePOST({
    amount,
    expired,
    bank_code,
    partner_reff,
    customer_id,
    customer_name,
    customer_email,
    clientId,
    serverKey
}) {
    const path = '/transaction/create/va';
    const method = 'POST';

    const rawValue = amount + expired + bank_code + partner_reff +
        customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();

    const signToString = path + method + cleaned;

    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

function generateSignatureQRIS({
    amount,
    expired,
    partner_reff,
    customer_id,
    customer_name,
    customer_email,
    clientId,
    serverKey
}) {
    const path = '/transaction/create/qris';
    const method = 'POST';

    const rawValue = amount + expired + partner_reff +
        customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();

    const signToString = path + method + cleaned;

    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

function generateSignatureRetail({
    amount,
    expired,
    retail_code,
    partner_reff,
    customer_id,
    customer_name,
    customer_email,
    clientId,
    serverKey
}) {
    // 1. Tentukan Path dan Method
    const path = '/transaction/create/retail';
    const method = 'POST';

    // 2. Gabungkan nilai parameter (Raw Value)
    // Sesuai urutan: amount + expired + retail_code + partner_reff + customer_id + customer_name + customer_email + clientId
    const rawValue = amount + expired + retail_code + partner_reff +
        customer_id + customer_name + customer_email + clientId;

    // 3. Bersihkan dan Ubah ke huruf kecil (Cleaned Value)
    // Hapus karakter non-alfanumerik (seperti yang dilakukan pada fungsi QRIS)
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();

    // 4. Gabungkan untuk String yang akan di-Sign (Sign to String)
    // Path + Method + Cleaned Value
    const signToString = path + method + cleaned;

    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

// 🧾 Fungsi membuat kode unik partner_reff
function generatePartnerReff() {
    const prefix = 'INV-782372373627';
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${timestamp}-${randomStr}`;
}

// ✅ Endpoint POST untuk membuat VA
app.post('/create-va', async (req, res) => {
    try {
        console.log("📩 Request Body:", req.body);

        const body = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();
        const url_callback = "https://topuplinku.siappgo.id/callback";

        console.log("🆔 Generated partner_reff:", partner_reff, "| expired:", expired);

        const signature = generateSignaturePOST({
            amount: body.amount,
            expired,
            bank_code: body.bank_code,
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            clientId,
            serverKey
        });

        console.log("🔑 Generated signature:", signature);

        const payload = {
            ...body,
            partner_reff,
            username,
            pin,
            expired,
            signature,
            url_callback
        };

        const headers = {
            'client-id': clientId,
            'client-secret': clientSecret
        };

        console.log("📤 Sending request to LinkQu:");
        console.log("Payload:", payload);
        console.log("Headers:", headers);

        const url = 'https://api.linkqu.id/linkqu-partner/transaction/create/va';
        const response = await axios.post(url, payload, { headers });
        const result = response.data;

        console.log("✅ Response from LinkQu:", result);

        // 🐘 Simpan ke DB
        const insertData = {
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            amount: body.amount,
            bank_code: result?.bank_name || null,
            expired,
            customer_phone: body.customer_phone || null,
            customer_email: body.customer_email,
            va_number: result?.virtual_account || null,
            response_raw: JSON.stringify(result),
            created_at: new Date(),
            status: "PENDING"
        };

        console.log("💾 Insert to DB:", insertData);

        await db.query('INSERT INTO inquiry_va SET ?', [insertData]);

        res.json(result);
    } catch (err) {
        console.error("❌ Gagal membuat VA:", err.message);
        console.error("Detail error:", err.response?.data || err);

        res.status(500).json({
            error: "Gagal membuat VA",
            detail: err.response?.data || err.message
        });
    }
});




app.post('/create-qris', async (req, res) => {
    try {
        const body = req.body;
        console.log("📥 Incoming request body:", body);

        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();
        const url_callback = "https://topuplinku.siappgo.id/callback";

        console.log("🧾 Generated partner_reff:", partner_reff);
        console.log("⏳ Expired timestamp:", expired);

        const signature = generateSignatureQRIS({
            amount: body.amount,
            expired,
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            clientId,
            serverKey
        });

        console.log("🔏 Generated signature:", signature);

        const payload = {
            ...body,
            partner_reff,
            username,
            pin,
            expired,
            signature,
            url_callback
        };

        console.log("📦 Final payload to API:", payload);

        const headers = {
            'client-id': clientId,
            'client-secret': clientSecret
        };

        const url = 'https://api.linkqu.id/linkqu-partner/transaction/create/qris';
        const response = await axios.post(url, payload, { headers });

        const result = response.data;
        console.log("✅ API response from LinkQu:", result);

        // 💾 Download QR image langsung
        let qrisImageBuffer = null;
        if (result?.imageqris) {
            try {
                console.log(`🌐 Downloading QR image from: ${result.imageqris}`);
                const imgResp = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer' });
                qrisImageBuffer = Buffer.from(imgResp.data);
                console.log("✅ QR image downloaded successfully");
            } catch (err) {
                console.error("⚠️ Failed to download QRIS image:", err.message);
            }
        }

        // 🕒 Gunakan waktu lokal server, bukan UTC
        const now = new Date();
        const mysqlDateTime = now.toISOString().slice(0, 19).replace('T', ' ');

        const insertQuery = `
            INSERT INTO inquiry_qris 
            (partner_reff, customer_id, customer_name, amount, expired, customer_phone, customer_email, qris_url, qris_image, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `;

        await db.execute(insertQuery, [
            partner_reff,
            body.customer_id,
            body.customer_name,
            body.amount,
            expired,
            body.customer_phone || null,
            body.customer_email,
            result?.imageqris || null,
            qrisImageBuffer,
            JSON.stringify(result),
            mysqlDateTime
        ]);

        console.log(`✅ Data QRIS berhasil disimpan ke database dengan created_at = ${mysqlDateTime}`);
        res.json(result);

    } catch (err) {
        const errMsg = err.response?.data?.message || err.message;
        const logMsg = `❌ Gagal membuat QRIS: ${errMsg}`;
        console.error(logMsg);

        if (err.response?.data) {
            console.error("📛 Full error response from API:", err.response.data);
        }

        logToFile(logMsg);

        res.status(500).json({
            error: "Gagal membuat QRIS",
            detail: err.response?.data || err.message
        });
    }
});

app.post('/create-retail', async (req, res) => {
    try {
        const body = req.body;
        console.log("📥 Incoming retail request body:", body);

        // Ambil retail_code dari body. Contoh: "ALFAMART", "INDOMARET"
        const retail_code = body.retail_code;
        if (!retail_code) {
            return res.status(400).json({ error: "Parameter 'retail_code' diperlukan." });
        }

        const partner_reff = generatePartnerReff();
        // Biasanya transaksi retail memiliki masa expired yang lebih pendek, 
        // pastikan getExpiredTimestamp() mengembalikan format YYYYMMDDHHmmss
        const expired = getExpiredTimestamp();
        const url_callback = "https://topuplinku.siappgo.id/callback";

        console.log("🧾 Generated partner_reff:", partner_reff);
        console.log("⏳ Expired timestamp:", expired);

        // --- 1. GENERATE SIGNATURE RETAIL ---
        // PENTING: Gunakan fungsi generateSignatureRetail dengan parameter yang sesuai.
        const signature = generateSignatureRetail({
            amount: body.amount,
            expired,
            retail_code, // Parameter tambahan untuk retail
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            clientId,
            serverKey
        });

        console.log("🔏 Generated signature:", signature);

        // --- 2. SIAPKAN PAYLOAD UNTUK LINKQU API ---
        const payload = {
            amount: body.amount,
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            expired,
            username,
            pin,
            retail_code, // Tambahkan retail_code ke payload
            customer_phone: body.customer_phone,
            customer_email: body.customer_email,
            remark: body.remark || "Pembayaran Retail",
            signature,
            url_callback
        };

        console.log("📦 Final payload to API:", payload);

        // --- 3. PANGGIL API LINKQU ---
        const headers = {
            'client-id': clientId,
            'client-secret': clientSecret
        };
        const url = 'https://api.linkqu.id/linkqu-partner/transaction/create/retail'; // Endpoint RETAIL
        const response = await axios.post(url, payload, { headers });

        const result = response.data;
        console.log("✅ API response from LinkQu:", result);

        // --- 4. SIMPAN DATA KE DATABASE ---
        // Sesuaikan nama tabel dan kolom jika diperlukan
        const now = new Date();
        const mysqlDateTime = now.toISOString().slice(0, 19).replace('T', ' ');

        const insertQuery = `
            INSERT INTO inquiry_retail 
            (partner_reff, customer_id, customer_name, amount, expired, bank_code, customer_phone, customer_email, retail_code, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `;

        await db.execute(insertQuery, [
            partner_reff,
            body.customer_id,
            body.customer_name,
            body.amount,
            expired,
            retail_code,
            body.customer_phone || null,
            body.customer_email,
            result?.payment_code || null, // Simpan Payment Code (misal: kode bayar Indomaret/Alfamart)
            JSON.stringify(result),
            mysqlDateTime
        ]);

        console.log(`✅ Data Retail berhasil disimpan ke database dengan created_at = ${mysqlDateTime}`);
        res.json(result);

    } catch (err) {
        const errMsg = err.response?.data?.message || err.message;
        const logMsg = `❌ Gagal membuat transaksi Retail: ${errMsg}`;
        console.error(logMsg);

        if (err.response?.data) {
            console.error("📛 Full error response from API:", err.response.data);
        }

        logToFile(logMsg);

        res.status(500).json({
            error: "Gagal membuat transaksi Retail",
            detail: err.response?.data || err.message
        });
    }
});


app.get('/download-qr/:partner_reff', async (req, res) => {
    const partner_reff = req.params.partner_reff;

    try {
        // 1️⃣ Cek apakah QR sudah ada di DB
        const [check] = await db.query(
            'SELECT qris_image FROM inquiry_qris WHERE partner_reff = ?',
            [partner_reff]
        );

        if (check.length > 0 && check[0].qris_image) {
            console.log(`✅ QR ditemukan di database: ${partner_reff}`);
            res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
            res.setHeader('Content-Type', 'image/png');
            return res.send(check[0].qris_image);
        }

        // 2️⃣ Ambil URL QR dari DB
        const [rows] = await db.query(
            'SELECT qris_url FROM inquiry_qris WHERE partner_reff = ?',
            [partner_reff]
        );

        if (!rows.length || !rows[0].qris_url) {
            return res.status(404).send('QRIS tidak ditemukan.');
        }

        const imageUrl = rows[0].qris_url.trim();
        console.log(`🔗 Download QR dari URL: ${imageUrl}`);

        // 3️⃣ Download gambar sebagai buffer
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        // 4️⃣ Simpan ke DB
        await db.query(
            'UPDATE inquiry_qris SET qris_image = ? WHERE partner_reff = ?',
            [buffer, partner_reff]
        );
        console.log(`💾 QR disimpan di database: ${partner_reff}`);

        // 5️⃣ Kirim ke user dengan force download
        res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);

    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        res.status(500).send('Terjadi kesalahan server.');
    }
});

async function addBalance(amount, customer_name, va_code, serialnumber) {
    const originalAmount = parseInt(amount);
    let admin;

    // Logika perhitungan admin
    if (va_code === "QRIS") {
        admin = Math.round(originalAmount * 0.008);
    } else if (va_code === "RETAIL") {
        admin = 2000;
    } else {
        admin = 2500;
    }

    const negativeAmount = originalAmount - admin;
    // Ambil nama terakhir untuk username
    const username = customer_name.trim().split(" ").pop();

    const formattedAmount = negativeAmount.toLocaleString('id-ID');
    const formattedAdmin = admin.toLocaleString('id-ID');
    const catatan = `Transaksi berhasil || nominal Rp. ${formattedAmount} || biaya admin Rp. ${formattedAdmin} || metode ${va_code} || Biller Reff ${serialnumber}`;

    // 1. Tambah Saldo ke RTS (External API)
    const formdata = new FormData();
    formdata.append("amount", negativeAmount);
    formdata.append("username", username);
    formdata.append("note", catatan);

    try {
        const response = await axios.post('https://rtsindonesia.biz.id/qris.php', formdata, {
            headers: formdata.getHeaders()
        });
        console.log("✅ RTS Response:", response.data);

        // Asumsi: Jika RTS gagal, biasanya memberikan response status tertentu. 
        // Sesuaikan pengecekan ini dengan format response rtsindonesia.biz.id
        if (response.data.status === false) {
            throw new Error("RTS API menolak penambahan saldo");
        }

        // 2. Kirim Notifikasi Jagel (Async, jangan biarkan ini menggagalkan transaksi utama)
        // Kita tidak pakai 'await' di sini agar response callback tetap cepat
        axios.post("https://api.jagel.id/v1/message/send", {
            type: "username",
            value: username,
            apikey: "FF6dKZ94S3SRB4jp3zc2UulCnH5bhLaMJ7sa3dz8wm1qj8ggqu",
            content: catatan,
        }).catch(err => console.error("⚠️ Jagel Notif Error (Ignored):", err.message));

        return { username, negativeAmount, catatan };

    } catch (error) {
        console.error("❌ Gagal di addBalance (RTS):", error.message);
        throw error; // Lempar error agar ditangkap oleh catch di /callback (untuk rollback)
    }
}

app.post('/callback', async (req, res) => {
    const connection = await db.getConnection(); // Dapatkan koneksi dari pool

    try {
        const { partner_reff, amount, va_code, customer_name, serialnumber } = req.body;
        const RETAIL_CODES = ['ALFAMART', 'INDOMARET'];

        // Tentukan tabel target
        let tableName = 'inquiry_va';
        if (va_code === 'QRIS') tableName = 'inquiry_qris';
        else if (RETAIL_CODES.includes(va_code)) tableName = 'inquiry_retail';

        // --- MULAI TRANSAKSI ---
        await connection.beginTransaction();

        // 1. LOCK & CHECK (Cegah Double Request di milidetik yang sama)
        const [rows] = await connection.execute(
            `SELECT status FROM ${tableName} WHERE partner_reff = ? FOR UPDATE`,
            [partner_reff]
        );

        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Data transaksi tidak ditemukan" });
        }

        if (rows[0].status === 'SUKSES') {
            await connection.rollback();
            console.log(`ℹ️ Skip: ${partner_reff} sudah SUKSES.`);
            return res.json({ message: "Sudah diproses sebelumnya." });
        }

        // 2. UPDATE STATUS DULU (Status 'PENDING' -> 'PROSES')
        // Ini memastikan jika addBalance lambat, request callback lain sudah melihat status bukan PENDING
        await connection.execute(
            `UPDATE ${tableName} SET status = 'SUKSES' WHERE partner_reff = ?`,
            [partner_reff]
        );

        // 3. JALANKAN LOGIKA EKSTERNAL (RTS & Jagel)
        // Jika ini gagal (throw error), maka status di DB akan kembali jadi PENDING (karena rollback)
        await addBalance(amount, customer_name, va_code, serialnumber);

        // 4. COMMIT SEMUA
        await connection.commit();

        console.log(`🚀 Callback Berhasil: Saldo ${customer_name} ditambahkan.`);
        res.json({ message: "Callback diterima dan saldo ditambahkan" });

    } catch (err) {
        if (connection) await connection.rollback();

        const logMsg = `❌ Callback Error [${req.body.partner_reff}]: ${err.message}`;
        console.error(logMsg);
        logToFile(logMsg);

        res.status(500).json({ error: "Internal Server Error", detail: err.message });
    } finally {
        if (connection) connection.release(); // PENTING: Kembalikan koneksi ke pool!
    }
});


app.get('/check-status/:partnerReff', async (req, res) => {
    const partner_reff = req.params.partnerReff;
    try {
        const response = await axios.get(`https://api.linkqu.id/linkqu-partner/transaction/payment/checkstatus`, {
            params: { username, partnerreff: partner_reff }, headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });
        if (response.data.status_code === '00') {
            await db.execute(`UPDATE order_service SET order_status = 'PAID' WHERE order_reff = ?`, [partner_reff]);
        }
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});


app.get('/va-list', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ error: "Username diperlukan" });
    }

    try {
        // Ambil semua data PENDING
        const [pendingBefore] = await db.query(`
            SELECT id, bank_code, va_number, amount, status, customer_name, expired, created_at
            FROM inquiry_va
            WHERE status = 'PENDING'
        `);

        console.log("[VA-LIST] Data PENDING sebelum hapus:", pendingBefore);

        const now = Date.now();
        const fifteenMinutes = 15 * 60 * 1000;
        const idsToDelete = pendingBefore
            .filter(row => now - new Date(row.created_at).getTime() > fifteenMinutes)
            .map(row => row.id);

        if (idsToDelete.length > 0) {
            await db.query(`DELETE FROM inquiry_va WHERE id IN (?)`, [idsToDelete]);
        }

        console.log(`[VA-LIST] Rows deleted = ${idsToDelete.length}`);

        // Ambil data terbaru
        const [results] = await db.query(`
            SELECT bank_code, va_number, amount, status, customer_name, expired, created_at
            FROM inquiry_va
            WHERE customer_name = ?
            ORDER BY created_at DESC
            LIMIT 5
        `, [username]);

        console.log("[VA-LIST] Data PENDING setelah hapus:", results);
        res.json(results);
    } catch (err) {
        console.error("DB error (va-list):", err.message);
        res.status(500).json({ error: "Terjadi kesalahan saat mengambil data VA" });
    }
});

app.get('/retail-list', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ error: "Username diperlukan" });
    }

    try {
        // --- 1. Hapus Transaksi PENDING yang Kedaluwarsa (Lebih dari 15 Menit) ---
        // Ambil semua data PENDING
        const [pendingBefore] = await db.query(`
            SELECT id, created_at
            FROM inquiry_retail
            WHERE status = 'PENDING'
        `);

        console.log("[RETAIL-LIST] Data PENDING sebelum cek expired:", pendingBefore.length);

        const now = Date.now();
        // Asumsi batas waktu kedaluwarsa adalah 15 menit (15 * 60 * 1000 ms)
        const fifteenMinutes = 15 * 60 * 1000;

        // Filter ID yang sudah melewati 15 menit dari created_at
        const idsToDelete = pendingBefore
            .filter(row => now - new Date(row.created_at).getTime() > fifteenMinutes)
            .map(row => row.id);

        if (idsToDelete.length > 0) {
            await db.query(`DELETE FROM inquiry_retail WHERE id IN (?)`, [idsToDelete]);
        }

        console.log(`[RETAIL-LIST] Jumlah baris PENDING yang dihapus: ${idsToDelete.length}`);

        // --- 2. Ambil Data Transaksi Retail Terbaru ---
        // Kolom yang ditampilkan: bank_code (Gerai), retail_code (Kode Bayar - asumsi Anda menggunakan ini), amount, status, created_at, expired.

        const [results] = await db.query(`
            SELECT 
               bank_code AS retail_code,
               retail_code AS payment_code,
                amount, 
                status, 
                customer_name, 
                expired, 
                created_at
            FROM inquiry_retail
            WHERE customer_name = ?
            ORDER BY created_at DESC
            LIMIT 5
        `, [username]);

        console.log(`[RETAIL-LIST] Mengirim ${results.length} transaksi retail terbaru.`);
        res.json(results);
    } catch (err) {
        console.error("DB error (retail-list):", err.message);
        res.status(500).json({ error: "Terjadi kesalahan saat mengambil data Retail" });
    }
});


app.get('/qr-list', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ error: "Username diperlukan" });
    }

    try {
        // Ambil semua data PENDING
        const [pendingBefore] = await db.query(`
            SELECT id, partner_reff, amount, status, customer_name, qris_url, expired, created_at
            FROM inquiry_qris
            WHERE status = 'PENDING'
        `);

        console.log("[QR-LIST] Data PENDING sebelum hapus:", pendingBefore);

        const now = Date.now();
        const fifteenMinutes = 15 * 60 * 1000;
        const idsToDelete = pendingBefore
            .filter(row => now - new Date(row.created_at).getTime() > fifteenMinutes)
            .map(row => row.id);

        if (idsToDelete.length > 0) {
            await db.query(`DELETE FROM inquiry_qris WHERE id IN (?)`, [idsToDelete]);
        }

        console.log(`[QR-LIST] Rows deleted = ${idsToDelete.length}`);

        // Ambil data terbaru
        const [results] = await db.query(`
            SELECT partner_reff, amount, status, customer_name, qris_url, expired, created_at
            FROM inquiry_qris
            WHERE customer_name = ?
            ORDER BY created_at DESC
            LIMIT 5
        `, [username]);

        console.log("[QR-LIST] Data PENDING setelah hapus:", results);
        res.json(results);
    } catch (err) {
        console.error("DB error (qr-list):", err.message);
        res.status(500).json({ error: "Terjadi kesalahan saat mengambil data QR" });
    }
});




const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});