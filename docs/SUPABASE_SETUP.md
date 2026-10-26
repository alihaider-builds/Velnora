# ReliefLens on Supabase PostgreSQL

ReliefLens works with two databases that have the same tables:

| | When | Setting |
|---|---|---|
| **SQLite file** (default) | local development, demos, tests | `DATABASE_URL` empty → `DATABASE_PATH` |
| **Supabase PostgreSQL** | shared or production data | `DATABASE_URL` set |

Only the FastAPI backend talks to the database. The browser talks only to FastAPI (`/api/...`), so the
frontend needs **no Supabase keys at all**. Never put the `service_role` key or a database password in
the frontend or in git.

Supabase project: **ReliefLens** (organization DukaanDiaryAI, region `ap-southeast-1`, Singapore).
Nothing here touches any other project.

---

## 1. How the data is organised

```
reports ──1:1── extractions      (AI result; deleted with the report)
   │  └──1:1── locations         (suggested + reviewer-confirmed point; deleted with the report)
   └── merged_into → reports.id  (duplicate merged into another report)
audit_log                        (every status change, review, merge and export; kept as history)
categories, helplines, geocode_cache   (settings and cache; no personal data)
relieflens_migrations            (which migration files have run)
```

| Table | What it holds | Key rules |
|---|---|---|
| `reports` | every report from web, SMS, WhatsApp, calls | `status` ∈ pending_review, approved, rejected, flagged, merged · `urgency` ∈ low, medium, high, unknown · `channel` ∈ web, sms, whatsapp, call · unique `reference` · lat and lng both set or both empty |
| `extractions` | AI suggestions for a report | one per report, cascade delete |
| `locations` | suggested and confirmed coordinates | one per report, cascade delete; only **confirmed** points reach the map and exports |
| `audit_log` | who did what, when | append-only for the backend (cannot be edited) |
| `categories` | help categories | deactivated, never deleted |
| `helplines` | helpline numbers | unique number |
| `geocode_cache` | place-search results | |

Timestamps are `timestamptz`; the API still returns them as `2026-10-26T12:00:00Z`.

**Not in the database:** photos and voice recordings stay in `UPLOAD_DIR` on the backend's disk; the
database stores only their file names. Reviewer sign-in is one password (`REVIEWER_PASSWORD_HASH`),
not user accounts, so there are no user or role tables.

### When is a report "approved"?

