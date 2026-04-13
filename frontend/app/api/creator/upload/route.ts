import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { isR2Configured, r2Client, R2_BUCKET_NAME, warnIfR2NotConfigured } from '../../../../src/lib/r2';
import crypto from 'crypto';

// ============================================================================
// CONFIGURATION & CONSTANTS - SECURITY HARDENED
// ============================================================================

const ALLOWED_MIME_TYPES = ['application/pdf', 'text/plain', 'text/markdown', 'application/epub+zip'] as const;
const ALLOWED_EXTENSIONS = ['pdf', 'txt', 'md', 'epub'] as const;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_DRAFT_QUOTA_PER_USER = 3;

// Magic bytes for file type verification (first 4-8 bytes)
const FILE_MAGIC_BYTES: Record<string, readonly number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  txt: [[0xef, 0xbb, 0xbf], [0xff, 0xfe], [0xfe, 0xff]], // UTF-8 BOM, UTF-16 variants
  md: [[0xef, 0xbb, 0xbf], [0xff, 0xfe], [0xfe, 0xff]], // Same as txt
  epub: [[0x50, 0x4b, 0x03, 0x04]], // ZIP header (EPUB is ZIP-based)
};

// ============================================================================
// HELPER FUNCTIONS - SECURITY VALIDATION
// ============================================================================

/**
 * Validate MIME type against allowlist
 */
