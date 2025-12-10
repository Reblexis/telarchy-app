# Metrics Tracker

A self-hostable personal metrics tracking application with formulas, dependencies, daily decay, and progress visualization. Built with vanilla JavaScript and Firebase.

## Features

- **XP/Rank System** - Track your overall progress with a unified XP score and rank
- **Formula Support** - Create derived metrics using mathematical formulas that reference other metrics
- **Dependency Tracking** - Automatically update dependent metrics when base values change
- **Daily Decay** - Optional automatic decay for metrics you want to maintain consistently
- **Focus Mode** - Zoom in on specific metrics and their dependency chain
- **Progress Graphs** - Visualize metric changes over time with Chart.js
- **Update History** - Timeline of all metric updates with descriptions
- **Depth-Based Organization** - Metrics automatically organized by dependency depth

## Quick Start

Total setup time: **~5-7 minutes**

### 1. Create a Firebase Project (2 minutes)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Add project"
3. Enter a project name (e.g., "my-metrics-tracker")
4. Disable Google Analytics (optional, not needed)
5. Click "Create project"

### 2. Enable Authentication (30 seconds)

1. In your Firebase project, go to **Build** → **Authentication**
2. Click "Get started"
3. Click on **Email/Password** in the Sign-in providers
4. Toggle "Enable" to ON
5. Click "Save"

### 3. Create Firestore Database (30 seconds)

