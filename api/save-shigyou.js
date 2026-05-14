'use strict';

const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

function getAuthClient() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  // 前後の余分なクォート・空白を除去（Vercelコピペ時の混入対策）
  raw = raw.trim().replace(/^['"]|['"]$/g, '');
  const credentials = JSON.parse(raw);
  // 秘密鍵の \\n を実改行に変換
  const privateKey = credentials.private_key.replace(/\\n/g, '\n');
  return new JWT({
    email: credentials.client_email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const SPREADSHEET_ID = process.env.SHIGYOU_SPREADSHEET_ID;
    if (!SPREADSHEET_ID) throw new Error('SHIGYOU_SPREADSHEET_ID が未設定です');

    const { row } = req.body;
    if (!Array.isArray(row)) throw new Error('row が配列ではありません');

    const auth   = getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // シートの存在確認 → なければ作成
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetExists = meta.data.sheets.some(
      s => s.properties.title === '士業DX診断結果'
    );
    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: '士業DX診断結果' } } }],
        },
      });
      // ヘッダー行を追加
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: '士業DX診断結果!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            '診断日時','氏名','事務所名','メールアドレス','電話番号',
            'スコア','レベル','Q1_問い合わせ対応','Q2_データ管理',
            'Q3_情報発信','Q4_予約方法','流入元'
          ]],
        },
      });
    }

    // データ行を追記
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: '士業DX診断結果!A:L',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    // ── Resendでメール通知 ──────────────────────────
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Path-Flow診断 <onboarding@resend.dev>',
          to: ['naka.kei@nexccess.com'],
          subject: `【新規予約】${row[1]} 様 ／ スコア${row[5]}点（${row[6]}）`,
          html: `
<h2>Path-Flow 士業DX診断 ― 新規予約通知</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
  <tr><th align="left">診断日時</th><td>${row[0]}</td></tr>
  <tr><th align="left">氏名</th><td>${row[1]}</td></tr>
  <tr><th align="left">事務所名</th><td>${row[2] || '―'}</td></tr>
  <tr><th align="left">メール</th><td>${row[3]}</td></tr>
  <tr><th align="left">電話</th><td>${row[4] || '―'}</td></tr>
  <tr><th align="left">スコア</th><td><strong>${row[5]}点</strong></td></tr>
  <tr><th align="left">レベル</th><td>${row[6]}</td></tr>
  <tr><th align="left">Q1 問い合わせ対応</th><td>${row[7]}</td></tr>
  <tr><th align="left">Q2 データ管理</th><td>${row[8]}</td></tr>
  <tr><th align="left">Q3 情報発信</th><td>${row[9]}</td></tr>
  <tr><th align="left">Q4 予約方法</th><td>${row[10]}</td></tr>
</table>
<p style="margin-top:16px;color:#666;">このメールはPath-Flow診断システムから自動送信されました。</p>
          `.trim(),
        }),
      });
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('[save-shigyou] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
