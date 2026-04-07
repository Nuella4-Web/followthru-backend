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
        system: `You are a precise meeting notes parser. Your job is to extract every single action item from meeting notes without missing any or merging any together.

STRICT RULES — follow every one of these without exception:

1. EXTRACT EVERY action item. An action item is any sentence or phrase where a person or group is expected to do something. If in doubt, include it.

2. NEVER merge two separate tasks into one item. If two things are mentioned they become two separate items even if they involve the same person.

3. NEVER skip an action item because it seems vague. Extract it as written and mark the owner as Team if no specific person is named.

4. KEEP the action description close to the original wording. Do not rewrite or summarise. Just clean up grammar slightly if needed.

5. OWNER: Use the person name exactly as written in the notes. If multiple people own a task list them as Name1 and Name2. If no name is given use Team.

6. DEADLINE: Extract the exact date or timeframe mentioned. Examples: by Friday, end of April, April 11, this week, next Monday. If no deadline is mentioned use null.

7. PRIORITY: Use High if the notes say urgent, high priority, ASAP, or critical. Use Low if the notes say when you get a chance or low priority. Default to Medium for everything else.

8. Return ONLY valid JSON. No markdown, no explanation, nothing else before or after the JSON.

Output format:
{
  "items": [
    {
      "id": "1",
      "action": "Exact description of the task",
      "owner": "Person name or Team",
      "deadline": "Timeframe or null",
      "priority": "High|Medium|Low"
    }
  ]
}`,
        messages: [
          {
            role: 'user',
            content: `Extract every action item from these meeting notes. Do not miss any. Do not merge any.\n\n${notes}`
          }
        ]
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error('Anthropic error:', data.error);
      return res.status(500).json({ error: data.error.message });
    }

    const raw = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const items = (parsed.items || []).map((item, i) => ({
      ...item,
      id: String(i + 1)
    }));

    console.log(`Extracted ${items.length} items`);
    res.json({ items });

  } catch (err) {
    console.error('Extract error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Match Tracker Screenshot ──────────────────────────────
// Reads a screenshot of an existing tracker, identifies columns,
// then maps action items to those exact columns and returns a CSV
app.post('/match-tracker', async (req, res) => {
  const { imageBase64, imageType, items } = req.body;

  if (!imageBase64 || !items || !items.length) {
    return res.status(400).json({ error: 'Image and items are required' });
  }

  try {
    // Step 1: Read the tracker screenshot and identify columns
    const visionResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 500,
        system: `You are reading a screenshot of a task tracker spreadsheet. Your job is to identify the column headers exactly as they appear.

Return ONLY valid JSON with no markdown, no explanation.

Format:
{
  "columns": ["Column1", "Column2", "Column3"],
  "taskColumn": "The column name that holds the task or action description",
  "ownerColumn": "The column name that holds the person responsible or null if none",
  "statusColumn": "The column name that holds the status or null if none",
  "dateColumn": "The column name that holds the date or deadline or null if none",
  "deliverableColumn": "The column name that holds deliverable or null if none",
  "priorityColumn": "The column name that holds priority or null if none"
}`,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageType || 'image/jpeg',
                  data: imageBase64
                }
              },
              {
                type: 'text',
                text: 'What are the column headers in this tracker? Return the JSON as instructed.'
              }
            ]
          }
        ]
      })
    });

    const visionData = await visionResponse.json();

    if (visionData.error) {
      console.error('Vision error:', visionData.error);
      return res.status(500).json({ error: 'Could not read tracker screenshot' });
    }

    const visionRaw = visionData.content?.[0]?.text || '{}';
    const trackerSchema = JSON.parse(visionRaw.replace(/```json|```/g, '').trim());

    console.log('Detected columns:', trackerSchema.columns);

    // Step 2: Build CSV using their exact columns
    const columns = trackerSchema.columns || [];

    if (!columns.length) {
      return res.status(400).json({ error: 'Could not detect columns from screenshot. Try a clearer image.' });
    }

    // Map our data fields to their column names
    const fieldMap = {
      [trackerSchema.taskColumn]: (it) => it.action || '',
      [trackerSchema.ownerColumn]: (it) => it.owner || 'Unassigned',
      [trackerSchema.statusColumn]: (it) => it.status || 'Not Started',
      [trackerSchema.dateColumn]: (it) => it.deadline || '',
      [trackerSchema.deliverableColumn]: (it) => it.deliverable || '',
      [trackerSchema.priorityColumn]: (it) => it.priority || 'Medium'
    };

    // Build CSV rows using their column order
    const headerRow = columns.join(',');
    const dataRows = items.map(it => {
      return columns.map(col => {
        const getter = fieldMap[col];
        const value = getter ? getter(it) : '';
        // Wrap in quotes if contains comma
        return value.includes(',') ? `"${value.replace(/"/g, '""')}"` : value;
      }).join(',');
    });

    const csv = [headerRow, ...dataRows].join('\n');

    res.json({
      csv,
      columns,
      detectedMapping: {
        task: trackerSchema.taskColumn,
        owner: trackerSchema.ownerColumn,
        status: trackerSchema.statusColumn,
        date: trackerSchema.dateColumn,
        deliverable: trackerSchema.deliverableColumn,
        priority: trackerSchema.priorityColumn
      }
    });

  } catch (err) {
    console.error('Match tracker error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FollowThru backend running on port ${PORT}`);
});
