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
      const platform = await browser.runtime.sendMessage({ action: 'getPlatformInfo' });
      const os = platform?.os || 'unknown';
      
      if (os === 'linux') {
        console.log('[Spectur Overlay] Linux OS detected. Drawing Shadow DOM overlays...');
        
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
            try {
              const overlay = createOverlay(video);
              const tracker = setupPositionTracker(video, overlay);
              activeOverlays.set(video, { overlay, tracker });
            } catch (err) {
              console.error('[Spectur Overlay] Failed to draw overlay:', err);
            }
          },
          (video) => {
            const entry = activeOverlays.get(video);
            if (entry) {
              entry.tracker.cleanup();
              destroyOverlay(entry.overlay);
              activeOverlays.delete(video);
            }
          }
        );

        window.addEventListener('unload', () => {
          videoObserver.cleanup();
        });
        
      } else if (os === 'win' || os === 'mac') {
        console.log(`[Spectur Overlay] ${os} OS detected. Activating background coordinate tracker...`);

        // Map to track active geometry monitors per video element
        const activeTrackers = new Map<HTMLVideoElement, { cleanup: () => void }>();

        const videoObserver = observeVideos(
          (video) => {
            let animationFrameId: number | null = null;

            // Compute and transmit video dimensions + page alignment context
            function sendCoords() {
              if (animationFrameId !== null) return;
              
              animationFrameId = requestAnimationFrame(() => {
                animationFrameId = null;
                const rect = video.getBoundingClientRect();
                
                const coordinates = {
                  x: rect.left,
                  y: rect.top,
                  width: rect.width,
                  height: rect.height,
                  screenX: window.screenX,
                  screenY: window.screenY,
                  devicePixelRatio: window.devicePixelRatio,
                };
                
                browser.runtime.sendMessage({
                  action: 'sendCoordinates',
                  coordinates
                }).catch(() => {});
              });
            }

            // Register ResizeObserver for player resizing transitions (e.g. theater mode)
            const resizeObserver = new ResizeObserver(sendCoords);
            resizeObserver.observe(video);

            // Sync layout positions on scroll, window resize, and fullscreen events
            const handleViewportChange = () => {
              sendCoords();
            };

            window.addEventListener('resize', handleViewportChange, { passive: true });
            window.addEventListener('scroll', handleViewportChange, { capture: true, passive: true });
            document.addEventListener('fullscreenchange', handleViewportChange, { passive: true });

            // Transmit initial layout position
            sendCoords();

            activeTrackers.set(video, {
              cleanup() {
                resizeObserver.disconnect();
                window.removeEventListener('resize', handleViewportChange);
                window.removeEventListener('scroll', handleViewportChange, { capture: true } as any);
                document.removeEventListener('fullscreenchange', handleViewportChange);
                if (animationFrameId !== null) {
                  cancelAnimationFrame(animationFrameId);
                }
                
                // Notify backend that video was destroyed (width/height zeroed)
                browser.runtime.sendMessage({
                  action: 'sendCoordinates',
                  coordinates: {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                    screenX: 0,
                    screenY: 0,
                    devicePixelRatio: 1
                  }
                }).catch(() => {});
              }
            });
          },
          (video) => {
            const tracker = activeTrackers.get(video);
            if (tracker) {
              tracker.cleanup();
              activeTrackers.delete(video);
            }
          }
        );

        window.addEventListener('unload', () => {
          videoObserver.cleanup();
        });
      }

    } catch (err) {
      console.error('[Spectur Overlay] Error during initialization:', err);
    }
  }
});
