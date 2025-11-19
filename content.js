const PIN_LINK_PATTERN = /\/pin\/\d+/;

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function autoScrollUntilSettled({
  maxIdleIterations = 5,
  delay = 1200,
} = {}) {
  let lastHeight = 0;
  let idleIterations = 0;

  while (idleIterations < maxIdleIterations) {
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: "smooth",
    });

    await sleep(delay);

    const currentHeight = document.body.scrollHeight;
    if (currentHeight <= lastHeight) {
      idleIterations += 1;
    } else {
      idleIterations = 0;
      lastHeight = currentHeight;
    }
  }
}

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

function extractPinsFromDocument() {
  const pins = [];
  const seenEntries = new Set();
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

      const key = `${absoluteUrl}|${imageUrl}`;
      if (seenEntries.has(key)) {
        return;
      }

      pins.push({
        title: itemTitle || baseTitle,
        imageUrl,
        link: absoluteUrl,
        description,
      });
      seenEntries.add(key);
    });
  });

  return pins;
}

async function getPins() {
  await autoScrollUntilSettled();
  return extractPinsFromDocument();
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type === "GET_PINS") {
    getPins()
      .then((pins) => sendResponse({ success: true, pins }))
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
