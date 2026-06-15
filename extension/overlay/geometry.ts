/**
 * Geometry tracker to keep the overlay aligned with the video element dynamically.
 */

export function setupPositionTracker(
  video: HTMLVideoElement,
  overlay: HTMLElement
): { cleanup: () => void; sync: () => void } {
  
  function syncPosition() {
    if (!video || !overlay) return;
    
    // Check if video is displayed
    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      overlay.style.display = 'none';
      return;
    }
    
    overlay.style.display = 'block';

    // Calculate position relative to document (absolute positioning context)
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const left = rect.left + scrollX;
    const top = rect.top + scrollY;

    // Apply geometry changes
    Object.assign(overlay.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  // Initial synchronization
  syncPosition();

  // ResizeObserver for element resizing (e.g. theater mode, resizing player container)
  const resizeObserver = new ResizeObserver(() => {
    // Request animation frame to prevent layout thrashing
    requestAnimationFrame(syncPosition);
  });
  resizeObserver.observe(video);

  // Scroll and resize events
  // Note: scroll needs { capture: true, passive: true } to intercept scroll events
  // originating from nested overflow containers (like sidebars/channels)
  const handleViewportChange = () => {
    requestAnimationFrame(syncPosition);
  };

  window.addEventListener('resize', handleViewportChange, { passive: true });
  window.addEventListener('scroll', handleViewportChange, { capture: true, passive: true });
  document.addEventListener('fullscreenchange', handleViewportChange, { passive: true });

  // Fallback polling for layout changes not caught by observers/listeners, wrapped in requestAnimationFrame
  const pollInterval = setInterval(() => {
    requestAnimationFrame(syncPosition);
  }, 1000);

  function cleanup() {
    clearInterval(pollInterval);
    resizeObserver.disconnect();
    window.removeEventListener('resize', handleViewportChange);
    window.removeEventListener('scroll', handleViewportChange, { capture: true } as any);
    document.removeEventListener('fullscreenchange', handleViewportChange);
  }

  return {
    cleanup,
    sync: syncPosition
  };
}
