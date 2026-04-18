import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AudioChunk, SavedBook, PlaybackState } from '../../features/library/model/types';

interface LibraryDB extends DBSchema {
  books: {
    key: string;
    value: SavedBook;
    indexes: { 'by-date': number };
  };
  audioChunks: {
    key: string;
    value: AudioChunk;
    indexes: { 'by-book': string; 'by-timestamp': number };
  };
  playbackState: {
    key: string;
    value: PlaybackState;
  };
  cache: {
    key: string;
    value: { key: string; data: Blob; timestamp: number };
  };
}

class BookStorageService {
  private dbPromise: Promise<IDBPDatabase<LibraryDB>> | null = null;
  private readonly DB_NAME = 'vf-library';
  private readonly DB_VERSION = 1;
  private readonly MAX_BOOKS = 3;

  async initDB() {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = openDB<LibraryDB>(this.DB_NAME, this.DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains('books')) {
            const bookStore = db.createObjectStore('books', { keyPath: 'id' });
            bookStore.createIndex('by-date', 'savedAt');
          }
          if (!db.objectStoreNames.contains('audioChunks')) {
            const chunkStore = db.createObjectStore('audioChunks', { keyPath: 'id' });
            chunkStore.createIndex('by-book', 'bookId');
            chunkStore.createIndex('by-timestamp', 'timestamp');
          }
          if (!db.objectStoreNames.contains('playbackState')) {
            db.createObjectStore('playbackState', { keyPath: 'bookId' });
          }
          if (!db.objectStoreNames.contains('cache')) {
            db.createObjectStore('cache', { keyPath: 'key' });
          }
        }
      },
    });

    return this.dbPromise;
  }

  async saveBook(book: SavedBook): Promise<boolean> {
    const db = await this.initDB();
    const count = await db.count('books');

    if (count >= this.MAX_BOOKS) {
      throw new Error(
        `Storage limit reached: Maximum ${this.MAX_BOOKS} books allowed. Delete a book to save another.`
      );
    }

    await db.put('books', book);
    return true;
  }

  async getBook(bookId: string | number): Promise<SavedBook | null> {
    const db = await this.initDB();
    return (await db.get('books', String(bookId))) || null;
  }

  async getAllBooks(): Promise<SavedBook[]> {
    const db = await this.initDB();
    return db.getAll('books');
  }

  async deleteBook(bookId: string | number): Promise<void> {
    const db = await this.initDB();
    await db.delete('books', String(bookId));

    const allChunks = await db.getAllFromIndex('audioChunks', 'by-book', String(bookId));
    for (const chunk of allChunks) {
      await db.delete('audioChunks', chunk.id);
    }
    await db.delete('playbackState', String(bookId));
  }

  async saveAudioChunk(chunk: AudioChunk): Promise<void> {
    const db = await this.initDB();
    await db.put('audioChunks', chunk);
  }

  async getAudioChunk(chunkId: string): Promise<AudioChunk | null> {
    const db = await this.initDB();
    return (await db.get('audioChunks', chunkId)) || null;
  }

  async getAudioChunksByBook(bookId: string | number): Promise<AudioChunk[]> {
    const db = await this.initDB();
    return db.getAllFromIndex('audioChunks', 'by-book', String(bookId));
  }

  async savePlaybackState(state: PlaybackState): Promise<void> {
    const db = await this.initDB();
    await db.put('playbackState', state);
  }

  async getPlaybackState(bookId: string | number): Promise<PlaybackState | null> {
    const db = await this.initDB();
    return (await db.get('playbackState', String(bookId))) || null;
  }

  async cacheData(key: string, data: Blob): Promise<void> {
    const db = await this.initDB();
    await db.put('cache', { key, data, timestamp: Date.now() });
  }

  async getCachedData(key: string): Promise<Blob | null> {
    const db = await this.initDB();
    const cached = await db.get('cache', key);
    return cached?.data || null;
  }

  async getStorageQuota(): Promise<{ used: number; limit: number }> {
    const db = await this.initDB();
    const books = await db.getAll('books');
    const used = books.reduce((sum, book) => sum + (book.totalSize || 0), 0);

    let limit = 500 * 1024 * 1024;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        if (estimate.quota) {
          limit = Math.floor(estimate.quota * 0.5);
        }
      } catch {
        // fallback to default
      }
    }

    return { used, limit };
  }

  async getBookCount(): Promise<number> {
    const db = await this.initDB();
    return db.count('books');
  }

  async clearAll(): Promise<void> {
    const db = await this.initDB();
    await db.clear('books');
    await db.clear('audioChunks');
    await db.clear('playbackState');
    await db.clear('cache');
  }
}

export const bookStorage = new BookStorageService();
