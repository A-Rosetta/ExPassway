(function () {
  const TOKEN_KEY = "alevel.authToken";
  const PROFILE_KEY = "alevel.userProfile";
  const DEFAULTS = {
    enabled: true,
    skin: "codex-glass",
    position: { x: 0.92, y: 0.84 },
  };
  const TIP_KEYS = [
    "petTipDownload",
    "petTipNotebook",
    "petTipForum",
    "petTipProfile",
    "petTipReview",
    "petTipStar",
    "petTipTimed",
  ];
  const FIRST_TIP_DELAY = 45 * 1000;
  const TIP_INTERVAL = 8 * 60 * 1000;
  const QUESTION_HINT_DELAY = 60 * 1000;
  const DAILY_TIP_LIMIT = 3;
  const DOCK_DISTANCE = 24;
  const DOCK_CLOSE_DISTANCE = 48;
  const DOCK_RELEASE_DISTANCE = 12;
  const DOCK_HINT_DURATION = 8 * 1000;
  let preferenceRevision = 0;
  let preferenceSaveQueue = Promise.resolve();
  const state = {
    preferences: DEFAULTS,
    root: null,
    bubble: null,
    bubbleMessage: null,
    bubbleText: null,
    hintProvider: null,
    hintQuestionKey: "",
    hintTimer: 0,
    tipTimer: 0,
    dockHintTimer: 0,
    bubbleAction: "",
    invitedQuestions: new Set(),
    dockSide: "",
    dragging: false,
    moved: false,
    pointerOffset: { x: 0, y: 0 },
    pointerStart: { x: 0, y: 0 },
    dragStartPosition: { left: 0, top: 0 },
    dragStartDockSide: "",
  };

  function t(key, vars) {
    return window.ALevelI18n?.t?.(key, vars) || key;
  }

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function readProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null") || {};
    } catch (_error) {
      return {};
    }
  }

  function normalizePreferences(input) {
    const x = Number(input?.position?.x);
    const y = Number(input?.position?.y);
    return {
      enabled: input?.enabled !== false,
      skin: input?.skin === "codex-glass" ? input.skin : DEFAULTS.skin,
      position: {
        x: Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : DEFAULTS.position.x,
        y: Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : DEFAULTS.position.y,
      },
    };
  }

  function persistProfilePet(preferences) {
    const profile = readProfile();
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, pet: preferences }));
  }

  function emitPreferences() {
    window.dispatchEvent(new CustomEvent("alevel:petpreferences", { detail: state.preferences }));
  }

  function clampToViewport(left, top) {
    const size = state.root?.getBoundingClientRect() || { width: 88, height: 104 };
    const margin = 12;
    return {
      left: Math.max(margin, Math.min(window.innerWidth - size.width - margin, left)),
      top: Math.max(margin, Math.min(window.innerHeight - size.height - margin, top)),
    };
  }

  function placeFromPreferences() {
    if (!state.root) return;
    const bounds = state.root.getBoundingClientRect();
    const top = clampToViewport(
      0,
      state.preferences.position.y * window.innerHeight - bounds.height / 2
    ).top;
    if (state.dockSide) {
      state.root.style.left = state.dockSide === "left"
        ? "0px"
        : `${Math.max(0, window.innerWidth - bounds.width)}px`;
      state.root.style.top = `${top}px`;
      state.root.dataset.dockSide = state.dockSide;
      return;
    }
    const intended = clampToViewport(
      state.preferences.position.x * window.innerWidth - bounds.width / 2,
      top
    );
    state.root.style.left = `${intended.left}px`;
    state.root.style.top = `${intended.top}px`;
    delete state.root.dataset.dockSide;
  }

  function positionFromElement() {
    const bounds = state.root.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (bounds.left + bounds.width / 2) / window.innerWidth)),
      y: Math.max(0, Math.min(1, (bounds.top + bounds.height / 2) / window.innerHeight)),
    };
  }

  async function savePreferences(next, rollback) {
    const desired = normalizePreferences(next);
    const revision = ++preferenceRevision;
    state.preferences = desired;
    persistProfilePet(state.preferences);
    emitPreferences();
    if (!window.ALevelApi?.updatePetPreferences || !token()) return true;
    const request = preferenceSaveQueue
      .catch(() => {})
      .then(() => window.ALevelApi.updatePetPreferences(token(), desired));
    preferenceSaveQueue = request.catch(() => {});
    try {
      const saved = await request;
      if (revision !== preferenceRevision) return true;
      state.preferences = normalizePreferences(saved);
      persistProfilePet(state.preferences);
      emitPreferences();
      return true;
    } catch (_error) {
      if (revision !== preferenceRevision) return false;
      state.preferences = normalizePreferences(rollback || DEFAULTS);
      persistProfilePet(state.preferences);
      emitPreferences();
      return false;
    }
  }

  function showBubble(message, action = "") {
    if (!state.bubble || !state.preferences.enabled) return;
    state.bubbleText.textContent = message;
    state.bubble.hidden = false;
    state.bubbleAction = action;
    state.root.classList.toggle("has-action", Boolean(action));
  }

  function clearDockHint() {
    window.clearTimeout(state.dockHintTimer);
    state.dockHintTimer = 0;
    if (state.bubbleAction === "dock") hideBubble();
  }

  function showDockHint() {
    showBubble(t("petDockedDismissHint"), "dock");
    window.clearTimeout(state.dockHintTimer);
    state.dockHintTimer = window.setTimeout(() => {
      if (state.bubbleAction === "dock") hideBubble();
    }, DOCK_HINT_DURATION);
  }

  function hideBubble() {
    if (!state.bubble) return;
    state.bubble.hidden = true;
    state.bubbleAction = "";
    state.root.classList.remove("has-action");
  }

  function activeInput() {
    const active = document.activeElement;
    return Boolean(active?.matches?.("input, textarea, select, [contenteditable='true'], math-field"));
  }

  function intrusiveUiOpen() {
    return Boolean(document.querySelector("dialog[open], .math-keyboard:not([hidden]), .community-math-keyboard:not([hidden])"));
  }

  function dailyTipState() {
    const profile = readProfile();
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const key = `alevel.petTips:${profile.id || "local"}`;
    let value = {};
    try {
      value = JSON.parse(localStorage.getItem(key) || "{}") || {};
    } catch (_error) {
    }
    if (value.day !== day) value = { day, count: 0, lastAt: 0, nextIndex: 0 };
    return { key, value };
  }

  function showNextAmbientTip(countAgainstLimit = false) {
    const { key, value } = dailyTipState();
    const nextIndex = Number.isInteger(value.nextIndex) ? value.nextIndex : 0;
    showBubble(t(TIP_KEYS[nextIndex % TIP_KEYS.length]));
    value.nextIndex = (nextIndex + 1) % TIP_KEYS.length;
    if (countAgainstLimit) {
      value.count = Number(value.count || 0) + 1;
      value.lastAt = Date.now();
    }
    localStorage.setItem(key, JSON.stringify(value));
  }

  function tryAmbientTip() {
    if (!state.preferences.enabled || state.dragging || document.hidden || activeInput() || intrusiveUiOpen()) return false;
    const { key, value } = dailyTipState();
    if (value.count >= DAILY_TIP_LIMIT || Date.now() - value.lastAt < TIP_INTERVAL) return false;
    showNextAmbientTip(true);
    window.setTimeout(() => {
      if (!state.bubbleAction) hideBubble();
    }, 9000);
    return true;
  }

  function scheduleAmbientTip(delay = FIRST_TIP_DELAY) {
    window.clearTimeout(state.tipTimer);
    state.tipTimer = window.setTimeout(() => {
      tryAmbientTip();
      scheduleAmbientTip(TIP_INTERVAL);
    }, delay);
  }

  function scheduleQuestionHint() {
    window.clearTimeout(state.hintTimer);
    if (!state.hintProvider || !state.preferences.enabled) return;
    const questionKey = String(state.hintProvider.getQuestionKey?.() || "");
    state.hintQuestionKey = questionKey;
    if (!questionKey || state.invitedQuestions.has(questionKey) || !state.hintProvider.hasUnseenHint?.()) return;
    state.hintTimer = window.setTimeout(() => {
      if (document.hidden || activeInput() || intrusiveUiOpen()) return scheduleQuestionHint();
      if (questionKey !== String(state.hintProvider.getQuestionKey?.() || "")) return;
      if (!state.hintProvider.hasUnseenHint?.()) return;
      state.invitedQuestions.add(questionKey);
      showBubble(t("petHintInvite"), "hint");
    }, QUESTION_HINT_DELAY);
  }

  async function activatePet() {
    if (state.dragging || state.moved) return;
    if (state.bubbleAction !== "hint") {
      showNextAmbientTip();
      return;
    }
    showBubble(t("petHintLoading"));
    try {
      await state.hintProvider?.showNextHint?.();
      hideBubble();
    } catch (_error) {
      showBubble(t("petHintUnavailable"));
      window.setTimeout(hideBubble, 8000);
    }
  }

  async function closePet(event, rollbackDockSide = state.dockSide) {
    event?.stopPropagation?.();
    const previous = state.preferences;
    state.root.hidden = true;
    hideBubble();
    window.clearTimeout(state.dockHintTimer);
    window.clearTimeout(state.tipTimer);
    window.clearTimeout(state.hintTimer);
    const saved = await savePreferences({ ...previous, enabled: false }, previous);
    if (!saved) {
      state.root.hidden = false;
      state.dockSide = rollbackDockSide;
      placeFromPreferences();
      scheduleAmbientTip();
      scheduleQuestionHint();
      if (rollbackDockSide) showDockHint();
    }
  }

  function beginDrag(event) {
    if (event.button != null && event.button !== 0) return;
    const bounds = state.root.getBoundingClientRect();
    state.dragging = true;
    state.moved = false;
    state.pointerOffset = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    state.pointerStart = { x: event.clientX, y: event.clientY };
    state.dragStartPosition = { left: bounds.left, top: bounds.top };
    state.dragStartDockSide = state.dockSide;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event) {
    if (!state.dragging) return;
    if (!state.moved && Math.hypot(
      event.clientX - state.pointerStart.x,
      event.clientY - state.pointerStart.y
    ) < 4) return;
    const rawLeft = event.clientX - state.pointerOffset.x;
    const rawTop = event.clientY - state.pointerOffset.y;
    const current = state.dragStartDockSide
      ? {
          left: rawLeft,
          top: clampToViewport(state.dragStartPosition.left, rawTop).top,
        }
      : clampToViewport(rawLeft, rawTop);
    state.root.style.left = `${current.left}px`;
    state.root.style.top = `${current.top}px`;
    state.moved = true;
    if (state.bubbleAction !== "dock") hideBubble();
  }

  async function endDrag(event) {
    if (!state.dragging) return;
    state.dragging = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!state.moved) return;
    const rawLeft = event.clientX - state.pointerOffset.x;
    const rawTop = event.clientY - state.pointerOffset.y;
    const finalPosition = state.dragStartDockSide
      ? {
          left: rawLeft,
          top: clampToViewport(state.dragStartPosition.left, rawTop).top,
        }
      : clampToViewport(rawLeft, rawTop);
    state.root.style.left = `${finalPosition.left}px`;
    state.root.style.top = `${finalPosition.top}px`;
    const horizontalDelta = event.clientX - state.pointerStart.x;
    if (state.dragStartDockSide) {
      const outwardDistance = state.dragStartDockSide === "left"
        ? Math.max(0, -horizontalDelta)
        : Math.max(0, horizontalDelta);
      const inwardDistance = state.dragStartDockSide === "left"
        ? Math.max(0, horizontalDelta)
        : Math.max(0, -horizontalDelta);
      if (outwardDistance >= DOCK_CLOSE_DISTANCE) {
        await closePet(event, state.dragStartDockSide);
      } else if (inwardDistance > DOCK_RELEASE_DISTANCE) {
        const previous = state.preferences;
        state.dockSide = "";
        clearDockHint();
        const current = clampToViewport(
          Number.parseFloat(state.root.style.left),
          Number.parseFloat(state.root.style.top)
        );
        state.root.style.left = `${current.left}px`;
        state.root.style.top = `${current.top}px`;
        const position = positionFromElement();
        const saved = await savePreferences({ ...previous, position }, previous);
        if (!saved) state.dockSide = state.dragStartDockSide;
        placeFromPreferences();
      } else {
        state.dockSide = state.dragStartDockSide;
        placeFromPreferences();
        showDockHint();
      }
      window.setTimeout(() => { state.moved = false; }, 0);
      return;
    }

    const previous = state.preferences;
    const bounds = state.root.getBoundingClientRect();
    const leftDistance = bounds.left;
    const rightDistance = window.innerWidth - bounds.right;
    const dockSide = Math.min(leftDistance, rightDistance) <= DOCK_DISTANCE
      ? (leftDistance <= rightDistance ? "left" : "right")
      : "";
    if (dockSide) {
      state.dockSide = dockSide;
      const position = {
        x: dockSide === "left" ? 0 : 1,
        y: positionFromElement().y,
      };
      const saved = await savePreferences({ ...previous, position }, previous);
      if (!saved) state.dockSide = "";
      placeFromPreferences();
      if (saved) showDockHint();
      window.setTimeout(() => { state.moved = false; }, 0);
      return;
    }
    const position = positionFromElement();
    await savePreferences({ ...previous, position }, previous);
    placeFromPreferences();
    window.setTimeout(() => { state.moved = false; }, 0);
  }

  function moveWithKeyboard(event) {
    const directions = {
      ArrowLeft: [-0.02, 0],
      ArrowRight: [0.02, 0],
      ArrowUp: [0, -0.02],
      ArrowDown: [0, 0.02],
    };
    if (!directions[event.key]) return;
    event.preventDefault();
    const previous = state.preferences;
    const [dx, dy] = directions[event.key];
    if (state.dockSide && (
      (state.dockSide === "left" && dx > 0) || (state.dockSide === "right" && dx < 0)
    )) state.dockSide = "";
    clearDockHint();
    const position = {
      x: Math.max(0, Math.min(1, previous.position.x + dx)),
      y: Math.max(0, Math.min(1, previous.position.y + dy)),
    };
    state.preferences = { ...previous, position };
    placeFromPreferences();
    savePreferences(state.preferences, previous);
  }

  function createPet() {
    const root = document.createElement("div");
    root.className = "site-pet site-pet--codex-glass";
    root.dataset.petSkin = "codex-glass";
    root.innerHTML = `
      <div class="site-pet__bubble" hidden>
        <button class="site-pet__bubble-message" type="button">
          <span class="site-pet__bubble-text" role="status" aria-live="polite"></span>
        </button>
        <button class="site-pet__bubble-close" type="button" aria-label="${t("petDismissMessage")}" title="${t("petDismissMessage")}">×</button>
      </div>
      <button class="site-pet__character" type="button" aria-label="Codex" title="Codex">
        <span class="site-pet__antenna" aria-hidden="true"><i></i></span>
        <span class="site-pet__head" aria-hidden="true"><i></i><i></i><b>&lt;/&gt;</b></span>
        <span class="site-pet__body" aria-hidden="true"><i></i></span>
        <span class="site-pet__shadow" aria-hidden="true"></span>
      </button>
    `;
    document.body.appendChild(root);
    state.root = root;
    state.bubble = root.querySelector(".site-pet__bubble");
    state.bubbleMessage = root.querySelector(".site-pet__bubble-message");
    state.bubbleText = root.querySelector(".site-pet__bubble-text");
    const character = root.querySelector(".site-pet__character");
    state.bubbleMessage.addEventListener("click", () => {
      if (state.bubbleAction === "hint") activatePet();
      else hideBubble();
    });
    root.querySelector(".site-pet__bubble-close").addEventListener("click", (event) => {
      event.stopPropagation();
      hideBubble();
    });
    character.addEventListener("click", activatePet);
    character.addEventListener("pointerdown", beginDrag);
    character.addEventListener("pointermove", moveDrag);
    character.addEventListener("pointerup", endDrag);
    character.addEventListener("pointercancel", endDrag);
    character.addEventListener("keydown", moveWithKeyboard);
  }

  function applyPreferences(input) {
    clearDockHint();
    state.preferences = normalizePreferences(input);
    state.dockSide = state.preferences.position.x === 0
      ? "left"
      : (state.preferences.position.x === 1 ? "right" : "");
    persistProfilePet(state.preferences);
    emitPreferences();
    if (!state.root) return;
    state.root.hidden = !state.preferences.enabled;
    state.root.dataset.petSkin = state.preferences.skin;
    placeFromPreferences();
    if (state.preferences.enabled) {
      scheduleAmbientTip();
      scheduleQuestionHint();
    } else {
      hideBubble();
      window.clearTimeout(state.dockHintTimer);
      window.clearTimeout(state.tipTimer);
      window.clearTimeout(state.hintTimer);
    }
  }

  function registerHintProvider(provider) {
    state.hintProvider = provider;
    scheduleQuestionHint();
  }

  function notifyQuestionChanged() {
    hideBubble();
    scheduleQuestionHint();
  }

  async function init() {
    if (!document.body.classList.contains("student-ui") || !token()) return;
    let profile = readProfile();
    if (window.ALevelApi?.getCurrentUser) {
      try {
        profile = await window.ALevelApi.getCurrentUser(token());
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      } catch (_error) {
      }
    }
    createPet();
    applyPreferences(profile.pet || DEFAULTS);
    window.addEventListener("resize", placeFromPreferences);
    window.addEventListener("alevel:languagechange", () => {
      const bubbleClose = state.root.querySelector(".site-pet__bubble-close");
      bubbleClose.setAttribute("aria-label", t("petDismissMessage"));
      bubbleClose.setAttribute("title", t("petDismissMessage"));
      hideBubble();
    });
  }

  window.ALevelPet = {
    applyPreferences,
    getPreferences: () => state.preferences,
    registerHintProvider,
    notifyQuestionChanged,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}());
