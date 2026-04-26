// State management
let state = {
    employees: [],
    leaves: {}, // Format: "YYYY-MM-DD_employeeId": "AL" | "SL" | etc.
    activeRegions: ['PH'],
    customHolidays: {} // "YYYY-MM-DD": "Name"
};

let dirHandle = null;
let dbFileHandle = null; // Handle for leavetracker.db
let dbReady = false; // Whether the SQLite database is initialised
let isLocked = false; // Whether the app is in read-only mode (another user has the lock)
let currentUserName = null; // The current user's name for lock identification
let heartbeatIntervalId = null; // Interval ID for heartbeat updates

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

// Lock Banner
const lockBanner = document.getElementById('lock-banner');
const lockBannerText = document.getElementById('lock-banner-text');

// Initialization
async function init() {
    await initDB(); // Initialise sql.js with an empty in-memory database
    dbReady = true;
    loadState();
    setupEventListeners();
    await fetchAvailableCountries();
    await fetchActiveHolidays();
    renderApp();
    
    // Auto sync from file system every 5 seconds if connected
    setInterval(async () => {
        // Only read from file if we are in locked (read-only) mode.
        // If we have the lock, we are the source of truth.
        if (dbFileHandle && isLocked && !contextMenu.classList.contains('active') && !addMemberModal.classList.contains('active')) {
            await readFromFile();
        }
        // If locked, periodically check if the lock was released so we can take over
        if (isLocked && dirHandle) {
            await tryAcquireLockIfReleased();
        }
    }, 5000);

    // Release lock when the page is closed or navigated away
    window.addEventListener('beforeunload', async () => {
        if (dirHandle && !isLocked) {
            // Use synchronous-ish approach: we can't fully await in beforeunload,
            // but we try our best to delete the lock file
            try {
                await releaseLock(dirHandle);
            } catch (e) {
                // Best effort
            }
        }
    });
}

function loadState() {
    if (dbReady && isDBReady()) {
        state = getFullState();
        // Ensure defaults
        if (!state.activeRegions || state.activeRegions.length === 0) {
            state.activeRegions = ['PH'];
        }
    } else {
        state = {
            employees: [],
            leaves: {},
            activeRegions: ['PH'],
            customHolidays: {}
        };
    }
}

