/**
 * zkde.fi Launch Configuration
 * 
 * Set LAUNCH_DATE to your exact launch time.
 * The countdown timer will display time remaining until this date.
 */

// Option 1: Set a specific date/time (UTC)
// export const LAUNCH_DATE = new Date('2026-01-31T04:00:00Z');

// Option 2: Set a specific date/time (local timezone)
// export const LAUNCH_DATE = new Date('2026-01-31T04:00:00');

// Option 3: Set relative to now (e.g., 3 hours from deployment)
// export const LAUNCH_DATE = new Date(Date.now() + 3 * 60 * 60 * 1000);

// Current setting: Update this with your actual launch time
export const LAUNCH_DATE = new Date('2026-01-31T04:00:00Z'); // Example: Jan 31, 2026 at 4:00 AM UTC

// Helper: Get launch date from environment variable if set
export function getLaunchDate(): Date {
  if (process.env.NEXT_PUBLIC_LAUNCH_DATE) {
    return new Date(process.env.NEXT_PUBLIC_LAUNCH_DATE);
  }
  return LAUNCH_DATE;
}
