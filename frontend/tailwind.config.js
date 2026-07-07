/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        theater: '#0B0B0D',
        charcoal: '#161619',
        ink: '#1F1F23',
        screen: '#F4F4F5',
        reel: '#8A8A93',
        'reel-dim': '#5C5C63',
        whisper: 'rgba(244,244,245,0.08)',
        ember: '#D64A3F',
        'ember-dim': 'rgba(214,74,63,0.14)',
        'ember-bloom': 'rgba(214,74,63,0.45)',
        error: '#C25A4A',
        'id-jo': '#7E9471',
        'id-vale': '#B0687A',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['Geist', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        fadeUp: 'fadeUp .4s ease',
        slideUp: 'slideUp .3s ease',
        slideDown: 'slideDown .3s ease',
        popIn: 'popIn .5s ease both',
        heartbeat: 'heartbeat 2.6s ease-in-out infinite',
        dotPulse: 'dotPulse 2s ease-in-out infinite',
        spin: 'spin .8s linear infinite',
        fadeIn: 'fadeIn .3s ease',
        bloom: 'bloom .8s ease both',
      },
    },
  },
  plugins: [],
};
