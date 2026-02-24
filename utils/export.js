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

function triggerDownload(csvText, filename = "pinterest_export.csv") {
  const blob = new Blob([csvText], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

  triggerDownload(csv, "pinterest_export.csv");
}


function exportToHTML(data = [], boardName = "Pinterest", metadata = {}) {
  if (!Array.isArray(data) || !data.length) {
    console.warn("exportToHTML called with empty data.");
    return;
  }

  // Define headers
  const headers = ["Image", "Item Name", "Description", "Link"];

  // Create HTML table
  let tableRows = data
    .map((pin) => {
      let mediaContent = "";
      if (pin.videoUrl) {
        mediaContent = `<video controls width="150" style="max-width:150px;height:auto;display:block;" poster="${pin.imageUrl || ""
          }">
          <source src="${pin.videoUrl}" type="video/mp4">
          <source src="${pin.videoUrl}" type="video/webm">
          Your browser does not support the video tag.
        </video>`;
      } else if (pin.imageUrl) {
        mediaContent = `<img src="${pin.imageUrl}" width="150" style="max-width:150px;height:auto;display:block;" alt="${pin.title || "pin"
          }">`;
      }

      const title = pin.title || "Unknown Item";
      let desc = pin.description || "";

      // "List it in the description behavior"
      const itemLabel = metadata.itemType ? metadata.itemType : "Item";
      desc += `<br><br><strong>${itemLabel}:</strong> ${title}`;

      let itemNameColumn = title;

      if (pin.lensResult) {
        const items = pin.lensResult.split(',').map(s => s.trim()).filter(Boolean);
        const listHtml = `<ul style="margin-top: 8px; margin-bottom: 0; padding-left: 20px;">` +
          items.map(item => `<li style="margin-bottom: 4px;">${item}</li>`).join('') +
          `</ul>`;

        itemNameColumn = `<div style="font-size: 14px;"><strong>🔮 Gemini Analysis:</strong>${listHtml}</div>
          <div style="margin-top: 16px;">
            <a href="https://lens.google.com/upload?url=${encodeURIComponent(pin.imageUrl)}" target="_blank" 
               style="text-decoration:none; color:#1a73e8; background:#fff; border:1px solid #1a73e8; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:bold; display:inline-flex; align-items:center;">
               Find Exact Visual Match 📸
            </a>
          </div>`;
      } else {
        desc += `<br><br><div style="padding:10px; background:#f1f1f1; border-left:4px solid #888; border-radius:4px;">
            <strong>🔮 Gemini Analysis:</strong><br>
            No match found (Check console)
          </div>`;
      }

      // Render Multiple Shopping Links in Description
      if (pin.shoppingLinks && pin.shoppingLinks.length > 0) {
        const linksHtml = pin.shoppingLinks.map(linkObj => `
          <a href="${linkObj.url}" target="_blank" 
             style="text-decoration:none; color:#fff; background:#E60023; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:bold; display:inline-flex; align-items:center; margin-bottom: 6px;">
             🛍️ Buy ${linkObj.item}
          </a>
        `).join('<br/>');

        desc += `<br><br><div style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px;">
            <strong>Direct Shopping Links:</strong><br>
            ${linksHtml}
          </div>`;
      } else if (pin.lensResult) {
        // Fallback for AI search failure
        desc += `<br><br><div style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
            <a href="https://www.google.com/search?tbm=shop&q=${encodeURIComponent(pin.lensResult)}" target="_blank" 
               style="text-decoration:none; color:#333; background:#fff; border:1px solid #ccc; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:bold; display:inline-flex; align-items:center;">
               Shop This Look 🛍️
            </a>
          </div>`;
      }

      const link = pin.link ? `<a href="${pin.link}" target="_blank">${pin.link}</a>` : "";

      return `
      <tr>
        <td style="vertical-align: top;">${mediaContent}</td>
        <td style="vertical-align: top;">${itemNameColumn}</td>
        <td style="vertical-align: top;">${desc}</td>
        <td style="vertical-align: top; word-break: break-all;">${link}</td>
      </tr>`;
    })
    .join("\n");

  // Construct metadata HTML
  let metadataHtml = "";
  if (metadata.gender || metadata.itemType || metadata.brands) {
    metadataHtml = `<div style="margin-bottom: 20px; padding: 15px; background: #f9f9f9; border-left: 4px solid #1db954;">`;
    if (metadata.gender) {
      metadataHtml += `<p><strong>Target Audience:</strong> ${metadata.gender}</p>`;
    }
    if (metadata.itemType) {
      metadataHtml += `<p><strong>Item Type:</strong> ${metadata.itemType}</p>`;
    }
    if (metadata.brands) {
      metadataHtml += `<p><strong>Preferred Brands/Styles:</strong> ${metadata.brands}</p>`;
    }
    metadataHtml += `</div>`;
  }

  // Clean, standard HTML5
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${boardName} Summary</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    table { border-collapse: collapse; width: 100%; border: 1px solid #ccc; }
    th, td { border: 1px solid #ccc; padding: 10px; vertical-align: middle; text-align: left; }
    th { background-color: #f4f4f4; font-weight: bold; }
    img { border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${boardName} Summary</h1>
  ${metadataHtml}
  <table>
    <thead>
      <tr>
        ${headers.map((h) => `<th>${h}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
</body>
</html>`;

  // Trigger download with .html extension
  const safeFilename = boardName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + "_summary.html";
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

window.exportToCSV = exportToCSV;
window.exportToHTML = exportToHTML;
