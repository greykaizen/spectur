import { defineContentScript } from 'wxt/sandbox';
import { observeVideos } from '../overlay/detector';
import { createOverlay, destroyOverlay } from '../overlay/ui';
import { setupPositionTracker } from '../overlay/geometry';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: true,
  async main() {
    try {
      // 1. Verify Platform (Linux Only)
      const platform = await browser.runtime.sendMessage({ action: 'getPlatformInfo' });
      if (!platform || platform.os !== 'linux') {
        return;
      }
      
      console.log('[Spectur Overlay] Linux OS detected. Initializing overlay hooks...');

      // Map to track active overlays and their position sync instances per video
      const activeOverlays = new Map<
        HTMLVideoElement,
        {
          overlay: HTMLElement;
          tracker: { cleanup: () => void; sync: () => void };
        }
      >();

      // Start observing video nodes
      const videoObserver = observeVideos(
        (video) => {
          console.log('[Spectur Overlay] Video element attached:', video);
          try {
            const overlay = createOverlay(video);
            const tracker = setupPositionTracker(video, overlay);
            activeOverlays.set(video, { overlay, tracker });
          } catch (err) {
            console.error('[Spectur Overlay] Failed to draw overlay:', err);
          }
        },
        (video) => {
          console.log('[Spectur Overlay] Video element detached:', video);
          const entry = activeOverlays.get(video);
          if (entry) {
            entry.tracker.cleanup();
            destroyOverlay(entry.overlay);
            activeOverlays.delete(video);
          }
        }
      );

      // Listen for window/context unload events to clean up DOM changes
      window.addEventListener('unload', () => {
        videoObserver.cleanup();
      });

    } catch (err) {
      console.error('[Spectur Overlay] Error during initialization:', err);
    }
  }
});
