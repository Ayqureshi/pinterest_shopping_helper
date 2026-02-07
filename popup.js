const refreshButtons = Array.from(
  document.querySelectorAll('[data-action="refresh"]')
);
const exportButtons = Array.from(
  document.querySelectorAll('[data-action="export"]')
);
const decisionControls = {
  approve: document.querySelector('[data-decision="approve"]'),
  reject: document.querySelector('[data-decision="reject"]'),
  undo: document.querySelector('[data-decision="undo"]'),
};
const statusElement = document.getElementById("status");
const cardContainer = document.getElementById("card-container");

const state = {
  pins: [],
  selections: new Map(), // key -> boolean
  activePinIndex: 0,
};

const actionHistory = []; // Stores { pin, previousSelection }

let baseStatusMessage = "";
let statusIsError = false;

const getPinKey = (pin) => pin.link;

const getSelectedPins = () =>
  state.pins.filter((pin) => state.selections.get(getPinKey(pin)) === true); // Only explicit true

const renderStatus = () => {
  if (!statusElement) return;

  const total = state.pins.length;
  const current = Math.min(state.activePinIndex + 1, total);
  const selected = getSelectedPins().length;

  let summary = "";
  if (total === 0) {
    summary = "No pins loaded.";
  } else if (state.activePinIndex >= total) {
    summary = `All ${total} pins reviewed. Selected ${selected}. Ready to export.`;
  } else {
    summary = `Reviewing pin ${current} of ${total}. Selected ${selected} so far.`;
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

const toggleButtonsDisabled = (buttons, disabled) => {
  buttons.forEach((button) => {
    if (button) button.disabled = disabled;
  });
};

const updateExportState = () => {
  toggleButtonsDisabled(exportButtons, getSelectedPins().length === 0);
  renderStatus();
};

const updateDecisionButtonsState = () => {
  const isFinished = state.activePinIndex >= state.pins.length;
  const hasPins = state.pins.length > 0;

  // Disable Approve/Reject if finished or no pins
  const decisionDisabled = isFinished || !hasPins;
  toggleButtonsDisabled(
    [decisionControls.approve, decisionControls.reject],
    decisionDisabled
  );

  // Undo disabled if at start
  if (decisionControls.undo) {
    decisionControls.undo.disabled = state.activePinIndex === 0;
  }
};

const commitCardDecision = (include) => {
  const pin = state.pins[state.activePinIndex];
  if (!pin) return;

  const key = getPinKey(pin);
  const previousSelection = state.selections.get(key);

  state.selections.set(key, include);
  actionHistory.push({ pin, previousSelection });

  state.activePinIndex++;

  // Scroll to top for next card
  window.scrollTo({ top: 0, behavior: 'auto' });

  renderCurrentPin();
  updateExportState();
  updateDecisionButtonsState();
};

const undoLastAction = () => {
  if (state.activePinIndex <= 0) return;

  state.activePinIndex--;
  const lastAction = actionHistory.pop();

  // Restore selection state (optional, or just leave it as is, it will be overwritten if they decide again)
  // But logically, if we undo, we might want to revert the selection map change?
  // Actually, keeping the map change is fine, but visually we are back to deciding.
  // Let's restore strictly if we want to support "Cancel" but here we just go back.

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'auto' });

  renderCurrentPin();
  updateExportState();
  updateDecisionButtonsState();
};

const createCard = (pin) => {
  const card = document.createElement("div");
  card.className = "card";

  const cardContent = document.createElement("div");
  cardContent.style.padding = "12px";

  const title = document.createElement("h3");
  title.className = "pin-title";
  title.textContent = pin.title || "Untitled Pin";
  title.style.margin = "0 0 8px 0";
  title.style.fontSize = "16px";
  cardContent.appendChild(title);

  if (pin.description && pin.description !== "No description available.") {
    const desc = document.createElement("p");
    desc.className = "pin-description";
    desc.textContent = pin.description;
    desc.style.fontSize = "14px";
    desc.style.color = "#555";
    desc.style.marginBottom = "8px";
    cardContent.appendChild(desc);
  }

  if (pin.imageUrl) {
    const img = document.createElement("img");
    img.src = pin.imageUrl;
    img.alt = pin.title || "Pin image";
    img.style.width = "100%";
    img.style.borderRadius = "8px";
    img.style.marginBottom = "8px";
    cardContent.appendChild(img);
  }

  if (pin.videoUrl) {
    const video = document.createElement("video");
    video.src = pin.videoUrl;
    video.controls = true;
    video.style.width = "100%";
    video.style.borderRadius = "8px";
    video.style.marginBottom = "8px";
    cardContent.appendChild(video);
  }

  const link = document.createElement("a");
  link.className = "pin-link";
  link.textContent = "View on Pinterest";
  link.href = pin.link;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "inline-block";
  link.style.marginTop = "4px";
  link.style.color = "#007bff";
  link.style.textDecoration = "none";
  link.style.fontSize = "14px";
  cardContent.appendChild(link);

  card.appendChild(cardContent);
  return card;
};

