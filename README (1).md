# FollowThru — Meeting Accountability Tool

> From meeting notes to a task list in seconds.

FollowThru is an open-source meeting accountability tool built by [Nuella Chukwudi](https://linkedin.com/in/nuella-chukwudi) as part of a portfolio of AI-powered productivity tools for operators and founders.

---

## What it does

Paste your meeting notes. FollowThru extracts every action item with the right owner and deadline. You review, edit, and export — either as a CSV or directly to your team via Slack or email.

No more action items getting lost after meetings. No more unclear ownership. Everyone knows what they own.

---

## Features

- Extracts action items, owners, deadlines, and priorities from raw meeting notes
- Inline editing — click any field to correct what the tool extracted
- Deliverable dropdown — assign a deliverable type to each task
- Status tracking — Not Started, In Progress, Blocked, Completed
- CSV export — compatible with Google Sheets, Excel, Notion, and any spreadsheet tool
- Slack and email copy — grouped by owner, ready to paste into your team chat
- Direct Google Sheets connection — coming soon

---

## Tech stack

**Frontend:** HTML, CSS, JavaScript — deployed on Netlify

**Backend:** Node.js, Express — deployed on Render

**AI:** Anthropic Claude API (claude-opus-4-5) via backend proxy

---

## How to run locally

**Backend**

```bash
cd followthru-backend
npm install
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=your_key_here
FRONTEND_URL=http://localhost:5500
```

```bash
node server.js
```

**Frontend**

Open `index.html` in a browser or use Live Server. Update `BACKEND` in the script to `http://localhost:3000`.

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| POST | `/extract` | Extract action items from meeting notes |

---

## Disclaimer

FollowThru is provided as-is for personal and professional use. The developer makes no guarantees about the accuracy of extracted action items. Always review the output before exporting. By using this tool you agree that the developer is not liable for any data loss, inaccuracies, or issues arising from use of this tool.

Meeting notes processed by this tool are sent to the Anthropic API for extraction and are not stored by FollowThru.

---

## Built by

Nuella Chukwudi — PM building in public.

[LinkedIn](https://linkedin.com/in/nuella-chukwudi) | [FollowThru](https://follow-thru.netlify.app)
