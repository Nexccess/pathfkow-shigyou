'use strict';

const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

function getAuthClient() {
  // Vercel環境変数で \\n が二重エスケープされるケースに対応
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const credentials = JSON.parse(raw);
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

    // ヘッダー行が存在しない場合に自動作成
    const check = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: '士業DX診断結果!A1',
    });
    if (!check.data.values || check.data.values.length === 0) {
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

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('[save-shigyou] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
