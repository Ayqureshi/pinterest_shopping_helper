const PIN_LINK_PATTERN = /\/pin\/\d+/;

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function normalizeUrl(href) {
  try {
    return new URL(href, location.origin).href;
  } catch {
    return null;
  }
}

function getCardElement(anchor) {
  return (
    anchor.closest(
      '[data-test-id="pinWrapper"], [data-test-id="pin"], [data-test-id="pin-card"], [data-test-id="pin-card-wrapper"]'
    ) || anchor
  );
}

function resolveImageUrl(imageElement) {
  const fromSrcSet =
    imageElement?.getAttribute("srcset")?.split(",")?.pop()?.trim() || "";
  return (
    imageElement?.dataset?.pinMedia ||
    imageElement?.dataset?.src ||
    imageElement?.currentSrc ||
    imageElement?.src ||
    fromSrcSet ||
    ""
  );
}

function resolveItemTitle({
  imageElement,
  cardTitle,
  anchor,
}) {
  return (
    imageElement?.alt?.trim() ||
    imageElement?.getAttribute("aria-label")?.trim() ||
    anchor.getAttribute("aria-label")?.trim() ||
    cardTitle ||
    ""
  );
}

function shouldIncludeImage(imageUrl) {
  if (!imageUrl) {
    return false;
  }

  try {
    const parsed = new URL(imageUrl, location.origin);
    return parsed.hostname.includes("pinimg.com");
  } catch {
    return false;
  }
}

// Extract pins visible on the page right now
function extractVisiblePins() {
  const pins = [];
  const anchors = document.querySelectorAll('a[href*="/pin/"]');

  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href");
    const absoluteUrl = normalizeUrl(href);

    if (!absoluteUrl || !PIN_LINK_PATTERN.test(absoluteUrl)) {
      return;
    }

    const card = getCardElement(anchor);
    const titleElement =
      card.querySelector(
        '[data-test-id="pinTitle"], [data-test-id="title"], h1, h2, h3, h4'
      ) || null;
    const descriptionElement =
      card.querySelector(
        '[data-test-id="pinDescription"], [data-test-id="fullDescription"]'
      ) || null;
    const baseTitle =
      titleElement?.textContent?.trim() ||
      anchor.getAttribute("aria-label")?.trim() ||
      "";
    const description = descriptionElement?.textContent?.trim() || "";

    const imageElements = card.querySelectorAll("img");
    imageElements.forEach((imageElement) => {
      const imageUrl = resolveImageUrl(imageElement);
      if (!shouldIncludeImage(imageUrl)) {
        return;
      }

      const itemTitle = resolveItemTitle({
        imageElement,
        cardTitle: baseTitle,
        anchor,
      });

      // Smart Title Generation: Clean and truncate
      // Smart Title Generation: Clean and truncate
      const generateSmartTitle = (text) => {
        if (!text) return null;

        // Filter out generic Pinterest AI text
        const genericPatterns = [
          /^This (may )?contain(s)?( an)? image of/i,
          /^Image of/i,
          /^No description available/i,
          /^Pixel data/i,
          /^via @/i // "via @user" is often not a useful title
        ];

        for (const pattern of genericPatterns) {
          if (pattern.test(text)) return null;
        }

        let clean = text.replace(/[:\-\|]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (!clean || clean.length < 2) return null;

        return clean.split(" ").slice(0, 6).join(" ");
      };

      // Extract Board Name from URL as fallback
      const getBoardName = () => {
        const path = window.location.pathname;
        const parts = path.split("/").filter(p => p);
        if (parts.length >= 2) {
          const raw = parts[1].replace(/-/g, " ");
          return raw.charAt(0).toUpperCase() + raw.slice(1);
        }
        return "Pinterest";
      };

      let smartTitle = generateSmartTitle(itemTitle || baseTitle);
      const boardName = getBoardName();

      // Fallback to Board Name if title is missing
      if (!smartTitle) {
        smartTitle = `${boardName} Pin`;
      }

      // Description logic
      let cleanDesc = description || (itemTitle && itemTitle !== smartTitle ? itemTitle : "") || "";

      // Filter generic descriptions too
      if (cleanDesc.match(/^This (may )?contain(s)?( an)? image of/i) ||
        cleanDesc.match(/^Image of/i) ||
        cleanDesc.match(/^via @/i)) {
        cleanDesc = "";
      }

      const fullDescription = cleanDesc; // Can be empty string now

      // Attempt to find video URL
      let videoUrl = null;
      const videoElement = card.querySelector("video");
      if (videoElement) {
        let rawUrl = videoElement.src || videoElement.querySelector("source")?.src;
        if (rawUrl && !rawUrl.startsWith("blob:")) {
          videoUrl = rawUrl;
        } else {
          const sources = Array.from(videoElement.querySelectorAll("source"));
          for (const source of sources) {
            if (source.src && !source.src.startsWith("blob:")) {
              videoUrl = source.src;
              break;
            }
          }
        }
      }

      pins.push({
        title: smartTitle,
        imageUrl,
        videoUrl,
        link: absoluteUrl,
        description: fullDescription,
      });
    });
  });

  return pins;
}


async function getPins() {
  const allPins = new Map(); // Use Map to dedup by unique key

  const addPinsToMap = (pins) => {
    pins.forEach(pin => {
      const key = pin.link;
      if (!allPins.has(key)) {
        allPins.set(key, pin);
      }
    });
  };

  // Scroll to the very top first to ensure we catch initial items
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Wait for pins to actually appear in the DOM (handling slow rendering)
  let attempts = 0;
  while (attempts < 20) { // Try for 10 seconds (20 * 500ms)
    const pinCount = document.querySelectorAll('a[href*="/pin/"]').length;
    if (pinCount > 0) {
      break; // Pins found! Proceed.
    }
    console.log("Waiting for pins to render...");
    await sleep(500);
    attempts++;
  }

  // Initial scrape at top
  addPinsToMap(extractVisiblePins());

  // Loop to scroll down incrementally
  while (true) {
    const currentScrollTop = window.scrollY || document.documentElement.scrollTop;
    const documentHeight = document.body.scrollHeight;
    const viewportHeight = window.innerHeight;

    // Check if we've reached the bottom
    if ((viewportHeight + currentScrollTop) >= documentHeight - 50) {
      // We are at the bottom. Wait a bit longer to see if more content loads.
      await sleep(2500);

      const newHeight = document.body.scrollHeight;
      if (newHeight > documentHeight) {
        // Content expanded, continue loop
        continue;
      } else {
        // No new content, check one last time and break.
        // Final scrape
        addPinsToMap(extractVisiblePins());
        break;
      }
    }

    // Scroll down by 60% of viewport height to ensure overlap and loading time
    window.scrollBy({
      top: viewportHeight * 0.6,
      behavior: "smooth",
    });

    // Wait for content to render/load
    await sleep(1500);

    // Scrape at this position
    addPinsToMap(extractVisiblePins());
  }

  // Helper to extract board name (re-used)
  const getBoardName = () => {
    const path = window.location.pathname;
    const parts = path.split("/").filter(p => p);
    if (parts.length >= 2) {
      const raw = parts[1].replace(/-/g, " ");
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
    return "Pinterest";
  };

  const boardName = getBoardName();
  return { pins: Array.from(allPins.values()), boardName };
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type === "GET_PINS") {
    getPins()
      .then(({ pins, boardName }) => sendResponse({ success: true, pins, boardName }))
      .catch((error) => {
        console.error("Failed to collect pins", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  return undefined;
});

// Expose for debugging in the console.
window.getPins = getPins;
