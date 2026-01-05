# Firebase Export Setup Guide

This guide explains how to export your SQLite bookmarks database to Firestore in the "crumbs" project.

## Prerequisites

- Firebase CLI installed (already available)
- Access to the "crumbs" Firebase project
- SQLite database exported (`out/bookmarks.db`)

## Authentication Options

### Option 1: Application Default Credentials (Recommended)

This is the easiest method for local development:

```bash
# Login to Firebase
firebase login

# Set up application default credentials
gcloud auth application-default login

# Verify you have access to crumbs-a4fdb project
firebase projects:list
```

### Option 2: Service Account Key

For production/CI environments:

1. **Generate Service Account Key:**
   ```bash
   # Go to Firebase Console
   https://console.firebase.google.com/project/crumbs-a4fdb/settings/serviceaccounts

   # Click "Generate new private key"
   # Save as: crumbs-serviceAccountKey.json
   ```

2. **Add to .gitignore:**
   ```bash
   echo "crumbs-serviceAccountKey.json" >> .gitignore
   ```

3. **Use with export:**
   ```bash
   npm run firebase:export -- --service-account=./crumbs-serviceAccountKey.json
   ```

## Usage

### 1. Dry Run (Recommended First Step)

Test the export without writing to Firestore:

```bash
npm run firebase:export:dry-run
```

This will:
- ✓ Validate SQLite database exists
- ✓ Read all tables
- ✓ Show what would be exported
- ✓ Display statistics
- ✗ NOT write to Firestore

### 2. Export Metadata Only (Without Images)

Export all bookmark data except base64 images:

```bash
npm run firebase:export
```

This exports:
- ✓ Users (2,298 records)
- ✓ Tweets (3,561 records)
- ✓ Metrics (engagement data)
- ✓ Media metadata (URLs, dimensions)
- ✓ Annotations (links, mentions)
- ✗ Base64 images (~400MB - skipped)

**Size estimate:** ~50MB in Firestore

### 3. Export Everything (Including Images)

⚠️ **WARNING:** This will upload ~400MB of base64 image data to Firestore!

```bash
npm run firebase:export:with-media
```

**Cost impact:**
- Firestore storage: ~400MB × $0.18/GB/month = ~$0.07/month
- Network egress when querying: expensive if images accessed frequently
- Better alternative: Use Cloud Storage for images (see below)

### 4. Custom Export Options

```bash
# Different project
npm run firebase:export -- --project=my-other-project

# Different database
npm run firebase:export -- --db=path/to/other.db

# Smaller batch size (if you hit rate limits)
npm run firebase:export -- --batch-size=100
```

## Firestore Collections Created

After export, your Firestore will have these collections:

```
/users/{userId}
  - userId: string
  - username: string
  - name: string
  - description: string
  - verified: boolean
  - followersCount: number
  ...

/tweets/{tweetId}
  - tweetId: string
  - authorId: string  (→ references /users/{userId})
  - text: string
  - createdAt: string
  - order: number
  ...

/metrics/{tweetId}
  - tweetId: string  (→ references /tweets/{tweetId})
  - likeCount: number
  - retweetCount: number
  ...

/media/{mediaKey}
  - mediaKey: string
  - type: "photo" | "video"
  - url: string
  - width: number
  - height: number
  ...

/mediaContent/{mediaKey}  (if --include-media)
  - mediaKey: string  (→ references /media/{mediaKey})
  - base64Data: string  (⚠️ large!)
  - mimeType: string
  - sizeBytes: number
  ...
```

## Better Alternative: Cloud Storage for Images

Instead of storing base64 in Firestore, consider Cloud Storage:

```bash
# 1. Export metadata to Firestore (without images)
npm run firebase:export

# 2. Upload images to Cloud Storage (TODO: create this script)
# npm run storage:upload-images

# 3. Update media documents with storage URLs
# gsutil cp out/images/* gs://crumbs.appspot.com/bookmarks/media/
```

Benefits:
- Much cheaper for large files
- Better performance
- Built-in CDN
- Easier to serve directly to users

## Troubleshooting

### Error: "Permission denied"

```bash
# Re-authenticate
firebase login
gcloud auth application-default login
```

### Error: "Project not found"

```bash
# List available projects
firebase projects:list

# Use correct project ID
npm run firebase:export -- --project=your-actual-project-id
```

### Error: "Database not found"

```bash
# Make sure you've exported the database first
npm run extract:sqlite

# Check the file exists
ls -lh out/bookmarks.db
```

### Error: "Quota exceeded"

```bash
# Use smaller batch size
npm run firebase:export -- --batch-size=100

# Or wait a few minutes and retry
```

## Firestore Security Rules

⚠️ **IMPORTANT:** Add security rules to protect your data!

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Lock down by default
    match /{document=**} {
      allow read, write: if false;
    }

    // Allow authenticated users to read bookmarks
    match /tweets/{tweetId} {
      allow read: if request.auth != null;
    }

    match /users/{userId} {
      allow read: if request.auth != null;
    }

    // Add more rules as needed...
  }
}
```

## View Your Data

After export, view in Firebase Console:

```
https://console.firebase.google.com/project/crumbs-a4fdb/firestore
```

## Clean Up

If you need to delete the exported data:

```bash
# Option 1: Firebase Console
# Go to Firestore → Delete each collection

# Option 2: Firebase CLI (TODO: create cleanup script)
# npm run firebase:cleanup
```

## Next Steps

1. ✓ Run dry-run to validate
2. ✓ Export metadata (without images)
3. ✓ Verify data in Firebase Console
4. ✓ Set up security rules
5. ✓ Build your app to query Firestore
6. 📋 Consider migrating images to Cloud Storage

## Support

For issues:
1. Check troubleshooting section above
2. Verify Firebase permissions
3. Check Firebase Console logs
4. Review error messages carefully
