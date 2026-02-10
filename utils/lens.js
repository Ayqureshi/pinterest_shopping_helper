
/**
 * Scrapes the "Best Guess" for an image URL by opening a Google Lens tab in the background.
 * Requires "tabs" and "scripting" permissions.
 * 
 * @param {string} imageUrl 
 * @returns {Promise<string|null>} The best guess text, or null if failed.
 */
async function scrapeLensTab(imageUrl) {
    return new Promise((resolve) => {
        try {
            // Open the *modern* Lens URL
            const lensUrl = `https://lens.google.com/upload?url=${encodeURIComponent(imageUrl)}`;

            chrome.tabs.create({ url: lensUrl, active: false }, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    console.warn("Failed to create tab", chrome.runtime.lastError);
                    resolve(null);
                    return;
                }

                const tabId = tab.id;

                // Timeout safety: If tab doesn't load in 10s, kill it.
                const timeoutId = setTimeout(() => {
                    console.warn("Tab load timeout for", imageUrl);
                    chrome.tabs.remove(tabId).catch(() => { });
                    resolve(null);
                }, 12000);

                const listener = (tid, changeInfo, tabInfo) => {
                    if (tid === tabId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        clearTimeout(timeoutId);

                        // Allow a brief moment for dynamic JS to populate the input box
                        setTimeout(() => {
                            // Inject script to scrape
                            chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                func: () => {
                                    // --- BROWSER CONTEXT ---
                                    try {
                                        // 1. The Search Box (Top priority)
                                        // Lens usually puts the recognized entity here: "White Sneakers"
                                        const inputs = document.querySelectorAll('input, textarea');
                                        for (const input of inputs) {
                                            if (input.placeholder && (input.placeholder.includes("Search") || input.getAttribute("aria-label") === "Search")) {
                                                if (input.value) return input.value;
                                            }
                                            // Fallback: check value of any search-like input
                                            if (input.name === "q" && input.value) return input.value;
                                        }

                                        // 2. Headings / Title Fallback
                                        // Sometimes title is "Subject - Google Lens"
                                        if (document.title && !document.title.includes("Google Lens")) {
                                            return document.title;
                                        }

                                        // 3. Accessibility labels often hide the truth
                                        const region = document.querySelector('[role="main"]');
                                        if (region) {
                                            // Heuristic: Look for large text?
                                            // This is risky. Sticking to input box is safest for "Active" scraping.
                                        }

                                        return null;
                                    } catch (e) {
                                        return null;
                                    }
                                }
                            }, (results) => {
                                // Cleanup
                                chrome.tabs.remove(tabId).catch(() => { });

                                if (chrome.runtime.lastError) {
                                    console.warn("Script injection failed", chrome.runtime.lastError);
                                    resolve(null);
                                } else {
                                    const result = results?.[0]?.result;
                                    resolve(result);
                                }
                            });
                        }, 1000); // Wait 1s after 'complete' for React/JS to hydrate input
                    }
                };

                chrome.tabs.onUpdated.addListener(listener);
            });
        } catch (e) {
            console.error("Scraping error", e);
            resolve(null);
        }
    });
}

// Keep the old one available just in case, or alias it?
// Replacing the window function with the new one.
window.fetchLensResult = scrapeLensTab; // Alias for compatibility with popup.js
window.wait = (ms) => new Promise(r => setTimeout(r, ms));
