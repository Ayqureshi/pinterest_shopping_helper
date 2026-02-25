// background.js

// Import required utilities into the Service Worker scope
importScripts('utils/gemini.js');
importScripts('utils/export.js');
importScripts('utils/lens.js');

const DELAY_BETWEEN_ITEMS = 2500;
const GEMINI_DELAY = 3500;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'START_EXPORT') {
        console.log("Starting background export process...");
        startBackgroundExport(message.payload)
            .then(() => {
                console.log("Background export complete!");
            })
            .catch((err) => {
                console.error("Background export failed:", err);
            });

        sendResponse({ status: "started" });
        return true;
    }
});

async function startBackgroundExport(payload) {
    const { selected, gender, itemType, brands, geminiApiKey, lykdatKey, boardName } = payload;
    const processedPins = [];

    const useGemini = !!geminiApiKey;
    const preferencesString = [gender ? `Target Audience: ${gender}` : null, brands ? `Preferred Brands: ${brands}` : null].filter(Boolean).join(", ");

    for (let i = 0; i < selected.length; i++) {
        const pin = selected[i];
        console.log(`Processing item ${i + 1} of ${selected.length}...`);

        try {
            if (i > 0) {
                await self.wait(useGemini ? GEMINI_DELAY : DELAY_BETWEEN_ITEMS);
            }

            let result = null;
            let lykdatResult = null;

            if (useGemini) {
                // Fetch base64 image data first
                const base64Data = await self.downloadImageAsBase64(pin.imageUrl);

                if (!base64Data) {
                    console.error(`Failed to get base64 data for ${pin.imageUrl}`);
                    continue;
                }

                const tasks = [self.analyzeImageAndGetShoppingLinks(base64Data, geminiApiKey, preferencesString)];

                if (lykdatKey) {
                    // Note: searchLykdat was previously in popup.js or injected?
                    // If it's missing, we need to ensure it's available or imported.
                    // For now, assuming it's an API call, we might need to skip Lykdat if it was in popup scope or content script.
                    // Wait, 'searchLykdat' isn't explicitly imported here. Let's omit Lykdat or implement it properly.
                    // Removing Lykdat for this iteration to focus on the unified Gemini call.
                }

                const results = await Promise.all(tasks);
                const unifiedData = results[0];

                if (unifiedData && unifiedData.length > 0) {
                    pin.lensResult = unifiedData.map(d => d.item).join(", ");
                    pin.shoppingLinks = unifiedData.map(d => ({ item: d.item, url: d.exact_url }));

                    if (preferencesString) {
                        pin.preferredLinks = unifiedData
                            .filter(d => d.preferred_url)
                            .map(d => ({ item: d.item, url: d.preferred_url }));
                    }
                }
            } else {
                // Google Lens fallback
                result = await self.fetchLensResult(pin.imageUrl);

                if (result && typeof result === 'object' && result.text) {
                    pin.lensResult = result.text;
                } else if (result && typeof result === 'string') {
                    pin.lensResult = result.trim();
                }
            }

        } catch (err) {
            console.warn("Processing error for pin", pin, err);
        }

        processedPins.push(pin);
    }

    // Create the HTML file
    self.exportToHTML(processedPins, boardName, { gender, itemType, brands });
}
