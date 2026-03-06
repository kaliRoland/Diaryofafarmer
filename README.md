# Diary of a Farmer Website

This repository contains the `Diary of a Farmer` website frontend and PHP backend endpoints used for:

- rendering the public site pages
- fetching blog posts from WordPress
- fetching marketplace products from WooCommerce
- receiving contact and consultation form submissions

## Tech Stack

- HTML/CSS/JavaScript
- PHP (XAMPP/Apache)
- WordPress + WooCommerce APIs (remote)
- SMTP (for consultation lead email delivery)

## Project Structure

- `index.html`, `about.html`, `contact.html`, `cons.html`, `calculator.html`, `payment-policy.html`: site pages
- `styles.css`, `script.js`: shared styling and client-side logic
- `components/`: reusable header/footer partials loaded by JavaScript
- `blog-proxy.php`: server-side proxy for latest blog posts
- `products-proxy.php`: server-side proxy for WooCommerce products
- `submit-form.php`: handles contact/consultation form submissions and optional file uploads
- `storage/`: runtime data (submission logs and uploads)

## Local Setup (XAMPP)

1. Place the project in your XAMPP web root:
   - `C:\xampp\htdocs\diary`
2. Start Apache from XAMPP control panel.
3. Copy environment file:
   - `copy .env.example .env`
4. Update values inside `.env`:
   - `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`
   - `WORDPRESS_URL`
   - `CONSULTATION_LEADS_EMAIL`
   - SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_ENCRYPTION`, `SMTP_USERNAME`, `SMTP_PASSWORD`)
5. Open the site:
   - `http://localhost/diary/`

## Environment Variables

Defined in `.env.example`:

- `WOO_CONSUMER_KEY`
- `WOO_CONSUMER_SECRET`
- `WORDPRESS_URL`
- `CONSULTATION_LEADS_EMAIL`
- `MAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_ENCRYPTION` (`starttls`, `ssl`, or `none`)
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_TIMEOUT`

## Form Handling

- Frontend posts form data to `submit-form.php`.
- Supported form types:
  - `contact`
  - `consultation`
- Consultation upload limits:
  - max size: `5 MB`
  - file types: `pdf`, `jpg`, `jpeg`, `png`
- Submissions are appended to:
  - `storage/submissions.jsonl`
- Uploaded files are stored in:
  - `storage/uploads/`

## API Endpoints (Local)

- `GET /diary/blog-proxy.php`
- `GET /diary/products-proxy.php?per_page=4&orderby=date&order=desc`
- `POST /diary/submit-form.php`

## Security Notes

- `.env` is ignored by Git and should never be committed.
- `storage/submissions.jsonl` and `storage/uploads/` are ignored by Git.
- Keep SMTP and WooCommerce credentials in `.env` only.

## GitHub

Repository: `https://github.com/kaliRoland/Diaryofafarmer`

