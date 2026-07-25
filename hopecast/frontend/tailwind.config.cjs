/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0d0a14',
        panel: '#1a1424',
        panelAlt: '#241a33',
        gold: '#c9a24b',
        cream: '#f3ead9',
      },
    },
  },
  plugins: [],
};
