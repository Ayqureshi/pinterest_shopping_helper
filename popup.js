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
const SWIPE_HINT_OPACITY = 0.2;

const state = {
  pins: [],
  selections: new Map(),
};
const actionHistory = [];

let baseStatusMessage = "";
let statusIsError = false;

const getPinKey = (pin) => `${pin.link}|${pin.imageUrl}`;

const getSelectedPins = () =>
  state.pins.filter((pin) => state.selections.get(getPinKey(pin)) !== false);

const renderStatus = () => {
  if (!statusElement) {
    return;
  }

  const total = state.pins.length;
  const selected = getSelectedPins().length;
  const summary = total
    ? `Selected ${selected} of ${total} pins for export.`
    : "No pins loaded yet.";
  const combined = baseStatusMessage
    ? `${baseStatusMessage}
${summary}`
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
    if (button) {
      button.disabled = disabled;
    }
  });
};

const setRefreshButtonsDisabled = (disabled) => {
  toggleButtonsDisabled(refreshButtons, disabled);
};

const setExportButtonsDisabled = (disabled) => {
  toggleButtonsDisabled(exportButtons, disabled);
};

const updateExportState = () => {
  setExportButtonsDisabled(getSelectedPins().length === 0);
  renderStatus();
};

const getStackedCards = () =>
  Array.from(cardContainer.querySelectorAll(".card")).sort((a, b) => {
    const zA = Number(a.style.zIndex) || 0;
    const zB = Number(b.style.zIndex) || 0;
    return zB - zA;
  });

const getTopCard = () => getStackedCards()?.[0] || null;

const getHighestZIndex = () => {
  const cards = cardContainer.querySelectorAll(".card");
  if (!cards.length) {
    return 0;
  }
  return Math.max(
    ...Array.from(cards).map((card) => Number(card.style.zIndex) || 0)
  );
};

const findPinByKey = (key) =>
  state.pins.find((pin) => getPinKey(pin) === key) || null;

const updateDecisionButtonsState = () => {
  const hasCards = Boolean(getTopCard());
  toggleButtonsDisabled(
    [decisionControls.approve, decisionControls.reject],
    !hasCards
  );
  if (decisionControls.undo) {
    decisionControls.undo.disabled = actionHistory.length === 0;
  }
};

const commitCardDecision = ({ card, include, yOffset = 0 }) => {
  if (!card) {
    return;
  }

  const key = card.dataset.pinKey;
  const pin = findPinByKey(key);
  if (!pin) {
    card.remove();
    updateDecisionButtonsState();
    return;
  }

  const previousSelection = state.selections.get(key);
  state.selections.set(key, include);
  updateExportState();
  actionHistory.push({ pin, previousSelection });
  updateDecisionButtonsState();

  const direction = include ? 1 : -1;
  card.style.transform = `translate(${direction * 400}px, ${yOffset}px) rotate(${direction * 30
    }deg)`;
  card.style.opacity = 0;

  setTimeout(() => {
    card.remove();
    updateDecisionButtonsState();
  }, 300);
};

const undoLastAction = () => {
  const last = actionHistory.pop();
  if (!last) {
    updateDecisionButtonsState();
    return;
  }

  const { pin, previousSelection } = last;
  const key = getPinKey(pin);
  if (typeof previousSelection === "undefined") {
    state.selections.delete(key);
  } else {
    state.selections.set(key, previousSelection);
  }
  updateExportState();

  const card = createCard(pin);
  card.style.opacity = 0;
  card.style.zIndex = getHighestZIndex() + 1;
  cardContainer.appendChild(card);

  requestAnimationFrame(() => {
    card.style.transition = "transform 0.3s ease, opacity 0.3s ease";
    card.style.opacity = 1;
  });

  updateDecisionButtonsState();
};

const triggerDecisionFromButton = (include) => {
  const card = getTopCard();
  if (!card) {
    return;
  }
  commitCardDecision({ card, include, yOffset: 0 });
};

