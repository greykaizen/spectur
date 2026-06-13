/**
 * DOM Video Detector using MutationObservers and Shadow DOM traversal.
 */

export function observeVideos(
  onVideoAdded: (video: HTMLVideoElement) => void,
  onVideoRemoved: (video: HTMLVideoElement) => void
): { cleanup: () => void } {
  const observedVideos = new Set<HTMLVideoElement>();
  const activeShadowObservers = new Map<ShadowRoot, MutationObserver>();

  // Pierces Shadow DOM to discover videos
  function scan(root: ParentNode) {
    if (!root) return;

    // 1. Direct video search
    const videos = root.querySelectorAll('video');
    videos.forEach((video) => {
      if (!observedVideos.has(video)) {
        observedVideos.add(video);
        onVideoAdded(video);
      }
    });

    // 2. Traversal & Shadow Root Piercing
    // Look at all elements in this subtree
    const elements = root.querySelectorAll('*');
    elements.forEach((el) => {
      if (el.shadowRoot) {
        // Scan the shadow root recursively
        scan(el.shadowRoot);
        
        // Observe changes inside this shadow root if we aren't already
        setupShadowObserver(el.shadowRoot);
      }
    });
  }

  function setupShadowObserver(shadowRoot: ShadowRoot) {
    if (activeShadowObservers.has(shadowRoot)) return;

    const observer = new MutationObserver(() => {
      scan(shadowRoot);
      pruneRemovedVideos();
    });

    observer.observe(shadowRoot, {
      childList: true,
      subtree: true,
    });

    activeShadowObservers.set(shadowRoot, observer);
  }

  function pruneRemovedVideos() {
    for (const video of observedVideos) {
      // Check if video is still present in the document
      let isAttached = false;
      
      // Check document body or active shadow roots
      if (document.contains(video)) {
        isAttached = true;
      } else {
        // Search inside observed shadow roots
        for (const [shadow] of activeShadowObservers) {
          if (shadow.contains(video)) {
            isAttached = true;
            break;
          }
        }
      }

      if (!isAttached) {
        observedVideos.delete(video);
        onVideoRemoved(video);
      }
    }
  }

  // MutationObserver for document.documentElement
  const mainObserver = new MutationObserver((mutations) => {
    let shouldScan = false;
    
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
    }
    
    if (shouldScan) {
      scan(document);
    }
    pruneRemovedVideos();
  });

  // Start observing main document
  mainObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Run initial scan
  scan(document);

  // Poll fallback for dynamic SPAs (e.g. YouTube virtual navigations)
  const pollInterval = setInterval(() => {
    scan(document);
    pruneRemovedVideos();
  }, 1500);

  function cleanup() {
    clearInterval(pollInterval);
    mainObserver.disconnect();
    activeShadowObservers.forEach((obs) => obs.disconnect());
    activeShadowObservers.clear();
    
    // Cleanup any lingering overlays
    observedVideos.forEach((video) => {
      onVideoRemoved(video);
    });
    observedVideos.clear();
  }

  return {
    cleanup,
  };
}
