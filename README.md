# Team Leave Tracker

A lightweight, browser-based web application for tracking team leaves, calculating utilization metrics, and ensuring team coverage. 

## Features

- **Interactive Calendar & Team Matrix:** View leaves on a traditional monthly calendar or a detailed team matrix to easily spot coverage gaps.
- **Multiple Leave Types:** Supports logging various types of leaves, including Annual (AL, AA, AP), Sick (SL, SA, SP), Emergency (EL, EA, EP), Maternity, Paternity, and more. Including support for half-day leaves (AM/PM).
- **Public & Custom Holidays:** Automatically fetches public holidays for up to 3 selected countries. You can also manually add custom holidays by clicking on an empty day in the calendar.
- **KPI Dashboard:** Automatically calculates monthly Team Utilization, Sick Leave, and Emergency Leave rates based on available working days.
- **Team Management:** Add and "soft-remove" team members. Removed members won't show in future months but their historical leave data is retained for accurate past reporting.
- **Network Storage / Data Persistence:** Data is stored locally in your browser by default. However, you can select a local folder (or a shared network drive/cloud sync folder) to save and load the `data.json` file. This acts as a shared database that automatically syncs every 5 seconds!
- **Excel Export:** Export the monthly Team Matrix directly to an `.xlsx` file for your records.

## Calendar View
<img width="1572" height="826" alt="image" src="https://github.com/user-attachments/assets/6c179c3a-cc85-461c-a362-48331a8f9201" />
<img width="1558" height="241" alt="image" src="https://github.com/user-attachments/assets/3893176f-dfbc-4ef5-af13-c67dde37719a" />

## Team View
<img width="1584" height="394" alt="image" src="https://github.com/user-attachments/assets/dd0ebaf2-a5e8-46a5-9b82-2cd8f3d5ec69" />

## Technologies Used

- **HTML5 & CSS3** for structure and styling
- **Vanilla JavaScript** for all application logic—no framework setup required!
- **File System Access API** for local/shared folder data persistence
- **[Nager.Date API](https://date.nager.at/)** to dynamically fetch public country holidays
- **[SheetJS](https://sheetjs.com/)** for exporting the data matrix to Microsoft Excel

## How to Run

1. Clone or download the source code folder.
2. Ensure you have a modern web browser that supports the File System Access API (like Chrome or Edge).
3. Simply open `index.html` in your browser. 
4. *Optional*: Click **Select Shared Folder**, pick a folder on your computer, and click **Create data.json** to start persistently saving your team's data to a file. 

## Usage Tips

- **Assigning Leave**: In either the Calendar or Team Matrix view, simply click on the cell corresponding to the employee and date, and a menu will pop up to assign a leave type.
- **Removing a Record**: Open the context menu on a leave and select "Clear Leave" at the bottom to erase it.
- **Sharing Data with Team**: Since the app uses a physical `data.json` file when connected to a directory, you can pick a shared Google Drive, OneDrive, or Dropbox folder. Then, anyone else opening `index.html` and selecting that same shared folder will be able to synchronize their view with yours.
