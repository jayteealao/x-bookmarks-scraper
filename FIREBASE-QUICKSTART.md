# Firebase Export - Quick Start

## TL;DR

```bash
# 1. Authenticate with Google Cloud
gcloud auth application-default login

# 2. Test export (no actual writes)
npm run firebase:export:dry-run

# 3. Export to Firestore (without images)
npm run firebase:export

# 4. View in Firebase Console
open https://console.firebase.google.com/project/crumbs-a4fdb/firestore
```

## What Gets Exported

Based on your current database (395MB with 1,617 images):

### WITHOUT Images (Recommended)
```
✓ 2,298 users
✓ 3,561 tweets
✓ 3,561 metrics (engagement data)
✓ 2,624 media metadata (URLs, dimensions)
✓ 2,641 relationships
✓ 1,149 text annotations

Total: ~18,458 documents
Firestore size: ~50MB
Cost: ~$0.01/month storage
```

### WITH Images (--include-media)
```
⚠️ Same as above PLUS:
✓ 1,617 base64 images (~400MB)

Total: ~20,075 documents
Firestore size: ~450MB
Cost: ~$0.08/month storage + network egress
```

## Firestore Structure

```
crumbs (Firebase project)
  └─ firestore
      ├─ users/
      │   └─ {userId}
      │       ├─ username: "elonmusk"
      │       ├─ name: "Elon Musk"
      │       └─ verified: true
      ├─ tweets/
      │   └─ {tweetId}
      │       ├─ authorId: "12345"  → /users/12345
      │       ├─ text: "Hello world!"
      │       └─ createdAt: "2024-01-01..."
      ├─ media/
      │   └─ {mediaKey}
      │       ├─ type: "photo"
      │       ├─ url: "https://pbs.twimg.com/..."
      │       └─ width: 1200
      └─ mediaContent/  (if --include-media)
          └─ {mediaKey}
              ├─ base64Data: "iVBORw0KGgo..."
              └─ mimeType: "image/png"
```

## Authentication

You need Google Cloud credentials to write to Firestore:

```bash
# Install gcloud CLI if not already installed
# https://cloud.google.com/sdk/docs/install

# Login and set up application default credentials
gcloud auth application-default login

# Follow browser prompt to authenticate
# Select your Google account with access to "crumbs" project
```

## Commands

```bash
# Dry run (recommended first)
npm run firebase:export:dry-run

# Export without images (recommended)
npm run firebase:export

# Export with images (expensive!)
npm run firebase:export:with-media

# Help
npx tsx src/firebase-export.ts --help
```

## Querying in Your App

### TypeScript/JavaScript Example

```typescript
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, orderBy } from 'firebase/firestore';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Get tweets by author
const tweetsRef = collection(db, 'tweets');
const q = query(
  tweetsRef,
  where('authorId', '==', 'some-user-id'),
  orderBy('order', 'desc')
);

// Get user profile
const userRef = doc(db, 'users', userId);
const userSnap = await getDoc(userRef);

// Get tweet with media
const tweetRef = doc(db, 'tweets', tweetId);
const mediaRef = collection(db, 'mediaKeys');
const mediaQuery = query(mediaRef, where('tweetId', '==', tweetId));
```

## Cost Estimate

Based on Firestore pricing (as of 2024):

### Without Images
- Storage: 50MB × $0.18/GB/month = ~$0.01/month
- Reads: First 50k/day free, then $0.06 per 100k reads
- Writes: First 20k/day free, then $0.18 per 100k writes

### With Images
- Storage: 450MB × $0.18/GB/month = ~$0.08/month
- Network egress: Can get expensive if images accessed frequently
- **Better option:** Use Cloud Storage for images (~$0.02/GB/month)

## Tips

1. **Start with dry-run** to validate before writing
2. **Export without images** first (cheaper, faster)
3. **Use Cloud Storage for images** instead of Firestore
4. **Set up security rules** to protect your data
5. **Add indexes** in Firebase Console for complex queries

## Troubleshooting

### "Permission denied"
```bash
gcloud auth application-default login
```

### "Database not found"
```bash
# Run extraction first
npm run extract:sqlite
```

### "Quota exceeded"
```bash
# Wait a few minutes or use smaller batches
npm run firebase:export -- --batch-size=100
```

## Next Steps

After export:
1. View data in Firebase Console
2. Set up Firestore security rules
3. Add indexes for your queries
4. Build your app to query the data
5. Consider migrating images to Cloud Storage

## Full Documentation

See [FIREBASE-SETUP.md](./FIREBASE-SETUP.md) for complete details.
