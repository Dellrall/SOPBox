# SOPBox — Frontend Edit Guide

## Changes requested in Edit Idea.pdf

| Request | Updated file | Details |
|---|---|---|
| Green navigation / overall theme | `src/theme.css` | `.nav-link.active`, `.org-icon`, `.primary-btn`, headings, tables, etc. SOPBox color variables near the top. |
| SOPBox logo | `public/SOPBox_Logo.jpeg`, `src/components/Sidebar.tsx`, `src/components/LoginPage.tsx` | Keep the `.jpeg` extension exactly as in the uploaded project. |
| Login screen | `src/components/LoginPage.tsx` | Frontend-only demo login; no real backend auth. |
| Staff/Admin permissions | `src/components/Sidebar.tsx`, `src/App.tsx` | Admin-only pages: Approvals, Activity Logs, User Management. Admin-only approval buttons. |
| Admin assigns staff account | `src/App.tsx` (`createStaff`, `page==='users'`) | Temporary account only, in React memory; lost on refresh. |
| Priority dashboard pending alert | `src/App.tsx` (`priority-alert`) and `src/theme.css` | Shown above dashboard heading/cards. |
| Submit button | `src/App.tsx` (`step===4`) | Visible label is Submit; it still invokes `validate()`. |
| Category and numeric pack quantity | `src/App.tsx` (`step===2`) | Category column, unit type selector and read-only numeric units-per-pack. Backend unit string contract is preserved. |
| Shared UI / types | `src/components/Shared.tsx`, `src/types.ts` | Extracted reusable components and types from App.tsx. |
| Core original styling | `src/styles.css` | Existing layouts and responsive rules. |
| Theme overrides | `src/theme.css` | All new color/theme adjustments in one place. |

## Demo sign-in (local preview only)

- Admin: `admin` / `SopBoxDemo2026!`
- Staff: `staff` / `StaffDemo2026!`

The passwords are intentionally visible in the frontend source and login page for **local demonstration only**. This is **not authentication**, **not an access-control security boundary**, and must never be used with real staff, real delivery data, or on a public production server. Admin-created accounts are only stored in React memory and disappear after page refresh. Do not enter real passwords. For production, the backend must implement credential hashing, sessions, authorization on every API route, staff invitation/reset and durable database storage.

## Run on Windows PowerShell

Open the **frontend** folder in VS Code, or from the root project:

```powershell
cd .\SDCIdea26-main\src\frontend
npm.cmd install
npm.cmd run dev
```

If you are replacing your existing `src/frontend` with the provided `frontend` folder, open the new folder and run `npm.cmd install` there. You can copy only the changed `src` and `public` files into your existing frontend if you prefer. Do not copy old `node_modules` or `dist`.

## Existing API boundaries

- `GET /api/products` loads the catalogue.
- `POST /api/extract` attempts Delivery Order image extraction.
- `POST /api/deliveries/check` validates the receiving data.
- Demo receiving records, approval actions, activity logs, and user accounts are in browser memory only. Real persistence, authentication and role enforcement need backend endpoints.

## Before integrating with Orbyte

Replace frontend-only login with your backend/Orbyte identity system; enforce role checks server-side. The present demo account switch has been removed from the top bar but the frontend code must not be considered secure access control.
