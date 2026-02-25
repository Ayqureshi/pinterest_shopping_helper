
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
                    { text: "Identify the fashion items in this image using highly specific, industry-standard fashion terminology. For example, instead of 'Zip-up Sweater', use 'Quarter-Zip Pullover' or 'Full-Zip Cardigan'. Instead of 'Pants', use 'Pleated Wide-Leg Trousers' or 'Slim Fit Chinos'. Return a concise, comma-separated list of the visible clothing and accessories. Include details like color, fit, or material if obvious. Do NOT write full sentences." },
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
 * @param {string} itemDescription The identified items in the image.
 * @param {string|null} base64Data The original image for visual context.
 * @param {string} apiKey The Gemini API Key
 * @param {string} [preferences] Optional string specifying brands, gender, etc.
 * @returns {Promise<Array<{item: string, url: string}>|null>} Array of shopping links, or null.
 */
async function searchAllShoppingUrlsWithGemini(itemDescription, base64Data, apiKey, preferences = "") {
    if (!apiKey || !itemDescription) return null;

    try {
        let promptText = `Analyze the provided image and outfit breakdown: "${itemDescription}". For EACH specific item, generate a Google Shopping redirect link.
CRITICAL RULES:
1. Construct a standard Google Shopping search URL for the item (since you cannot do live web searches).
2. Format MUST BE: https://www.google.com/search?tbm=shop&q=Gray+Zip-up+Sweater
3. Replace spaces with + in the URL.
4. Return ONLY a valid JSON array of objects, with "item" and "url" keys. No markdown, no conversational text.`;

        if (preferences) {
            promptText = `Analyze the outfit breakdown: "${itemDescription}". For EACH specific item, strictly apply these user preferences: ${preferences}.
CRITICAL RULES:
1. You MUST prioritize the requested brands. Figure out the official website domain of the preferred brand (e.g. Banana Republic is bananarepublic.gap.com).
2. Generate a DuckDuckGo "I'm Feeling Lucky" redirect URL that will automatically navigate the user to the top actual product result on that domain.
3. CRITICAL: Search engines will return generic Category Listing pages if your search term is too simple (e.g. "Men's White T-Shirt" or "Men's Pleated Pants"). You MUST construct highly specific, realistic marketing product names in the query string using actual VISIBLE attributes of the clothing (e.g., exact color shade, fabric texture like 'ribbed' or 'linen', collar style, and fit like 'slim' or 'oversized'). 
4. DO NOT hallucinate random materials or random styles that aren't in the image. The highly specific name must accurately describe the exact item shown (e.g., "Men's Ribbed Supima Cotton Crewneck Sweater" or "Men's Relaxed Fit Italian Linen Pleated Trousers").
5. Ensure the Target Audience (e.g., "Men") is explicitly included in your specific name.
6. Format MUST BE: https://duckduckgo.com/?q=%5Csite:bananarepublic.gap.com+Men%27s+Relaxed+Fit+Italian+Linen+Pleated+Trousers 
   (The %5C is the URL-encoded backslash which triggers the blind auto-redirect to the top hit).
7. Replace spaces with + in the query string.
8. Return ONLY a valid JSON array of objects, with "item" (the specific name you constructed) and "url" keys. No markdown, no conversational text.`;
        }

        const parts = [
            { text: promptText }
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
            // Removed tools: [{ google_search: {} }] so it generates links instantly.
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

/**
 * Downloads an image and converts it to a base64 string using OffscreenCanvas for Service Worker compatibility.
 * Resizes the image to a maximum of 800px to save Gemini tokens.
 * @param {string} imageUrl 
 * @returns {Promise<string|null>} Base64 data string
 */
async function downloadImageAsBase64(imageUrl) {
    try {
        let base64ImageSource = null;

        // Try to fetch from active tab content script to bypass Pinterest 403 Forbidden checks
        if (typeof chrome !== 'undefined' && chrome.tabs) {
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
        }

        let blob;
        if (base64ImageSource) {
            const r = await fetch(base64ImageSource);
            blob = await r.blob();
        } else {
            const imageResp = await fetch(imageUrl);
            if (!imageResp.ok) throw new Error("Failed to fetch image");
            blob = await imageResp.blob();
        }

        // Service Worker compatible image resizing
        const bitmap = await createImageBitmap(blob);
        let width = bitmap.width;
        let height = bitmap.height;

        const MAX_SIZE = 800;
        if (width > height) {
            if (width > MAX_SIZE) {
                height = Math.round(height * (MAX_SIZE / width));
                width = MAX_SIZE;
            }
        } else {
            if (height > MAX_SIZE) {
                width = Math.round(width * (MAX_SIZE / height));
                height = MAX_SIZE;
            }
        }

        // Use OffscreenCanvas which is supported in Service Workers (no DOM)
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, width, height);

        const resizedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });

        // Convert Blob to Base64 using FileReader sync
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const dataUrl = reader.result;
                resolve(dataUrl.split(',')[1]); // return just the raw base64
            };
            reader.onerror = reject;
            reader.readAsDataURL(resizedBlob);
        });

    } catch (err) {
        console.error("Failed to download or convert image", err);
        return null;
    }
}

