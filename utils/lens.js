
/**
 * Fetches the "Best Guess" for an image URL using Google's legacy Search By Image.
 * valid host_permissions are required in manifest.json.
 * 
 * @param {string} imageUrl 
 * @returns {Promise<string|null>} The best guess text, or null if failed.
 */
async function fetchLensResult(imageUrl) {
    try {
        // 1. Construct the search URL
        const searchUrl = `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imageUrl)}&client=app`;

        // 2. Fetch the HTML content
        const response = await fetch(searchUrl, {
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });

        if (!response.ok) {
            console.warn("Lens fetch failed:", response.status);
            return null;
        }

        const html = await response.text();

        // 3. Parse the result using Regex (lighter than DOMParser for simple extraction)
        // Common pattern for "Best guess for this image" in the legacy result:
        // "Best guess for this image: ... <a ...>TEXT</a>" 
        // OR inside an input box: value="TEXT"

        // Pattern A: The "Best guess" label often appears near the result.
        // DOM Parser is safer.
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // Strategy 1: Look for the specific "Best guess" container
        // Class names change, but often structure is: [Best guess for this image] [Link with Text]

        // Try to find the input box which often contains the refined search query
        // <input name="q" ... value="KEYWORD">
        const searchInput = doc.querySelector('input[name="q"]');
        if (searchInput && searchInput.value) {
            return searchInput.value;
        }

        // Strategy 2: Look for title tag, often "Result - Google Search"
        // Title usually is "KEYWORD - Google Search"
        const title = doc.title;
        if (title && title.includes(" - Google Search")) {
            return title.replace(" - Google Search", "");
        }

        // Strategy 3: Look for "Best guess for this image" text node
        const links = Array.from(doc.querySelectorAll('a'));
        for (const link of links) {
            // Sometimes the best guess is a link
            if (link.href && link.href.includes("/search?q=")) {
                // Heuristic: The link text might be it
            }
        }

        return null;

    } catch (error) {
        console.warn("Error fetching Lens result:", error);
        return null;
    }
}

// Sleep helper
const wait = (ms) => new Promise(r => setTimeout(r, ms));

window.fetchLensResult = fetchLensResult;
window.wait = wait;