function validateMimeType(mimeType: string | null): { valid: boolean; error?: string } {
  if (!mimeType) return { valid: false, error: 'MIME type is required' };
  const normalized = String(mimeType).toLowerCase().trim();
  const isAllowed = ALLOWED_MIME_TYPES.some((allowed) => normalized === allowed);
  if (!isAllowed) {
    return {
      valid: false,
      error: `Invalid MIME type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
    };
  }
  return { valid: true };
}

/**
 * Validate file extension against allowlist
 */
function validateFileExtension(filename: string): { valid: boolean; extension?: string; error?: string } {
  if (!filename || typeof filename !== 'string') {
    return { valid: false, error: 'Filename is required' };
  }
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) {
    return { valid: false, error: 'File must have an extension' };
  }
  const extension = parts[parts.length - 1];
  const isAllowed = ALLOWED_EXTENSIONS.some((allowed) => extension === allowed);
  if (!isAllowed) {
    return {
      valid: false,
      error: `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }
  return extension ? { valid: true, extension } : { valid: true };
}

/**
 * Check file magic bytes to verify actual file type
 */
function verifyMagicBytes(buffer: Buffer, extension: string): { valid: boolean; error?: string } {
  if (buffer.length === 0) {
    return { valid: false, error: 'File is empty' };
  }

  const magicSignatures = FILE_MAGIC_BYTES[extension.toLowerCase()];
  if (!magicSignatures) {
    return { valid: false, error: 'Unknown file type for magic byte verification' };
  }

  const isMagicBytesMatch = magicSignatures.some((signature) => {
    if (buffer.length < signature.length) return false;
    for (let i = 0; i < signature.length; i++) {
      if (buffer[i] !== signature[i]) return false;
    }
    return true;
  });

  if (!isMagicBytesMatch) {
    return {
      valid: false,
      error: `File magic bytes do not match ${extension.toUpperCase()} format. Possible file type mismatch or tampered file.`,
    };
  }
  return { valid: true };
}

/**
 * Generate a secure random filename (remove user-supplied filename from being used directly)
 */
function generateSecureFilename(extension: string): string {
  const randomUUID = crypto.randomUUID();
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(4).toString('hex');
  return `${randomUUID}-${timestamp}-${randomBytes}.${extension}`;
}

/**
 * Check if creator upload route is enabled (development only)
 */
function isCreatorUploadRouteEnabled(): boolean {
  const raw = String(process.env.VF_ENABLE_CREATOR_UPLOAD_ROUTE || '').trim().toLowerCase();
  const enabled = raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  return enabled && process.env.NODE_ENV !== 'production';
}

/**
 * In-memory quota tracking (TEMPORARY - should use Firestore in production)
 * WARNING: This resets on server restart and doesn't persist across instances
 * TODO: Migrate to Firestore for persistent quota enforcement
 */
let mockNovelDraftCounts: Record<string, number> = {};

// ============================================================================
// MAIN POST HANDLER - SECURITY HARDENED
// ============================================================================

export async function POST(req: NextRequest) {
  if (!isCreatorUploadRouteEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    // ========================================================================
    // 1. PARSE REQUEST & EXTRACT DATA
    // ========================================================================
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const authorId = formData.get('authorId') as string | null;
    const isPublishing = formData.get('isPublishing') === 'true';

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided', code: 'NO_FILE' },
        { status: 400 }
      );
    }

    // ========================================================================
    // 2. VALIDATE FILE SIZE
    // ========================================================================
    const fileSize = file.size;
    if (fileSize === 0) {
      return NextResponse.json(
        { error: 'File is empty', code: 'EMPTY_FILE' },
        { status: 400 }
      );
    }
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      const maxSizeMB = MAX_FILE_SIZE_BYTES / (1024 * 1024);
      return NextResponse.json(
        {
          error: `File exceeds maximum size of ${maxSizeMB}MB. Current size: ${(fileSize / (1024 * 1024)).toFixed(2)}MB`,
          code: 'FILE_TOO_LARGE',
          maxSizeBytes: MAX_FILE_SIZE_BYTES,
          fileSizeBytes: fileSize,
        },
        { status: 413 } // 413 Payload Too Large
      );
    }

    // ========================================================================
    // 3. VALIDATE MIME TYPE
    // ========================================================================
    const mimeTypeValidation = validateMimeType(file.type);
    if (!mimeTypeValidation.valid) {
      return NextResponse.json(
        { error: mimeTypeValidation.error, code: 'INVALID_MIME_TYPE' },
        { status: 400 }
      );
    }

    // ========================================================================
    // 4. VALIDATE FILE EXTENSION
    // ========================================================================
    const extensionValidation = validateFileExtension(file.name);
    if (!extensionValidation.valid) {
      return NextResponse.json(
        { error: extensionValidation.error, code: 'INVALID_EXTENSION' },
        { status: 400 }
      );
    }

    const safeExtension = extensionValidation.extension!;

    // ========================================================================
    // 5. READ FILE & VERIFY MAGIC BYTES
    // ========================================================================
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const magicBytesValidation = verifyMagicBytes(buffer, safeExtension);
    if (!magicBytesValidation.valid) {
      return NextResponse.json(
        { error: magicBytesValidation.error, code: 'INVALID_FILE_CONTENT' },
        { status: 400 }
      );
    }

    // ========================================================================
    // 6. VALIDATE AUTHOR ID OWNERSHIP
    // ========================================================================
    // SECURITY: Ensure authorId is provided and is a valid string
    const normalizedAuthorId = String(authorId || '').trim();
    if (!normalizedAuthorId) {
      return NextResponse.json(
        { error: 'Author ID is required', code: 'MISSING_AUTHOR_ID' },
        { status: 400 }
      );
    }

    // SECURITY: In production, verify authorId matches authenticated user UID
    // This would be done via Firebase token verification in middleware
    console.info(`[UPLOAD] Author: ${normalizedAuthorId}, File: ${file.name}, Size: ${fileSize} bytes`);

    // ========================================================================
    // 7. CHECK DRAFT QUOTA (temporary in-memory tracking)
    // ========================================================================
    if (!isPublishing) {
      const currentDraftCount = mockNovelDraftCounts[normalizedAuthorId] || 0;
      if (currentDraftCount >= MAX_DRAFT_QUOTA_PER_USER) {
        return NextResponse.json(
          {
            error: `Draft quota exceeded. Maximum ${MAX_DRAFT_QUOTA_PER_USER} unpublished drafts allowed per user. Publish or delete an existing draft to upload a new one.`,
            code: 'QUOTA_EXCEEDED',
            currentDraftCount,
            maxQuota: MAX_DRAFT_QUOTA_PER_USER,
          },
          { status: 429 } // 429 Too Many Requests
        );
      }
      // Increment mock draft counter
      mockNovelDraftCounts[normalizedAuthorId] = currentDraftCount + 1;
    }

    // ========================================================================
    // 8. UPLOAD FILE TO R2 WITH SECURE FILENAME
    // ========================================================================
    const secureFilename = generateSecureFilename(safeExtension);
    const objectKey = `novels/${normalizedAuthorId}/${secureFilename}`;

    if (!isR2Configured) {
      warnIfR2NotConfigured('Creator upload storage');
      return NextResponse.json(
        { error: 'Storage unavailable: R2 is not configured.', code: 'STORAGE_UNAVAILABLE' },
        { status: 503 }
      );
    }

    try {
      const uploadCommand = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: objectKey,
        Body: buffer,
        ContentType: file.type,
        Metadata: {
          'original-filename': file.name.substring(0, 255), // Limit length for safety
          'upload-timestamp': new Date().toISOString(),
          'author-id': normalizedAuthorId.substring(0, 255),
        },
      });

      await r2Client.send(uploadCommand);

      const shareLink = `https://${process.env.NEXT_PUBLIC_APP_DOMAIN || 'v-flow-ai.com'}/novel/${secureFilename.split('.')[0]}`;

      return NextResponse.json(
        {
          success: true,
          message: isPublishing ? 'Novel successfully published!' : 'Draft safely stored in R2 (Max 3 allowed).',
          url: `https://pub-${R2_BUCKET_NAME}.r2.dev/${objectKey}`,
          shareLink: isPublishing ? shareLink : null,
          objectKey,
          uploadedFilename: secureFilename,
        },
        { status: 200 }
      );
    } catch (uploadError) {
      console.error('R2 upload error:', uploadError);
      return NextResponse.json(
        { error: 'File upload to storage failed. Please try again.', code: 'UPLOAD_FAILED' },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error('Upload handler error:', err);
    return NextResponse.json(
      {
        error: 'An unexpected error occurred during file upload',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 }
    );
  }
}