`reports.status = 'approved'` **and** a confirmed location in `locations`. Only these reports appear on
the public map, in `GET /api/public/export` (rounded location, no text) and in the reviewer download
`GET /api/reports/export` (exact location, masked text, never the sender's number). Pending, rejected,
flagged and merged reports are never exported. Approving, rejecting and confirming locations all
require the reviewer sign-in; the database also refuses unknown status values.

---

## 2. Who can access what (security)

| Who | How they connect | What they can do |
|---|---|---|
| The public (browser) | FastAPI `/api/public/*` | approved reports only: needs, area, location rounded to ~1 km, no text or phone numbers |
| Reviewer (signed in) | FastAPI, session cookie | everything in the review screens, including downloads |
| `anon` / `authenticated` (Supabase REST/GraphQL with the anon key) | Supabase API | **nothing**: Row Level Security is on with no policies, and table privileges are revoked |
| `relieflens_backend` (the FastAPI login) | `DATABASE_URL` | read/write ReliefLens rows only; cannot create, drop or alter tables, change permissions, edit the audit trail, or delete categories/helplines |
| `postgres` (owner) | `MIGRATION_DATABASE_URL`, dashboard | run migrations; keep this password private |

Why RLS if Supabase's API isn't used? Supabase publishes every table in the `public` schema through its
REST API automatically. Without RLS, anyone holding the project's anon key could read reports and
phone numbers. With it, that API returns nothing.

---

## 3. Set it up (step by step)

### 3.1 Install the database driver

```bash
cd backend
pip install -e ".[dev]"      # adds psycopg (the PostgreSQL driver)
```

### 3.2 Get the connection string

1. Open the **ReliefLens** project in the Supabase dashboard (check the project name at the top!).
2. Click **Connect** (top bar) → **Connection string** → **Session pooler**. It looks like:
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
   (Use the session pooler: the "Direct connection" needs IPv6, which many home networks don't have.)
3. `[YOUR-PASSWORD]` is the database password you chose when creating the project. If you've lost it:
   **Project Settings → Database → Reset database password**.
4. If the password has symbols such as `@ : / ? # %`, URL-encode them. For example, `@` becomes `%40`.
   This prints the encoded form:
   `python -c "import urllib.parse,getpass;print(urllib.parse.quote(getpass.getpass(),safe=''))"`

### 3.3 Apply the migrations (as the owner)

In `.env` at the repo root (never committed), add:

```
MIGRATION_DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:5432/postgres
```

Then:

```bash
cd backend
python -m app.migrate --status   # shows PENDING for 0001 and 0002; changes nothing
python -m app.migrate            # creates the tables, RLS, and the relieflens_backend role
```

Each file runs in one transaction and is recorded, so running it again is safe ("Already up to date").
The migrations only create and grant; none drop tables or delete rows.

*No Python on hand?* You can paste `backend/migrations/0001_initial_schema.sql` and then `0002_backend_role.sql`
into the dashboard's **SQL Editor** and run them in that order. `python -m app.migrate` will then still
try to apply them, which is harmless because every statement checks whether its object already exists.

### 3.4 Give the backend login a password

The migration creates `relieflens_backend` without a password, so it can't log in yet. In the dashboard's
**SQL Editor**, run (use your own long random password, e.g. from
`python -c "import secrets;print(secrets.token_urlsafe(24))"`):

```sql
alter role relieflens_backend with login password 'paste-a-long-random-password-here';
```

Then in `.env`:

```
DATABASE_URL=postgresql://relieflens_backend.<project-ref>:<that-password>@<pooler-host>:5432/postgres
```

Same host and port as before; the username is `relieflens_backend.<project-ref>`.

> If the pooler refuses this login, you can temporarily use the owner string here as well.
> Everything works, but the backend then has full rights over the database. Switch back once it works.

### 3.5 Production settings

```
DEMO_MODE=false                 # real reports are not labelled "demo", the simulator is off,
                                # and `python -m app.seed` refuses to load sample data
REVIEWER_PASSWORD_HASH=...      # python -m app.auth hash-password  (at least 8 characters)
SESSION_SECRET=...              # long random string
SENDER_HASH_SECRET=...          # long random string
```

Sample data is never inserted automatically. `python -m app.seed` loads it only when you run it by hand
with `DEMO_MODE=true`. Its `--reset` option only deletes a local SQLite file, never a Postgres
database.

### 3.6 Check the connection, then start

```bash
cd backend
python -m app.migrate --check
# → Connected as relieflens_backend (PostgreSQL 17.x). Tables OK. Reports stored: 0.

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
cd ../frontend && npm run dev
```

If the tables are missing, the backend refuses to start and tells you to run `python -m app.migrate`.

### 3.7 Try the whole flow

1. **Submit:** open `http://localhost:5173/submit`, send a report and note its reference (`RL-…`).
2. **Review:** sign in at `/review` and open the report.
3. **Confirm and approve:** confirm the location on the map, then **Approve**.
4. **Check the public side:** the report appears on the public map at `/`. A pending or rejected
   report does not.
5. **Downloads:** on the review queue, **Download approved → CSV / GeoJSON** contains only approved
   reports and no phone numbers. Signed out, `/api/reports/export` answers `401`.
6. **Database:** in Supabase **Table Editor → reports**, the row's `status` is `approved`, and
   `audit_log` has the `approve` and `export_approved` entries.

---

## 4. Tests

```bash
cd backend
python -m pytest                      # SQLite (default): fast, no setup
```

The same tests can run on PostgreSQL. Point `TEST_DATABASE_URL` at a **local, throwaway** Postgres;
the tests empty its tables, so they refuse any non-local host and can never touch Supabase:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/relieflens_test python -m pytest
```

`tests/test_postgres.py` covers:
- the schema matches the backend tables, and migrations are re-runnable
- RLS and revoked privileges for `anon`/`authenticated`
- what the `relieflens_backend` role can and cannot do
- constraints and cascade deletes
- the full submit → approve → export flow under the limited login

---

## 5. Changing the schema later

1. Add a new file `backend/migrations/0003_<what>.sql`. Never edit a file that has already been applied.
2. Update the matching table in `backend/app/db.py` (same column names and types).
3. In the new file, for each new table:
   - `enable row level security`
   - `revoke all ... from anon, authenticated`
   - grant `relieflens_backend` only what it needs, and add its `relieflens_backend_all` policy
4. Run `python -m app.migrate`, and run the tests on a local Postgres.

## 6. Troubleshooting

| Message | Fix |
|---|---|
| `missing ReliefLens tables` at startup | run `python -m app.migrate` with `MIGRATION_DATABASE_URL` set |
| `password authentication failed` | wrong password or not URL-encoded; for `relieflens_backend` check step 3.4 |
| `Tenant or user not found` | the username must include the project ref: `relieflens_backend.<project-ref>` |
| connection timeout | use the **Session pooler** string (IPv4), not "Direct connection" |
| `permission denied for table …` | a new table without grants for `relieflens_backend`; see §5 |
