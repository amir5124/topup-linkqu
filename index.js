'use strict';

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
app.use(express.json({ limit: '10mb' }));

// ============================================================
// KONFIGURASI
// ============================================================
// const CONFIG = {
//     clientId: process.env.LINKQU_CLIENT_ID || 'testing',
//     clientSecret: process.env.LINKQU_CLIENT_SECRET || '123',
//     username: process.env.LINKQU_USERNAME || 'LI307GXIN',
//     pin: process.env.LINKQU_PIN || '2K2NPCBBNNTovgB',
//     serverKey: process.env.LINKQU_SERVER_KEY || 'LinkQu@2020',
//     callbackUrl: process.env.CALLBACK_URL || 'https://top.mudico.co.id/callback',
//     MUDICOUrl: process.env.MUDICO_URL || 'https://mudico.my.id/mudico.php',
//     jagelApiKey: process.env.JAGEL_APIKEY || 'q2t7lktZkZIEiCDs7y9HpWP0WCRdABEGTrHidEUhrAMe0IDzXV',
//     linkquGateway: process.env.LINKQU_GATEWAY || 'https://gateway-dev.linkqu.id/linkqu-partner',
// };

const CONFIG = {
    clientId: process.env.LINKQU_CLIENT_ID || '1c6d18de-0482-4032-8b86-ccfabbd1ad16',
    clientSecret: process.env.LINKQU_CLIENT_SECRET || 'wF81cAuqlipbNHT8Ppwbcwsd9',
    username: process.env.LINKQU_USERNAME || 'LI642KHVN',
    pin: process.env.LINKQU_PIN || 'XBWtQGnSBjxRNsE',
    serverKey: process.env.LINKQU_SERVER_KEY || 'Xumk9OriODJ1WK8jFp0mZPjz',
    callbackUrl: process.env.CALLBACK_URL || 'https://topuplinku.siappgo.id/callback',
    MUDICOUrl: process.env.MUDICO_URL || 'https://mudico.my.id/mudico.php',
    jagelApiKey: process.env.JAGEL_APIKEY || 'q2t7lktZkZIEiCDs7y9HpWP0WCRdABEGTrHidEUhrAMe0IDzXV',
    linkquGateway: process.env.LINKQU_GATEWAY || 'https://api.linkqu.id/linkqu-partner',
};

// ============================================================
// DATABASE POOL
// ============================================================
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '3306'),
    connectTimeout: 30000,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

// ============================================================
// LOGGER
// ============================================================
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logToFile(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const logPath = path.join(LOG_DIR, `${type.toLowerCase()}.log`);
    const logMessage = `[${timestamp}] [${type}] ${message}\n`;
    fs.appendFile(logPath, logMessage, (err) => {
        if (err) console.error('Gagal write log:', err.message);
    });
    console.log(logMessage.trim());
}

// ============================================================
// TEST KONEKSI DATABASE
// ============================================================
async function testDatabaseConnection() {
    console.log('\n🔍 Testing database connection...');
    console.log(`   Host: ${process.env.DB_HOST || '153.92.11.209'}`);
    console.log(`   Database: ${process.env.DB_NAME || 'u922574939_topup'}`);

    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.query('SELECT VERSION() as version, NOW() as now, DATABASE() as db, USER() as user');
        console.log('✅ DATABASE CONNECTED!');
        console.log(`   MySQL Version: ${rows[0].version}`);
        console.log(`   Server Time: ${rows[0].now}`);
        console.log(`   Database: ${rows[0].db}`);
        console.log(`   User: ${rows[0].user}`);

        const [tables] = await connection.query(`
            SELECT TABLE_NAME 
            FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = ? 
            AND TABLE_NAME IN ('inquiry_va', 'inquiry_qris', 'inquiry_retail')
        `, [rows[0].db]);

        const existingTables = tables.map(t => t.TABLE_NAME);
        console.log(`   Tables found: ${existingTables.join(', ') || 'none'}`);

        if (existingTables.length < 3) {
            console.warn('⚠️ Some tables are missing! Please create them.');
        }

        connection.release();
        return true;
    } catch (err) {
        console.error('❌ DATABASE CONNECTION FAILED!');
        console.error(`   Error: ${err.message}`);
        console.error(`   Code: ${err.code}`);
        return false;
    }
}

