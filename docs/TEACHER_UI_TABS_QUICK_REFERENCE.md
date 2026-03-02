# Teacher Dashboard Tabs - Quick Reference

## Tab Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  👥 Monitor  │  🔗 Chains (2)  │  📸 Capture  │  🤖 Quiz (●)  │  ⚙️ Session  │
└─────────────────────────────────────────────────────────────────┘
```

## Tab 1: 👥 Monitor (Default)

**Purpose:** Real-time attendance tracking

**What you see:**
- 📥 Show Entry QR button
- 📤 Show Exit QR button
- 4 stat cards: Total Students, Online Now, Present Entry, Late Entry
- Student attendance table with:
  - Student ID
  - Online status (🟢/⚪)
  - Chain holder indicator (🎯)
  - Attendance status
  - Location warnings (⚠️)
  - Entry time & method

**When to use:** During class to monitor who's present

---

## Tab 2: 🔗 Chains

**Purpose:** Chain management and troubleshooting

**What you see:**
- Start Entry Chains button
- Start Exit Chains button
- Close All Chains button
- Chain status list with stall indicators
- Chain visualization

**Badge:** Shows count of stalled chains (e.g., "2" in red)

**When to use:** When chains stall or need management

---

## Tab 3: 📸 Capture

**Purpose:** Photo capture and seating verification

**What you see:**
- Initiate Image Capture button
- Capture status and countdown
- Snapshot Manager (list/compare snapshots)
- Capture History viewer

**When to use:** To verify student seating with photos

---

## Tab 4: 🤖 Quiz

**Purpose:** AI-powered live quiz system

**What you see:**
- Start/Stop Screen Share button
- Capture frequency selector (15s - 5min)
- Quiz statistics:
  - Captures count
  - Questions generated
  - Questions sent
  - Next capture countdown

**Badge:** Shows "●" in green when quiz is active

**Important:** Quiz continues running in background when you switch tabs!

**When to use:** During lectures to auto-generate quiz questions

---

## Tab 5: ⚙️ Session

**Purpose:** Session administration and controls

**What you see:**
- Session details (Class ID, Status, Times, Cutoffs)
- Constraints (Geofence, WiFi allowlist)
- End Session button
- Export Attendance button

**When to use:** To end session or export data

---

## Quick Tips

### Multitasking
1. Start quiz on Quiz tab
2. Switch to Monitor tab to watch attendance
3. Quiz continues capturing in background
4. Green "●" badge shows it's still active

### Stall Alerts
- Red badge on Chains tab shows stall count
- Click Chains tab to resolve stalls
- Badge disappears when resolved

### Tab Memory
- Dashboard remembers your last active tab
- Refresh page → returns to same tab
- Different sessions → independent tab memory

### Mobile Usage
- Tabs wrap to multiple rows on small screens
- Swipe horizontally to see all tabs
- All features work on mobile

---

## Keyboard Shortcuts (Future)

Coming soon:
- `Ctrl+1` → Monitor tab
- `Ctrl+2` → Chains tab
- `Ctrl+3` → Capture tab
- `Ctrl+4` → Quiz tab
- `Ctrl+5` → Session tab

---

## Common Workflows

### Starting a Class
1. Monitor tab → Show Entry QR
2. Watch students join in real-time
3. (Optional) Quiz tab → Start screen share

### During Class
1. Monitor tab → Check attendance
2. Chains tab → Manage any stalls
3. Quiz tab → Monitor question generation

### Ending a Class
1. Monitor tab → Show Exit QR
2. Wait for students to scan out
3. Session tab → End Session → Export

### Photo Verification
1. Capture tab → Initiate Image Capture
2. Wait for students to upload
3. Snapshot Manager → Compare photos
4. Verify seating arrangement

---

## Troubleshooting

**Tab not switching?**
- Check browser console for errors
- Refresh page

**Quiz not capturing?**
- Check Quiz tab for "● ACTIVE" badge
- Verify screen share permission granted
- Check countdown timer

**Real-time updates not working?**
- Check connection status (🟢 Live / 🔴 Disconnected)
- Refresh page to reconnect

**Stalled chains?**
- Red badge shows count
- Go to Chains tab
- Click "Close All Chains" if needed

---

## Visual Indicators

| Indicator | Meaning |
|-----------|---------|
| 🟢 Live | SignalR connected, real-time updates working |
| 🟡 Connecting... | Attempting to connect |
| 🔴 Disconnected | No real-time updates, polling fallback |
| 🟢 Online | Student currently connected |
| ⚪ Offline | Student disconnected |
| 🎯 Holder | Student currently holds a chain |
| ⚠️ Warning | GPS/location issue |
| 🔗 Chain | Verified via chain |
| 📱 QR | Verified via QR code |
| ● ACTIVE | Quiz is running |
| (2) | Badge count (e.g., 2 stalled chains) |

---

**Last Updated:** 2026-02-28
