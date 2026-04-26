// =============================================================================
// db.js — SQLite data access layer using sql.js (WebAssembly)
// =============================================================================

const DB_FILENAME = 'leavetracker.db';

// FIX #5: Define valid leave types whitelist for input validation
const VALID_LEAVE_TYPES = ['AL', 'AA', 'AP', 'SL', 'SA', 'SP', 'EL', 'EA', 'EP', 'BL', 'OL', 'ML', 'PL'];

let _db = null; // sql.js Database instance

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize sql.js and create an empty in-memory database with schema.
 * Call this once at application startup.
 */
async function initDB() {
    const SQL = await initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/${file}`
    });
    _db = new SQL.Database();
    _createTables();
    return _db;
}

/**
 * Create tables if they don't already exist.
 */
function _createTables() {
    _db.run(`
        CREATE TABLE IF NOT EXISTS employees (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            end_year_month TEXT
        );
    `);
    _db.run(`
        CREATE TABLE IF NOT EXISTS leaves (
            date TEXT NOT NULL,
            employee_id TEXT NOT NULL,
            leave_type TEXT NOT NULL,
            PRIMARY KEY (date, employee_id),
            FOREIGN KEY (employee_id) REFERENCES employees(id)
        );
    `);
    _db.run(`
        CREATE TABLE IF NOT EXISTS active_regions (
            region_code TEXT PRIMARY KEY
        );
    `);
    _db.run(`
        CREATE TABLE IF NOT EXISTS custom_holidays (
            date TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );
    `);
}

// ---------------------------------------------------------------------------
// File System I/O
// ---------------------------------------------------------------------------

/**
 * Load an existing .db file from the file system into sql.js.
 * @param {FileSystemFileHandle} fileHandle
 */
async function loadFromFile(fileHandle) {
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    const SQL = await initSqlJs({
        locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/${f}`
    });
    if (_db) _db.close();
    _db = new SQL.Database(new Uint8Array(buffer));
    // Ensure tables exist (in case the file is from an older version)
    _createTables();
}

/**
 * Export the current in-memory database and write it to the file system.
 * @param {FileSystemFileHandle} fileHandle
 */
async function saveToFile(fileHandle) {
    if (!_db) return;
    const data = _db.export(); // Uint8Array
    const blob = new Blob([data], { type: 'application/x-sqlite3' });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
}

// ---------------------------------------------------------------------------
// Migration from JSON
// ---------------------------------------------------------------------------

/**
 * Import data from the old JSON state format into the SQLite database.
 * @param {Object} jsonState - Parsed contents of the old data.json
 */
function migrateFromJSON(jsonState) {
    if (!_db) throw new Error('Database not initialized');

    _db.run('BEGIN TRANSACTION');
    try {
        // Employees
        if (jsonState.employees && Array.isArray(jsonState.employees)) {
            const stmt = _db.prepare('INSERT OR REPLACE INTO employees (id, name, end_year_month) VALUES (?, ?, ?)');
            jsonState.employees.forEach(emp => {
                stmt.run([emp.id, emp.name, emp.endYearMonth || null]);
            });
            stmt.free();
        }

        // Leaves — keys are "YYYY-MM-DD_employeeId", values are leave type strings
        if (jsonState.leaves && typeof jsonState.leaves === 'object') {
            const stmt = _db.prepare('INSERT OR REPLACE INTO leaves (date, employee_id, leave_type) VALUES (?, ?, ?)');
            Object.entries(jsonState.leaves).forEach(([key, type]) => {
                const separatorIdx = key.indexOf('_');
                if (separatorIdx === -1) return; // malformed key
                const date = key.substring(0, separatorIdx);
                const empId = key.substring(separatorIdx + 1);
                stmt.run([date, empId, type]);
            });
            stmt.free();
        }

        // Active Regions
        if (jsonState.activeRegions && Array.isArray(jsonState.activeRegions)) {
            const stmt = _db.prepare('INSERT OR REPLACE INTO active_regions (region_code) VALUES (?)');
            jsonState.activeRegions.forEach(code => {
                stmt.run([code]);
            });
            stmt.free();
        }

        // Custom Holidays
        if (jsonState.customHolidays && typeof jsonState.customHolidays === 'object') {
            const stmt = _db.prepare('INSERT OR REPLACE INTO custom_holidays (date, name) VALUES (?, ?)');
            Object.entries(jsonState.customHolidays).forEach(([date, name]) => {
                stmt.run([date, name]);
            });
            stmt.free();
        }

        _db.run('COMMIT');
    } catch (e) {
        _db.run('ROLLBACK');
        throw e;
    }
}

