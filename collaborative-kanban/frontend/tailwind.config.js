/** Design tokens live as CSS variables in index.css; Tailwind maps them to utilities. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        mute: 'rgb(var(--mute) / <alpha-value>)',
        brand: { DEFAULT: 'rgb(var(--brand) / <alpha-value>)', soft: 'rgb(var(--brand-soft) / <alpha-value>)', ink: 'rgb(var(--brand-ink) / <alpha-value>)' },
        signal: 'rgb(var(--signal) / <alpha-value>)',
        danger: { DEFAULT: 'rgb(var(--danger) / <alpha-value>)', soft: 'rgb(var(--danger-soft) / <alpha-value>)' },
        ok: { DEFAULT: 'rgb(var(--ok) / <alpha-value>)', soft: 'rgb(var(--ok-soft) / <alpha-value>)' },
      },
      fontFamily: { display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'], sans: ['Figtree', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 1px 0 rgb(var(--line)), 0 1px 3px rgb(20 38 46 / 0.06)', lift: '0 12px 32px -8px rgb(20 38 46 / 0.28)' },
      keyframes: { slidein: { from: { transform: 'translateX(24px)', opacity: 0 }, to: { transform: 'none', opacity: 1 } }, pop: { from: { transform: 'scale(.97)', opacity: 0 }, to: { transform: 'none', opacity: 1 } } },
      animation: { slidein: 'slidein .18s ease-out', pop: 'pop .14s ease-out' },
    },
  },
  plugins: [],
};
