/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        proof: {
          pending: '#f59e0b',
          valid: '#34d399',
          generating: '#22d3ee',
        },
        privacy: {
          shielded: '#8b5cf6',
          revealed: '#a1a1aa',
        },
        surface: {
          0: '#09090b',
          1: '#18181b',
          2: '#27272a',
        }
      },
      animation: {
        'proof-pulse': 'proof-pulse 2s ease-in-out infinite',
        'shield-build': 'shield-build 1.5s ease-out',
        'success-pop': 'success-pop 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
      backdropBlur: {
        xs: '2px',
      },
      fontSize: {
        'display': ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
      }
    },
  },
  plugins: [],
};
