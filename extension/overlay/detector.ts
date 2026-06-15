/**
 * DOM Video Detector using MutationObservers and Shadow DOM traversal.
 */

export function observeVideos(
  onVideoAdded: (video: HTMLVideoElement) => void,
  onVideoRemoved: (video: HTMLVideoElement) => void
): { cleanup: () => void } {
  const observedVideos = new Set<HTMLVideoElement>();
  const activeShadowObservers = new Map<ShadowRoot, MutationObserver>();

  // Optimized Element-only recursive tree walker (O(N) traversal)
  function scan(node: Node) {
    if (!node) return;

    const type = node.nodeType;
    // Walk only Element, Document, and ShadowRoot (DocumentFragment) nodes
    if (
      type !== Node.ELEMENT_NODE &&
      type !== Node.DOCUMENT_NODE &&
      type !== Node.DOCUMENT_FRAGMENT_NODE
    ) {
      return;
    }

    if (type === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.tagName === 'VIDEO') {
        const video = el as HTMLVideoElement;
        if (!observedVideos.has(video)) {
          observedVideos.add(video);
          onVideoAdded(video);
        }
      }
      if (el.shadowRoot) {
        scan(el.shadowRoot);
        setupShadowObserver(el.shadowRoot);
      }
    }

    // Recurse into children
    let child = node.firstChild;
    while (child) {
      scan(child);
      child = child.nextSibling;
    }
  }

  function setupShadowObserver(shadowRoot: ShadowRoot) {
    if (activeShadowObservers.has(shadowRoot)) return;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          scan(node);
        });
      });
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
      let isAttached = false;
      
      if (document.contains(video)) {
        isAttached = true;
      } else {
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
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        scan(node);
      });
    });
    pruneRemovedVideos();
  });

  // Start observing main document
  mainObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Run initial scan
  scan(document);

  // Poll fallback for dynamic SPAs, wrapped in requestAnimationFrame to prevent layout thrashing
  const pollInterval = setInterval(() => {
    requestAnimationFrame(() => {
      scan(document);
      pruneRemovedVideos();
    });
  }, 1500);

  function cleanup() {
    clearInterval(pollInterval);
    mainObserver.disconnect();
    activeShadowObservers.forEach((obs) => obs.disconnect());
    activeShadowObservers.clear();
    
    observedVideos.forEach((video) => {
      onVideoRemoved(video);
    });
    observedVideos.clear();
  }

  return {
    cleanup,
  };
}
