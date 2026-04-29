/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cmu: {
          red:  '#C41230',
          dark: '#1a1a2e',
          gray: '#f4f5f7',
        },
      },
    },
  },
  plugins: [],
}

