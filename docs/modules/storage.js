/**
 * AI-Maestro Browser Persistence Module
 * - LocalStorage for DSP knob values, presets, and bypass state
 * - IndexedDB for persisting user-uploaded audio files across browser reloads
 */

// Read-once fallback so a session saved under the pre-rebrand key is not lost.
// Gate exemption: this key must stay byte-exact for existing users' saved settings.
const LEGACY_SETTINGS_KEY = 'nasuno_engine_settings_v3';
const SETTINGS_KEY = 'maestro_settings_v1';
const DB_NAME = 'MaestroAudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'uploaded_tracks';
const AUDIO_RECORD_KEY = 'active_track';

export class PersistenceManager {
  /**
   * Save DSP knob values, preset key, and bypass flag.
   * @param {Object} settings
   */
  static saveSettings(settings = {}) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  }

  /**
   * Load saved DSP settings. Returns null if none found.
   * @returns {Object|null}
   */
  static loadSettings() {
    try {
      let data = localStorage.getItem(SETTINGS_KEY);
      if (!data) data = localStorage.getItem(LEGACY_SETTINGS_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.warn('LocalStorage load failed:', e);
      return null;
    }
  }

  /**
   * Clear saved DSP settings.
   */
  static clearSettings() {
    try {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(LEGACY_SETTINGS_KEY);
    } catch (e) {}
  }

  /**
   * Open IndexedDB instance with Promise wrapper.
   * @returns {Promise<IDBDatabase>}
   */
  static openDB() {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(new Error('IndexedDB not supported'));
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Run one transaction and resolve only when it is durable (fix 4):
   * tx.oncomplete, never the request's onsuccess; reject on abort/error;
   * always close the connection so it cannot block a version upgrade.
   * @param {string} mode
   * @param {(store: IDBObjectStore) => Promise<any>|any} action
   * @returns {Promise<any>}
   */
  static _runTx(mode, action) {
    return new Promise((resolve, reject) => {
      this.openDB().then((db) => {
        const finish = (err, val) => {
          try { db.close(); } catch (_) {}
          if (err) reject(err); else resolve(val);
        };
        const tx = db.transaction(STORE_NAME, mode);
        tx.oncomplete = () => finish(null, this._txResult);
        tx.onabort = () => finish(tx.error || new Error('IndexedDB transaction aborted'));
        tx.onerror = () => finish(tx.error || new Error('IndexedDB transaction failed'));
        try {
          const req = action(tx.objectStore(STORE_NAME));
          if (req && req.onsuccess !== undefined) {
            req.onsuccess = () => { this._txResult = req.result; };
            req.onerror = () => finish(req.error);
          }
        } catch (err) { finish(err); }
      }).catch(reject);
    });
  }

  /**
   * Save an uploaded audio File/Blob/ArrayBuffer to IndexedDB.
   * @param {ArrayBuffer|Blob|File} audioData
   * @param {string} fileName
   * @returns {Promise<boolean>}
   */
  static async saveUploadedAudio(audioData, fileName) {
    try {
      await this._runTx('readwrite', (store) =>
        store.put({ data: audioData, fileName, timestamp: Date.now() }, AUDIO_RECORD_KEY));
      return true;
    } catch (err) {
      console.warn('IndexedDB saveUploadedAudio error:', err);
      return false;
    }
  }

  /**
   * Load the active uploaded audio file from IndexedDB.
   * Returns { data, fileName, timestamp } or null.
   * @returns {Promise<Object|null>}
   */
  static async loadUploadedAudio() {
    try {
      const result = await this._runTx('readonly', (store) => store.get(AUDIO_RECORD_KEY));
      return result || null;
    } catch (err) {
      console.warn('IndexedDB loadUploadedAudio error:', err);
      return null;
    }
  }

  /**
   * Clear any persisted uploaded audio from IndexedDB.
   * @returns {Promise<void>}
   */
  static async clearUploadedAudio() {
    try {
      await this._runTx('readwrite', (store) => store.delete(AUDIO_RECORD_KEY));
    } catch (err) {
      console.warn('IndexedDB clearUploadedAudio error:', err);
    }
  }
}
