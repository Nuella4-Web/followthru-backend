const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'https://follow-thru.netlify.app',
  credentials: true
}));

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'FollowThru backend is running' });
});

app.post('/extract', async (req, res) => {
  const { notes } = req.body;
  if (!notes || !notes.trim()) {
    return res.status(400).json({ error: 'No notes provided' });
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
        system: `Extract ALL action items from meeting notes. Return ONLY valid JSON, nothing else.
Format: {"items":[{"id":"1","action":"...","owner":"name or Team","deadline":"date or null","priority":"High|Medium|Low"}]}`,
        messages: [{ role: 'user', content: `Extract action items:\n\n${notes}` }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const raw = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const items = (parsed.items || []).map((item, i) => ({ ...item, id: String(i + 1) }));
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
