import { getMetadata } from './ak.js';

/**
 * Metadata-gated Adobe Web SDK (alloy) loader.
 *
 * Config is author-controlled via the site metadata sheet (same convention as
 * the concierge-* / commerce-* keys), so no code change is needed to wire a
 * real Adobe org:
 *   websdk-datastream    Datastream (edge config) id — PRESENCE GATES loading
 *   websdk-org-id        IMS Org id (XXtoo@AdobeOrg)
 *   websdk-edge-domain   first-party edge domain (optional)
 *   websdk-src           alloy CDN url (optional override / version pin)
 *
 * Inert until a datastream + org id are set, so shipping this changes nothing
 * today. When configured, it installs the `window.alloy` command queue
 * SYNCHRONOUSLY (so consumers always find a callable `window.alloy`),
 * configures it, then loads the library async to drain the queue.
 */

const DATASTREAM = getMetadata('websdk-datastream');
const ORG_ID = getMetadata('websdk-org-id');
const EDGE_DOMAIN = getMetadata('websdk-edge-domain');
const ALLOY_SRC = getMetadata('websdk-src')
  || 'https://cdn1.adoberesources.net/alloy/2.26.0/alloy.min.js';

let started = false;

export default function initWebSDK() {
  // Gated: do nothing until a real datastream + org id are configured.
  if (started || !DATASTREAM || !ORG_ID) return;
  started = true;

  // 1. Synchronous command-queue shim — window.alloy is callable immediately,
  //    before any block decorates; the real library replaces it on load.
  if (typeof window.alloy !== 'function') {
    // __alloyNS is the vendor-required registry the library reads on load to
    // find and hydrate the queued instance.
    /* eslint-disable no-underscore-dangle */
    window.__alloyNS = window.__alloyNS || [];
    window.__alloyNS.push('alloy');
    /* eslint-enable no-underscore-dangle */
    window.alloy = (...args) => new Promise((resolve, reject) => {
      window.alloy.q.push([resolve, reject, args]);
    });
    window.alloy.q = [];
  }

  // 2. Configure (queued until the library loads).
  const config = {
    datastreamId: DATASTREAM,
    orgId: ORG_ID,
    defaultConsent: 'in',
  };
  if (EDGE_DOMAIN) config.edgeDomain = EDGE_DOMAIN;
  window.alloy('configure', config);

  // 3. Load the library async; it processes the queued commands.
  const script = document.createElement('script');
  script.src = ALLOY_SRC;
  script.async = true;
  document.head.append(script);
}
