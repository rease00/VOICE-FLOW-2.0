# Firestore Collections Reference

## Core Collections

### `users/{uid}`
- `displayName`: string
- `email`: string
- `isAdmin`: boolean
- `vnBalance`: number (default 0)
- `kycStatus`: `'none' | 'pending' | 'verified' | 'rejected'`
- `referralCode`: string (generated on first login)
- `bankDetails`: `{ accountNumber, ifsc, beneficiaryName }`
- `signupBonusCredited`: boolean (default false)
- `favoriteBooks`: string[] (book IDs)
- `wallets.vffBalance`: number (free VF)
- `wallets.paidVfBalance`: number (purchased VF)
- `wallets.vcFreeBalance`: number
- `wallets.vcPaidBalance`: number

### `publishedBooks/{bookId}`
- `title`: string
- `description`: string (max 2000 chars)
- `genre`: string
- `language`: string
- `coverUrl`: string (sanitized URL)
- `authorId`: string (uid)
- `authorName`: string
- `status`: `'draft' | 'pending_review' | 'published' | 'unpublished' | 'rejected'`
- `pricing.chapterPrice`: number (VN per chapter)
- `pricing.fullNovelPrice`: number (VN for full novel)
- `pricing.currency`: `'VN'`
- `aggregatedRating`: number (0-5)
- `totalRatings`: number
- `totalReads`: number
- `publishedAt`: Timestamp
- `updatedAt`: Timestamp

### `publishedBooks/{bookId}/chapters/{chapterId}`
- `index`: number (0-based)
- `title`: string
- `driveDocId`: string (Google Drive doc reference)
- `summary`: string
- `audioR2Key`: string (R2 cached audio key)
- `price`: number (VN, 0 = free)
- `charCount`: number

### `domainJobs/{jobId}`
- Canonical async job collection for active domains such as `audioNovel`, `voiceClone`, and future media tasks.

## Financial Collections

### `transactions/{txId}`
- `userId`: string
- `type`: `'vn_purchase' | 'chapter_unlock' | 'full_novel_unlock' | 'author_earning' | 'withdrawal' | 'refund' | 'daily_free_unlock' | 'signup_bonus'`
- `amount`: number
- `tokenType`: `'VN' | 'VF' | 'VC'`
- `status`: `'pending' | 'completed' | 'failed' | 'refunded'`
- `timestamp`: string (ISO)
- `metadata`: `{ bookId?, chapterId?, packKey?, withdrawalId?, razorpayOrderId?, reason? }`

### `withdrawals/{wId}`
- `userId`: string
- `vnAmount`: number
- `inrAmount`: number (vnAmount / 10)
- `platformFee`: number (2% of inrAmount)
- `netAmount`: number (inrAmount - platformFee)
- `bankDetails`: `{ accountNumber, ifsc, beneficiaryName }`
- `status`: `'pending' | 'processing' | 'completed' | 'failed'`
- `createdAt`: string (ISO)
- `processedAt`: string (ISO, optional)
- `completedAt`: string (ISO, optional)
- `razorpayPayoutId`: string (optional)
- `error`: string (optional)

## Social Collections

### `ratings/{ratingId}`
- `bookId`: string
- `chapterId`: string (optional — book-level if absent)
- `userId`: string
- `stars`: number (1-5)
- `timestamp`: string (ISO)

### `referrals/{rId}`
- `referrerId`: string (uid)
- `referredUserId`: string (uid)
- `code`: string
- `status`: `'pending' | 'qualified' | 'rewarded'`
- `createdAt`: string (ISO)
- `rewardedAt`: string (ISO, optional)

### `notifications/{userId}/items/{notifId}`
- `type`: string (event code)
- `title`: string
- `message`: string
- `read`: boolean
- `readAt`: number (timestamp, nullable)
- `dismissedAt`: number (timestamp, nullable)
- `createdAt`: number (timestamp)
- `severity`: `'success' | 'info' | 'warning' | 'error'`
- `metadata`: object (optional, varies by type)

### `agreements/{aId}`
- `userId`: string
- `signedAt`: string (ISO)
- `version`: string
- `ipAddress`: string
- `signatureHash`: string

### `dailyUnlocks/{userId}/{date}`
- `chapterId`: string
- `bookId`: string
- `unlockedAt`: string (ISO)

### `chapterUnlocks/{unlockId}`
- `userId`: string
- `bookId`: string
- `chapterId`: string
- `unlocked`: boolean
- `unlockedAt`: string (ISO)
- `method`: `'purchase' | 'full_novel' | 'daily_free'`

### `kyc/{kycId}`
- `userId`: string
- `status`: `'pending' | 'verified' | 'rejected'`
- `documentType`: string
- `submittedAt`: string (ISO)
- `verifiedAt`: string (ISO, optional)
