const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'https://follow-thru.netlify.app',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'FollowThru backend is running' });
});

// ─── Extract Action Items ──────────────────────────────────
app.post('/extract', async (req, res) => {
  const { notes } = req.body;
  if (!notes || !notes.trim()) {
    return res.status(400).json({ error: 'No notes provided' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You are a precise meeting notes parser. Extract every single action item from meeting notes without missing any or merging any together.
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
}`
          },
          {
            role: 'user',
            content: `Extract every action item. Do not miss any. Do not merge any.\n\n${notes}`
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const raw = data.choices[0].message.content || '{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const items = (parsed.items || []).map((item, i) => ({ ...item, id: String(i + 1) }));

    console.log(`Extracted ${items.length} items`);
    res.json({ items });
  } catch (err) {
    console.error('Extract error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FollowThru backend running on port ${PORT}`);
});
