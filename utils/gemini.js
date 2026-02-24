
/**
 * Service for interacting with Google Gemini API to identify items in images.
 */
// Using Gemini 2.0 Flash-Lite for lowest cost and high speed
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite-001:generateContent";

/**
 * Identifies the main fashion/product item in an image using Gemini 2.0 Flash.
 * @param {string} imageUrl 
 * @param {string} apiKey 
 * @returns {Promise<string|null>} The identified item name, or null if failed.
 */
async function identifyItemWithGemini(imageUrl, apiKey) {
    if (!apiKey) {
        console.warn("Gemini API Key is missing.");
        return null;
    }

    try {
        // 1. Fetch the image data to convert to base64
        // First try fetching via content script to bypass CORS/403 blocks from Pinterest's CDN
        let base64ImageSource = null;
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs && tabs[0]) {
                const response = await chrome.tabs.sendMessage(tabs[0].id, { type: "FETCH_IMAGE_BASE64", url: imageUrl });
                if (response && response.success && response.base64) {
                    base64ImageSource = response.base64;
                }
            }
        } catch (e) {
            console.warn("Could not fetch via content script, falling back to direct fetch", e);
        }

        let blob;
        if (base64ImageSource) {
            const r = await fetch(base64ImageSource);
            blob = await r.blob();
        } else {
            const imageResp = await fetch(imageUrl);
            if (!imageResp.ok) throw new Error("Failed to fetch image for analysis");
            blob = await imageResp.blob();
        }

        // Optimize Image: Resize to max 800px to save tokens (Cost Reduction)
        const base64Data = await new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Resize logic: Keep aspect ratio, max 800px
                const MAX_SIZE = 800;
                if (width > height) {
                    if (width > MAX_SIZE) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Get JPEG at 0.8 quality (Good balance)
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                URL.revokeObjectURL(url);
                resolve(dataUrl.split(',')[1]); // Strip prefix
            };
            img.onerror = reject;
            img.src = url;
        });

        const mimeType = "image/jpeg";

        // 2. Prepare the payload
        const payload = {
            contents: [{
                parts: [
                    { text: "Identify the fashion items in this image. Return a concise, comma-separated list of the visible clothing and accessories (e.g. 'Black Leather Jacket, White T-Shirt, Blue Jeans, Silver Watch'). Include details like color or material if obvious. Do NOT write full sentences." },
                    {
                        inline_data: {
                            mime_type: mimeType,
                            data: base64Data
                        }
                    }
                ]
            }],
            generationConfig: {
                temperature: 0.1
            }
        };

        // 3. Call Gemini API with Retry Logic
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            try {
                const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (!response.ok) {
                    // Handle Rate Limit (429)
                    if (response.status === 429) {
                        console.log("Gemini Rate Limit Exceeded. Retrying...");
                        // Try to parse "Please retry in X s" from message
                        const waitTimeMatch = data.error?.message?.match(/retry in\s+([0-9.]+)\s*s/);
                        let waitMs = 2000 * Math.pow(2, attempts); // Default exponential backoff

                        if (waitTimeMatch && waitTimeMatch[1]) {
                            waitMs = Math.ceil(parseFloat(waitTimeMatch[1]) * 1000) + 1000; // Add 1s buffer
                        }

                        console.log(`Waiting ${waitMs}ms before retry...`);
                        await new Promise(r => setTimeout(r, waitMs));
                        attempts++;
                        continue;
                    }

                    console.error("Gemini API Error", JSON.stringify(data, null, 2));
                    return null;
                }

                // 4. Extract Text
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                return text ? { text: text.trim(), base64Data } : null;

            } catch (error) {
                console.error("Gemini Request Failed:", error);
                attempts++;
                if (attempts >= maxAttempts) return null;
                await new Promise(r => setTimeout(r, 2000)); // Basic wait on network error
            }
        }

        return null;

    } catch (error) {
        console.error("Gemini Identification Failed:", error);
        return null;
    }
}

/**
 * Searches the web for shopping links for all described items using Gemini's google_search tool.
 * @param {string} itemDescription 
 * @param {string|null} base64Data
 * @param {string} apiKey 
 * @returns {Promise<Array<{item: string, url: string}>|null>} Array of shopping links, or null.
 */
async function searchAllShoppingUrlsWithGemini(itemDescription, base64Data, apiKey) {
    if (!apiKey || !itemDescription) return null;

    try {
        const parts = [
            {
                text: `Analyze the provided image and the outfit breakdown: "${itemDescription}". For EACH specific item, find the exact product page. 
CRITICAL RULES:
1. Google Search often returns generic pages. You MUST verify the URL goes to the exact item.
2. DO NOT hallucinate or guess URLs. If you are not 100% confident you found the exact product page, you MUST fallback to returning a standard Google Shopping search URL for that item instead. Example fallback format: https://www.google.com/search?tbm=shop&q=Gray+Zip-up+Sweater (Replace spaces with +).
3. Return ONLY a valid JSON array of objects, with "item" and "url" keys. No markdown, no conversational text.` }
        ];

        if (base64Data) {
            parts.push({
                inline_data: {
                    mime_type: "image/jpeg",
                    data: base64Data
                }
            });
        }

        const payload = {
            contents: [{ parts }],
            tools: [{ google_search: {} }],
            generationConfig: {
                temperature: 0.1
            }
        };

        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            try {
                const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (!response.ok) {
                    if (response.status === 429) {
                        console.log("Gemini Search Rate Limit Exceeded. Retrying...");
                        const waitTimeMatch = data.error?.message?.match(/retry in\s+([0-9.]+)\s*s/);
                        let waitMs = 2000 * Math.pow(2, attempts);

                        if (waitTimeMatch && waitTimeMatch[1]) {
                            waitMs = Math.ceil(parseFloat(waitTimeMatch[1]) * 1000) + 1000;
                        }

                        console.log(`Waiting ${waitMs}ms before search retry...`);
                        await new Promise(r => setTimeout(r, waitMs));
                        attempts++;
                        continue;
                    }

                    console.error("Gemini Search API Error", data);
                    return null;
                }

                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                    try {
                        // Extract JSON from potential markdown blocks (```json ... ```)
                        const jsonMatch = text.match(/\[[\s\S]*\]/);
                        if (jsonMatch) {
                            const parsed = JSON.parse(jsonMatch[0]);
                            if (Array.isArray(parsed) && parsed.length > 0) {
                                return parsed;
                            }
                        }
                    } catch (e) {
                        console.error("Failed to parse Gemini shopping JSON:", e, text);
                    }
                }
                return null;

            } catch (error) {
                console.error("Gemini Shopping Search Request Failed:", error);
                attempts++;
                if (attempts >= maxAttempts) return null;
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        return null;
    } catch (error) {
        console.error("Gemini Shopping Search Failed:", error);
        return null;
    }
}

// Expose to window
window.identifyItemWithGemini = identifyItemWithGemini;
window.searchAllShoppingUrlsWithGemini = searchAllShoppingUrlsWithGemini;
