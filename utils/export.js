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


function exportToHTML(data = []) {
  if (!Array.isArray(data) || !data.length) {
    console.warn("exportToHTML called with empty data.");
    return;
  }

  // Define headers
  const headers = ["Image", "Title", "Description", "Link"];

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

      const title = pin.title || "";
      const desc = pin.description || "";
      const link = pin.link ? `<a href="${pin.link}" target="_blank">${pin.link}</a>` : "";

      return `
      <tr>
        <td>${mediaContent}</td>
        <td>${title}</td>
        <td>${desc}</td>
        <td>${link}</td>
      </tr>`;
    })
    .join("\n");

  // Clean, standard HTML5
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Pinterest Export</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    table { border-collapse: collapse; width: 100%; border: 1px solid #ccc; }
    th, td { border: 1px solid #ccc; padding: 10px; vertical-align: middle; text-align: left; }
    th { background-color: #f4f4f4; font-weight: bold; }
    img, video { border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Pinterest Export Need to Copy? (Cmd+A, Cmd+C) then Paste in Numbers/Excel</h1>
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
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pinterest_pins.html";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

window.exportToCSV = exportToCSV;
window.exportToHTML = exportToHTML;
