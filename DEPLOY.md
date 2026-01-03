# Deploying Metrics Tracker

## First-Time Setup

1. Create your Firebase hosting site (if not already done):

```bash
firebase hosting:sites:create your-site-id --project your-project-id
```

2. Create your `.firebaserc` file (gitignored, personal to you):

```bash
cp .firebaserc.example .firebaserc
```

3. Edit `.firebaserc` with your Firebase project and site:

```json
{
  "projects": {
    "default": "your-project-id"
  },
  "targets": {
    "your-project-id": {
      "hosting": {
        "production": [
          "your-site-id"
        ]
      }
    }
  }
}
```

**Example:** For project "vcihal" with site "metrics-tracker-vcihal":
```json
{
  "projects": {
    "default": "vcihal"
  },
  "targets": {
    "vcihal": {
      "hosting": {
        "production": [
          "metrics-tracker-vcihal"
        ]
      }
    }
  }
}
```

## Deploying

After setup, deploy with:

```bash
npm run deploy
```

Or directly:

```bash
npx firebase-tools deploy --only hosting
```

## Notes

- `firebase.json` uses generic target "production" (committed to repo)
- `.firebaserc` maps "production" to your actual site (gitignored, personal)
- This keeps the repository generic and shareable
- Each person deploying creates their own `.firebaserc` with their site info

