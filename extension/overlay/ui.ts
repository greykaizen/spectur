/**
 * UI components for drawing the isolated Shadow DOM action button.
 */

function isDarkMode(): boolean {
  const mq =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (mq) return true;

  const htmlEl = document.documentElement;
  if (htmlEl.hasAttribute("dark") || htmlEl.getAttribute("theme") === "dark") {
    return true;
  }

  const bodyEl = document.body;
  if (
    bodyEl &&
    (bodyEl.classList.contains("dark") ||
      bodyEl.getAttribute("theme") === "dark")
  ) {
    return true;
  }

  return false;
}

export function createOverlay(video: HTMLVideoElement): HTMLElement {
  // Create host element that will contain the Shadow Root
  const host = document.createElement("div");
  host.setAttribute("data-spectur-overlay-host", "");

  // Style host element to overlay precisely
  Object.assign(host.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    width: "0px",
    height: "0px",
    zIndex: "2147483647",
    pointerEvents: "none",
    boxSizing: "border-box",
    margin: "0",
    padding: "0",
  });

  // Attach open Shadow Root for style isolation
  const shadow = host.attachShadow({ mode: "open" });

  const isDark = isDarkMode();
  const logoUrl = browser.runtime.getURL('icons/no-bgx256.png');

  // Add Stylesheet inside Shadow DOM
  const style = document.createElement("style");
  style.textContent = `
    .download-btn {
      position: absolute;
      /* Rest exactly on the top edge of the video frame */
      bottom: 100%;
      right: 0px;

      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0;
      margin: 0;
      border-radius: 4px;

      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11px;
      font-weight: 600;
      cursor: grab;
      pointer-events: auto; /* Active pointer events for clicking/dragging */
      user-select: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      transition: background-color 0.2s, border-color 0.2s;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      box-sizing: border-box;
      line-height: 1;
      white-space: nowrap;
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

    .logo-container {
      width: 18px;
      height: 18px;
      margin: 0;
      padding: 0;
      overflow: hidden;
      display: block;
      border-radius: 3px 0 0 3px; /* Match button left rounded corners */
    }

    .logo-img {
      width: 18px;
      height: 18px;
      margin: 0;
      padding: 0;
      object-fit: contain;
      pointer-events: none;
      display: block;
      transform: scale(1.35); /* Zoom in on internal logo details */
      transform-origin: center;
    }

    .btn-text {
      margin: 0 1px 0 0;
      padding: 0;
      line-height: 18px; /* Match logo height for absolute vertical alignment */
      display: inline-block;
    }

    .close-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px; /* Matches logo height for a balanced, symmetric appearance */
      height: 18px;
      border-radius: 0 3px 3px 0; /* Match button right rounded corners */
      color: inherit;
      opacity: 0.6;
      font-weight: 700;
      font-size: 10px;
      transition: all 0.2s;
      cursor: pointer;
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      line-height: 18px;
    }

    .close-btn:hover {
      opacity: 1;
      background-color: rgba(255, 59, 48, 0.15);
      color: #ff3b30;
    }

    /* Context Menu Styles */
    .context-menu {
      position: absolute;
      top: 100%;
      right: 0px;
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      z-index: 2147483647;
      pointer-events: auto;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;

      /* Capped dimensions & scrolling settings */
      min-width: 160px;
      max-width: 280px;
      max-height: 200px;
      overflow-y: auto;
      overflow-x: hidden;
      width: max-content;
    }

    .context-menu.theme-dark {
      background-color: rgba(28, 28, 30, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }

    .context-menu.theme-light {
      background-color: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(0, 0, 0, 0.12);
      color: #1c1c1e;
    }

    .context-menu-row {
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      white-space: nowrap;
      box-sizing: border-box;
      transition: background-color 0.15s;
    }

    .context-menu-row.theme-dark:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }

    .context-menu-row.theme-light:hover {
      background-color: rgba(0, 0, 0, 0.05);
    }

    .row-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  // Create the button
  const button = document.createElement("div");
  button.className = `download-btn ${isDark ? "theme-dark" : "theme-light"}`;

  // Icon wrapper for clipping
  const logoContainer = document.createElement("div");
  logoContainer.className = "logo-container";

  const logo = document.createElement("img");
  logo.className = "logo-img";
  logo.src = logoUrl;
  logo.alt = "";

  logoContainer.appendChild(logo);

  // Text
  const text = document.createElement("span");
  text.className = "btn-text";
  text.textContent = "Download with tur";

  // Close Button
  const close = document.createElement("span");
  close.className = "close-btn";
  close.innerHTML = "&#x2715;";

  // Context Menu Creation (Appended inside button for local positioning context)
  const menu = document.createElement("div");
  menu.className = `context-menu ${isDark ? "theme-dark" : "theme-light"}`;
  menu.style.display = "none";

  // Stop clicks inside the menu from bubbling up to toggle/close the menu
  menu.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Mock streams list to test rendering (Flat strings)
  const mockTracks = [
    "1080p (High Definition) [HLS]",
    "720p (Standard HD) [HLS]",
    "480p (Medium Resolution) [HLS]",
    "Audio Stream (128kbps) [AAC]",
  ];

  mockTracks.forEach((track) => {
    const row = document.createElement("div");
    row.className = `context-menu-row ${isDark ? "theme-dark" : "theme-light"}`;

    const labelSpan = document.createElement("span");
    labelSpan.className = "row-label";
    labelSpan.textContent = track;

    row.appendChild(labelSpan);
    menu.appendChild(row);

    row.addEventListener("click", (e) => {
      e.stopPropagation();
      console.log(`[Spectur Overlay] Trigger download for: ${track}`);
      menu.style.display = "none";
    });
  });

  // Assemble
  button.appendChild(logoContainer);
  button.appendChild(text);
  button.appendChild(close);
  button.appendChild(menu);

  shadow.appendChild(style);
  shadow.appendChild(button);

  // Close handler
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    host.style.display = "none";
  });

  // Drag and Drop State
  let isPreparingDrag = false;
  let isDragging = false;
  let dragged = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  // Clicks are handled inside the mouseup listener below to avoid click-conflict issues

  // Close menu on click outside the host
  document.addEventListener(
    "click",
    (e) => {
      if (host && !host.contains(e.target as Node)) {
        menu.style.display = "none";
      }
    },
    { passive: true },
  );

  // Drag and Drop Logic

  button.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // Only trigger for left-click
    if (e.target === close) return;

    // Prepare drag on mousedown, but don't convert layout yet to avoid click-conflict shifts
    isPreparingDrag = true;
    dragged = false;
    startX = e.clientX;
    startY = e.clientY;

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });

  function onMouseMove(e: MouseEvent) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (isPreparingDrag) {
      // Verify if movement exceeds threshold (4px) to officially start drag
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        isPreparingDrag = false;
        isDragging = true;
        dragged = true;
        menu.style.display = "none"; // Close menu when dragging begins

        // Convert layout to absolute positioning only when drag starts
        const rect = button.getBoundingClientRect();
        const parentRect = host.getBoundingClientRect();

        initialLeft = rect.left - parentRect.left;
        initialTop = rect.top - parentRect.top;

        button.style.left = `${initialLeft}px`;
        button.style.top = `${initialTop}px`;
        button.style.bottom = "auto";
        button.style.right = "auto";
        button.style.cursor = "grabbing";
      }
      return;
    }

    if (isDragging) {
      button.style.left = `${initialLeft + dx}px`;
      button.style.top = `${initialTop + dy}px`;
    }
  }

  function onMouseUp(e: MouseEvent) {
    isPreparingDrag = false;
    isDragging = false;
    button.style.cursor = "grab";
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);

    // If mouse was released without dragging, trigger the menu toggle
    if (!dragged) {
      e.stopPropagation();
      const isHidden = menu.style.display === "none";
      menu.style.display = isHidden ? "flex" : "none";
    }
  }

  document.body.appendChild(host);
  return host;
}

export function destroyOverlay(host: HTMLElement): void {
  if (host && host.parentNode) {
    host.parentNode.removeChild(host);
  }
}
