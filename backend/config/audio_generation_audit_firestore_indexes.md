# Audio Generation Audit Firestore Indexes

Collection: `audio_generation_audit`

Recommended indexes:

- `submittedAt` descending
- `uid` ascending, `submittedAt` descending
- `userId` ascending, `submittedAt` descending
- `paymentRef` ascending, `submittedAt` descending
- `status` ascending, `submittedAt` descending

These indexes support the admin search and retention workflows added for the
5-year audio metadata compliance store.
