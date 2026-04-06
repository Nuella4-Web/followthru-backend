const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── CORS ─────────────────────────────────────────────────
const allowedOrigins = [
  'https://follow-thru.netlify.app',
  'http://localhost:3000',
  'http://localhost:5500'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json());

// ─── Health Check ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'FollowThru backend is running' });
});

// ─── Extract Action Items ──────────────────────────────────
app.post('/extract', async (req, res) => {
  const { notes } = req.body;

  if (!notes || !notes.trim()) {
    return res.status(400).json({ error: 'No meeting notes provided' });
  }

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
        max_tokens: 1000,
        system: `Extract ALL action items from meeting notes. Return ONLY valid JSON — no markdown fences, no explanation, nothing else.
Format exactly:
{
  "items": [
    {
      "id": "1",
      "action": "Clear description of what needs to be done",
      "owner": "Person name or Team",
      "deadline": "Specific date or timeframe, or null",
      "priority": "High|Medium|Low"
    }
  ]
}
Rules: extract every task and follow-up; urgent or ASAP = High, default = Medium, when you get a chance = Low; use name as written; if whole team use Team.`,
        messages: [
          { role: 'user', content: `Extract action items from these meeting notes:\n\n${notes}` }
        ]
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error('Anthropic error:', data.error);
      return res.status(500).json({ error: 'AI extraction failed', details: data.error.message });
    }

    const raw = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const items = (parsed.items || []).map((item, i) => ({ ...item, id: String(i + 1) }));

    console.log(`Extracted ${items.length} items`);
    res.json({ items });

  } catch (err) {
    console.error('Extract error:', err);
    res.status(500).json({ error: 'Extraction failed', details: err.message });
  }
});

// ─── Start Server ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FollowThru backend running on port ${PORT}`);
});
