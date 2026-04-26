// =============================================================================
// lock.js — Application-level exclusive lock using a lock file on shared drive
// =============================================================================

const LOCK_FILENAME = 'leavetracker.lock';
const STALE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Get the stored username from localStorage, or prompt the user for one.
 * @returns {string} The username
 */
function getLockUserName() {
    let name = localStorage.getItem('leavetracker_username');
    if (!name) {
        name = prompt('Enter your name (used to identify who is editing):');
        if (name && name.trim()) {
            name = name.trim().substring(0, 30);
            localStorage.setItem('leavetracker_username', name);
        } else {
            name = 'Unknown User';
        }
    }
    return name;
}

/**
 * Read the current lock file contents.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Object|null} Parsed lock data, or null if no lock file exists
 */
async function checkLock(dirHandle) {
    try {
        const handle = await dirHandle.getFileHandle(LOCK_FILENAME, { create: false });
        const file = await handle.getFile();
        const text = await file.text();
        if (text) {
            return JSON.parse(text);
        }
        return null;
    } catch (e) {
        if (e.name === 'NotFoundError') return null;
        console.error('Error reading lock file', e);
        return null;
    }
}

/**
 * Check whether a lock's heartbeat is older than the stale timeout.
 * @param {Object} lockData - Parsed lock file contents
 * @returns {boolean} True if the lock is stale (heartbeat too old)
 */
function isLockStale(lockData) {
    if (!lockData || !lockData.heartbeat) return true;
    const heartbeatTime = new Date(lockData.heartbeat).getTime();
    const now = Date.now();
    return (now - heartbeatTime) > STALE_TIMEOUT_MS;
}

/**
 * Try to acquire the lock.
 * - If no lock file exists → create it → acquired
 * - If lock file exists but is stale → overwrite it → acquired
 * - If lock file exists and is fresh → not acquired (someone else is editing)
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} userName
 * @returns {Object} { acquired: boolean, holder?: string, since?: string }
 */
async function acquireLock(dirHandle, userName) {
    const existing = await checkLock(dirHandle);

    if (existing && !isLockStale(existing)) {
        // Someone else holds a fresh lock
        return {
            acquired: false,
            holder: existing.user,
            since: existing.since
        };
    }

    // No lock or stale lock — take over
    const lockData = {
        user: userName,
        since: new Date().toISOString(),
        heartbeat: new Date().toISOString()
    };

    try {
        const handle = await dirHandle.getFileHandle(LOCK_FILENAME, { create: true });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(lockData));
        await writable.close();
        return { acquired: true };
    } catch (e) {
        console.error('Failed to acquire lock', e);
        return { acquired: false, holder: 'Unknown', since: '' };
    }
}

/**
 * Release the lock by deleting the lock file.
 * @param {FileSystemDirectoryHandle} dirHandle
 */
async function releaseLock(dirHandle) {
    try {
        await dirHandle.removeEntry(LOCK_FILENAME);
    } catch (e) {
        // File may not exist — that's fine
        if (e.name !== 'NotFoundError') {
            console.error('Failed to release lock', e);
        }
    }
}

/**
 * Update the heartbeat timestamp in the lock file to signal the session is still active.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} userName
 */
async function updateHeartbeat(dirHandle, userName) {
    try {
        const existing = await checkLock(dirHandle);
        if (!existing || existing.user !== userName) {
            // Lock was taken by someone else or removed — don't overwrite
            return false;
        }

        const lockData = {
            user: userName,
            since: existing.since,
            heartbeat: new Date().toISOString()
        };

        const handle = await dirHandle.getFileHandle(LOCK_FILENAME, { create: true });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(lockData));
        await writable.close();
        return true;
    } catch (e) {
        console.error('Failed to update heartbeat', e);
        return false;
    }
}
