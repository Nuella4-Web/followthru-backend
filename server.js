const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_URL = 'https://follow-thru.netlify.app';
const CALLBACK_URL = 'https://followthru-backend.onrender.com/sheets/callback';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));

app.use(express.json({ limit: '15mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'FollowThru backend is running' });
});


// ─── Extract Action Items ──────────────────────────────────
app.post('/extract', async (req, res) => {
  const { notes } = req.body;
  if (!notes || !notes.trim()) return res.status(400).json({ error: 'No notes provided' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        system: `You are a precise meeting notes parser. Extract every single action item from meeting notes without missing any or merging any together.

STRICT RULES:
1. Extract EVERY action item. If in doubt include it.
2. NEVER merge two separate tasks into one item.
3. NEVER skip a task because it seems vague. Mark owner as Team if no person is named.
4. Keep the action description close to the original wording.
5. OWNER: Use the person name exactly as written. Multiple owners: Name1 and Name2. No name: Team.
6. DEADLINE: Extract exact date or timeframe. If none use null.
7. PRIORITY: urgent/ASAP/critical = High. Default = Medium. when you get a chance = Low.
8. Return ONLY valid JSON. No markdown. Nothing else.

Format:
{
  "items": [
    {
      "id": "1",
      "action": "Task description",
      "owner": "Person name or Team",
      "deadline": "Timeframe or null",
      "priority": "High|Medium|Low"
    }
  ]
}`,
        messages: [{ role: 'user', content: `Extract every action item. Do not miss any. Do not merge any.\n\n${notes}` }]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const raw = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const items = (parsed.items || []).map((item, i) => ({ ...item, id: String(i + 1) }));

    console.log(`Extracted ${items.length} items`);
    res.json({ items });

  } catch (err) {
    console.error('Extract error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ─── Google Sheets OAuth: Step 1 — redirect to Google ─────
app.get('/sheets/auth', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly'
  ].join(' ');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(CALLBACK_URL)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.redirect(authUrl);
});


// ─── Google Sheets OAuth: Step 2 — exchange code for token ─
app.get('/sheets/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${FRONTEND_URL}#sheets_error=no_code`);

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: CALLBACK_URL,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.redirect(`${FRONTEND_URL}#sheets_error=${tokenData.error}`);

    const params = new URLSearchParams({
      sheets_token: tokenData.access_token,
      sheets_refresh: tokenData.refresh_token || ''
    });

    res.redirect(`${FRONTEND_URL}#${params.toString()}`);
  } catch (err) {
    console.error('Sheets callback error:', err);
    res.redirect(`${FRONTEND_URL}#sheets_error=callback_failed`);
  }
});


// ─── Refresh Google token if expired ──────────────────────
async function refreshToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  return data.access_token;
}


// ─── Read sheet structure and existing data ────────────────
app.post('/sheets/read', async (req, res) => {
  const { token, sheetId } = req.body;
  if (!token || !sheetId) return res.status(400).json({ error: 'Token and sheet ID required' });

  try {
    // Get spreadsheet metadata to find sheet names
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = await metaRes.json();
    if (meta.error) return res.status(400).json({ error: meta.error.message });

    const sheetName = meta.sheets?.[0]?.properties?.title || 'Sheet1';

    // Read all data from first sheet
    const dataRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await dataRes.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    const values = data.values || [];
    const headers = values[0] || [];
    const rows = values.slice(1);

    // Detect which column is which
    const findCol = (keywords) => {
      const idx = headers.findIndex(h =>
        keywords.some(k => h.toLowerCase().includes(k.toLowerCase()))
      );
      return idx;
    };

    const colMap = {
      task: findCol(['task', 'action', 'description', 'item', 'what']),
      owner: findCol(['owner', 'assigned', 'responsible', 'who', 'person']),
      status: findCol(['status', 'state', 'progress']),
      date: findCol(['date', 'deadline', 'due', 'end', 'when']),
      deliverable: findCol(['deliverable', 'output', 'result']),
      priority: findCol(['priority', 'urgency', 'importance']),
      milestone: findCol(['milestone']),
      notes: findCol(['notes', 'comments', 'remarks'])
    };

    res.json({
      headers,
      rows,
      sheetName,
      colMap,
      totalRows: rows.length
    });

  } catch (err) {
    console.error('Sheet read error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ─── Write new items to sheet ──────────────────────────────
app.post('/sheets/write', async (req, res) => {
  const { token, sheetId, sheetName, newItems, format, headers, colMap } = req.body;
  if (!token || !sheetId || !newItems) return res.status(400).json({ error: 'Missing required fields' });

  try {
    let rowsToAppend = [];

    if (format === 'match') {
      // Use their existing columns
      rowsToAppend = newItems.map(item => {
        const row = new Array(headers.length).fill('');
        if (colMap.task >= 0) row[colMap.task] = item.action || '';
        if (colMap.owner >= 0) row[colMap.owner] = item.owner || 'Unassigned';
        if (colMap.status >= 0) row[colMap.status] = item.status || 'Not Started';
        if (colMap.date >= 0) row[colMap.date] = item.deadline || '';
        if (colMap.deliverable >= 0) row[colMap.deliverable] = item.deliverable || '';
        if (colMap.priority >= 0) row[colMap.priority] = item.priority || 'Medium';
        return row;
      });
    } else {
      // FollowThru standard format
      // First check if header row exists, if not add it
      const standardHeaders = ['Task', 'Owner', 'Status', 'End Date', 'Milestone', 'Deliverable', 'Notes', 'Priority'];

      if (!headers || headers.length === 0) {
        rowsToAppend.push(standardHeaders);
      }

      newItems.forEach(item => {
        rowsToAppend.push([
          item.action || '',
          item.owner || 'Unassigned',
          item.status || 'Not Started',
          item.deadline || '',
          '',
          item.deliverable || '',
          '',
          item.priority || 'Medium'
        ]);
      });

      // Add 5 empty rows for manual additions
      for (let i = 0; i < 5; i++) {
        rowsToAppend.push(new Array(8).fill(''));
      }
    }

    // Append rows to sheet
    const sheet = sheetName || 'Sheet1';
    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheet)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: rowsToAppend })
      }
    );

    const appendData = await appendRes.json();
    if (appendData.error) return res.status(400).json({ error: appendData.error.message });

    res.json({
      success: true,
      rowsAdded: newItems.length,
      updatedRange: appendData.updates?.updatedRange
    });

  } catch (err) {
    console.error('Sheet write error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ─── Start Server ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FollowThru backend running on port ${PORT}`);
});