const createCard = (pin) => {
  const key = getPinKey(pin);
  if (!state.selections.has(key)) {
    state.selections.set(key, true);
  }

  const card = document.createElement("div");
  card.className = "card";
  card.dataset.pinKey = key;

  // Add swipe actions
  const approveAction = document.createElement("div");
  approveAction.className = "swipe-action approve";
  approveAction.innerHTML = "&#10003;"; // Checkmark
  card.appendChild(approveAction);

  const rejectAction = document.createElement("div");
  rejectAction.className = "swipe-action reject";
  rejectAction.innerHTML = "&#10007;"; // X
  card.appendChild(rejectAction);

  const cardContent = document.createElement("div");
  cardContent.style.padding = "12px";

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

  cardContent.appendChild(title);
  cardContent.appendChild(desc);
  cardContent.appendChild(link);

  if (pin.imageUrl) {
    const img = document.createElement("img");
    img.src = pin.imageUrl;
    img.alt = pin.title || "Pin image";
    img.style.width = "100%";
    img.style.borderRadius = "8px";
    img.style.marginTop = "6px";
    cardContent.appendChild(img);
  }

  card.appendChild(cardContent);

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let x = 0;
  let y = 0;

  const resetSwipeHints = () => {
    approveAction.style.opacity = SWIPE_HINT_OPACITY;
    rejectAction.style.opacity = SWIPE_HINT_OPACITY;
  };

  resetSwipeHints();

  const onPointerDown = (e) => {
    isDragging = true;
    card.classList.add("dragging");
    startX = e.pageX || e.touches[0].pageX;
    startY = e.pageY || e.touches[0].pageY;
    card.style.transition = "none";
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;

    const currentX = e.pageX || e.touches[0].pageX;
    const currentY = e.pageY || e.touches[0].pageY;

    x = currentX - startX;
    y = currentY - startY;

    card.style.transform = `translate(${x}px, ${y}px) rotate(${x / 20}deg)`;

    // Show approve/reject actions
    const opacity = Math.min(Math.abs(x) / 100, 1);
    if (x > 10) {
      approveAction.style.opacity = Math.max(SWIPE_HINT_OPACITY, opacity);
      rejectAction.style.opacity = SWIPE_HINT_OPACITY;
    } else if (x < -10) {
      rejectAction.style.opacity = Math.max(SWIPE_HINT_OPACITY, opacity);
      approveAction.style.opacity = SWIPE_HINT_OPACITY;
    } else {
      resetSwipeHints();
    }
  };

  const onPointerUp = () => {
    if (!isDragging) return;
    isDragging = false;
    card.classList.remove("dragging");
    card.style.transition = "transform 0.3s ease, opacity 0.3s ease";

    if (Math.abs(x) > 100) {
      // Swiped far enough; direction decides selection
      const include = x > 0;
      commitCardDecision({ card, include, yOffset: y });
    } else {
      // Didn't swipe far enough, return to center
      card.style.transform = "translate(0, 0) rotate(0)";
      resetSwipeHints();
    }
  };

  card.addEventListener("mousedown", onPointerDown);
  card.addEventListener("mousemove", onPointerMove);
  card.addEventListener("mouseup", onPointerUp);
  card.addEventListener("mouseleave", onPointerUp);

  card.addEventListener("touchstart", onPointerDown);
  card.addEventListener("touchmove", onPointerMove);
  card.addEventListener("touchend", onPointerUp);

  return card;
};

const renderPins = () => {
  cardContainer.innerHTML = "";
  actionHistory.length = 0;

  if (!state.pins.length) {
    const emptyState = document.createElement("div");
    emptyState.textContent = "No pins found on this board.";
    emptyState.style.padding = "20px";
    cardContainer.appendChild(emptyState);
    updateDecisionButtonsState();
    return;
  }

  state.pins.forEach((pin, index) => {
    const card = createCard(pin);
    // Stacking effect
    card.style.zIndex = state.pins.length - index;
    cardContainer.appendChild(card);
  });
  updateDecisionButtonsState();
};

const exportSelectedPins = () => {
  const selected = getSelectedPins();
  if (!selected.length) {
    setStatus("Select at least one pin before exporting.", true);
    return;
  }

  try {
    exportToHTML(selected);
    setStatus(`Exported ${selected.length} pins to HTML. Open file & copy to Numbers.`);
  } catch (error) {
    console.error("Failed to export pins", error);
    setStatus("Failed to export pins.", true);
  }
};

const requestPinsFromActiveTab = () => {
  setStatus("Collecting pins… this may take a moment.");
  setRefreshButtonsDisabled(true);
  setExportButtonsDisabled(true);
  actionHistory.length = 0;
  updateDecisionButtonsState();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const [tab] = tabs;

    if (!tab?.id) {
      setStatus("Unable to find the active tab.", true);
      setRefreshButtonsDisabled(false);
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "GET_PINS" }, (response) => {
      setRefreshButtonsDisabled(false);

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
      renderPins();
      setStatus(
        `Loaded ${state.pins.length} pins. Swipe right to include, left to exclude.`
      );
      updateExportState();
    });
  });
};

refreshButtons.forEach((button) =>
  button.addEventListener("click", requestPinsFromActiveTab)
);
exportButtons.forEach((button) =>
  button.addEventListener("click", exportSelectedPins)
);

decisionControls.approve?.addEventListener("click", () =>
  triggerDecisionFromButton(true)
);
decisionControls.reject?.addEventListener("click", () =>
  triggerDecisionFromButton(false)
);
decisionControls.undo?.addEventListener("click", undoLastAction);

requestPinsFromActiveTab();
