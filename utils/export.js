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

window.exportToCSV = exportToCSV;
