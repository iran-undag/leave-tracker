# Team Leave Tracker

A robust, browser-based web application for tracking team leaves, calculating utilization metrics, and ensuring team coverage. Now powered by SQLite for improved reliability and concurrency. 
A team sometimes have their own leave tracker using spreadsheets, even if the company has a time tool. This application tries to replace that internal spreadsheet and remove the hassle of maintaining it i.e. update holidays, insert new month sheet, etc.

## Features

- **Interactive Calendar & Team Matrix:** View leaves on a traditional monthly calendar or a detailed team matrix to easily spot coverage gaps.
- **Multiple Leave Types:** Supports logging various types of leaves, including Annual (AL, AA, AP), Sick (SL, SA, SP), Emergency (EL, EA, EP), Maternity, Paternity, and more.
- **Public & Custom Holidays:** Automatically fetches public holidays for up to 3 selected countries. You can also manually add custom holidays by clicking on an empty day in the calendar.
- **KPI Dashboard:** Automatically calculates monthly Team Utilization, Sick Leave, and Emergency Leave rates.
- **Team Management:** Add and "soft-remove" team members. Historical data is preserved for accurate past reporting.
- **SQLite Persistence:** Data is stored in a `leavetracker.db` file when connected to a shared folder. The app automatically migrates legacy `data.json` files on first connection.
- **Exclusive Multi-User Locking:** To prevent data corruption on shared drives, the app uses a locking mechanism. Only one user can edit at a time; others are placed in a real-time **Read-Only Mode** that syncs updates automatically.
- **Excel Export:** Export the monthly Team Matrix directly to an `.xlsx` file.

## Technologies Used

- **HTML5 & CSS3** for structure and styling.
- **Vanilla JavaScript** with **sql.js (SQLite WASM)** for data management.
- **File System Access API** for local/shared folder persistence.
- **[Nager.Date API](https://date.nager.at/)** for public holidays.
- **[SheetJS](https://sheetjs.com/)** for Excel export.

## Calendar View
<img width="1853" height="893" alt="image" src="https://github.com/user-attachments/assets/db13f0fa-6191-4308-b073-07c31383451a" />

## Team View
<img width="1860" height="775" alt="image" src="https://github.com/user-attachments/assets/975060a7-3b44-4a99-ba19-6f95d1e78fc4" />

## How to Run

1. Clone or download the source code folder.
2. Ensure you have a modern web browser that supports the File System Access API (Chrome, Edge).
3. Open `index.html` in your browser. 
4. Click **Select Shared Folder** and pick a folder (local or on a shared network drive).
5. If no database exists, click **Create Database**. If a `data.json` exists, it will be migrated automatically.

## Multi-User Usage

- **Editing**: When you connect to a folder, the app attempts to acquire an exclusive lock. If successful, you can edit freely. Your name will be displayed in the status bar.
- **Read-Only Mode**: If another user is already editing, you will see a banner and the app will switch to read-only mode. Your view will automatically refresh every 5 seconds to show changes made by the editor.
- **Lock Takeover**: If an editor closes their browser or goes inactive for more than 2 minutes, the lock becomes stale and can be acquired by another user.
- **Resetting Identity**: Click the user icon next to the connection status to change the name you use for lock identification.

## Usage Tips

- **Assigning Leave**: Click on a cell in either view to open the assignment menu.
- **Removing a Record**: Open the context menu and select "Clear Leave".
- **Sharing Data**: Pick a shared network drive or cloud-synced folder (OneDrive, Dropbox, etc.) as your shared folder. All team members pointing to that same folder will share the same database.