// Expose to global scope for both popup (window) and background workers (self)
var globalScope = typeof self !== 'undefined' ? self : window;
globalScope.analyzeImageAndGetShoppingLinks = analyzeImageAndGetShoppingLinks;
globalScope.identifyItemWithGemini = identifyItemWithGemini;
globalScope.searchAllShoppingUrlsWithGemini = searchAllShoppingUrlsWithGemini;
globalScope.downloadImageAsBase64 = downloadImageAsBase64;

/**
 * Unified function to identify items and generate both exact and preferred URLs in a single API call.
 * This drastically reduces API rate limit hits compared to making 3 separate calls per pin.
 * @param {string} base64Data The original image for visual context.
 * @param {string} apiKey The Gemini API Key
 * @param {string} [preferences] Optional string specifying brands, gender, etc.
 * @returns {Promise<Array<{item: string, exact_url: string, preferred_url?: string}>|null>} 
 */
async function analyzeImageAndGetShoppingLinks(base64Data, apiKey, preferences = "") {
    if (!apiKey || !base64Data) return null;

    try {
        let promptText = `Analyze the provided fashion image. Identify each visible clothing item and accessory.
For EACH item, you must generate two things:
1. "item": A highly specific, realistic marketing product name constructed using actual VISIBLE attributes (e.g. "Men's Ribbed Supima Cotton Quarter-Zip Sweater"). DO NOT hallucinate details.
2. "exact_url": 
   - Identify the most likely brand for this item. If the brand is unknown, guess a popular fashion retailer (e.g., Nordstrom, ASOS, Zara, Amazon).
   - Generate a DuckDuckGo "I'm Feeling Lucky" redirect URL to navigate the user to the top ACTUAL PRODUCT PAGE on that website for this specific item.
   - Format: https://duckduckgo.com/?q=%5Csite:brandname.com+Men%27s+Ribbed+Supima+Cotton+Quarter-Zip+Sweater

Return ONLY a valid JSON array of objects with keys "item" and "exact_url". No markdown, no conversational text.`;

        if (preferences) {
            promptText = `Analyze the provided fashion image. Identify each visible clothing item and accessory.
For EACH item, you must generate three things:
1. "item": A highly specific, realistic marketing product name constructed using actual VISIBLE attributes (e.g. "Men's Ribbed Supima Cotton Quarter-Zip Sweater" or "Men's Relaxed Fit Italian Linen Pleated Trousers"). DO NOT hallucinate details.
2. "exact_url": 
   - Identify the most likely brand for this item. If the brand is unknown, guess a popular fashion retailer (e.g., Nordstrom, ASOS, Zara, Amazon).
   - Generate a DuckDuckGo "I'm Feeling Lucky" redirect URL to navigate the user to the top ACTUAL PRODUCT PAGE on that website for this specific item.
   - Format: https://duckduckgo.com/?q=%5Csite:brandname.com+Men%27s+Ribbed+Supima+Cotton+Quarter-Zip+Sweater
3. "preferred_url": 
   - Strictly apply these user preferences: ${preferences}.
   - Figure out the official website domain of the preferred brand.
   - Generate a DuckDuckGo "I'm Feeling Lucky" redirect URL that will automatically navigate the user to the top actual product result on that brand's domain.
   - Ensure the Target Audience (if provided) is included in the specific name query.
   - Format: https://duckduckgo.com/?q=%5Csite:bananarepublic.gap.com+Men%27s+Relaxed+Fit+Italian+Linen+Pleated+Trousers

Return ONLY a valid JSON array of objects with keys "item", "exact_url", and "preferred_url". No markdown, no conversational text.`;
        }

        const parts = [
            { text: promptText },
            {
                inline_data: {
                    mime_type: "image/jpeg",
                    data: base64Data
                }
            }
        ];

        const payload = {
            contents: [{ parts }],
            generationConfig: {
                temperature: 0.1
            }
        };

        let attempts = 0;
        const maxAttempts = 4;

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
                        console.log("Gemini Unified Search Rate Limit Exceeded. Retrying...");
                        const waitMs = 3000 * Math.pow(2, attempts); // Standard exponential backoff

                        console.log(`Waiting ${waitMs}ms before unified search retry...`);
                        await new Promise(r => setTimeout(r, waitMs));
                        attempts++;
                        continue;
                    }

                    console.error("Gemini Unified Search API Error", JSON.stringify(data));
                    return null;
                }

                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                    try {
                        const jsonMatch = text.match(/\[[\s\S]*\]/);
                        if (jsonMatch) {
                            const parsed = JSON.parse(jsonMatch[0]);
                            if (Array.isArray(parsed) && parsed.length > 0) {
                                return parsed;
                            }
                        }
                    } catch (e) {
                        console.error("Failed to parse Gemini unified JSON:", e, text);
                    }
                }
                return null;

            } catch (error) {
                console.error("Gemini Unified Search Request Failed:", error);
                attempts++;
                if (attempts >= maxAttempts) return null;
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        return null;
    } catch (error) {
        console.error("Gemini Unified Search Failed:", error);
        return null;
    }
}

globalScope.analyzeImageAndGetShoppingLinks = analyzeImageAndGetShoppingLinks;