// ---------------------------------------------------------------------------
// Employees CRUD
// ---------------------------------------------------------------------------

function getEmployees() {
    const results = [];
    const stmt = _db.prepare('SELECT id, name, end_year_month FROM employees ORDER BY name');
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push({
            id: row.id,
            name: row.name,
            endYearMonth: row.end_year_month || undefined
        });
    }
    stmt.free();
    return results;
}

function addEmployee(id, name) {
    _db.run('INSERT INTO employees (id, name) VALUES (?, ?)', [id, name]);
}

function softDeleteEmployee(id, endYearMonth) {
    _db.run('UPDATE employees SET end_year_month = ? WHERE id = ?', [endYearMonth, id]);
}

// ---------------------------------------------------------------------------
// Leaves CRUD
// ---------------------------------------------------------------------------

/**
 * Get all leaves as a flat object matching the old state.leaves format:
 *   { "YYYY-MM-DD_employeeId": "AL", ... }
 */
function getLeaves() {
    const result = {};
    const stmt = _db.prepare('SELECT date, employee_id, leave_type FROM leaves');
    while (stmt.step()) {
        const row = stmt.getAsObject();
        result[`${row.date}_${row.employee_id}`] = row.leave_type;
    }
    stmt.free();
    return result;
}

/**
 * Get leaves for a specific month only (performance optimisation).
 * @param {number} year
 * @param {number} month - 1-indexed (1 = January)
 */
function getLeavesForMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const result = {};
    const stmt = _db.prepare("SELECT date, employee_id, leave_type FROM leaves WHERE date LIKE ? || '%'");
    stmt.bind([prefix]);
    while (stmt.step()) {
        const row = stmt.getAsObject();
        result[`${row.date}_${row.employee_id}`] = row.leave_type;
    }
    stmt.free();
    return result;
}

/**
 * Set a leave record with validation.
 * FIX #5: Add leave type whitelist validation
 * @param {string} date - YYYY-MM-DD format
 * @param {string} employeeId
 * @param {string} leaveType - Must be in VALID_LEAVE_TYPES
 */
function setLeave(date, employeeId, leaveType) {
    // SECURITY FIX: Validate leave type against whitelist
    if (!VALID_LEAVE_TYPES.includes(leaveType)) {
        throw new Error(`Invalid leave type: ${leaveType}. Must be one of: ${VALID_LEAVE_TYPES.join(', ')}`);
    }
    _db.run(
        'INSERT OR REPLACE INTO leaves (date, employee_id, leave_type) VALUES (?, ?, ?)',
        [date, employeeId, leaveType]
    );
}

function clearLeave(date, employeeId) {
    _db.run('DELETE FROM leaves WHERE date = ? AND employee_id = ?', [date, employeeId]);
}

// ---------------------------------------------------------------------------
// Active Regions CRUD
// ---------------------------------------------------------------------------

function getActiveRegions() {
    const results = [];
    const stmt = _db.prepare('SELECT region_code FROM active_regions ORDER BY region_code');
    while (stmt.step()) {
        results.push(stmt.getAsObject().region_code);
    }
    stmt.free();
    return results;
}

function addRegion(code) {
    _db.run('INSERT OR IGNORE INTO active_regions (region_code) VALUES (?)', [code]);
}

function removeRegion(code) {
    _db.run('DELETE FROM active_regions WHERE region_code = ?', [code]);
}

// ---------------------------------------------------------------------------
// Custom Holidays CRUD
// ---------------------------------------------------------------------------

function getCustomHolidays() {
    const result = {};
    const stmt = _db.prepare('SELECT date, name FROM custom_holidays ORDER BY date');
    while (stmt.step()) {
        const row = stmt.getAsObject();
        result[row.date] = row.name;
    }
    stmt.free();
    return result;
}

function setCustomHoliday(date, name) {
    _db.run('INSERT OR REPLACE INTO custom_holidays (date, name) VALUES (?, ?)', [date, name]);
}

function removeCustomHoliday(date) {
    _db.run('DELETE FROM custom_holidays WHERE date = ?', [date]);
}

// ---------------------------------------------------------------------------
// Convenience: full state object (backward-compatible with rendering code)
// ---------------------------------------------------------------------------

/**
 * Build and return the full state object in the same shape as the old JSON format.
 * This allows the rendering code to remain unchanged.
 */
function getFullState() {
    return {
        employees: getEmployees(),
        leaves: getLeaves(),
        activeRegions: getActiveRegions(),
        customHolidays: getCustomHolidays()
    };
}

/**
 * Check whether the database has been initialized.
 */
function isDBReady() {
    return _db !== null;
}