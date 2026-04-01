// State management
let state = {
    employees: [],
    leaves: {}, // Format: "YYYY-MM-DD_employeeId": "AL" | "SL" | etc.
    activeRegions: ['PH'],
    customHolidays: {} // "YYYY-MM-DD": "Name"
};

let dirHandle = null;
let fileHandle = null;

// Cache for API fetched holidays
const holidayCache = {}; // { 'PH_2026': { '2026-01-01': 'New Year', ... } }

let currentDate = new Date();
let currentView = 'calendar'; // 'calendar' or 'team'
let contextMenuTarget = null; // Store { dateString, employeeId, cellElement }

// DOM Elements
const views = {
    calendar: document.getElementById('calendar-view'),
    team: document.getElementById('team-view')
};
const navBtns = document.querySelectorAll('.nav-btn');
const exportBtn = document.getElementById('export-btn');
const monthDisplay = document.getElementById('current-month-display');
const prevBtn = document.getElementById('prev-month');
const nextBtn = document.getElementById('next-month');

// Data Connection Elements
const selectDirBtn = document.getElementById('select-dir-btn');
const createFileBtn = document.getElementById('create-file-btn');
const connectionStatus = document.getElementById('connection-status');
const createFileTooltip = document.getElementById('create-file-tooltip');

// Holiday & KPI Elements
const countrySelect = document.getElementById('country-select');
const holidaySelectorLinks = document.getElementById('holiday-selector');
const kpiUtilization = document.getElementById('kpi-utilization');
const kpiSick = document.getElementById('kpi-sick');
const kpiEmergency = document.getElementById('kpi-emergency');

// Calendar Elements
const calendarGrid = document.getElementById('calendar-grid');

// Team Matrix Elements
const teamTable = document.getElementById('team-table');
const teamThead = teamTable.querySelector('thead');
const teamTbody = teamTable.querySelector('tbody');

// Modals
const addMemberModal = document.getElementById('add-member-modal');
const addMemberBtn = document.getElementById('add-member-btn');
const closeModals = document.querySelectorAll('.close-modal');
const addMemberForm = document.getElementById('add-member-form');
const memberNameInput = document.getElementById('member-name-input');
const membersList = document.getElementById('members-list');

// Context Menu
const contextMenu = document.getElementById('leave-context-menu');
const ctxBtns = document.querySelectorAll('.ctx-btn');

// Initialization
async function init() {
    loadState();
    setupEventListeners();
    await fetchAvailableCountries();
    await fetchActiveHolidays();
    renderApp();
    
    // Auto sync from file system every 5 seconds if connected
    setInterval(async () => {
        if (fileHandle && !contextMenu.classList.contains('active') && !addMemberModal.classList.contains('active')) {
            await readFromFile();
        }
    }, 5000);
}

function loadState() {
    state = {
        employees: [],
        leaves: {},
        activeRegions: ['PH'],
        customHolidays: {}
    };
}

async function fetchAvailableCountries() {
    try {
        const res = await fetch('https://date.nager.at/api/v3/AvailableCountries');
        const countries = await res.json();
        countries.sort((a,b) => a.name.localeCompare(b.name));
        let options = '<option value="">Select a country...</option>';
        countries.forEach(c => {
            options += `<option value="${c.countryCode}">${c.name}</option>`;
        });
        countrySelect.innerHTML = options;
    } catch(e) { console.error('Failed to fetch countries', e); }
}

