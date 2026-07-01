/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"Hanken Grotesk"', 'sans-serif'],
      },
      // Los @keyframes viven en index.css (para estar disponibles también en
      // animations arbitrarias e inline). Acá sólo los atajos animate-*.
      animation: {
        fadeUp: 'fadeUp .4s ease',
        slideUp: 'slideUp .3s ease',
        slideDown: 'slideDown .3s ease',
        popIn: 'popIn .5s ease both',
        heartbeat: 'heartbeat 2.6s ease-in-out infinite',
        dotPulse: 'dotPulse 2s ease-in-out infinite',
        glowPulse: 'glowPulse 3s ease infinite',
        spin: 'spin .8s linear infinite',
        fadeIn: 'fadeIn .3s ease',
      },
    },
  },
  plugins: [],
};