// Run test on startup
let dbReady = false;
testDatabaseConnection().then(result => {
    dbReady = result;
    if (!dbReady) {
        console.error('\n⚠️ WARNING: Database not ready! API will not save data.');
    }
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getExpiredTimestamp(minutes = 15) {
    return moment.tz('Asia/Jakarta').add(minutes, 'minutes').format('YYYYMMDDHHmmss');
}

function generatePartnerReff() {
    return crypto.randomBytes(5).toString('hex'); // 5 bytes = 10 hex chars
}

function mysqlNow() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function hmac256(serverKey, data) {
    return crypto.createHmac('sha256', serverKey).update(data).digest('hex');
}

function cleanValue(str) {
    return String(str).replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

function generateSignatureVA(params) {
    const { amount, expired, bank_code, partner_reff, customer_id, customer_name, customer_email, clientId, serverKey } = params;
    const path = '/transaction/create/va';
    const method = 'POST';
    const raw = cleanValue(amount + expired + bank_code + partner_reff + customer_id + customer_name + customer_email + clientId);
    const signToString = path + method + raw;
    return hmac256(serverKey, signToString);
}

function generateSignatureQRIS(params) {
    const { amount, expired, partner_reff, customer_id, customer_name, customer_email, clientId, serverKey } = params;
    const path = '/transaction/create/qris';
    const method = 'POST';
    const raw = cleanValue(amount + expired + partner_reff + customer_id + customer_name + customer_email + clientId);
    const signToString = path + method + raw;
    return hmac256(serverKey, signToString);
}

function generateSignatureRetail(params) {
    const { amount, expired, retail_code, partner_reff, customer_id, customer_name, customer_email, clientId, serverKey } = params;
    const path = '/transaction/create/retail';
    const method = 'POST';
    const raw = cleanValue(amount + expired + retail_code + partner_reff + customer_id + customer_name + customer_email + clientId);
    const signToString = path + method + raw;
    return hmac256(serverKey, signToString);
}

// ============================================================
// FUNGSI ADD BALANCE (TAMBAH SALDO KE MUDICO) - FIXED
// ============================================================
async function addBalance(amount, customer_name, methodCode, serialnumber) {
    const originalAmount = parseInt(amount);
    let admin;

    console.log(`💰 [ADD-BALANCE] Processing: methodCode=${methodCode}, amount=${originalAmount}`);

    if (methodCode === "QRIS") {
        admin = Math.ceil(originalAmount * 0.008) + 1000;
    } else if (methodCode === "ALFAMART" || methodCode === "INDOMARET") {
        admin = 3500;
    } else {
        admin = 3500; // VA Bank
    }
    const negativeAmount = originalAmount - admin;

    // ✅ Username langsung dari DB
    const username = customer_name.trim();

    const formattedAmount = negativeAmount.toLocaleString('id-ID');
    const formattedAdmin = admin.toLocaleString('id-ID');

    let methodDisplayName =
        methodCode === 'QRIS' ? 'QRIS' :
            methodCode === 'ALFAMART' ? 'ALFAMART' :
                methodCode === 'INDOMARET' ? 'INDOMARET' :
                    'Virtual Account';

    const catatan = `Topup Berhasil || nominal Rp. ${formattedAmount} || biaya admin Rp. ${formattedAdmin} || metode ${methodDisplayName} || Biller Reff ${serialnumber}`;

    console.log(`💰 [ADD-BALANCE] username: "${username}"`);
    console.log(`   Amount bersih: ${negativeAmount}, Method: ${methodDisplayName}`);

    // ✅ Payload sesuai dokumentasi Jagel: POST /v1/balance/adjust
    const adjustPayload = {
        type: "username",          // pilihan: username | email | phone | user_id | session
        value: username,
        apikey: CONFIG.jagelApiKey,
        amount: negativeAmount,    // negatif untuk pengurangan, positif untuk penambahan
        adjust_balance_admin: 0,   // 0 = tidak pengaruhi saldo admin
        note: catatan,
    };

    console.log(`📤 [ADD-BALANCE] Adjust Payload:`, JSON.stringify(adjustPayload));

    try {
        // 1️⃣ ADJUST SALDO DULU
        const adjustResponse = await axios.post(
            'https://api.jagel.id/v1/balance/adjust',
            adjustPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                timeout: 30000,
            }
        );

        console.log("✅ Adjust Balance Response:", adjustResponse.data);

        if (adjustResponse.data?.success !== true) {
            throw new Error("Adjust balance gagal: " + JSON.stringify(adjustResponse.data));
        }

        // 2️⃣ BARU KIRIM MESSAGE (setelah adjust berhasil)
        try {
            const msgResponse = await axios.post(
                'https://api.jagel.id/v1/message/send',
                {
                    type: "username",
                    value: username,
                    apikey: CONFIG.jagelApiKey,
                    content: catatan,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    timeout: 30000,
                }
            );
            console.log("✅ Message Sent Response:", msgResponse.data);
        } catch (msgErr) {
            // Kirim pesan gagal tidak boleh menggagalkan proses topup,
            // karena saldo sudah berhasil di-adjust
            console.error("⚠️ Gagal kirim message (Ignored):", msgErr.message);
        }

        return {
            success: true,
            username,
            negativeAmount,
            catatan,
            adjustedBalance: adjustResponse.data?.data,
        };

    } catch (error) {
        console.error("❌ Gagal addBalance (Jagel):", error.message);
        throw error;
    }
}
// ============================================================
// ENDPOINT: POST /create-va
// ============================================================
app.post('/create-va', async (req, res) => {
    console.log('\n📝 [CREATE-VA] Request received:', JSON.stringify(req.body, null, 2));

    if (!dbReady) {
        return res.status(503).json({ error: 'Database not ready', detail: 'Check database connection' });
    }

    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();

        const signature = generateSignatureVA({
            amount: body.amount,
            expired,
            bank_code: body.bank_code,
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            clientId: CONFIG.clientId,
            serverKey: CONFIG.serverKey
        });

        const payload = {
            amount: body.amount,
            bank_code: body.bank_code,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            customer_phone: body.customer_phone || '',
            partner_reff,
            username: CONFIG.username,
            pin: CONFIG.pin,
            expired,
            signature,
            url_callback: CONFIG.callbackUrl
        };

        console.log('🚀 Sending to LinkQu API...');
        const response = await axios.post(
            `${CONFIG.linkquGateway}/transaction/create/va`,
            payload,
            { headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000 }
        );

        const result = response.data;
        console.log('✅ LinkQu Response:', JSON.stringify(result, null, 2));

        const vaNumber = result.virtual_account || null;
        const bankCode = result.bank_code || body.bank_code;

        const insertQuery = `
            INSERT INTO inquiry_va 
            (partner_reff, customer_id, customer_name, amount, bank_code, expired, 
             customer_phone, customer_email, va_number, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            partner_reff,
            body.customer_id,
            body.customer_name,
            body.amount,
            bankCode,
            expired,
            body.customer_phone || null,
            body.customer_email,
            vaNumber,
            JSON.stringify(result),
            mysqlNow(),
            'PENDING'
        ];

        const [dbResult] = await pool.execute(insertQuery, values);
        console.log(`✅ Data saved to DB! Insert ID: ${dbResult.insertId}`);

        res.json({ ...result, partner_reff, db_saved: true });

    } catch (err) {
        console.error('❌ Error in /create-va:', err.message);
        if (err.response) console.error('API Error:', err.response.data);
        res.status(500).json({ error: 'Failed to create VA', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /create-qris
// ============================================================
app.post('/create-qris', async (req, res) => {
    console.log('\n📝 [CREATE-QRIS] Request received:', JSON.stringify(req.body, null, 2));

    if (!dbReady) {
        return res.status(503).json({ error: 'Database not ready' });
    }

    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();

        const signature = generateSignatureQRIS({
            amount: body.amount,
            expired,
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            clientId: CONFIG.clientId,
            serverKey: CONFIG.serverKey
        });

        const payload = {
            amount: body.amount,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            customer_phone: body.customer_phone || '',
            partner_reff,
            username: CONFIG.username,
            pin: CONFIG.pin,
            expired,
            signature,
            url_callback: CONFIG.callbackUrl
        };

        console.log('🚀 Sending to LinkQu API...');
        const response = await axios.post(
            `${CONFIG.linkquGateway}/transaction/create/qris`,
            payload,
            { headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000 }
        );

        const result = response.data;
        console.log('✅ LinkQu Response:', JSON.stringify(result, null, 2));

        let qrisImageBuffer = null;
        if (result?.imageqris) {
            try {
                const imgResp = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer', timeout: 10000 });
                qrisImageBuffer = Buffer.from(imgResp.data);
                console.log('✅ QR image downloaded');
            } catch (imgErr) {
                console.warn('⚠️ Failed to download QR:', imgErr.message);
            }
        }

        const insertQuery = `
            INSERT INTO inquiry_qris 
            (partner_reff, customer_id, customer_name, amount, expired, 
             customer_phone, customer_email, qris_url, qris_image, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
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
            mysqlNow(),
            'PENDING'
        ];

        const [dbResult] = await pool.execute(insertQuery, values);
        console.log(`✅ Data saved to DB! Insert ID: ${dbResult.insertId}`);

        res.json({ ...result, partner_reff, db_saved: true });

    } catch (err) {
        console.error('❌ Error in /create-qris:', err.message);
        if (err.response) console.error('API Error:', err.response.data);
        res.status(500).json({ error: 'Failed to create QRIS', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /create-retail
// ============================================================
app.post('/create-retail', async (req, res) => {
    console.log('\n📝 [CREATE-RETAIL] Request received:', JSON.stringify(req.body, null, 2));

    if (!dbReady) {
        return res.status(503).json({ error: 'Database not ready' });
    }

    try {
        const body = req.body;
        const retail_code = body.retail_code;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();

        const signature = generateSignatureRetail({
            amount: body.amount,
            expired,
            retail_code,
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            clientId: CONFIG.clientId,
            serverKey: CONFIG.serverKey
        });

        const payload = {
            amount: body.amount,
            retail_code,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            customer_phone: body.customer_phone || '',
            partner_reff,
            username: CONFIG.username,
            pin: CONFIG.pin,
            expired,
            signature,
            url_callback: CONFIG.callbackUrl,
            remark: body.remark || 'Pembayaran Retail'
        };

        console.log('🚀 Sending to LinkQu API...');
        const response = await axios.post(
            `${CONFIG.linkquGateway}/transaction/create/retail`,
            payload,
            { headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000 }
        );

        const result = response.data;
        console.log('✅ LinkQu Response:', JSON.stringify(result, null, 2));

        const insertQuery = `
            INSERT INTO inquiry_retail 
            (partner_reff, customer_id, customer_name, amount, expired, bank_code,
             customer_phone, customer_email, retail_code, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            partner_reff,
            body.customer_id,
            body.customer_name,
            body.amount,
            expired,
            retail_code,
            body.customer_phone || null,
            body.customer_email,
            result?.payment_code || null,
            JSON.stringify(result),
            mysqlNow(),
            'PENDING'
        ];

        const [dbResult] = await pool.execute(insertQuery, values);
        console.log(`✅ Data saved to DB! Insert ID: ${dbResult.insertId}`);

        res.json({ ...result, partner_reff, db_saved: true });

    } catch (err) {
        console.error('❌ Error in /create-retail:', err.message);
        if (err.response) console.error('API Error:', err.response.data);
        res.status(500).json({ error: 'Failed to create Retail', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /callback (DENGAN ADD BALANCE - FIXED dengan query DB)
// ============================================================
app.post('/callback', async (req, res) => {
    console.log('\n📞 [CALLBACK] Received:', JSON.stringify(req.body, null, 2));

    const { partner_reff, amount, serialnumber, va_code, retail_code } = req.body;

    if (!partner_reff) {
        logToFile(`Missing partner_reff`, 'ERROR');
        return res.status(400).json({ error: 'partner_reff wajib ada' });
    }

    const connection = await pool.getConnection();
    let tableName = null;

    try {
        // MULAI TRANSAKSI
        await connection.beginTransaction();

        // CEK DI SEMUA TABEL BERDASARKAN partner_reff
        let dbData = null;

        // Cek di inquiry_va
        let [rows] = await connection.execute(
            `SELECT status, customer_name, amount, bank_code as method_code, 'VA' as type FROM inquiry_va WHERE partner_reff = ? FOR UPDATE`,
            [partner_reff]
        );
        if (rows.length > 0) {
            tableName = 'inquiry_va';
            dbData = rows[0];
        }

        // Cek di inquiry_qris
        if (!tableName) {
            [rows] = await connection.execute(
                `SELECT status, customer_name, amount, 'QRIS' as method_code, 'QRIS' as type FROM inquiry_qris WHERE partner_reff = ? FOR UPDATE`,
                [partner_reff]
            );
            if (rows.length > 0) {
                tableName = 'inquiry_qris';
                dbData = rows[0];
            }
        }

        // Cek di inquiry_retail
        if (!tableName) {
            [rows] = await connection.execute(
                `SELECT status, customer_name, amount, bank_code as method_code, 'RETAIL' as type FROM inquiry_retail WHERE partner_reff = ? FOR UPDATE`,
                [partner_reff]
            );
            if (rows.length > 0) {
                tableName = 'inquiry_retail';
                dbData = rows[0];
            }
        }

        if (!tableName || !dbData) {
            await connection.rollback();
            logToFile(`Transaction not found: ${partner_reff}`, 'ERROR');
            return res.status(404).json({ error: "Data transaksi tidak ditemukan" });
        }

        if (dbData.status === 'SUKSES') {
            await connection.rollback();
            console.log(`ℹ️ Skip: ${partner_reff} sudah SUKSES.`);
            return res.json({ message: "Sudah diproses sebelumnya." });
        }

        // UPDATE STATUS
        await connection.execute(
            `UPDATE ${tableName} SET status = 'SUKSES' WHERE partner_reff = ?`,
            [partner_reff]
        );

        await connection.commit();
        console.log(`✅ Database updated to SUKSES for ${partner_reff}`);

        // AMBIL METHOD CODE DARI DATABASE (BUKAN DARI CALLBACK)
        let methodCode = dbData.method_code;

        // Untuk retail, pastikan formatnya benar (uppercase)
        if (dbData.type === 'RETAIL') {
            methodCode = methodCode ? methodCode.toUpperCase() : 'RETAIL';
        }

        console.log(`📌 Using method_code from database: ${methodCode} (type: ${dbData.type})`);
        console.log(`📌 Callback sent va_code: ${va_code}, retail_code: ${retail_code} (IGNORED - using DB value)`);

        const dbCustomerName = dbData.customer_name;
        const dbAmount = dbData.amount;

        // Panggil addBalance dengan methodCode yang benar dari DATABASE
        await addBalance(dbAmount, dbCustomerName, methodCode, serialnumber || partner_reff);

        console.log(`🚀 Callback Berhasil: Saldo ${dbCustomerName} ditambahkan via ${methodCode}`);
        res.json({ message: "Callback diterima dan saldo ditambahkan" });

    } catch (err) {
        // Rollback status ke PENDING jika error
        if (tableName) {
            try {
                await connection.execute(
                    `UPDATE ${tableName} SET status = 'PENDING' WHERE partner_reff = ?`,
                    [partner_reff]
                );
                await connection.commit();
                console.log(`⚠️ Status rolled back to PENDING for ${partner_reff}`);
            } catch (rollbackErr) {
                console.error(`❌ Failed to rollback status: ${rollbackErr.message}`);
            }
        } else {
            await connection.rollback();
        }

        const logMsg = `❌ Callback Error [${partner_reff}]: ${err.message}`;
        console.error(logMsg);
        logToFile(logMsg, 'ERROR');

        res.status(500).json({ error: "Internal Server Error", detail: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// ============================================================
// ENDPOINT: GET /va-list
// ============================================================
app.get('/va-list', async (req, res) => {
    const { username } = req.query;
    console.log(`\n📋 [VA-LIST] Request for username: ${username}`);

    if (!username) {
        return res.status(400).json({ error: 'Username diperlukan' });
    }

    try {
        await pool.execute(`
            DELETE FROM inquiry_va 
            WHERE status = 'PENDING' 
            AND created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)
        `);

        const [results] = await pool.execute(`
            SELECT partner_reff, bank_code, va_number, amount, status, customer_name, expired, created_at
            FROM inquiry_va
            WHERE customer_name = ?
            ORDER BY created_at DESC
        `, [username]);

        console.log(`✅ Found ${results.length} VA transactions`);
        res.json(results);

    } catch (err) {
        console.error('❌ DB error in va-list:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data VA', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: GET /qr-list
// ============================================================
app.get('/qr-list', async (req, res) => {
    const { username } = req.query;
    console.log(`\n📋 [QR-LIST] Request for username: ${username}`);

    if (!username) {
        return res.status(400).json({ error: 'Username diperlukan' });
    }

    try {
        await pool.execute(`
            DELETE FROM inquiry_qris 
            WHERE status = 'PENDING' 
            AND created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)
        `);

        const [results] = await pool.execute(`
            SELECT partner_reff, amount, status, customer_name, qris_url, expired, created_at
            FROM inquiry_qris
            WHERE customer_name = ?
            ORDER BY created_at DESC
        `, [username]);

        console.log(`✅ Found ${results.length} QRIS transactions`);
        res.json(results);

    } catch (err) {
        console.error('❌ DB error in qr-list:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data QRIS', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: GET /retail-list
// ============================================================
app.get('/retail-list', async (req, res) => {
    const { username } = req.query;
    console.log(`\n📋 [RETAIL-LIST] Request for username: ${username}`);

    if (!username) {
        return res.status(400).json({ error: 'Username diperlukan' });
    }

    try {
        await pool.execute(`
            DELETE FROM inquiry_retail 
            WHERE status = 'PENDING' 
            AND created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)
        `);

        const [results] = await pool.execute(`
            SELECT partner_reff, bank_code as retail_code, retail_code as payment_code, 
                   amount, status, customer_name, expired, created_at
            FROM inquiry_retail
            WHERE customer_name = ?
            ORDER BY created_at DESC
        `, [username]);

        console.log(`✅ Found ${results.length} Retail transactions`);
        res.json(results);

    } catch (err) {
        console.error('❌ DB error in retail-list:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data Retail', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: GET /all-history
// ============================================================
app.get('/all-history', async (req, res) => {
    const { username } = req.query;
    console.log(`\n📋 [ALL-HISTORY] Request for username: ${username}`);

    if (!username) {
        return res.status(400).json({ error: 'Username diperlukan' });
    }

    try {
        const [vaResults] = await pool.execute(`
            SELECT 'VA' as type, partner_reff, bank_code as method_name, va_number as code,
                   amount, status, customer_name, expired, created_at
            FROM inquiry_va
            WHERE customer_name = ?
        `, [username]);

        const [qrResults] = await pool.execute(`
            SELECT 'QRIS' as type, partner_reff, 'QRIS' as method_name, qris_url as code,
                   amount, status, customer_name, expired, created_at
            FROM inquiry_qris
            WHERE customer_name = ?
        `, [username]);

        const [retailResults] = await pool.execute(`
            SELECT 'RETAIL' as type, partner_reff, bank_code as method_name, retail_code as code,
                   amount, status, customer_name, expired, created_at
            FROM inquiry_retail
            WHERE customer_name = ?
        `, [username]);

        const allTransactions = [...vaResults, ...qrResults, ...retailResults];
        allTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        console.log(`✅ Found ${allTransactions.length} total transactions`);
        res.json(allTransactions);

    } catch (err) {
        console.error('❌ DB error in all-history:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: GET /download-qr/:partner_reff
// ============================================================
app.get('/download-qr/:partner_reff', async (req, res) => {
    const partner_reff = req.params.partner_reff;
    console.log(`\n📥 [DOWNLOAD-QR] Request for: ${partner_reff}`);

    try {
        const [rows] = await pool.execute(
            'SELECT qris_image, qris_url FROM inquiry_qris WHERE partner_reff = ?',
            [partner_reff]
        );

        if (!rows.length) {
            return res.status(404).send('QRIS tidak ditemukan');
        }

        if (rows[0].qris_image) {
            res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
            res.setHeader('Content-Type', 'image/png');
            return res.send(rows[0].qris_image);
        }

        if (!rows[0].qris_url) {
            return res.status(404).send('URL QRIS tidak tersedia');
        }

        const imgResp = await axios.get(rows[0].qris_url.trim(), { responseType: 'arraybuffer', timeout: 10000 });
        const buffer = Buffer.from(imgResp.data);

        await pool.execute('UPDATE inquiry_qris SET qris_image = ? WHERE partner_reff = ?', [buffer, partner_reff]);

        res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);

    } catch (err) {
        console.error('❌ Error downloading QR:', err.message);
        res.status(500).send('Terjadi kesalahan server');
    }
});

// ============================================================
// ENDPOINT: GET /check-status/:partner_reff
// ============================================================
app.get('/check-status/:partner_reff', async (req, res) => {
    const partner_reff = req.params.partner_reff;
    console.log(`\n🔍 [CHECK-STATUS] Checking transaction: ${partner_reff}`);

    if (!partner_reff) {
        return res.status(400).json({ rc: '01', message: 'partner_reff diperlukan' });
    }

    try {
        let transaction = null;

        let [rows] = await pool.execute(
            'SELECT partner_reff, status, amount, created_at FROM inquiry_va WHERE partner_reff = ?',
            [partner_reff]
        );
        if (rows.length > 0) transaction = rows[0];

        if (!transaction) {
            [rows] = await pool.execute(
                'SELECT partner_reff, status, amount, created_at FROM inquiry_qris WHERE partner_reff = ?',
                [partner_reff]
            );
            if (rows.length > 0) transaction = rows[0];
        }

        if (!transaction) {
            [rows] = await pool.execute(
                'SELECT partner_reff, status, amount, created_at FROM inquiry_retail WHERE partner_reff = ?',
                [partner_reff]
            );
            if (rows.length > 0) transaction = rows[0];
        }

        if (!transaction) {
            console.log(`❌ Transaction not found: ${partner_reff}`);
            return res.status(404).json({ rc: '404', message: 'Transaksi tidak ditemukan', data: null });
        }

        const status_trx = transaction.status === 'SUKSES' ? 'success' : 'pending';
        console.log(`✅ Status for ${partner_reff}: ${status_trx} (${transaction.status})`);

        res.json({
            rc: '00',
            message: 'Success',
            data: {
                partner_reff: transaction.partner_reff,
                status_trx: status_trx,
                status_db: transaction.status,
                amount: transaction.amount,
                created_at: transaction.created_at,
                checked_at: new Date().toISOString()
            }
        });

    } catch (err) {
        console.error('❌ Error checking status:', err.message);
        res.status(500).json({ rc: '99', message: 'Internal server error', error: err.message });
    }
});

// ============================================================
// ENDPOINT: GET /health
// ============================================================
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        database_ready: dbReady,
        uptime: process.uptime()
    });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`📁 Log directory: ${LOG_DIR}`);
    console.log('========================================\n');
});