# Lab Grader — Frontend

React + TypeScript web interface for the Lab Grader system.

## Stack

- **React 19** with TypeScript
- **Vite 8** for dev server and builds
- **Tailwind CSS 3** for styling
- **React Router 7** for client-side routing
- **Lucide React** for icons

## Pages

| Route | Component | Description |
|---|---|---|
| `/` | `LabsPage` | Landing page — lab cards with progress, create/rename/delete labs |
| `/labs/:labId` | `LabDashboard` | Lab detail — upload files, view reports, start/cancel grading |
| `/labs/:labId/review/:reportId` | `ReviewPage` | Grade review — split PDF viewer + score/comment editor |

## Key Files

- `src/api.ts` — API client, TypeScript interfaces, and all backend calls
- `src/GradingContext.tsx` — React context for grading job state that persists across page navigation
- `src/components/DropZone.tsx` — Drag-and-drop file upload component

## Development

```bash
npm install
npm run dev       # Start dev server on http://localhost:5173
npm run build     # Production build to dist/
```

The dev server proxies nothing — API calls go directly to `http://localhost:9090` (configured in `src/api.ts`).

## Production

Run `npm run build` to generate `dist/`. The FastAPI backend automatically serves `dist/` as static files when it exists, so no separate web server is needed in production.
