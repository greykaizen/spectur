/**
 * Geometry tracker to keep the overlay aligned with the video element dynamically.
 */

export function getPlayerContainer(video: HTMLVideoElement): HTMLElement {
  let current = video.parentElement;
  let bestContainer: HTMLElement = video;

  // Walk up to 5 levels to find the outermost player wrapper/container
  for (let i = 0; i < 5; i++) {
    if (!current || current === document.body || current === document.documentElement) break;

    const className = (current.className || '').toString().toLowerCase();
    const id = (current.id || '').toString().toLowerCase();
    
    // Explicit player class/ID matches (handles Plyr, JWPlayer, VideoJS, etc.)
    if (
      className.includes('player') ||
      className.includes('video-js') ||
      className.includes('vjs-') ||
      className.includes('plyr') ||
      className.includes('jwplayer') ||
      id.includes('player') ||
      id.includes('video')
    ) {
      bestContainer = current;
      continue;
    }

    // Size-based heuristic: if parent element has similar size to video and contains controls/UI
    const pRect = current.getBoundingClientRect();
    const vRect = video.getBoundingClientRect();
    if (pRect.width > 0 && pRect.height > 0) {
      const widthDiff = Math.abs(pRect.width - vRect.width);
      const heightDiff = Math.abs(pRect.height - vRect.height);
      
      // If the parent is very close in size (within 60px)
      if (widthDiff < 60 && heightDiff < 60) {
        const hasControls = current.querySelector(
          '[class*="control" i], [class*="play" i], [class*="skin" i], [class*="ui" i], [class*="bar" i]'
        );
        if (hasControls) {
          bestContainer = current;
        }
      }
    }
    current = current.parentElement;
  }
  return bestContainer;
}

export function setupPositionTracker(
  video: HTMLVideoElement,
  overlay: HTMLElement
): { cleanup: () => void; sync: () => void } {
  
  // Resolve outer player container boundary
  let container: HTMLElement = video;
  try {
    container = getPlayerContainer(video);
  } catch (_) {}

  let isIntersecting = false;
  let isFullscreenActive = false;

  function syncPosition() {
    if (!video || !overlay) return;
    
    // 1. Hide overlay completely if offscreen or in fullscreen
    if (!isIntersecting || isFullscreenActive) {
      overlay.style.display = 'none';
      return;
    }

    // 2. Check if container is displayed
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      overlay.style.display = 'none';
      return;
    }
    
    overlay.style.display = 'block';

    // 3. Dynamically adjust top/bottom alignment if not dragged by the user
    const button = overlay.shadowRoot?.querySelector('.download-btn') as HTMLElement | null;
    if (button) {
      const isDragged = button.style.left !== '' && button.style.left !== 'auto';
      if (!isDragged) {
        if (rect.top < 24) {
          // Inside top-right corner, touching borders (no margins)
          button.style.bottom = 'auto';
          button.style.top = '0px';
          button.style.right = '0px';
        } else {
          // Outside top-right corner, touching borders (original design language)
          button.style.bottom = '100%';
          button.style.top = 'auto';
          button.style.right = '0px';
        }
      }
    }

    // Calculate position relative to document (absolute positioning context)
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const left = rect.left + scrollX;
    const top = rect.top + scrollY;

    // Apply geometry changes using absolute layout (scrolls natively with the page)
    Object.assign(overlay.style, {
      position: 'absolute',
      left: `${left}px`,
      top: `${top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  // 1. IntersectionObserver to toggle tracking and visibility based on viewport viewport presence
  const intersectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      isIntersecting = entry.isIntersecting;
      syncPosition();
    }
  }, { threshold: 0.01 });
  intersectionObserver.observe(container);

  // 2. ResizeObserver for element resizing (e.g. theater mode, resizing player container)
  const resizeObserver = new ResizeObserver(() => {
    if (isIntersecting && !isFullscreenActive) {
      requestAnimationFrame(syncPosition);
    }
  });
  resizeObserver.observe(container);

  // 3. MutationObserver to detect CSS-transform-based scaling changes on the player container
  const mutationObserver = new MutationObserver(() => {
    if (isIntersecting && !isFullscreenActive) {
      requestAnimationFrame(syncPosition);
    }
  });
  mutationObserver.observe(container, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  // Viewport scroll and resize listeners for fallback layout sync (e.g., nested scroll containers)
  const handleViewportChange = () => {
    if (isIntersecting && !isFullscreenActive) {
      requestAnimationFrame(syncPosition);
    }
  };

  const handleFullscreenChange = () => {
    const fullscreenEl = document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement;
    
    isFullscreenActive = !!fullscreenEl;
    syncPosition();
  };

  window.addEventListener('resize', handleViewportChange, { passive: true });
  window.addEventListener('scroll', handleViewportChange, { capture: true, passive: true });
  document.addEventListener('fullscreenchange', handleFullscreenChange, { passive: true });
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange, { passive: true });
  document.addEventListener('mozfullscreenchange', handleFullscreenChange, { passive: true });
  document.addEventListener('MSFullscreenChange', handleFullscreenChange, { passive: true });

  // Initial synchronization
  syncPosition();

  function cleanup() {
    intersectionObserver.disconnect();
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    window.removeEventListener('resize', handleViewportChange);
    window.removeEventListener('scroll', handleViewportChange, { capture: true } as any);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
    document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
  }

  return {
    cleanup,
    sync: syncPosition
  };
}
