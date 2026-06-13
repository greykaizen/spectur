/**
 * UI components for drawing the isolated Shadow DOM action button.
 */

// Helper to check if the host page is in dark mode
function isDarkMode(): boolean {
  // 1. Check media query
  const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (mq) return true;

  // 2. Check YouTube specific or general DOM attributes
  const htmlEl = document.documentElement;
  if (htmlEl.hasAttribute('dark') || htmlEl.getAttribute('theme') === 'dark') {
    return true;
  }
  
  const bodyEl = document.body;
  if (bodyEl && (bodyEl.classList.contains('dark') || bodyEl.getAttribute('theme') === 'dark')) {
    return true;
  }

  return false;
}

export function createOverlay(video: HTMLVideoElement): HTMLElement {
  // Create host element that will contain the Shadow Root
  const host = document.createElement('div');
  host.setAttribute('data-spectur-overlay-host', '');
  
  // Style host element to overlay precisely
  Object.assign(host.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: '0px',
    height: '0px',
    zIndex: '2147483647', // Max possible z-index
    pointerEvents: 'none',
    boxSizing: 'border-box',
    margin: '0',
    padding: '0',
  });

  // Attach open Shadow Root for style isolation
  const shadow = host.attachShadow({ mode: 'open' });

  // Get logo assets using browser extension API
  const isDark = isDarkMode();
  const logoUrl = browser.runtime.getURL(
    isDark ? 'icons/whitex256.png' : 'icons/blackx256.png'
  );

  // Add Stylesheet inside Shadow DOM
  const style = document.createElement('style');
  style.textContent = `
    .download-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 12px;
      font-weight: 600;
      cursor: grab;
      pointer-events: auto; /* Active pointer events for clicking/dragging */
      user-select: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transition: background-color 0.2s, border-color 0.2s, transform 0.1s;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      box-sizing: border-box;
      line-height: 1;
    }

    /* Dark theme styles */
    .download-btn.theme-dark {
      background-color: rgba(28, 28, 30, 0.85);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .download-btn.theme-dark:hover {
      background-color: rgba(44, 44, 46, 0.95);
      border-color: rgba(255, 255, 255, 0.25);
    }

    /* Light theme styles */
    .download-btn.theme-light {
      background-color: rgba(255, 255, 255, 0.9);
      color: #1c1c1e;
      border: 1px solid rgba(0, 0, 0, 0.12);
    }
    .download-btn.theme-light:hover {
      background-color: rgba(242, 242, 247, 0.95);
      border-color: rgba(0, 0, 0, 0.2);
    }

    .logo-img {
      width: 14px;
      height: 14px;
      object-fit: contain;
      pointer-events: none;
    }

    .btn-text {
      pointer-events: none;
      margin-right: 2px;
    }

    .close-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 4px;
      color: inherit;
      opacity: 0.65;
      font-weight: 700;
      font-size: 11px;
      transition: all 0.2s;
      cursor: pointer;
      box-sizing: border-box;
      margin-left: 2px;
    }

    .close-btn:hover {
      opacity: 1;
      background-color: rgba(255, 59, 48, 0.15);
      color: #ff3b30;
    }
  `;

  // Create the sleek button
  const button = document.createElement('div');
  button.className = `download-btn ${isDark ? 'theme-dark' : 'theme-light'}`;
  
  // Icon
  const logo = document.createElement('img');
  logo.className = 'logo-img';
  logo.src = logoUrl;
  logo.alt = '';

  // Text
  const text = document.createElement('span');
  text.className = 'btn-text';
  text.textContent = 'Download with tur';

  // Close Button
  const close = document.createElement('span');
  close.className = 'close-btn';
  close.innerHTML = '&#x2715;'; // Sleek multiplication cross (✕)

  // Assemble
  button.appendChild(logo);
  button.appendChild(text);
  button.appendChild(close);
  
  shadow.appendChild(style);
  shadow.appendChild(button);

  // Close handler: Dismiss the button
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    host.style.display = 'none';
    console.log('[Spectur Overlay] Overlay dismissed by user.');
  });

  // Action click handler
  button.addEventListener('click', () => {
    console.log('[Spectur Overlay] Action trigger: Download with tur clicked for video:', video.src);
    // Future integration hook: notify content.ts to schedule download
  });

  // Drag and Drop Logic
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  button.addEventListener('mousedown', (e) => {
    // Check if close button was clicked
    if (e.target === close) return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    const rect = button.getBoundingClientRect();
    const parentRect = host.getBoundingClientRect();
    
    initialLeft = rect.left - parentRect.left;
    initialTop = rect.top - parentRect.top;
    
    button.style.left = `${initialLeft}px`;
    button.style.top = `${initialTop}px`;
    button.style.right = 'auto'; // Disable default right constraints during drag
    button.style.cursor = 'grabbing';
    
    // Attach window listeners to capture smooth movement outside the button area
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    
    e.preventDefault();
  });

  function onMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    button.style.left = `${initialLeft + dx}px`;
    button.style.top = `${initialTop + dy}px`;
  }

  function onMouseUp() {
    isDragging = false;
    button.style.cursor = 'grab';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  document.body.appendChild(host);
  return host;
}

export function destroyOverlay(host: HTMLElement): void {
  if (host && host.parentNode) {
    host.parentNode.removeChild(host);
  }
}
