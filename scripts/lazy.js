import ENV from './utils/env.js';

async function loadSidekick() {
  const getSk = () => document.querySelector('aem-sidekick');

  const sk = getSk() || await new Promise((resolve) => {
    document.addEventListener('sidekick-ready', () => resolve(getSk()));
  });
  if (sk) import('../tools/sidekick/sidekick.js').then((mod) => mod.default(sk));
}

/**
 * Adobe personalization layer. Loaded in order: the Web SDK installs
 * window.alloy (inert unless websdk-* metadata is set), personalization starts
 * deriving an audience from concierge + quote activity, then the ?demo panel
 * wraps alloy in its capture shim so the inspector sees everything after it.
 */
async function loadPersonalization() {
  const [{ default: initWebSDK }, { default: initPersonalization }] = await Promise.all([
    import('./websdk.js'),
    import('./personalization.js'),
  ]);
  initWebSDK();
  initPersonalization();

  // The visible payoff: a persona-labelled product strip above the grid.
  const { default: initRecommended } = await import('./recommended.js');
  initRecommended();

  const demo = await import('./demo-panel.js');
  if (demo.demoEnabled()) demo.default();
}

(function loadLazy() {
  import('./utils/lazyhash.js');
  import('./utils/favicon.js');
  import('./utils/footer.js').then(({ default: footer }) => footer());
  loadPersonalization();

  // Author facing tools
  if (ENV !== 'prod') {
    import('../tools/scheduler/scheduler.js');
    loadSidekick();
  }
}());
