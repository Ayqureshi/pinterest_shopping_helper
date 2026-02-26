function sanitizeValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

function collectHeaders(records = []) {
  const headers = [];

  records.forEach((record) => {
    Object.keys(record || {}).forEach((key) => {
      if (!headers.includes(key)) {
        headers.push(key);
      }
    });
  });

  return headers;
}

function buildCSV(data = []) {
  const headers = collectHeaders(data);
  if (!headers.length) {
    return "";
  }

  const headerRow = headers.join(",");
  const rows = data.map((item) =>
    headers.map((header) => sanitizeValue(item?.[header] ?? "")).join(",")
  );
  return [headerRow, ...rows].join("\n");
}

function triggerDownload(content, filename = "pinterest_export.csv", mimeType = "text/csv") {
  if (typeof chrome !== 'undefined' && chrome.downloads) {
    // Background worker compatibility
    const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    });
  } else {
    // Fallback for DOM environments (popup.js)
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

function exportToCSV(arrayOfObjects = []) {
  if (!Array.isArray(arrayOfObjects) || !arrayOfObjects.length) {
    console.warn("exportToCSV called with empty data.");
    return;
  }

  const csv = buildCSV(arrayOfObjects);
  if (!csv) {
    console.warn("exportToCSV could not build CSV from the provided data.");
    return;
  }

  triggerDownload(csv, "pinterest_export.csv", "text/csv");
}


function exportToHTML(data = [], boardName = "Pinterest", metadata = {}) {
  if (!Array.isArray(data) || !data.length) {
    console.warn("exportToHTML called with empty data.");
    return;
  }

  // Create HTML cards
  let cardsHtml = data.map((pin) => {
    // Generate a mock price between $30 and $250 for the shop app feel
    const mockPrice = Math.floor(Math.random() * 220) + 30;

    let mediaContent = "";
    if (pin.videoUrl) {
      mediaContent = `<video controls autoplay loop muted playsinline poster="${pin.imageUrl || ""}">
        <source src="${pin.videoUrl}" type="video/mp4">
        <source src="${pin.videoUrl}" type="video/webm">
      </video>`;
    } else if (pin.imageUrl) {
      mediaContent = `<img src="${pin.imageUrl}" alt="${pin.title || 'Outfit'}">`;
    }

    const title = pin.title || "Curated Look";
    const desc = pin.description || "";
    
    let outfitBreakdown = "";
    if (pin.lensResult && Array.isArray(pin.lensResult) || (typeof pin.lensResult === 'string' && pin.lensResult)) {
        let items = [];
        if (typeof pin.lensResult === 'string') {
            items = pin.lensResult.split(',').map(s => s.trim()).filter(Boolean);
        } else {
            items = pin.lensResult;
        }
        if (items.length > 0) {
            outfitBreakdown = `<div class="section-title">Outfit Breakdown</div>
            <div class="outfit-pills">` + items.map(i => `<span class="pill">${i}</span>`).join('') + `</div>`;
        }
    }

    let shoppingLinksHtml = "";
    if (pin.shoppingLinks && pin.shoppingLinks.length > 0) {
        shoppingLinksHtml += `<div class="section-title">Alternative Options</div>`;
        shoppingLinksHtml += pin.shoppingLinks.map(link => 
            `<a href="${link.url}" target="_blank" class="btn btn-primary">🛍️ Buy ${link.item}</a>`
        ).join("");
    }
    
    let preferredLinksHtml = "";
    // Only show "Preferred Matches" if metadata was used/requested
    const hasPreferences = !!(metadata.gender || metadata.itemType || metadata.brands);
    if (hasPreferences && pin.preferredLinks && pin.preferredLinks.length > 0) {
        preferredLinksHtml += `<div class="section-title">Top Style Matches</div>`;
        preferredLinksHtml += pin.preferredLinks.map(link => 
            `<a href="${link.url}" target="_blank" class="btn btn-success">✨ ${link.item}</a>`
        ).join("");
    }

    // Create Excel-Style View for this specific pin
    const itemLabel = metadata.itemType ? metadata.itemType : "Item";
    let excelDesc = pin.description ? pin.description + `<br><br><strong>${itemLabel}:</strong> ${title}` : `<strong>${itemLabel}:</strong> ${title}`;
    
    let itemNameColumn = title;
    if (pin.lensResult) {
        let excelItems = typeof pin.lensResult === 'string' ? pin.lensResult.split(',').map(s => s.trim()).filter(Boolean) : pin.lensResult;
        const listHtml = `<ul style="margin-top: 8px; margin-bottom: 0; padding-left: 20px;">` +
          excelItems.map(item => `<li style="margin-bottom: 4px;">${item}</li>`).join('') +
          `</ul>`;
        itemNameColumn = `<div style="font-size: 14px;"><strong>🔮 Gemini Analysis:</strong>${listHtml}</div>
          <div style="margin-top: 16px;">
            <a href="https://lens.google.com/upload?url=${encodeURIComponent(pin.imageUrl)}" target="_blank" 
               style="text-decoration:none; color:#1a73e8; background:#fff; border:1px solid #1a73e8; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:bold; display:inline-flex; align-items:center;">
               Find Exact Visual Match 📸
            </a>
          </div>`;
    } else {
        excelDesc += `<br><br><div style="padding:10px; background:#f1f1f1; border-left:4px solid #888; border-radius:4px;">
            <strong>🔮 Gemini Analysis:</strong><br>No match found</div>`;
    }
    
    if (pin.shoppingLinks && pin.shoppingLinks.length > 0) {
        const linksHtml = pin.shoppingLinks.map(linkObj => `
          <a href="${linkObj.url}" target="_blank" 
             style="text-decoration:none; color:#fff; background:#E60023; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:bold; display:inline-flex; align-items:center; margin-bottom: 6px;">
             🛍️ Buy ${linkObj.item}
          </a>`).join('<br/>');
        excelDesc += `<br><br><div style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px;"><strong>Direct Shopping Links:</strong><br>${linksHtml}</div>`;
    }
    
    let excelPreferredTd = "";
    if (hasPreferences) {
        if (pin.preferredLinks && pin.preferredLinks.length > 0) {
            const pLinksHtml = pin.preferredLinks.map(linkObj => `
                <a href="${linkObj.url}" target="_blank" 
                   style="text-decoration:none; color:#fff; background:#1db954; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:bold; display:inline-flex; align-items:center; margin-bottom: 6px;">
                   ✨ Shop ${linkObj.item}
                </a>`).join('<br/>');
            excelPreferredTd = `<td style="vertical-align: top;"><div style="display: flex; flex-direction: column; gap: 4px;"><strong>Style Matches:</strong><br>${pLinksHtml}</div></td>`;
        } else {
            excelPreferredTd = `<td style="vertical-align: top;"><span style="color: #888; font-size:12px; font-style: italic;">No specific matches found</span></td>`;
        }
    }
    
    let tableMediaContent = "";
    if (pin.videoUrl) {
      tableMediaContent = `<video controls width="150" style="max-width:150px;height:auto;display:block;" poster="${pin.imageUrl || ""}">
        <source src="${pin.videoUrl}" type="video/mp4">
      </video>`;
    } else if (pin.imageUrl) {
      tableMediaContent = `<img src="${pin.imageUrl}" width="150" style="max-width:150px;height:auto;display:block;">`;
    }
    
    let tableHeaders = ["Image", "Item Name", "Description"];
    if (hasPreferences) { tableHeaders.push("Preferred Matches"); }
    tableHeaders.push("Link");
    
    const excelPinLink = pin.link ? `<a href="${pin.link}" target="_blank">${pin.link}</a>` : "";
    
    const singlePinHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Pin Details</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    table { border-collapse: collapse; width: 100%; border: 1px solid #ccc; }
    th, td { border: 1px solid #ccc; padding: 10px; vertical-align: middle; text-align: left; }
    th { background-color: #f4f4f4; font-weight: bold; }
    img { border-radius: 4px; }
  </style>
</head>
<body>
  <h2>${title}</h2>
  <table>
    <thead><tr>${tableHeaders.map(h => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>
      <tr>
        <td style="vertical-align: top;">${tableMediaContent}</td>
        <td style="vertical-align: top;">${itemNameColumn}</td>
        <td style="vertical-align: top;">${excelDesc}</td>
        ${excelPreferredTd}
        <td style="vertical-align: top; word-break: break-all;">${excelPinLink}</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

    // Extremely important: use encodeURIComponent or btoa for safely embedding full HTML inside an href
    const dataUri = "data:text/html;charset=utf-8," + encodeURIComponent(singlePinHtml);

    const similarWebBtn = pin.imageUrl ? `<a href="${dataUri}" target="_blank" class="btn btn-outline" rel="noopener noreferrer">🔍 See similar on web</a>` : "";


    return `
      <div class="card" data-price="${mockPrice}">
        <div class="media">
            ${mediaContent}
            <div class="price-tag">~$${mockPrice}</div>
        </div>
        <div class="content">
            <h3 class="title">${title}</h3>
            ${desc ? `<div class="desc">${desc}</div>` : ''}
            
            ${outfitBreakdown}
            
            <div class="shop-links">
                ${preferredLinksHtml}
                ${shoppingLinksHtml}
                ${similarWebBtn}
            </div>
        </div>
      </div>
    `;
  }).join("");

  // Construct metadata HTML
  let metadataHtml = "";
  if (metadata.gender || metadata.itemType || metadata.brands) {
    metadataHtml = `<div class="metadata">
      ${metadata.gender ? `<span class="meta-badge">${metadata.gender}</span>` : ""}
      ${metadata.itemType ? `<span class="meta-badge">${metadata.itemType}</span>` : ""}
      ${metadata.brands ? `<span class="meta-badge">${metadata.brands}</span>` : ""}
    </div>`;
  }

  // Clean, standard HTML5 with modern UI styling
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${boardName} Shopping List</title>
  <style>
    :root {
      --primary: #111;
      --background: #f4f6f8;
      --surface: #fff;
      --text: #333;
      --text-light: #666;
      --accent: #E60023;
      --success: #1db954;
      --border: #eaeaea;
    }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
      margin: 0; padding: 0; 
      background: var(--background); 
      color: var(--text);
    }
    .header {
      background: var(--surface);
      padding: 24px 40px;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }
    .header-content h1 {
      margin: 0; font-size: 28px; font-weight: 800; color: var(--primary); letter-spacing: -0.5px;
    }
    .metadata {
      display: flex; gap: 8px; margin-top: 10px; font-size: 13px; color: var(--text-light); flex-wrap: wrap;
    }
    .meta-badge {
      background: #f1f3f4; padding: 6px 12px; border-radius: 20px; font-weight: 600; color: #5f6368;
    }
    .controls {
      display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 600;
      background: #f8f9fa; padding: 12px 20px; border-radius: 30px; border: 1px solid var(--border);
    }
    input[type=range] {
      accent-color: var(--primary); cursor: pointer;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 32px;
      padding: 40px;
      max-width: 1600px;
      margin: 0 auto;
    }
    .card {
      background: var(--surface);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 8px 30px rgba(0,0,0,0.06);
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      display: flex;
      flex-direction: column;
      border: 1px solid rgba(0,0,0,0.04);
    }
    .card:hover {
      transform: translateY(-6px);
      box-shadow: 0 14px 40px rgba(0,0,0,0.1);
    }
    .media {
      position: relative;
      width: 100%;
      height: 400px;
      background: #f0f0f0;
      overflow: hidden;
    }
    .media img, .media video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.5s;
    }
    .card:hover .media img {
      transform: scale(1.05);
    }
    .price-tag {
      position: absolute;
      top: 16px;
      right: 16px;
      background: rgba(255,255,255,0.95);
      color: var(--primary);
      padding: 8px 16px;
      border-radius: 24px;
      font-weight: 800;
      font-size: 15px;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      letter-spacing: -0.5px;
    }
    .content {
      padding: 24px;
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .title {
      font-size: 20px; font-weight: 800; margin: 0 0 8px 0;
      color: var(--primary); letter-spacing: -0.5px; line-height: 1.3;
    }
    .desc {
      font-size: 14px; color: var(--text-light); margin-bottom: 24px; flex: 1;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5;
    }
    .section-title {
      font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;
      color: #9aa0a6; margin-bottom: 12px; margin-top: 16px;
    }
    .outfit-pills {
      display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;
    }
    .pill {
      background: var(--surface); border: 1px solid #e1e3e8; color: #4a5568;
      padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;
      box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    }
    .btn {
      display: flex; justify-content: center; align-items: center; width: 100%; padding: 14px; border-radius: 12px; text-decoration: none;
      font-size: 14px; font-weight: 700; text-align: center; transition: all 0.2s;
      box-sizing: border-box; margin-bottom: 10px; cursor: pointer; letter-spacing: -0.2px;
    }
    .btn-primary {
      background: var(--primary); color: white; border: 1px solid var(--primary);
    }
    .btn-primary:hover { background: #333; transform: scale(1.02); }
    .btn-success {
      background: var(--success); color: white; border: 1px solid var(--success);
    }
    .btn-success:hover { background: #189a45; box-shadow: 0 4px 12px rgba(29, 185, 84, 0.3); transform: scale(1.02); }
    .btn-outline {
      background: transparent; color: var(--primary); border: 2px solid #e1e3e8; margin-top: 4px;
    }
    .btn-outline:hover { background: #f8f9fa; border-color: var(--primary); }
    
    .shop-links {
       display: flex; flex-direction: column; 
    }
    
    @media (max-width: 768px) {
        .header { flex-direction: column; align-items: flex-start; gap: 16px; padding: 20px; }
        .controls { width: 100%; justify-content: space-between; box-sizing: border-box; }
        .grid { padding: 20px; gap: 20px; grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="header">
      <div class="header-content">
          <h1>${boardName}</h1>
          ${metadataHtml}
      </div>
      <div class="controls">
          <label for="budget">Max Budget:</label>
          <input type="range" id="budget" min="30" max="300" value="300" oninput="updateBudget(this.value)">
          <span id="budget-val" style="min-width: 45px; text-align: right;">$300+</span>
      </div>
  </div>
  
  <div class="grid" id="grid">
      ${cardsHtml}
  </div>

  <script>
      function updateBudget(val) {
          document.getElementById('budget-val').textContent = val >= 300 ? '$300+' : '$' + val;
          const cards = document.querySelectorAll('.card');
          cards.forEach(card => {
              const price = parseInt(card.getAttribute('data-price'));
              if (price <= val || val >= 300) {
                  card.style.display = 'flex';
              } else {
                  card.style.display = 'none';
              }
          });
      }
  </script>
</body>
</html>`;

  const safeFilename = boardName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + "_shopping_app.html";
  triggerDownload(html, safeFilename, "text/html");
}

var globalScope = typeof self !== 'undefined' ? self : window;
globalScope.exportToCSV = exportToCSV;
globalScope.exportToHTML = exportToHTML;
