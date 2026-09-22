/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      colors: {
        // ── Wintermute NODE brand tokens ──────────────────────────────
        'wm-green':    '#00F554',  // Gibson green — primary actions & accents
        'wm-night':    '#070B09',  // Night green — nav background
        'wm-shadow':   '#151916',  // Shadow — dark surfaces
        'wm-charcoal': '#1C211E',  // Charcoal — nav hover / raised surfaces
        'wm-graphite': '#323935',  // Graphite — dark separators / borders
        'wm-ash':      '#606663',  // Ash — secondary text on dark bg
        'wm-frost':    '#D8DAD8',  // Frost — light borders on white bg
        'wm-horizon':  '#EFF0F0',  // Horizon — table heading rows
        'wm-offwhite': '#FAFAFA',  // Off-white — workspace background

        // Legacy aliases kept so any un-migrated slate/emerald refs still compile
        nav: {
          DEFAULT: '#070B09', // wm-night
          hover:   '#1C211E', // wm-charcoal
          border:  '#323935', // wm-graphite
        },
      },
    },
  },
  plugins: [],
};
