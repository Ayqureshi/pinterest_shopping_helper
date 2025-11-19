const refreshButton = document.getElementById("refresh");
const exportButton = document.getElementById("export");
const undoButton = document.getElementById("undo");
const statusElement = document.getElementById("status");
const listElement = document.getElementById("pins");

const state = {
  pins: [],
  selections: new Map(),
  hidden: new Set(),
  removalStack: [],
};

let baseStatusMessage = "";
let statusIsError = false;

const getPinKey = (pin) => `${pin.link}|${pin.imageUrl}`;

const getVisiblePins = () =>
  state.pins.filter((pin) => !state.hidden.has(getPinKey(pin)));

const getSelectedPins = () =>
  getVisiblePins().filter(
    (pin) => state.selections.get(getPinKey(pin)) !== false
  );

const updateUndoState = () => {
  if (undoButton) {
    undoButton.disabled = state.removalStack.length === 0;
  }
};

const renderStatus = () => {
  if (!statusElement) {
    return;
  }

  const total = state.pins.length;
  const visible = getVisiblePins().length;
  const selected = getSelectedPins().length;
  let summary;

  if (!total) {
    summary = "No pins loaded yet.";
  } else if (!visible) {
    summary = `All ${total} pins are currently hidden. Use Undo to restore.`;
  } else {
    summary = `Selected ${selected} of ${visible} visible pins (total scraped: ${total}).`;
  }

  const combined = baseStatusMessage
    ? `${baseStatusMessage}\n${summary}`
    : summary;

  if ("value" in statusElement) {
    statusElement.value = combined;
  } else {
    statusElement.textContent = combined;
  }
  statusElement.style.color = statusIsError ? "#c00" : "#333";
};

const setStatus = (message = "", isError = false) => {
  baseStatusMessage = message;
  statusIsError = isError;
  renderStatus();
};

const updateExportState = () => {
  if (exportButton) {
    exportButton.disabled = getSelectedPins().length === 0;
  }
  renderStatus();
};

const syncSelectionControls = (includeButton, excludeButton, key) => {
  const included = state.selections.get(key) !== false;
  includeButton.classList.toggle("active", included);
  excludeButton.classList.toggle("active", !included);
};

const removePinFromView = (key) => {
  if (state.hidden.has(key)) {
    return;
  }
  const wasSelected = state.selections.get(key) !== false;
  state.hidden.add(key);
  state.selections.set(key, false);
  state.removalStack.push({ key, wasSelected });
  updateUndoState();
  renderPins();
  updateExportState();
  setStatus("Removed pin. Use Undo to restore it.", false);
};

const undoRemoval = () => {
  if (!state.removalStack.length) {
    return;
  }

  const { key, wasSelected } = state.removalStack.pop();
  state.hidden.delete(key);
  state.selections.set(key, wasSelected);

  updateUndoState();
  renderPins();
  updateExportState();
  setStatus("Restored the most recently removed pin.", false);
};

const renderPins = () => {
  listElement.innerHTML = "";

  const visiblePins = getVisiblePins();

  if (!visiblePins.length) {
    const emptyState = document.createElement("li");
    if (!state.pins.length) {
      emptyState.textContent = "No pins found on this board.";
    } else {
      emptyState.textContent =
        "All pins hidden. Click Undo Remove to restore the most recent pin.";
    }
    listElement.appendChild(emptyState);
    return;
  }

  visiblePins.forEach((pin) => {
    const key = getPinKey(pin);
    if (!state.selections.has(key)) {
      state.selections.set(key, true);
    }

    const listItem = document.createElement("li");

    const controls = document.createElement("div");
    controls.className = "pin-controls";

    const approveBtn = document.createElement("button");
    approveBtn.className = "approve";
    approveBtn.innerHTML = "&#10003;";
    approveBtn.title = "Include this pin";

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "reject";
    rejectBtn.innerHTML = "&#10007;";
    rejectBtn.title = "Exclude this pin";

    approveBtn.addEventListener("click", () => {
      state.selections.set(key, true);
      syncSelectionControls(approveBtn, rejectBtn, key);
      updateExportState();
    });

    rejectBtn.addEventListener("click", () => {
      removePinFromView(key);
    });

    syncSelectionControls(approveBtn, rejectBtn, key);

    controls.appendChild(approveBtn);
    controls.appendChild(rejectBtn);

    const title = document.createElement("p");
    title.className = "pin-title";
    title.textContent = pin.title || "Untitled Pin";

    const desc = document.createElement("p");
    desc.className = "pin-description";
    desc.textContent = pin.description || "No description available.";

    const link = document.createElement("a");
    link.className = "pin-link";
    link.textContent = pin.link;
    link.href = pin.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    listItem.appendChild(controls);
    listItem.appendChild(title);
    listItem.appendChild(desc);
    listItem.appendChild(link);

    if (pin.imageUrl) {
      const img = document.createElement("img");
      img.src = pin.imageUrl;
      img.alt = pin.title || "Pin image";
      img.style.maxWidth = "100%";
      img.style.marginTop = "6px";
      listItem.appendChild(img);
    }

    listElement.appendChild(listItem);
  });
};

const exportSelectedPins = () => {
  const selected = getSelectedPins();
  if (!selected.length) {
    setStatus("Select at least one pin before exporting.", true);
    return;
  }

  try {
    exportToCSV(selected);
    setStatus(`Exported ${selected.length} pins to CSV.`);
  } catch (error) {
    console.error("Failed to export pins", error);
    setStatus("Failed to export pins to CSV.", true);
  }
};

const requestPinsFromActiveTab = () => {
  setStatus("Collecting pins… this may take a moment.");
  refreshButton.disabled = true;
  if (exportButton) {
    exportButton.disabled = true;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const [tab] = tabs;

    if (!tab?.id) {
      setStatus("Unable to find the active tab.", true);
      refreshButton.disabled = false;
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "GET_PINS" }, (response) => {
      refreshButton.disabled = false;

      if (chrome.runtime.lastError) {
        setStatus(
          `Unable to reach the Pinterest page. ${chrome.runtime.lastError.message}`,
          true
        );
        return;
      }

      if (!response?.success) {
        setStatus(response?.error || "Failed to collect pins.", true);
        return;
      }

      state.pins = response.pins || [];
      state.selections = new Map();
      state.pins.forEach((pin) => {
        state.selections.set(getPinKey(pin), true);
      });
      state.hidden = new Set();
      state.removalStack = [];
      updateUndoState();
      renderPins();
      setStatus(
        `Loaded ${state.pins.length} pins. Use the green check to include or the red X to exclude each item before exporting.`
      );
      updateExportState();
    });
  });
};

refreshButton.addEventListener("click", requestPinsFromActiveTab);
exportButton.addEventListener("click", exportSelectedPins);
undoButton.addEventListener("click", undoRemoval);
requestPinsFromActiveTab();
