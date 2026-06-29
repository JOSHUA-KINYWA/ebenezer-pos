# Ebenezar POS System

A full-stack Point of Sale system built with Next.js, React, TypeScript, Tailwind CSS, and Supabase.

---

## What is included

- Staff login with email and PIN
- Sell screen — tap products, add to cart, cash or M-Pesa payment
- Auto stock deduction when a sale is completed
- Downloadable PDF receipt after every sale
- Reports — daily revenue, cash vs M-Pesa breakdown, bar charts, top products
- Stock management — visual levels, low-stock alerts, restock form
- Staff management — add/deactivate staff, owner vs cashier roles
- Settings — add/edit/remove products and prices
- Works on phone and laptop (responsive)
- Installable as a PWA (add to home screen)

---

## Setup Instructions

### Step 1 — Get your Supabase credentials

1. Open your Supabase project at https://supabase.com
2. Go to **Settings → API**
3. Copy your **Project URL** and **anon public key**

---

### Step 2 — Configure environment variables

In the project folder, create a file called `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=paste_your_project_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste_your_anon_key_here
```

Replace the values with what you copied from Supabase.

---

### Step 3 — Install dependencies

Open VS Code, then open the Terminal (View → Terminal) and run:

```bash
npm install
```

Wait for it to finish. This downloads all the packages the app needs.

---

### Step 4 — Run the app locally

```bash
npm run dev
```

Open your browser and go to: **http://localhost:3000**

You will see the login screen.

---

### Step 5 — First login

Log in with one of the owner accounts you created in Supabase.

> If you haven't created owner accounts yet, use the provided seed script or create them manually in Supabase Table Editor, then change the PIN in **Settings → Account** after logging in.

---

### Step 6 — Deploy online (free)

To make the app accessible from any phone or laptop:

1. Push your project to GitHub
2. Go to https://vercel.com and sign in with GitHub
3. Click **New Project** and select your repository
4. Under **Environment Variables**, add your two Supabase keys
5. Click **Deploy**

Vercel gives you a live URL like `https://ebenezar-pos.vercel.app` that works on any device.

---

## Project structure

```
src/
  app/
    login/          → Login page
    (dashboard)/
      layout.tsx    → Sidebar navigation
      sell/         → Main sell screen
      reports/      → Sales reports and charts
      stock/        → Stock levels and restock
      staff/        → Staff management
      settings/     → Products and prices
  lib/
    supabase.ts     → Supabase client
    receipt.ts      → PDF receipt generator
  types/
    index.ts        → TypeScript types for all tables
```

---

## Adding M-Pesa STK Push (next phase)

This will be added as a Supabase Edge Function. When ready:

1. Customer pays via M-Pesa
2. Staff enters customer phone number
3. M-Pesa payment prompt appears on customer phone
4. Once confirmed, sale is recorded automatically with the M-Pesa reference

---

## Tech stack

| Layer      | Technology                  |
|------------|-----------------------------|
| Frontend   | Next.js 14, React, TypeScript |
| Styling    | Tailwind CSS                |
| Database   | Supabase (PostgreSQL)       |
| Auth       | Custom PIN via Supabase DB  |
| PDF        | jsPDF + jsPDF-AutoTable     |
| Charts     | Recharts                    |
| Hosting    | Vercel (free tier)          |
