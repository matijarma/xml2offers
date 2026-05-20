# Izrada ponuda - Offer PDF Generator 🧾✨

Chrome extension for creating professional offers and exporting them to PDF, fully locally in your browser.

![Offer generator screenshot](icons/screenshot-1-en.png)

## ✨ Features

- 100% local processing (no server upload)
- Create and manage issuer profiles
- Import issuer data from e-invoice XML
- Buyer autofill from previously saved offer data
- Flexible line items with quantity, unit, price, discount and automatic totals
- Live financial summary (net, VAT, total)
- PDF preview and one-click download
- Configurable PDF logo and accent color
- Croatian and English interface + PDF language
- Popup and side panel display modes

## 🔒 Privacy

- All offer data stays in browser local storage on the same device
- No external API calls for offer generation
- No tracking scripts in the extension

## 🧩 Split Architecture

This extension is now focused only on offers.

- Offers extension: `ponude/` (this folder)
- XML invoice conversion extension: `../xml2pdf/`

## 🛠 Local Development

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `ponude/` folder

## ⚠️ Note

Generated PDF offers are informational/business documents. Legal validity depends on your workflow, approval process, and local regulations.
