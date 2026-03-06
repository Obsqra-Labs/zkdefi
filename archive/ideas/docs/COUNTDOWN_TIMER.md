# Countdown Timer Configuration

The zkde.fi landing page includes a countdown timer that shows time remaining until the alpha launch on Sepolia.

## Setting the Launch Date

### Option 1: Environment Variable (Recommended)

Set `NEXT_PUBLIC_LAUNCH_DATE` in your `.env.local` file:

```bash
# UTC time
NEXT_PUBLIC_LAUNCH_DATE=2026-01-31T04:00:00Z

# Or local time (no Z suffix)
NEXT_PUBLIC_LAUNCH_DATE=2026-01-31T04:00:00
```

Then restart the frontend:
```bash
cd frontend
npm run dev
```

### Option 2: Edit Config File

Edit `frontend/src/lib/launch-config.ts`:

```typescript
export const LAUNCH_DATE = new Date('2026-01-31T04:00:00Z');
```

Then rebuild:
```bash
cd frontend
npm run dev
```

## Date Format Examples

**Specific UTC time:**
```typescript
new Date('2026-01-31T04:00:00Z')
// Jan 31, 2026 at 4:00 AM UTC
```

**Specific local time:**
```typescript
new Date('2026-01-31T04:00:00')
// Jan 31, 2026 at 4:00 AM in your timezone
```

**Relative to now:**
```typescript
new Date(Date.now() + 3 * 60 * 60 * 1000)
// 3 hours from now
```

## Countdown Display

**Before launch:**
- Shows countdown in days, hours, minutes, seconds
- Updates every second
- Clean, minimal design with card layout

**After launch:**
- Automatically switches to "Alpha Live on Sepolia" with animated green dot
- No manual switching needed

## Styling

The countdown timer uses:
- Dark theme (zinc-900 cards)
- Emerald accent for "live" indicator
- Tabular numbers for consistent digit width
- Responsive sizing (smaller on mobile)

## Quick Start

1. Copy `.env.example` to `.env.local`:
   ```bash
   cd frontend
   cp .env.example .env.local
   ```

2. Edit `.env.local` and set your launch date:
   ```bash
   NEXT_PUBLIC_LAUNCH_DATE=2026-01-31T04:00:00Z
   ```

3. Start the frontend:
   ```bash
   npm run dev
   ```

4. Visit http://localhost:3001 to see the countdown

## Production Deployment

When deploying to zkde.fi, ensure `NEXT_PUBLIC_LAUNCH_DATE` is set in your hosting environment variables (Hostinger, Vercel, etc.).

The timer will automatically count down and switch to "live" when the time comes!