1. Go to **Build** → **Firestore Database**
2. Click "Create database"
3. Select "Start in **production mode**" (we'll add rules next)
4. Choose a location close to you
5. Click "Enable"

### 4. Deploy Firestore Rules (1 minute)

**Option A: Via Console (Easiest)**

1. In Firestore Database, click on the **Rules** tab
2. Replace the entire content with the rules from `firestore.rules` in this repository
3. Click "Publish"

**Option B: Via Firebase CLI**

```bash
# Install Firebase CLI (if not already installed)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase in this directory
firebase init firestore
# Select your project
# Use existing firestore.rules file

# Deploy rules
firebase deploy --only firestore:rules
```

### 5. Get Your Firebase Config (30 seconds)

1. In Firebase Console, go to **Project Settings** (gear icon)
2. Scroll down to "Your apps" section
3. Click on **Web** icon (`</>`)
4. Register your app with a nickname (e.g., "Metrics Tracker Web")
5. Copy the `firebaseConfig` object (it looks like this):

```javascript
{
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
}
```

### 6. Launch the App (30 seconds)

**Option A: Local Development**

```bash
# Serve the public directory
cd public
python3 -m http.server 8000
# Or use any other static server
```

**Option B: Deploy to Firebase Hosting**

```bash
firebase init hosting
# Select your project
# Public directory: public
# Single page app: No
# Automatic builds: No

firebase deploy --only hosting
```

**Option C: Deploy to any static host**

Upload the `public/` directory to:
- Netlify
- Vercel  
- GitHub Pages
- Any web server

### 7. Configure the App (30 seconds)

1. Open the app in your browser
2. You'll be redirected to the setup page
3. Paste your Firebase config JSON
4. Click "Save Configuration"
5. You'll be redirected to the login page

### 8. Create Your Account (30 seconds)

1. Click "Don't have an account? Sign up"
2. Enter your email and password
3. Click "Sign Up"
4. You're in! Start tracking metrics.

## Usage Guide

### Creating Your First Metric

1. Scroll to "Add New Metric" section
2. Fill in:
   - **Metric Name**: e.g., "Deep Work Hours"
   - **Description**: Optional, what this metric represents
   - **Base Value**: Starting value (e.g., 0)
   - **Formula**: Leave as "0" for base metrics
   - **Enable daily decay**: Check if you want -1 per day when not updated
3. Click "Add Metric"

### Creating Derived Metrics

Derived metrics use formulas to calculate values from other metrics:

**Example 1: Simple Addition**
```
Name: Total Hours
Formula: {Deep Work} + {Exercise}
```

**Example 2: Weighted Sum**
```
Name: Productivity Score
Formula: {Deep Work} * 2 + {Reading} * 1.5
```

**Example 3: Complex Formula**
```
Name: Utility
Formula: ({Deep Work} + {Exercise}) * sqrt({Consistency})
```

**Available Functions:**
- `sqrt(x)` - Square root
- `abs(x)` - Absolute value
- `min(a, b)` - Minimum
- `max(a, b)` - Maximum
- `pow(x, y)` - Power (x^y)
- Standard operators: `+`, `-`, `*`, `/`, `()`, `^`

### Updating Metrics

1. Go to "Post Update" section
2. Select the metric
3. Enter the new base value
4. Add a description of what changed
5. Click "Post Update"

All dependent metrics will automatically recalculate!

### Focus Mode (Zoom)

Click "Zoom" on any metric to enter Focus Mode:
- Shows only that metric and its dependency chain
- Hides unrelated metrics
- Great for working on specific goals
- Click "Exit Focus Mode" to return

### Progress Graphs

Click "Graph" on any metric to see its value over time. Historical values are automatically logged when metrics change.

### Daily Decay

When enabled, metrics automatically lose 1 point per day since your last visit. Perfect for metrics like:
- Streak counters
- Consistency trackers
- Habits you want to maintain

### XP and Ranks

The XP system is based on a metric named "Utility". Create a metric called "Utility" with a formula that represents your overall productivity/progress:

```
Name: Utility
Formula: {Deep Work} * 10 + {Exercise} * 5 + {Reading} * 3
```

Ranks:
- **S Rank**: 900+ XP
- **A Rank**: 800-899 XP
- **B Rank**: 700-799 XP
- **C Rank**: 600-699 XP
- **D Rank**: 500-599 XP
- **E Rank**: 400-499 XP

## File Structure

```
metrics-tracker/
├── public/
│   ├── index.html           # Entry point / router
│   ├── setup.html           # Firebase configuration page
│   ├── login.html           # Login and signup page
│   ├── metrics.html         # Main application
│   ├── css/
│   │   └── style.css        # All styles
│   └── js/
│       ├── firebase-config.js  # Config management
│       └── app.js              # Main application logic
├── firestore.rules          # Database security rules
├── firebase.json            # Firebase hosting config (optional)
└── README.md                # This file
```

## Reconfiguring Firebase

If you need to switch to a different Firebase project:

1. In the app header, click "⚙️ Reconfigure Firebase"
2. Confirm the action
3. You'll be logged out and redirected to the setup page
4. Paste your new Firebase config

Your data remains in the original Firebase project and is not deleted.

## Data Storage

All data is stored in **your** Firebase Firestore database:

- `metrics` - Your metrics (name, value, formula, decay setting)
- `updates` - Update history with timestamps and descriptions
- `metricLogs` - Historical values for graphing
- `system` - System data (last decay date)

**Privacy**: Your data never leaves your Firebase project. It's completely under your control.

## Hosting Options

### Firebase Hosting (Recommended)

```bash
firebase init hosting
firebase deploy --only hosting
```

Your app will be available at: `https://your-project-id.web.app`

### Other Static Hosts

The app is a pure static site. Upload the `public/` directory to:

- **Netlify**: Drag & drop the public folder
- **Vercel**: `vercel public/`
- **GitHub Pages**: Push public/ to gh-pages branch
- **Any web server**: Copy public/ to your web root

### Local Development

```bash
cd public
python3 -m http.server 8000
# Then open http://localhost:8000
```

## Troubleshooting

### "Firebase config not found"

**Solution**: You need to complete the setup process. Visit `/setup.html` and paste your Firebase config.

### "Invalid email or password" on signup

**Possible causes**:
- Email/Password authentication not enabled in Firebase Console
- Password is less than 6 characters
- Email format is invalid

**Solution**: Check Firebase Console → Authentication → Sign-in method → Email/Password is enabled.

### Metrics not saving

**Possible causes**:
- Firestore rules not deployed
- Database not created

**Solution**: 
1. Go to Firebase Console → Firestore Database
2. Verify database exists
3. Check Rules tab - should match `firestore.rules` in this repo

### Charts not displaying

**Possible cause**: No historical data yet.

**Solution**: Metrics log values when they change. Update a metric a few times, then check the graph.

### Decay not working

**Possible causes**:
- Metric doesn't have "decay" enabled
- You've visited today already (decay applies once per day)

**Solution**: Enable decay when creating/editing metrics. Decay applies on your first visit each day.

### "Circular dependency" error

**Cause**: Formula creates a loop (e.g., A depends on B, B depends on A).

**Solution**: Restructure your formulas to avoid circular references.

## Security Notes

- **Authentication Required**: All Firestore operations require authentication
- **User Isolation**: If you want multi-user support, modify `firestore.rules` to add user-specific rules
- **API Key Public**: The Firebase API key in your config is safe to expose publicly (it's just an identifier, not a secret)
- **Production Mode**: Database starts in production mode with rules - this is correct and secure

## Advanced: Multi-User Setup

To allow multiple users with data isolation, update your `firestore.rules`:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Then modify the app to store data under `/users/{userId}/metrics`, etc.

## Contributing

This is an open-source project. Feel free to:
- Fork and customize for your needs
- Submit issues or pull requests
- Share your customizations

## License

MIT License - Use freely for personal or commercial projects.

## Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review Firebase Console for configuration issues
3. Open an issue on GitHub

---

**Built with**: Vanilla JavaScript, Firebase, Chart.js

**Hosting**: Works anywhere - Firebase, Netlify, Vercel, GitHub Pages, or your own server

**Cost**: Free (Firebase free tier is generous: 50k reads/day, 20k writes/day)

