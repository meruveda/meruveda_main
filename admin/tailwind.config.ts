/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50:  '#fdf9ed',
          100: '#faf0cc',
          200: '#f5de96',
          300: '#efc95a',
          400: '#e8b530',
          500: '#c9971a',
          600: '#b07c12',
          700: '#8d5f10',
          800: '#744d13',
          900: '#614115',
          950: '#382108',
        },
        sidebar: {
          DEFAULT: '#2B1820',
          hover:   '#3d2230',
          active:  '#c9971a',
          text:    '#c8a97a',
          border:  '#4a2535',
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card:  '0 1px 3px 0 rgba(0,0,0,.06), 0 1px 2px -1px rgba(0,0,0,.06)',
        'card-hover': '0 4px 16px 0 rgba(201,151,26,.15)',
        glow:  '0 0 24px rgba(201,151,26,.3)',
      },
      animation: {
        'fade-in':    'fadeIn .25s ease',
        'slide-in':   'slideIn .3s ease',
        'scale-in':   'scaleIn .2s ease',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' },                    to: { opacity: '1' } },
        slideIn: { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        scaleIn: { from: { transform: 'scale(.95)', opacity: '0' },      to: { transform: 'scale(1)', opacity: '1' } },
      },
    },
  },
  plugins: [],
}
