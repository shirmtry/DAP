// frontend/indexeddb-helper.js
const DB_NAME = 'AttendanceDB';
const STORE_NAME = 'students';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (ev) => {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function getStudentsFromCache() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        return new Promise((resolve, reject) => {
            const all = store.getAll();
            all.onsuccess = () => resolve(all.result);
            all.onerror = () => reject(all.error);
        });
    } catch (e) {
        return null;
    }
}

export async function saveStudentsToCache(students) {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        await Promise.all(students.map(s => store.put(s)));
        return true;
    } catch (e) {
        return false;
    }
}