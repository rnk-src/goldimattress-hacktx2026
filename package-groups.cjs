/**
 * The one place that says which packages are pure and which need a DOM.
 * Read by vitest.config.ts, eslint.config.js and .dependency-cruiser.cjs.
 */
module.exports = {
  // No DOM use allowed. `listings` does not exist yet; the boundary tests already cover it.
  purePackages: ['domain', 'signal', 'session', 'listings'],
  // Tests of these packages run under happy-dom.
  domPackages: ['sensors', 'store', 'coach', 'app'],
};
