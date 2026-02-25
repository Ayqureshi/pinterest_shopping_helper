
/**
 * Scrapes the "Best Guess" for an image URL by opening a Google Lens tab in the background.
 * Requires "tabs" and "scripting" permissions.
 * 
 * @param {string} imageUrl 
 * @returns {Promise<string|null>} The best guess text, or null if failed.
 */
/**
 * Scrapes the "Best Guess" for an image URL by opening a MINIMIZED Google Lens window.
 * Requires "tabs", "scripting", and "windows" permissions.
 * 
 * @param {string} imageUrl 
 * @returns {Promise<string|null>} The best guess text, or null if failed.
 */
async function scrapeLensWindow(imageUrl) {
    return new Promise((resolve) => {
        try {
            const lensUrl = `https://lens.google.com/upload?url=${encodeURIComponent(imageUrl)}`;

            // Create a MINIMIZED window to be less intrusive
            chrome.windows.create({
                url: lensUrl,
                type: 'popup',
                state: 'minimized',
                focused: false
            }, (window) => {
                if (chrome.runtime.lastError || !window) {
                    console.warn("Failed to create window", chrome.runtime.lastError);
                    resolve(null);
                    return;
                }

                const windowId = window.id;
                // The window has one tab usually
                const tabId = window.tabs && window.tabs[0] ? window.tabs[0].id : null;

                // If we didn't get a tab ID immediately, we might need to query for it, 
                // but usually windows.create returns it if we ask for a url.
                // However, let's just listen for the tab update in that window.

                // Timeout safety: 15 seconds (slower network profile)
                const timeoutId = setTimeout(() => {
                    console.warn("Window load timeout for", imageUrl);
                    chrome.windows.remove(windowId).catch(() => { });
                    resolve(null);
                }, 15000);

                // We need to find the tab ID if it wasn't returned
                // Listener for tab updates
                const listener = (tid, changeInfo, tabInfo) => {
                    // Check if this tab matches our window
                    if (tabInfo.windowId === windowId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        clearTimeout(timeoutId);

                        // Inject script to scrape with SMART POLLING
                        chrome.scripting.executeScript({
                            target: { tabId: tid },
                            func: () => {
                                return new Promise((resolveScript) => {
                                    const check = () => {
                                        try {
                                            // 1. The Search Box (Top priority)
                                            const inputs = document.querySelectorAll('input, textarea');
                                            for (const input of inputs) {
                                                if (input.placeholder && (input.placeholder.includes("Search") || input.getAttribute("aria-label") === "Search")) {
                                                    if (input.value) return input.value;
                                                }
                                                if (input.name === "q" && input.value) return input.value;
                                            }

                                            // 2. Headings / Title Fallback
                                            // BUT IGNORE GENERIC TERMS
                                            if (document.title && !document.title.includes("Google Lens")) {
                                                return document.title;
                                            }
                                        } catch (e) { }
                                        return null;
                                    };

                                    const isGeneric = (text) => {
                                        if (!text) return true;
                                        const lower = text.toLowerCase().trim();
                                        const generics = [
                                            "google search", "google images", "find item", "search",
                                            "image search", "visual matches", "visually similar images",
                                            "undefined", "null"
                                        ];
                                        if (generics.includes(lower)) return true;
                                        // If it's just "Google", ignore
                                        if (lower === "google") return true;
                                        return false;
                                    };

                                    // Poll every 200ms for up to 6 seconds
                                    let attempts = 0;
                                    const interval = setInterval(() => {
                                        attempts++;
                                        const res = check();
                                        if (res && !isGeneric(res)) {
                                            clearInterval(interval);
                                            resolveScript(res);
                                        } else if (res && isGeneric(res)) {
                                            // Found something but it's generic, keep waiting for better?
                                            // Or is that all we got? Let's wait a bit more.
                                            if (attempts > 30) { // After 6s, if all we have is generic, give up
                                                clearInterval(interval);
                                                resolveScript(null);
                                            }
                                        }

                                        if (attempts > 50) { // 10 seconds max wait inside script
                                            clearInterval(interval);
                                            resolveScript(null);
                                        }
                                    }, 200);
                                });
                            }
                        }, (results) => {
                            // Cleanup window
                            chrome.windows.remove(windowId).catch(() => { });

                            if (chrome.runtime.lastError) {
                                console.warn("Script injection failed", chrome.runtime.lastError);
                                resolve(null);
                            } else {
                                const result = results?.[0]?.result;
                                resolve(result);
                            }
                        });
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
const globalScope = typeof self !== 'undefined' ? self : window;
globalScope.fetchLensResult = scrapeLensWindow; // Alias for compatibility with popup.js
globalScope.wait = (ms) => new Promise(r => setTimeout(r, ms));
