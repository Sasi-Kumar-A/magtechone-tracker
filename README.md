# MagtechOne Tracker

A shared website for the QA team and developers: test cases, results and bugs for every module. Each person signs in with their own username/email and password. **All data is stored as JSON files in a GitHub repo.**

```
 Browser (React website, hosted on GitHub Pages)
        │  HTTPS + JSON, signed-in token
        ▼
 Java API  (backend/, runs on Render / Railway / a company server)
        │  GitHub API with a secret token
        ▼
 GitHub repo  data/
              ├─ testcases/TC-WFL-001.json   one file per test case
              ├─ bugs/BUG-001.json           one file per bug
              ├─ modules.json                WFL, LEV, … (you can add more)
              └─ team.json                   people, roles, password hashes
```

## Features

| Area | What it does |
|---|---|
| Sign in | Username or email + password. Passwords are stored only as PBKDF2 hashes. 10 wrong tries locks that login for 15 minutes. Everyone can change their own password in Settings. |
| Dashboard | % executed, pass rate, open bugs, status table for every module (Pass / Fail / Blocked / Not run / Pass % / open bugs), recent activity |
| Test cases | Search, status chips, filters, add, edit, record Pass / Fail / Blocked / N/A with remarks, report a bug from a failed test |
| Bugs | Cards with the full bug data (steps, expected, actual, notes). Opens on **Open** bugs. Assign a developer and change status right on the card. Board view (drag and drop) as a second layout. |
| Notifications | Bell in the top bar: "assigned to you", "Developer X completed BUG-012 (Fixed – retest / Closed)", "QA closed your bug". New ones also pop up while you work. |
| Team | Separate page. Leads add people, set roles (Lead / QA / Developer), emails, GitHub usernames and passwords. |
| Settings | Separate page: light / dark / device theme, change password, **modules** (add new ones any time), data info |
| Excel import | Upload a .xlsx. The app finds the test case and bug sheets, checks every row, matches modules and developers, shows problems before saving, then saves everything in one commit. |

Rules (enforced by the API):
- Only the **assigned developer** or a **Lead** can close a bug.
- Unassigned bugs notify nobody. With `GITHUB_ISSUES=true`, assigning a developer also creates a GitHub issue, so GitHub emails them.
- If two people edit the same record at once, the second save is refused ("changed by X meanwhile") and nothing is overwritten.
- Only Leads change the team. Developers can't import or change modules.

## How the data is stored in Git

- Every save from the website becomes **one commit** in the repo, e.g. `tracker: BUG-012: Status: Open → Fixed – retest (by dev1)`. An Excel import is one commit with all its files.
- One record = one small JSON file, so two people working on different bugs never clash, and the GitHub history shows exactly who changed what and when (open any file → **History**).
- The API keeps a copy in memory and re-reads the repo every 60 seconds, so edits made directly on GitHub also show up. The website refreshes every 30 seconds.
- `team.json` holds password **hashes** (not passwords). Still, keep the data repo **private**: put the data in a private repo (`GITHUB_REPO`), even if the website code is public.

Example `data/bugs/BUG-012.json`:
```json
{
  "id": "BUG-012",
  "title": "Regularisation breadcrumb skips the 'Requests' level",
  "module": "WFL",
  "severity": "Low",
  "status": "Fixed – retest",
  "assignee": "dev1",
  "reporter": "tester",
  "history": [
    { "at": "2026-11-14T10:20:00Z", "by": "dev1", "action": "Status: Open → Fixed – retest", "status": "Fixed – retest" }
  ]
}
```

## Run it on your laptop