async function fetchAvailableCountries() {
    try {
        const res = await fetch('https://date.nager.at/api/v3/AvailableCountries');
        if (!res.ok) {
            throw new Error(`API returned ${res.status}`);
        }
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
    if (dbFileHandle) {
        saveToFileSystem();
    }
}

async function saveToFileSystem() {
    if (!dbFileHandle || !isDBReady() || isLocked) return;
    try {
        await saveToFile(dbFileHandle);
    } catch (e) {
        console.error('Save to file system failed', e);
    }
}

async function readFromFile() {
    if (!dbFileHandle) return;
    try {
        await loadFromFile(dbFileHandle);
        state = getFullState();
        if (!state.activeRegions || state.activeRegions.length === 0) {
            state.activeRegions = ['PH'];
        }
        renderApp();
    } catch (e) {
        console.error('Failed to read database file', e);
    }
}

function updateConnectionStatus(mode) {
    // mode: 'connected' | 'readonly' | 'local'
    const statusText = connectionStatus.querySelector('.status-text');
    connectionStatus.classList.remove('local', 'connected', 'readonly');

    if (mode === 'connected') {
        connectionStatus.classList.add('connected');
        statusText.textContent = currentUserName ? `Editing as ${currentUserName}` : 'Connected — Editing';
    } else if (mode === 'readonly') {
        connectionStatus.classList.add('readonly');
        statusText.textContent = 'Connected — Read Only';
    } else {
        connectionStatus.classList.add('local');
        statusText.textContent = 'Local Storage Only';
    }
}

/**
 * Enter or exit locked (read-only) mode.
 * FIX #1: Use textContent instead of innerHTML to prevent XSS
 */
function setLockedMode(locked, holderName) {
    isLocked = locked;
    if (locked) {
        document.body.classList.add('app-locked');
        lockBanner.classList.remove('hidden');
        // SECURITY FIX: Use safe DOM manipulation instead of innerHTML
        const lockBannerContent = document.createElement('span');
        lockBannerContent.textContent = `This database is currently being edited by ${holderName}. You are in read-only mode.`;
        lockBannerText.innerHTML = ''; // Clear old content
        lockBannerText.appendChild(lockBannerContent);
        updateConnectionStatus('readonly');
    } else {
        document.body.classList.remove('app-locked');
        lockBanner.classList.add('hidden');
        updateConnectionStatus('connected');
    }
}

/**
 * Periodically check if the lock holder has released the lock.
 * If released or stale, acquire it and switch to edit mode.
 */
async function tryAcquireLockIfReleased() {
    if (!dirHandle || !currentUserName) return;
    const lockData = await checkLock(dirHandle);
    if (!lockData || isLockStale(lockData)) {
        // Lock was released or went stale — acquire it
        const result = await acquireLock(dirHandle, currentUserName);
        if (result.acquired) {
            setLockedMode(false, null);
            startHeartbeat();
            console.log('Lock acquired — switched to edit mode');
        }
    }
}

/**
 * Start the heartbeat interval to keep the lock alive.
 */
function startHeartbeat() {
    if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = setInterval(async () => {
        if (dirHandle && !isLocked && currentUserName) {
            const ok = await updateHeartbeat(dirHandle, currentUserName);
            if (!ok) {
                // Lost the lock (someone else took it or it went stale and was snatched)
                const lockData = await checkLock(dirHandle);
                const holder = lockData ? lockData.user : 'Unknown';
                setLockedMode(true, holder);
                clearInterval(heartbeatIntervalId);
                heartbeatIntervalId = null;
                console.warn(`Lock lost! It is now held by ${holder}. Switched to read-only mode.`);
            }
        }
    }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the heartbeat interval.
 */
function stopHeartbeat() {
    if (heartbeatIntervalId) {
        clearInterval(heartbeatIntervalId);
        heartbeatIntervalId = null;
    }
}

/**
 * Generate a cryptographically secure random ID.
 * FIX #4: Use crypto.getRandomValues instead of Math.random()
 */
function generateId() {
    // Use crypto API for secure random ID generation
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const array = new Uint8Array(6);
        crypto.getRandomValues(array);
        return Array.from(array)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    // Fallback for environments without crypto API
    return Math.random().toString(36).substr(2, 9);
}

/**
 * Reset the user name by clearing localStorage and prompting again.
 */
function resetUserName() {
    localStorage.removeItem('leavetracker_username');
    const oldName = currentUserName;
    currentUserName = getLockUserName();
    
    // If we have the lock, update it with the new name
    if (dirHandle && !isLocked && currentUserName !== oldName) {
        acquireLock(dirHandle, currentUserName).then(() => {
            updateConnectionStatus('connected');
            renderApp();
        });
    } else {
        updateConnectionStatus(isLocked ? 'readonly' : (dbFileHandle ? 'connected' : 'local'));
        renderApp();
    }
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
            if (isLocked) return;
            if (!dirHandle) {
                alert("Please click 'Select Shared Folder' first so the app knows exactly where you want to save the new file.");
                return;
            }
            try {
                // Re-initialise a fresh empty database
                await initDB();
                dbReady = true;
                // Add default region
                addRegion('PH');

                dbFileHandle = await dirHandle.getFileHandle('leavetracker.db', { create: true });
                await saveToFileSystem();

                // Acquire the lock
                currentUserName = getLockUserName();
                await acquireLock(dirHandle, currentUserName);
                startHeartbeat();
                
                updateConnectionStatus('connected');
                createFileBtn.disabled = true;
                createFileBtn.classList.add('disabled-btn');
                createFileTooltip.textContent = 'Database connected';
                
                // Refresh state from the new database
                loadState();
                renderApp();
            } catch (e) {
                console.error('Failed to create database', e);
            }
        });
    }

    // Modals
    addMemberBtn.addEventListener('click', () => {
        if (isLocked) return;
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
        if (isLocked) return;
        const value = memberNameInput.value.trim();
        if (value) {
            const id = generateId();
            addEmployee(id, value);
            state = getFullState();
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
            if (isLocked) { hideContextMenu(); return; }
            if (!contextMenuTarget) return;
            const type = e.target.closest('.ctx-btn').getAttribute('data-type');
            const { dateStr, empId } = contextMenuTarget;
            
            if (type === 'CLEAR') {
                clearLeave(dateStr, empId);
            } else {
                setLeave(dateStr, empId, type);
            }
            
            state = getFullState();
            saveState();
            hideContextMenu();
            renderApp(); // Re-render to update both views
        });
    });

    // Export Excel
    exportBtn.addEventListener('click', exportToExcel);

    // Reset Name
    const resetNameBtn = document.getElementById('reset-name-btn');
    if (resetNameBtn) {
        resetNameBtn.addEventListener('click', resetUserName);
    }

    // Holiday Region Selection Dropdown
    countrySelect.addEventListener('change', async (e) => {
        if (isLocked) { countrySelect.value = ''; return; }
        const val = e.target.value;
        if (!val) return;
        if (!state.activeRegions) state.activeRegions = [];
        if (state.activeRegions.includes(val)) return;
        if (state.activeRegions.length >= 3) {
            alert("Maximum of 3 countries allowed. Please remove one first.");
            countrySelect.value = '';
            return;
        }
        addRegion(val);
        state = getFullState();
        countrySelect.value = '';
        saveState();
        await fetchActiveHolidays();
        renderApp();
    });

    // Delegated listener for removing active region holidays
    holidaySelectorLinks.addEventListener('click', (e) => {
        if (isLocked) return;
        if (e.target.classList.contains('remove-region')) {
            const code = e.target.closest('button').getAttribute('data-region');
            removeRegion(code);
            state = getFullState();
            saveState();
            renderApp();
        }
    });

    // Add Custom Holiday via Calendar
    calendarGrid.addEventListener('click', (e) => {
        if (isLocked) return;
        const dayEl = e.target.closest('.calendar-day');
        if (!dayEl || dayEl.classList.contains('empty')) return;
        
        // Prevent click if clicking inside an existing chip
        if (e.target.closest('.chip')) return;
        
        const dateStr = dayEl.getAttribute('data-date');
        if (!dateStr) return;
        
        const existing = (state.customHolidays && state.customHolidays[dateStr]) ? state.customHolidays[dateStr] : '';
        const name = prompt(`Add custom holiday for ${dateStr} (Leave blank to remove):`, existing);
        if (name !== null) {
            if (name.trim() === '') {
                removeCustomHoliday(dateStr);
            } else {
                setCustomHoliday(dateStr, name.trim());
            }
            state = getFullState();
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

/**
 * FIX #2 & #3: Safe rendering of calendar with proper text escaping
 */
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

        // Create header
        const headerDiv = document.createElement('div');
        headerDiv.className = 'day-header';
        
        const dayNumberDiv = document.createElement('div');
        dayNumberDiv.className = 'day-number';
        dayNumberDiv.textContent = day;
        headerDiv.appendChild(dayNumberDiv);
        
        if (holidayName) {
            const holidayDiv = document.createElement('div');
            holidayDiv.className = 'holiday-name';
            holidayDiv.title = holidayName;
            holidayDiv.textContent = holidayName; // SECURITY FIX: Use textContent for holiday names
            headerDiv.appendChild(holidayDiv);
        } else if (isWeekend) {
            const weekendDiv = document.createElement('div');
            weekendDiv.className = 'holiday-name';
            weekendDiv.style.background = 'var(--weekend-bg)';
            weekendDiv.style.color = 'var(--weekend)';
            weekendDiv.textContent = 'Weekend';
            headerDiv.appendChild(weekendDiv);
        }

        // Create chips container
        const chipsDiv = document.createElement('div');
        chipsDiv.className = 'leave-chips';
        
        getVisibleEmployees().forEach(emp => {
            const key = `${dateStr}_${emp.id}`;
            if (state.leaves[key]) {
                const type = state.leaves[key];
                const chip = document.createElement('div');
                chip.className = `chip chip-${type}`;
                const span = document.createElement('span');
                span.textContent = emp.name; // SECURITY FIX: Use textContent for employee names
                chip.appendChild(span);
                chipsDiv.appendChild(chip);
            }
        });

        dayEl.appendChild(headerDiv);
        dayEl.appendChild(chipsDiv);
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
    if (isLocked) return;
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2[...]
            </button>
        `;
        membersList.appendChild(li);
    });

    // Attach remove handlers
    document.querySelectorAll('.remove-member').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (isLocked) return;
            const id = e.target.closest('.remove-member').getAttribute('data-id');
            // Soft remove employee (set endYearMonth to current viewed month)
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            softDeleteEmployee(id, `${year}-${month}`);
            state = getFullState();
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

    // Prompt for username (needed for lock)
    currentUserName = getLockUserName();

    // 1. Try to open existing leavetracker.db
    try {
        dbFileHandle = await dirHandle.getFileHandle('leavetracker.db', { create: false });
        
        await loadFromFile(dbFileHandle);
        state = getFullState();
        if (!state.activeRegions || state.activeRegions.length === 0) {
            state.activeRegions = ['PH'];
        }

        createFileBtn.disabled = true;
        createFileBtn.classList.add('disabled-btn');
        createFileTooltip.textContent = 'Database connected';
        
        // Try to acquire the lock
        const lockResult = await acquireLock(dirHandle, currentUserName);
        if (lockResult.acquired) {
            setLockedMode(false, null);
            startHeartbeat();
        } else {
            setLockedMode(true, lockResult.holder);
        }

        renderApp();
        return;
    } catch (e) {
        if (e.name !== 'NotFoundError') {
            console.error('Error opening database file', e);
            return;
        }
    }

    // 2. No .db file found — check for legacy data.json to migrate
    try {
        const jsonHandle = await dirHandle.getFileHandle('data.json', { create: false });
        const file = await jsonHandle.getFile();
        const contents = await file.text();

        if (contents) {
            const jsonState = JSON.parse(contents);

            // Re-initialise a clean database and migrate
            await initDB();
            dbReady = true;
            migrateFromJSON(jsonState);

            // Save the new .db file
            dbFileHandle = await dirHandle.getFileHandle('leavetracker.db', { create: true });
            await saveToFileSystem();

            state = getFullState();
            if (!state.activeRegions || state.activeRegions.length === 0) {
                state.activeRegions = ['PH'];
            }

            // Acquire the lock (we just created the db, so we should get it)
            await acquireLock(dirHandle, currentUserName);
            startHeartbeat();
            updateConnectionStatus('connected');

            createFileBtn.disabled = true;
            createFileBtn.classList.add('disabled-btn');
            createFileTooltip.textContent = 'Database connected (migrated from data.json)';

            console.log('Successfully migrated data.json → leavetracker.db');
            renderApp();
            return;
        }
    } catch (e) {
        if (e.name !== 'NotFoundError') {
            console.error('Error reading data.json for migration', e);
        }
    }

    // 3. Neither file found — offer to create a new database
    dbFileHandle = null;
    updateConnectionStatus('local');
    
    createFileBtn.disabled = false;
    createFileBtn.classList.remove('disabled-btn');
    createFileTooltip.textContent = 'Click to create a new database';

    // Reset to clean state
    await initDB();
    dbReady = true;
    addRegion('PH');
    state = getFullState();
    renderApp();
    renderMembersList();
}