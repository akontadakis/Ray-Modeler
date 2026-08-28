/**
 * Static Tailwind build. Replaces the cdn.tailwindcss.com JIT script, which
 * Tailwind's own docs say not to ship and which was the only reason the CSP
 * needed 'unsafe-eval'. Rebuild with `npm run build:css` after adding classes.
 */
module.exports = {
  content: ['./index.html', './scripts/**/*.js'],
  theme: { extend: {} },
  plugins: [],
};
