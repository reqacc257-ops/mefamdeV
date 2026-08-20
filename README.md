# MEFAMDEV local development

## Requirements

- Node.js 18 or newer
- npm (included with Node.js)

Check the installation from a new terminal:

```powershell
node --version
npm --version
```

## Install

Install the backend dependencies from the repository root:

```powershell
npm install
```

The React preview has its own dependencies:

```powershell
Set-Location frontend/react
npm install
Set-Location ../..
```

## Run the existing app locally

For Director OTP verification, create a root `.env` file with
`DIRECTOR_EMAIL`, `RESEND_API_KEY`, and `RESEND_FROM`. The `.env` file is
ignored by Git and must not be committed.

Start the backend and static frontend:

```powershell
npm run dev
```

Open <http://localhost:3000/>. Useful local endpoints include:

- <http://localhost:3000/api/health>
- <http://localhost:3000/applicant_portal.html>
- <http://localhost:3000/admin_dashboard.html>

The JSON data store is kept in `data/mefamdev.json`. To use a separate local
database file, set `DB_PATH` before starting the server.

## Run the React frontend

Keep the backend running in one terminal, then use another:

```powershell
Set-Location frontend/react
npm run dev
```

Open <http://localhost:5173/>. Vite forwards `/api` and `/test-email` to the
backend on port 3000.

## Run all tests

From the repository root:

```powershell
npm test
```

For the grade workflow only:

```powershell
npm run test:grades
```

To rerun the test suite whenever a test file changes:

```powershell
npm run test:watch
```