Needs **Node 20+** and **JDK 17+** (Android Studio's bundled JDK works).

```bash
# 1) API using the local data/ folder (no GitHub needed)
cd backend
run-local.bat            # Windows      → http://localhost:8080
./run-local.sh           # Mac / Linux

# 2) Website (second terminal)
cd frontend
npm install
echo VITE_API_URL=http://localhost:8080 > .env.local
npm run dev                                           # → http://localhost:5173
```

Sign in as the Lead: username **tester**, password **tester12345**.

**Adding people (Lead only):** Team → Add member → type the name. The username is filled in from the name (`Priya Sharma` → `priya.sharma`) and the password defaults to **tester12345**. Pick the role (QA / Developer / Lead) and save. They sign in with that username (or their email) and `tester12345`, then change it in **Settings**. A Lead can reset anyone back to the default password from Team → Edit.

Without `VITE_API_URL` the website runs in **preview mode**: data stays in the browser; the same accounts and password work.

## Live setup used now: GitHub only (no server)

- Website: https://sasi-kumar-a.github.io/magtechone-tracker/
- Data: private repo `Sasi-Kumar-A/magtechone-tracker-data` (set as the Actions variable `TRACKER_DATA_REPO` on this repo).
- The website reads and writes the data repo directly with **each person's own GitHub token**. Every save is one commit authored by that person. Nothing else to host, nothing that sleeps.
- The rules guard workflow in the data repo (`.github/workflows/guard.yml`) checks every push and undoes changes that break the rules: only Leads change the team, only the assignee or a Lead closes a bug, people not in the team can't change anything.

**Adding someone (Lead):** Team → Add member → name, role, **GitHub username** → Save. Their starting password is **tester12345** (or what you type). GitHub e-mails them an invitation to the data repo.

**First sign-in (each person, once per device):**
1. Accept the GitHub invitation e-mail.
2. Create a token: GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate, tick **repo**. (Fine-grained tokens can't reach a repo you were only invited to.)
3. On the website: username + `tester12345` + paste the token → Sign in.
4. The site asks you to **set your own password** before you continue.

After that, on the same device you sign in with just **username + password**: the token is kept on the device, encrypted with your password. On a new device, paste the token once again. Forgot your password? The Lead opens Team → Edit → Reset to default.

**Download report:** Dashboard, Test cases or Bugs → pick *All modules* or one module → **Download report**. You get an Excel file in the ATT_Test_Report_FINAL layout: Summary sheet (live formulas) + "<module> Test" and "<module> Bugs" sheets with the same columns, colours, filters and drop-downs.

Removing someone: delete them in Team and remove them in the data repo → Settings → Collaborators.

## Alternative: Java API server

### 1. Repos
- Code repo (can be public): push this whole folder.
- Data: either the same repo kept **private**, or a separate private repo with just the `data/` folder.

GitHub Pages on a free account needs a public repo; a private data repo is fine because only the API reads it.

### 2. Token for the API
GitHub → Settings → Developer settings → **Fine-grained tokens** → access only to the data repo → permissions **Contents: Read and write** (and **Issues: Read and write** if you use `GITHUB_ISSUES`). Keep it secret; it only goes into the API's environment variables.

### 3. Deploy the API (example: Render)
New → Web Service → connect the code repo → Root directory `backend` → Runtime **Docker**. Environment variables:

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | token from step 2 |
| `GITHUB_REPO` | `<owner>/<data-repo>` |
| `GITHUB_BRANCH` | `main` |
| `AUTH_SECRET` | a long random sentence (keeps people signed in across restarts) |
| `DEFAULT_PASSWORD` | password for new members and anyone without one (default `tester12345`) |
| `ALLOWED_ORIGIN` | `https://<owner>.github.io` |
| `GITHUB_ISSUES` | `true` to notify developers by email through GitHub issues |

Check `https://<your-api>/api/health` returns `{"ok":true}`.

### 4. Website on GitHub Pages
- Code repo → Settings → Secrets and variables → Actions → **Variables** → `TRACKER_API_URL` = your API URL
- Settings → Pages → Source: **GitHub Actions**
- Push to `main`. The site appears at `https://<owner>.github.io/<code-repo>/`.

### 5. First sign-in
Sign in as **tester / tester12345** (the Lead) → change your password in **Settings** → **Team**: add each tester and developer (username comes from the name, password defaults to `tester12345`) → they sign in and change their password.

## Adding a module later
**Settings → Modules → New module code** (e.g. `PAY`, name "Payroll") → **Save modules**. New test cases then get IDs like `TC-PAY-001`, and the dashboard shows a row for it. An Excel import with an unknown module offers to create it.

## Excel import format
Any sheet whose header row has **TC ID** and **Scenario** is read as test cases; **Bug ID** and **Title** as bugs. Recognised columns (case doesn't matter):
- Test cases: TC ID, Module, Screen, Scenario, Login as, Pre-condition, Steps, Expected result, Priority, Spec ref, Status, Bug ID, Tested by, Date, Remarks
- Bugs: Bug ID, Module, Title, Status, Severity, Assigned To, Reported On, Steps to Reproduce, Expected Result, Actual Result, Fixed On, Notes, Test case

Checks before saving: empty or duplicate IDs, unknown modules (created on import), unknown statuses/severities/priorities (set to defaults), developers not in the team (left unassigned), links to test cases that don't exist. Existing IDs are skipped unless you choose "Overwrite with the Excel values".

## Where to change things
- Rules: `backend/src/main/java/com/magtech/tracker/Tracker.java` and `frontend/src/lib/rules.js`
- Screens: `frontend/src/pages/` · Styles and colours: `frontend/src/styles.css`
- Excel column names: `frontend/src/lib/importer.js`
