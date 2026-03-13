/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Linear-inspired neutral palette
        // All colors meet WCAG 2.1 AA contrast requirements (4.5:1 minimum on #0d0d0d)
        background: '#0d0d0d',
        foreground: '#f5f5f5',
        muted: '#8a8a8a', // 5.1:1 contrast on background
        border: '#262626',
        accent: '#2e8bc9', // USWDS blue lightened for dark bg (5.21:1 contrast)
        'accent-hover': '#3d97d3', // Hover variant (6.12:1 contrast)
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
