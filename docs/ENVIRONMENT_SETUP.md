# Environment Setup Guide

This guide covers local development environment setup for V FLOW AI.

## Prerequisites

### Required Software

| Software | Version | Notes |
|----------|---------|-------|
| Node.js | 20+ | LTS recommended |
| npm | 10+ | Comes with Node.js |
| Git | Latest | For version control |

### System Requirements

- **OS**: Windows 11, macOS, or Linux
- **RAM**: 8GB minimum, 16GB recommended
- **Disk**: 5GB free space minimum

### External Services

- **Firebase Project**: Authentication, Firestore, and Storage
- **Google Cloud Project**: Text-to-Speech API, Vertex AI
- **Cloudflare R2** (optional): Audio asset storage

## Installation

### 1. Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd voice-Flow

# Navigate to frontend and install dependencies
cd frontend
npm install
```

### 2. Environment Configuration

Copy the environment template:

```bash
# From the project root
cp .env.example .env.local
```

## Environment Variables

### Firebase Configuration (Required)

Configure these variables in `.env.local`:

```env
# Firebase Web SDK Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

### Firebase Admin Configuration (Backend)

Option A - Service Account File (Recommended):

```env
GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-adminsdk.json
```

Option B - Inline JSON:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

### Google Cloud TTS Configuration

```env
# TTS Provider Settings
VF_TTS_UPSTREAM_PROVIDER=texttospeech
VF_TTS_TEXTTOSPEECH_AUTH_MODE=google_cloud

# Default TTS Model
VF_AI_TEXT_DEFAULT_MODEL=gemini-2.5-flash-lite
```

### Cloudflare R2 Storage (Optional)

```env
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_BASE_URL=https://your-bucket.your-domain.com
```

### Development Settings

```env
# Development mode
VF_ENV=development
VF_DEV_BOOTSTRAP_MODE=cpu

# Auth enforcement (set to 0 for local dev bypass)
VF_AUTH_ENFORCE=1

# Enable dev features
NEXT_PUBLIC_ENABLE_RESOURCE_MONITOR=0
NEXT_PUBLIC_ENABLE_DEV_UID_HEADER=0
```

## Firebase Setup

### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" and follow the setup wizard
3. Enable Google Analytics (optional)

### 2. Enable Required Services

In the Firebase Console:

1. **Authentication**: Enable Email/Password and any other providers
2. **Firestore Database**: Create database in test mode initially
3. **Storage**: Enable for user uploads

### 3. Create Web App

1. Go to Project Settings > General
2. Click "Add app" > Web
3. Register app and copy config values to `.env.local`

### 4. Generate Service Account

1. Go to Project Settings > Service Accounts
2. Click "Generate new private key"
3. Save as `firebase-adminsdk.json` (do not commit to repo)
4. Set `GOOGLE_APPLICATION_CREDENTIALS` path in `.env.local`

### 5. Configure Firestore Security Rules

Deploy the security rules from [`frontend/firestore.rules`](frontend/firestore.rules.md):

```bash
firebase deploy --only firestore:rules
```

## Local Development

### Start Development Server

```bash
# From frontend directory
npm run dev
```

The application will be available at `http://localhost:3000`.

### Alternative Start Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Development with Turbopack (recommended) |
| `npm run dev:webpack` | Development with Webpack |
| `npm run dev:ui` | Same as `dev` with Turbopack |

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
```

### Running Tests

```bash
# Run all tests
npm run test:ci

# Run E2E smoke tests
npm run e2e:smoke
```

### Production Build

```bash
# Build for production
npm run build

# Start production server locally
npm run start
```

## Common Troubleshooting

### Environment Variables Not Loading

1. Ensure `.env.local` is in the project root (not in `frontend/`)
2. Restart the development server after changing env vars
3. Check that variable names start with `NEXT_PUBLIC_` for client-side access

### Firebase Authentication Errors

1. Verify Firebase config values are correct
2. Check that Authentication is enabled in Firebase Console
3. Ensure `VF_AUTH_ENFORCE=1` for proper auth flow
4. For local testing, you can set `VF_AUTH_ENFORCE=0` to bypass

### Firestore Permission Denied

1. Check Firestore security rules are deployed
2. Verify user is authenticated before accessing data
3. Check Firestore indexes if queries are failing

### Build Errors

```bash
# Clean frontend artifacts
npm run clean:frontend-artifacts

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Port Already in Use

If port 3000 is occupied:

```bash
# On Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# On macOS/Linux
lsof -i :3000
kill -9 <pid>
```

### TypeScript Errors

```bash
# Regenerate Next.js type definitions
npx next typegen

# Full type check
npm run typecheck
```

### Cloudflare Deployment Issues

```bash
# Verify Cloudflare Workers config
npm run cloudflare:verify

# Type generation for Cloudflare
npm run cf:typegen
```

## Development Workflow

### Recommended Workflow

1. **Start development server**: `npm run dev`
2. **Make changes** in the appropriate directory
3. **Run type check**: `npm run typecheck`
4. **Run linting**: `npm run lint`
5. **Run tests**: `npm run test:ci`
6. **Build**: `npm run build`

### Pre-Commit Checklist

```bash
# Run all checks
npm run typecheck && npm run lint && npm run test:ci
```

### Production Audit

```bash
# Full production audit
npm run audit:prod
```

This runs typecheck, lint, maintainability check, tests, and build.

## Additional Resources

- [Frontend Architecture](FRONTEND_ARCHITECTURE.md)
- [Firestore Collections Reference](../frontend/FIRESTORE_COLLECTIONS.md)
- [Full Project Audit](audits/FULL-PROJECT-AUDIT-2026-04-13.md)

## Getting Help

1. Check the troubleshooting section above
2. Review the audit documentation in `docs/audits/`
3. Check existing issues in the project tracker