const renderCurrentPin = () => {
  cardContainer.innerHTML = "";

  if (!state.pins.length) {
    cardContainer.textContent = "No pins loaded.";
    cardContainer.style.padding = "20px";
    cardContainer.style.textAlign = "center";
    return;
  }

  if (state.activePinIndex >= state.pins.length) {
    const finishedMsg = document.createElement("div");
    finishedMsg.innerHTML = `
      <div style="text-align: center; padding: 40px 20px;">
        <h3>All Done!</h3>
        <p>You have reviewed all ${state.pins.length} pins.</p>
        <p>Selected: ${getSelectedPins().length}</p>
        <p>Click "Export Selected" to finish.</p>
      </div>
    `;
    cardContainer.appendChild(finishedMsg);
    return;
  }

  const pin = state.pins[state.activePinIndex];
  const card = createCard(pin);
  cardContainer.appendChild(card);
};

// --- Initialization & Event Listeners ---

const exportSelectedPins = () => {
  const selected = getSelectedPins();
  if (!selected.length) {
    setStatus("Select at least one pin before exporting.", true);
    return;
  }
  try {
    exportToHTML(selected);
    setStatus(`Exported ${selected.length} pins.`);
  } catch (error) {
    console.error("Export failed", error);
    setStatus("Failed to export.", true);
  }
};

const requestPinsFromActiveTab = () => {
  setStatus("Collecting pins... please wait.");
  toggleButtonsDisabled(refreshButtons, true);
  toggleButtonsDisabled(exportButtons, true);

  state.pins = [];
  state.selections.clear();
  state.activePinIndex = 0;
  actionHistory.length = 0;
  renderCurrentPin();
  updateDecisionButtonsState();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const [tab] = tabs;
    if (!tab?.id) {
      setStatus("No active tab.", true);
      toggleButtonsDisabled(refreshButtons, false);
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "GET_PINS" }, (response) => {
      toggleButtonsDisabled(refreshButtons, false);

      if (chrome.runtime.lastError) {
        setStatus(`Error: ${chrome.runtime.lastError.message}`, true);
        return;
      }
      if (!response?.success) {
        setStatus(response?.error || "Failed to collect pins.", true);
        return;
      }

      state.pins = response.pins || [];
      // Default: select all? Or select none? 
      // User flow suggests they want to "Keep" or "Skip".
      // Let's assume default is "undefined" (not selected) until they choose.
      // Or, better, assume "selected" if they export without reviewing?
      // No, "Reviewing" implies filtering. Let's make them choose.
      // But if they just want to grab all, they might get annoyed.
      // Let's auto-select all initially?
      // "Swipe right to include, left to exclude" implies partial selection.
      // Let's default to TRUE (Include) for everything, and "Skip" sets to FALSE.
      // That way if they scroll 5 pins and export, do they get 5 or 27?
      // Previously: `state.selections.get(key) !== false` (default true).
      // Let's keep that.
      state.pins.forEach(p => state.selections.set(getPinKey(p), true));

      state.activePinIndex = 0;
      renderCurrentPin();
      setStatus(""); // Clear loading message, renderStatus will take over
      renderStatus();
      updateExportState();
      updateDecisionButtonsState();
    });
  });
};

refreshButtons.forEach(btn => btn.addEventListener("click", requestPinsFromActiveTab));
exportButtons.forEach(btn => btn.addEventListener("click", exportSelectedPins));

decisionControls.approve?.addEventListener("click", () => commitCardDecision(true));
decisionControls.reject?.addEventListener("click", () => commitCardDecision(false));
decisionControls.undo?.addEventListener("click", undoLastAction);

// Init
renderCurrentPin();
updateDecisionButtonsState();
