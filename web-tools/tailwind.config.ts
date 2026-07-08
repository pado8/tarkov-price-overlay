import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9ecff',
          500: '#2b7de9',
          600: '#1f66c9',
          700: '#1a52a3',
        },
      },
    },
  },
  plugins: [],
};

export default config;
