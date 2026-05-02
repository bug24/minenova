# MineNova — cPanel Deployment Guide

## What You're Deploying
MineNova is a full-stack gamified crypto mining web app built with:
- **Frontend**: React + Vite (compiled to static files)
- **Backend**: Node.js + Express API server
- **Database**: PostgreSQL

---

## Server Requirements

| Requirement | Minimum Version |
|---|---|
| Node.js | 18.x or higher (20.x recommended) |
| npm / pnpm | pnpm 9+ |
| PostgreSQL | 14+ |
| RAM | 512 MB minimum |

> cPanel hosts that support **Node.js apps** via Passenger (e.g. Namecheap, HostGator, SiteGround, A2 Hosting) will work. Make sure your hosting plan includes Node.js app support.

---

## Step 1 — Set Up Your PostgreSQL Database

1. In cPanel, go to **PostgreSQL Databases** (or MySQL if you're mapping the schema — PostgreSQL is required).
2. Create a new database, e.g. `minenova_db`
3. Create a database user with a strong password
4. Grant the user **all privileges** on the database
5. Note down your connection string:
   ```
   postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME
   ```

---

## Step 2 — Upload the Project Files

1. Compress the entire project folder (excluding `node_modules`) into a `.zip`
2. In cPanel → **File Manager**, navigate to your desired directory (e.g. `/home/yourusername/minenova`)
3. Upload and extract the zip there
4. Your directory should look like:
   ```
   /home/yourusername/minenova/
   ├── artifacts/
   │   ├── api-server/
   │   └── minenova/
   ├── lib/
   ├── scripts/
   ├── package.json
   ├── pnpm-workspace.yaml
   └── DEPLOYMENT_README.md
   ```

---

## Step 3 — Install pnpm (via SSH)

Connect to your server via **SSH** (cPanel → Terminal or your SSH client):

```bash
# Install pnpm globally
npm install -g pnpm

# Verify
pnpm --version
```

---

## Step 4 — Install Dependencies

```bash
cd /home/yourusername/minenova

# Install all workspace dependencies
pnpm install --frozen-lockfile
```

---

## Step 5 — Set Environment Variables

Create a file called `.env` in `/home/yourusername/minenova/artifacts/api-server/`:

```bash
nano /home/yourusername/minenova/artifacts/api-server/.env
```

Paste the following and fill in your values:

```env
# Database
DATABASE_URL=postgresql://USERNAME:PASSWORD@localhost:5432/minenova_db

# Server
NODE_ENV=production
PORT=3000

# Session (generate a random 64-character string)
SESSION_SECRET=your-very-long-random-secret-here

# Web Push Notifications (optional — leave blank to disable)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@yourdomain.com
```

> **Generate SESSION_SECRET**: Run `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` in terminal.

> **Generate VAPID Keys** (for push notifications): Run:
> ```bash
> node -e "const wp=require('web-push');const k=wp.generateVAPIDKeys();console.log(JSON.stringify(k,null,2))"
> ```
> from inside `artifacts/api-server/` after installing dependencies.

---

## Step 6 — Run Database Migrations

```bash
cd /home/yourusername/minenova

# Apply database schema (creates all tables)
DATABASE_URL="postgresql://USERNAME:PASSWORD@localhost:5432/minenova_db" \
  pnpm --filter @workspace/db run push
```

> This is safe to run multiple times. It only creates tables that don't exist yet.

---

## Step 7 — Build the Project

```bash
cd /home/yourusername/minenova

# Build frontend + backend together
NODE_ENV=production \
BASE_PATH=/ \
PORT=3000 \
pnpm --filter @workspace/minenova build && \
pnpm --filter @workspace/api-server run build
```

This produces:
- `artifacts/minenova/dist/` — compiled frontend static files
- `artifacts/api-server/dist/index.mjs` — compiled backend server

---

## Step 8 — Configure Node.js App in cPanel

1. In cPanel, go to **Setup Node.js App**
2. Click **Create Application**
3. Fill in:

| Field | Value |
|---|---|
| Node.js version | 20.x (or 18.x) |
| Application mode | Production |
| Application root | `/home/yourusername/minenova/artifacts/api-server` |
| Application URL | Your domain or subdomain (e.g. `yourdomain.com`) |
| Application startup file | `dist/index.mjs` |

4. Click **Create**
5. In the app's **Environment Variables** section, add all the variables from Step 5
6. Click **Run NPM Install** (or it will prompt you)

---

## Step 9 — Start the App

1. In cPanel → **Setup Node.js App**, click **Start** on your application
2. Visit your domain — MineNova should be live!

---

## Step 10 — Set Up Admin Account

1. Register a normal user account at `https://yourdomain.com`
2. In your PostgreSQL database, run this query to make yourself admin:
   ```sql
   UPDATE users SET is_admin = true WHERE email = 'your@email.com';
   ```
3. Access the admin panel at `https://yourdomain.com/admin`
4. Admin secret: `minenova-admin-2024` (change this in `artifacts/api-server/src/routes/admin.ts`)

---

## Troubleshooting

### App won't start
- Check that `NODE_ENV=production` is set
- Check that `DATABASE_URL` is correct and the database is accessible
- View logs in cPanel → **Setup Node.js App** → **Error Log**

### Database connection errors
- Make sure PostgreSQL allows connections from localhost
- Verify username/password are correct
- Try connecting manually: `psql "postgresql://USER:PASS@localhost:5432/DB"`

### Static files not loading (blank page / 404s)
- Make sure the build completed successfully (Step 7)
- Check that `artifacts/api-server/dist/` and `artifacts/minenova/dist/` both exist
- The Express server serves the frontend from `artifacts/minenova/dist/`

### Port conflicts
- If port 3000 is taken, change `PORT` to another free port (e.g. 3001, 8080)
- Update it in both the `.env` file and cPanel Node.js app settings

---

## Directory Structure After Build

```
minenova/
├── artifacts/
│   ├── api-server/
│   │   ├── dist/
│   │   │   └── index.mjs          ← compiled server (entry point)
│   │   ├── src/                   ← server source code
│   │   └── .env                   ← your environment variables
│   └── minenova/
│       ├── dist/                  ← compiled frontend (served by Express)
│       └── src/                   ← frontend source code
├── lib/
│   └── db/
│       └── migrations/            ← database migration files
├── pnpm-workspace.yaml
└── DEPLOYMENT_README.md
```

---

## Keeping the App Updated

To deploy future updates:

```bash
cd /home/yourusername/minenova

# Pull latest code (if using Git)
git pull origin main

# Reinstall dependencies if package.json changed
pnpm install --frozen-lockfile

# Rebuild
NODE_ENV=production BASE_PATH=/ PORT=3000 \
pnpm --filter @workspace/minenova build && \
pnpm --filter @workspace/api-server run build

# Restart app in cPanel → Setup Node.js App → Restart
```

---

## Support

For technical issues, refer to your hosting provider's Node.js documentation or open an issue on the GitHub repository.
