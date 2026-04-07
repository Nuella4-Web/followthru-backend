const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'https://follow-thru.netlify.app',
  credentials: true
}));

app.use(express.json({ limit: '15mb' }));

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
        system: `You are a precise meeting notes parser. Extract every single action item from meeting notes without missing any or merging any together.

STRICT RULES:
1. Extract EVERY action item. If in doubt, include it.
2. NEVER merge two separate tasks into one item.
3. NEVER skip a task because it seems vague. Mark owner as Team if no person is named.
4. Keep the action description close to the original wording.
5. OWNER: Use the person name exactly as written. Multiple owners: Name1 and Name2. No name: Team.
6. DEADLINE: Extract exact date or timeframe. If none, use null.
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
        messages: [
          {
            role: 'user',
            content: `Extract every action item. Do not miss any. Do not merge any.\n\n${notes}`
          }
        ]
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


// ─── Combine Tracker ───────────────────────────────────────
// Reads existing tracker screenshot, combines with new items,
// returns CSV in either standard format or matched column format
app.post('/combine-tracker', async (req, res) => {
  const { imageBase64, imageType, newItems, format } = req.body;
  // format: 'standard' or 'match'

  if (!imageBase64 || !newItems || !newItems.length) {
    return res.status(400).json({ error: 'Screenshot and new items are required' });
  }

  try {
    // Step 1: Read the tracker screenshot — get columns AND existing rows
    const readResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 3000,
        system: `You are reading a screenshot of a task tracker spreadsheet.
Extract the column headers AND all visible rows of data.

Return ONLY valid JSON. No markdown. No explanation.

Format:
{
  "columns": ["Column1", "Column2", "Column3"],
  "rows": [
    ["row1col1 value", "row1col2 value", "row1col3 value"],
    ["row2col1 value", "row2col2 value", "row2col3 value"]
  ],
  "taskColumnIndex": 0,
  "ownerColumnIndex": 1,
  "statusColumnIndex": 2,
  "dateColumnIndex": 3,
  "deliverableColumnIndex": -1,
  "priorityColumnIndex": -1
}

Rules:
- columns: exact header names as they appear
- rows: all visible data rows (not the header row), each row is an array matching the column order
- taskColumnIndex: index of the column that holds the task or action description
- ownerColumnIndex: index of the column with the owner or person responsible, -1 if not found
- statusColumnIndex: index of the column with status, -1 if not found
- dateColumnIndex: index of the column with date or deadline, -1 if not found
- deliverableColumnIndex: index of the deliverable column, -1 if not found
- priorityColumnIndex: index of the priority column, -1 if not found
- If a column is not present set its index to -1`,
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
                text: 'Read this tracker screenshot. Return the columns and all visible data rows as JSON.'
              }
            ]
          }
        ]
      })
    });

    const readData = await readResponse.json();
    if (readData.error) return res.status(500).json({ error: 'Could not read tracker screenshot' });

    const rawRead = readData.content?.[0]?.text || '{}';
    const tracker = JSON.parse(rawRead.replace(/```json|```/g, '').trim());

    const { columns, rows, taskColumnIndex, ownerColumnIndex, statusColumnIndex, dateColumnIndex, deliverableColumnIndex, priorityColumnIndex } = tracker;

    if (!columns || !columns.length) {
      return res.status(400).json({ error: 'Could not detect columns. Try a clearer screenshot showing the full header row.' });
    }

    console.log('Detected columns:', columns);
    console.log('Existing rows:', rows ? rows.length : 0);

    let csv = '';

    if (format === 'match') {
      // ── Option B: Keep their exact columns ──
      // Header row
      const headerRow = columns.map(c => `"${c.replace(/"/g, '""')}"`).join(',');

      // Existing rows (already in their format)
      const existingRows = (rows || []).map(row => {
        return columns.map((_, i) => {
          const val = row[i] || '';
          return val.toString().includes(',') ? `"${val.toString().replace(/"/g, '""')}"` : val;
        }).join(',');
      });

      // New items mapped to their columns
      const newRows = newItems.map(item => {
        return columns.map((col, i) => {
          let val = '';
          if (i === taskColumnIndex) val = item.action || '';
          else if (i === ownerColumnIndex) val = item.owner || 'Unassigned';
          else if (i === statusColumnIndex) val = item.status || 'Not Started';
          else if (i === dateColumnIndex) val = item.deadline || '';
          else if (i === deliverableColumnIndex) val = item.deliverable || '';
          else if (i === priorityColumnIndex) val = item.priority || 'Medium';
          return val.includes(',') ? `"${val.replace(/"/g, '""')}"` : val;
        }).join(',');
      });

      // 5 empty rows at the bottom
      const emptyRow = columns.map(() => '').join(',');
      const emptyRows = Array(5).fill(emptyRow);

      csv = [headerRow, ...existingRows, ...newRows, ...emptyRows].join('\n');

    } else {
      // ── Option A: FollowThru standard columns ──
      const standardCols = ['Task', 'Owner', 'Status', 'End Date', 'Milestone', 'Deliverable', 'Notes', 'Priority'];

      // Convert existing rows to standard format using detected column indices
      const existingStandard = (rows || []).map(row => {
        const task = taskColumnIndex >= 0 ? (row[taskColumnIndex] || '') : '';
        const owner = ownerColumnIndex >= 0 ? (row[ownerColumnIndex] || '') : '';
        const status = statusColumnIndex >= 0 ? (row[statusColumnIndex] || '') : '';
        const date = dateColumnIndex >= 0 ? (row[dateColumnIndex] || '') : '';
        const deliverable = deliverableColumnIndex >= 0 ? (row[deliverableColumnIndex] || '') : '';
        const priority = priorityColumnIndex >= 0 ? (row[priorityColumnIndex] || '') : '';
        return [
          task.includes(',') ? `"${task.replace(/"/g,'""')}"` : task,
          owner, status, date, '', deliverable, '', priority
        ].join(',');
      });

      // New items in standard format
      const newStandard = newItems.map(item => {
        const task = `"${(item.action || '').replace(/"/g, '""')}"`;
        return [task, item.owner||'Unassigned', item.status||'Not Started', item.deadline||'', '', item.deliverable||'', '', item.priority||'Medium'].join(',');
      });

      // 5 empty rows
      const emptyRows = Array(5).fill(standardCols.map(() => '').join(','));

      csv = [standardCols.join(','), ...existingStandard, ...newStandard, ...emptyRows].join('\n');
    }

    res.json({
      csv,
      columns,
      existingCount: (rows || []).length,
      newCount: newItems.length
    });

  } catch (err) {
    console.error('Combine tracker error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ─── Start Server ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FollowThru backend running on port ${PORT}`);
});