async function fetchActiveHolidays() {
    const year = currentDate.getFullYear();
    if (!state.activeRegions) state.activeRegions = [];
    
    for (const code of state.activeRegions) {
        const cacheKey = `${code}_${year}`;
        if (!holidayCache[cacheKey]) {
            try {
                const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`);
                if (res.ok) {
                    const data = await res.json();
                    let mapped = {};
                    data.forEach(h => { mapped[h.date] = h.name; }); // Using English name for consistency
                    holidayCache[cacheKey] = mapped;
                }
            } catch(e) { console.error('Holiday API err', e); }
        }
    }
}

function getHolidayName(dateStr) {
    if (state.customHolidays && state.customHolidays[dateStr]) {
        return state.customHolidays[dateStr]; // Custom has highest priority
    }
    const year = dateStr.split('-')[0];
    const regions = state.activeRegions || [];
    for (const code of regions) {
        const cacheKey = `${code}_${year}`;
        if (holidayCache[cacheKey] && holidayCache[cacheKey][dateStr]) {
            return holidayCache[cacheKey][dateStr];
        }
    }
    return null;
}

function getVisibleEmployees() {
    const viewYear = currentDate.getFullYear();
    const viewMonth = String(currentDate.getMonth() + 1).padStart(2, '0');
    const viewYM = `${viewYear}-${viewMonth}`;
    
    return state.employees.filter(emp => {
        if (!emp.endYearMonth) return true; // Active indefinitely
        return viewYM <= emp.endYearMonth; // Visible if current month is on or before their end month
    });
}

function saveState() {
    if (fileHandle) {
        saveToFileSystem();
    }
}

async function saveToFileSystem() {
    if (!fileHandle) return;
    try {
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(state));
        await writable.close();
    } catch (e) {
        console.error('Save to file system failed', e);
    }
}

async function readFromFile() {
    if (!fileHandle) return;
    try {
        const file = await fileHandle.getFile();
        const contents = await file.text();
        
        if (contents) {
            state = JSON.parse(contents);
            if (!state.activeRegions) state.activeRegions = ['PH'];
            renderApp();
        }
    } catch (e) {
        console.error('Failed to read file', e);
    }
}

function updateConnectionStatus(isConnected) {
    const statusText = connectionStatus.querySelector('.status-text');
    if (isConnected) {
        connectionStatus.classList.remove('local');
        connectionStatus.classList.add('connected');
        statusText.textContent = 'Connected to Network';
    } else {
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('local');
        statusText.textContent = 'Local Storage Only';
    }
}

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Event Listeners
function setupEventListeners() {
    // Navigation
    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const btnTgt = e.target.closest('.nav-btn');
            navBtns.forEach(b => b.classList.remove('active'));
            btnTgt.classList.add('active');
            
            const view = btnTgt.getAttribute('data-view');
            switchView(view);
        });
    });

    // Month Navigation
    prevBtn.addEventListener('click', async () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        await fetchActiveHolidays();
        renderApp();
    });
    
    nextBtn.addEventListener('click', async () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        await fetchActiveHolidays();
        renderApp();
    });

    // File System Integration
    if (selectDirBtn) {
        selectDirBtn.addEventListener('click', async () => {
            try {
                dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                await checkDataFile();
            } catch (e) {
                console.error('Directory selection failed/cancelled', e);
            }
        });
    }

    if (createFileBtn) {
        createFileBtn.addEventListener('click', async () => {
            if (!dirHandle) {
                alert("Please click 'Select Shared Folder' first so the app knows exactly where you want to save the new file.");
                return;
            }
            try {
                fileHandle = await dirHandle.getFileHandle('data.json', { create: true });
                await saveToFileSystem();
                
                updateConnectionStatus(true);
                createFileBtn.disabled = true;
                createFileBtn.classList.add('disabled-btn');
                createFileTooltip.textContent = 'data.json already exists';
                
                // Refresh the app to clear out any past memory and prep it for the new file
                renderApp();
            } catch (e) {
                console.error('Failed to create file', e);
            }
        });
    }

    // Modals
    addMemberBtn.addEventListener('click', () => {
        renderMembersList();
        addMemberModal.classList.add('active');
        memberNameInput.focus();
    });

    closeModals.forEach(btn => {
        btn.addEventListener('click', () => {
            addMemberModal.classList.remove('active');
        });
    });

    // Add Member
    addMemberForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = memberNameInput.value.trim();
        if (value) {
            state.employees.push({ id: generateId(), name: value });
            saveState();
            memberNameInput.value = '';
            renderMembersList();
            renderApp();
        }
    });

    // Context Menu clicks outside
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target) && !e.target.closest('.cell-interactive')) {
            hideContextMenu();
        }
    });

    // Assign Leave from context menu
    ctxBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!contextMenuTarget) return;
            const type = e.target.closest('.ctx-btn').getAttribute('data-type');
            const { dateStr, empId } = contextMenuTarget;
            const key = `${dateStr}_${empId}`;
            
            if (type === 'CLEAR') {
                delete state.leaves[key];
            } else {
                state.leaves[key] = type;
            }
            
            saveState();
            hideContextMenu();
            renderApp(); // Re-render to update both views
        });
    });

    // Export Excel
    exportBtn.addEventListener('click', exportToExcel);

    // Holiday Region Selection Dropdown
    countrySelect.addEventListener('change', async (e) => {
        const val = e.target.value;
        if (!val) return;
        if (!state.activeRegions) state.activeRegions = [];
        if (state.activeRegions.includes(val)) return;
        if (state.activeRegions.length >= 3) {
            alert("Maximum of 3 countries allowed. Please remove one first.");
            countrySelect.value = '';
            return;
        }
        state.activeRegions.push(val);
        countrySelect.value = '';
        saveState();
        await fetchActiveHolidays();
        renderApp();
    });

    // Delegated listener for removing active region holidays
    holidaySelectorLinks.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-region')) {
            const code = e.target.closest('button').getAttribute('data-region');
            state.activeRegions = state.activeRegions.filter(r => r !== code);
            saveState();
            renderApp();
        }
    });

    // Add Custom Holiday via Calendar
    calendarGrid.addEventListener('click', (e) => {
        const dayEl = e.target.closest('.calendar-day');
        if (!dayEl || dayEl.classList.contains('empty')) return;
        
        // Prevent click if clicking inside an existing chip
        if (e.target.closest('.chip')) return;
        
        const dateStr = dayEl.getAttribute('data-date');
        if (!dateStr) return;
        
        const existing = (state.customHolidays && state.customHolidays[dateStr]) ? state.customHolidays[dateStr] : '';
        const name = prompt(`Add custom holiday for ${dateStr} (Leave blank to remove):`, existing);
        if (name !== null) {
            if (!state.customHolidays) state.customHolidays = {};
            if (name.trim() === '') {
                delete state.customHolidays[dateStr];
            } else {
                state.customHolidays[dateStr] = name.trim();
            }
            saveState();
            renderApp();
        }
    });
}

function switchView(viewName) {
    currentView = viewName;
    Object.values(views).forEach(v => {
        v.classList.remove('section-active');
        setTimeout(() => v.classList.add('hidden'), 300); // Wait for transition
    });
    
    setTimeout(() => {
        views[viewName].classList.remove('hidden');
        setTimeout(() => {
            views[viewName].classList.add('section-active');
        }, 10);
    }, 300);

    // Toggle export button visibility
    if (viewName === 'team') {
        exportBtn.classList.remove('hidden');
    } else {
        exportBtn.classList.add('hidden');
    }
}

// Rendering Logic
function renderApp() {
    updateMonthDisplay();
    updateHolidaySelector();
    renderCalendar();
    renderTeamTable();
    calculateKPIs();
}

function updateHolidaySelector() {
    holidaySelectorLinks.innerHTML = '';
    const regions = state.activeRegions || [];
    regions.forEach(code => {
        const btn = document.createElement('button');
        btn.className = 'holiday-btn active';
        btn.setAttribute('data-region', code);
        btn.innerHTML = `${code} <span class="remove-region">&times;</span>`;
        holidaySelectorLinks.appendChild(btn);
    });
}

function updateMonthDisplay() {
    const opts = { month: 'long', year: 'numeric' };
    monthDisplay.textContent = currentDate.toLocaleDateString('en-US', opts);
}

// Calendar View
function renderCalendar() {
    calendarGrid.innerHTML = '';
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const today = new Date();
    const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;

    // Empty cells for days before the 1st
    for (let i = 0; i < firstDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day empty';
        calendarGrid.appendChild(emptyDay);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        if (isCurrentMonth && day === today.getDate()) {
            dayEl.classList.add('today');
        }

        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        dayEl.setAttribute('data-date', dateStr);
        
        const holidayName = getHolidayName(dateStr);
        const isWeekend = new Date(year, month, day).getDay() === 0 || new Date(year, month, day).getDay() === 6;

        let chipsHtml = '';
        getVisibleEmployees().forEach(emp => {
            const key = `${dateStr}_${emp.id}`;
            if (state.leaves[key]) {
                const type = state.leaves[key];
                chipsHtml += `<div class="chip chip-${type}"><span>${emp.name}</span></div>`;
            }
        });

        let headerHtml = `<div class="day-header"><div class="day-number">${day}</div>`;
        if (holidayName) {
            headerHtml += `<div class="holiday-name" title="${holidayName}">${holidayName}</div>`;
        } else if (isWeekend) {
            headerHtml += `<div class="holiday-name" style="background:var(--weekend-bg); color:var(--weekend);">Weekend</div>`;
        }
        headerHtml += `</div>`;

        dayEl.innerHTML = `
            ${headerHtml}
            <div class="leave-chips">${chipsHtml}</div>
        `;
        calendarGrid.appendChild(dayEl);
    }
}

// Team View Matrix
function renderTeamTable() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Build Header
    let theadHtml = '<tr><th>Team Member</th>';
    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const holidayName = getHolidayName(dateStr);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        
        let cls = isWeekend ? 'weekend-col' : '';
        if (holidayName) cls += ' holiday-col';
        const titleAttr = holidayName ? `title="${holidayName}"` : '';

        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).substr(0, 2);
        theadHtml += `<th class="${cls}" ${titleAttr}>
            <div>${dayName}</div>
            <div>${day}</div>
        </th>`;
    }
    theadHtml += '</tr>';
    teamThead.innerHTML = theadHtml;

    // Build Body
    teamTbody.innerHTML = '';
    
    const visibleEmployees = getVisibleEmployees();
    
    if (visibleEmployees.length === 0) {
        teamTbody.innerHTML = `<tr><td colspan="${daysInMonth + 1}" style="text-align:center; padding: 40px;">No team members added yet. Click 'Add Member' to start.</td></tr>`;
        return;
    }

    visibleEmployees.forEach(emp => {
        const tr = document.createElement('tr');
        
        const nameTd = document.createElement('td');
        nameTd.textContent = emp.name;
        tr.appendChild(nameTd);
        
        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(year, month, day);
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const key = `${dateStr}_${emp.id}`;
            const leaveType = state.leaves[key];
            const holidayName = getHolidayName(dateStr);
            
            const td = document.createElement('td');
            
            if (isWeekend) {
                td.className = 'weekend-col cell-WE';
                td.textContent = 'WE';
            } else if (holidayName) {
                td.className = 'holiday-col cell-HL';
                td.textContent = 'HL';
                td.title = holidayName;
            } else {
                td.className = 'cell-interactive';
                if (leaveType) {
                    td.textContent = leaveType;
                    td.classList.add(`cell-${leaveType}`);
                }
                // Click to open context menu only on active cells
                td.addEventListener('click', (e) => showContextMenu(e, dateStr, emp.id, td));
            }
            
            tr.appendChild(td);
        }
        teamTbody.appendChild(tr);
    });
}

function showContextMenu(e, dateStr, empId, cellEl) {
    e.stopPropagation();
    contextMenuTarget = { dateStr, empId, cellEl };
    
    const rect = cellEl.getBoundingClientRect();
    let top = rect.bottom + window.scrollY;
    let left = rect.left + window.scrollX;

    // The extended menu is large (450px wide)
    if (left + 460 > window.innerWidth) {
        left = window.innerWidth - 470;
    }
    
    contextMenu.style.top = `${top}px`;
    contextMenu.style.left = `${left}px`;
    contextMenu.classList.add('active');
}

function hideContextMenu() {
    contextMenu.classList.remove('active');
    contextMenuTarget = null;
}

// Modal Members List
function renderMembersList() {
    membersList.innerHTML = '';
    getVisibleEmployees().forEach(emp => {
        const li = document.createElement('li');
        li.className = 'member-item';
        li.innerHTML = `
            <span>${emp.name}</span>
            <button class="remove-member" data-id="${emp.id}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
        `;
        membersList.appendChild(li);
    });

    // Attach remove handlers
    document.querySelectorAll('.remove-member').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.closest('.remove-member').getAttribute('data-id');
            // Soft remove employee (set endYearMonth to current viewed month)
            const emp = state.employees.find(e => e.id === id);
            if (emp) {
                const year = currentDate.getFullYear();
                const month = String(currentDate.getMonth() + 1).padStart(2, '0');
                emp.endYearMonth = `${year}-${month}`;
            }
            saveState();
            renderMembersList();
            renderApp();
        });
    });
}

// Export Functionality using SheetJS (XLSX)
function exportToExcel() {
    if (typeof XLSX === 'undefined') {
        alert("Excel export library is still loading or failed to load. Please try again.");
        return;
    }

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Prepare Data Matrix
    let aoa = [];
    
    // Headers row
    let headers = ["Team Member"];
    let holidayRow = ["Holidays"];
    let hasHolidays = false;
    
    for (let d = 1; d <= daysInMonth; d++) {
        const dObj = new Date(year, month, d);
        const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' }).substr(0, 2);
        headers.push(`${dayName} ${d}`);
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const holidayName = getHolidayName(dateStr);
        if (holidayName) {
            hasHolidays = true;
            holidayRow.push(holidayName);
        } else {
            holidayRow.push("");
        }
    }
    aoa.push(headers);
    if (hasHolidays) aoa.push(holidayRow);

    // Employee Rows
    getVisibleEmployees().forEach(emp => {
        let row = [emp.name];
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const key = `${dateStr}_${emp.id}`;
            const isWeekend = new Date(year, month, day).getDay() === 0 || new Date(year, month, day).getDay() === 6;
            const holidayName = getHolidayName(dateStr);
            
            if (isWeekend) {
                row.push("WE");
            } else if (holidayName) {
                row.push("HL");
            } else {
                row.push(state.leaves[key] || "");
            }
        }
        aoa.push(row);
    });

    // Create Worksheet
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Create Workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leaves Matrix");

    // File name
    const filename = `Team_Leaves_${monthName.replace(" ", "_")}.xlsx`;

    // Download
    XLSX.writeFile(wb, filename);
}

// KPI Calculations
function calculateKPIs() {
    const visibleEmployees = getVisibleEmployees();
    if (!visibleEmployees || visibleEmployees.length === 0) {
        kpiUtilization.textContent = '--%';
        kpiSick.textContent = '--%';
        kpiEmergency.textContent = '--%';
        return;
    }

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let totalWorkDays = 0;
    let takenSick = 0;
    let takenEmergency = 0;
    let totalTaken = 0; 

    // Calculate work days
    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const holidayName = getHolidayName(dateStr);
        
        if (!isWeekend && !holidayName) {
            totalWorkDays++;
            
            visibleEmployees.forEach(emp => {
                const type = state.leaves[`${dateStr}_${emp.id}`];
                if (!type) return;

                let amt = 1.0;
                if (['AA','AP','SA','SP','EA','EP'].includes(type)) {
                    amt = 0.5;
                }
                
                totalTaken += amt;

                if (type.startsWith('S')) takenSick += amt;
                if (type.startsWith('E')) takenEmergency += amt;
            });
        }
    }
    
    const possibleWorkDays = totalWorkDays * visibleEmployees.length;
    
    if (possibleWorkDays === 0) {
        kpiUtilization.textContent = '0%';
        kpiSick.textContent = '0%';
        kpiEmergency.textContent = '0%';
        return;
    }

    const utilRate = ((possibleWorkDays - totalTaken) / possibleWorkDays) * 100;
    const sickRate = (takenSick / possibleWorkDays) * 100;
    const emergRate = (takenEmergency / possibleWorkDays) * 100;

    kpiUtilization.textContent = utilRate.toFixed(1) + '%';
    kpiSick.textContent = sickRate.toFixed(1) + '%';
    kpiEmergency.textContent = emergRate.toFixed(1) + '%';
}

// Bootstrap
init();

async function checkDataFile() {
    if (!dirHandle) return;
    try {
        fileHandle = await dirHandle.getFileHandle('data.json', { create: false });
        
        updateConnectionStatus(true);
        createFileBtn.disabled = true;
        createFileBtn.classList.add('disabled-btn');
        createFileTooltip.textContent = 'data.json already exists';
        
        await readFromFile();
    } catch (e) {
        if (e.name === 'NotFoundError') {
            fileHandle = null;
            updateConnectionStatus(false);
            
            createFileBtn.disabled = false;
            createFileBtn.classList.remove('disabled-btn');
            createFileTooltip.textContent = 'Click to create data.json';

            // Reset state if data.json is missing in the connected directory
            state = {
                employees: [],
                leaves: {},
                activeRegions: ['PH'],
                customHolidays: {}
            };
            renderApp();
            renderMembersList();
        } else {
            console.error('Error checking file', e);
        }
    }
}
