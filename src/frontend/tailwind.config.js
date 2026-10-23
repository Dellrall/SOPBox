/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: { colors: { orbyte: { blue: '#0864e8', navy: '#1e3a62', surface: '#f3f7ff' } } } },
  plugins: []
};
