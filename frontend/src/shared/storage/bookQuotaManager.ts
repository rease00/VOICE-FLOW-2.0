import { bookStorage } from './bookStorage';

export class BookQuotaManager {
  private readonly MAX_BOOKS = 3;
  private readonly MAX_STORAGE = 500 * 1024 * 1024;

  async checkQuota(): Promise<{
    canAddMore: boolean;
    bookCount: number;
    storageUsed: number;
    storageLimit: number;
    percentage: number;
    message: string;
  }> {
    const bookCount = await bookStorage.getBookCount();
    const { used, limit } = await bookStorage.getStorageQuota();

    const canAddMore = bookCount < this.MAX_BOOKS && used < this.MAX_STORAGE;
    const percentage = limit > 0 ? (used / limit) * 100 : 100;

    let message = '';
    if (bookCount >= this.MAX_BOOKS) {
      message = `Maximum ${this.MAX_BOOKS} books saved. Delete a book to save another.`;
    } else if (used >= this.MAX_STORAGE) {
      message = `Storage limit reached (${(used / 1024 / 1024).toFixed(1)}MB/${(limit / 1024 / 1024).toFixed(1)}MB). Delete a book to free up space.`;
    } else if (percentage > 80) {
      message = `Storage running low: ${percentage.toFixed(1)}% used.`;
    }

    return { canAddMore, bookCount, storageUsed: used, storageLimit: limit, percentage, message };
  }

  async canSaveBook(): Promise<{ allowed: boolean; reason?: string }> {
    const quota = await this.checkQuota();
    if (!quota.canAddMore) {
      return { allowed: false, reason: quota.message };
    }
    return { allowed: true };
  }
}

export const bookQuotaManager = new BookQuotaManager();
