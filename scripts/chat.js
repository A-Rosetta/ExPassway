(function () {
  const TOKEN_KEY = "alevel.authToken";
  const DEVICE_KEY = "expassway.chat.device.v1";
  const PENDING_INVITE_KEY = "expassway.chat.pendingInvite.v1";
  const EMOJI_RECENT_KEY = "expassway.chat.recentEmoji.v1";
  const EMOJI_CATEGORIES = [
    { id: "faces", key: "chatEmojiFaces", label: "Faces", entries: "😀:grin 笑|😃:happy 开心|😄:smile 微笑|😁:beam 大笑|😆:laugh 笑|😅:sweat 汗|😂:joy 喜极而泣|🤣:rofl 笑哭|🙂:smile 微笑|🙃:upside down 倒脸|😉:wink 眨眼|😊:blush 害羞|😇:angel 天使|🥰:love 喜爱|😍:heart eyes 爱慕|🤩:star eyes 崇拜|😘:kiss 亲吻|😋:yum 好吃|😛:tongue 吐舌|😎:cool 酷|🤓:nerd 书呆|🧐:think 思考|🤔:thinking 思考|🤗:hug 拥抱|🤭:giggle 偷笑|🤫:quiet 安静|😴:sleep 睡觉|🥳:party 庆祝|😭:cry 哭|😢:sad 难过|😤:angry 生气|😱:scream 惊讶|😬:grimace 尴尬|🫠:melt 融化|😮:surprise 惊讶|😑:expressionless 无语" },
    { id: "gestures", key: "chatEmojiGestures", label: "Gestures", entries: "👍:thumbs up 赞|👎:thumbs down 踩|👏:clap 鼓掌|🙌:celebrate 庆祝|👐:open hands 双手|🤲:palms 双掌|🤝:handshake 握手|🙏:thanks 谢谢|✌️:peace 胜利|🤞:luck 幸运|🤟:love you 爱你|🤘:rock 摇滚|👌:okay 好的|🤌:pinched 手势|👋:wave 挥手|🤚:hand 手掌|✋:stop 停止|🖐️:fingers 手指|👊:fist 拳头|🤛:left fist 左拳|🤜:right fist 右拳|💪:strong 加油|🫶:heart hands 比心|☝️:point 指向" },
    { id: "hearts", key: "chatEmojiHearts", label: "Hearts", entries: "❤️:red heart 红心|🧡:orange heart 橙心|💛:yellow heart 黄心|💚:green heart 绿心|💙:blue heart 蓝心|💜:purple heart 紫心|🖤:black heart 黑心|🤍:white heart 白心|🤎:brown heart 棕心|🩷:pink heart 粉心|🩵:light blue heart 浅蓝心|🩶:grey heart 灰心|💔:broken heart 心碎|❤️‍🔥:heart fire 热爱|💕:two hearts 双心|💞:revolving hearts 爱心|💓:beating heart 心跳|💗:growing heart 喜欢|💖:sparkle heart 闪亮爱心|💘:cupid 爱神|💝:gift heart 心意|💟:heart decoration 爱心|💌:love letter 情书|💋:kiss 亲吻" },
    { id: "animals", key: "chatEmojiAnimals", label: "Animals", entries: "🐶:dog 狗|🐱:cat 猫|🐭:mouse 老鼠|🐹:hamster 仓鼠|🐰:rabbit 兔|🦊:fox 狐狸|🐻:bear 熊|🐼:panda 熊猫|🐨:koala 考拉|🐯:tiger 老虎|🦁:lion 狮子|🐮:cow 牛|🐷:pig 猪|🐸:frog 青蛙|🐵:monkey 猴子|🐔:chicken 鸡|🐧:penguin 企鹅|🐦:bird 鸟|🦋:butterfly 蝴蝶|🐝:bee 蜜蜂|🐢:turtle 乌龟|🐬:dolphin 海豚|🐳:whale 鲸鱼|🦄:unicorn 独角兽" },
    { id: "food", key: "chatEmojiFood", label: "Food", entries: "🍎:apple 苹果|🍊:orange 橙|🍋:lemon 柠檬|🍌:banana 香蕉|🍉:watermelon 西瓜|🍇:grapes 葡萄|🍓:strawberry 草莓|🫐:blueberry 蓝莓|🍒:cherry 樱桃|🥭:mango 芒果|🥑:avocado 牛油果|🥕:carrot 胡萝卜|🌽:corn 玉米|🍞:bread 面包|🥐:croissant 羊角面包|🍔:burger 汉堡|🍟:fries 薯条|🍕:pizza 披萨|🍜:noodles 面条|🍣:sushi 寿司|🍰:cake 蛋糕|🍩:donut 甜甜圈|☕:coffee 咖啡|🧋:bubble tea 奶茶" },
    { id: "activities", key: "chatEmojiActivities", label: "Activities", entries: "⚽:football 足球|🏀:basketball 篮球|🏈:football 橄榄球|⚾:baseball 棒球|🎾:tennis 网球|🏐:volleyball 排球|🎱:pool 台球|🏓:table tennis 乒乓球|🏸:badminton 羽毛球|🏊:swim 游泳|🚴:cycle 骑车|🏃:run 跑步|🎮:game 游戏|🎲:dice 骰子|🎯:target 目标|🎸:guitar 吉他|🎹:piano 钢琴|🎨:art 画画|🎬:film 电影|🎤:microphone 唱歌|🎧:headphones 耳机|🏆:trophy 奖杯|🥇:medal 金牌|🎉:party 庆祝" },
    { id: "objects", key: "chatEmojiObjects", label: "Objects", entries: "🚀:rocket 火箭|⭐:star 星星|🌟:glowing star 闪亮|✨:sparkles 闪光|🔥:fire 火|💡:idea 灯泡|✅:check 完成|❌:cross 错误|❓:question 问号|❗:exclamation 感叹|💯:hundred 满分|📚:books 书|✏️:pencil 铅笔|📝:note 笔记|💻:laptop 电脑|📱:phone 手机|📷:camera 相机|🎁:gift 礼物|🎈:balloon 气球|🌈:rainbow 彩虹|☀️:sun 太阳|🌙:moon 月亮|🌍:earth 地球|🌸:flower 花" },
  ].map((category) => ({ ...category, entries: category.entries.split("|").map((entry) => {
    const separator = entry.indexOf(":");
    return { emoji: entry.slice(0, separator), keywords: entry.slice(separator + 1), category: category.id };
  }) }));
  const EMOJI_ENTRIES = EMOJI_CATEGORIES.flatMap((category) => category.entries);
  const t = (key, fallback, vars = {}) => {
    const translated = window.ALevelI18n?.t?.(key, vars);
    let value = translated && translated !== key ? translated : fallback;
    Object.entries(vars).forEach(([name, replacement]) => {
      value = value.replaceAll(`{${name}}`, String(replacement));
    });
    return value;
  };
  const state = {
    profile: null,
    device: null,
    contacts: [],
    conversations: [],
    activeConversation: null,
    messages: [],
    cursor: "",
    cryptoWorker: null,
    pendingCrypto: new Map(),
    localPlaintexts: {},
    peerBundles: new Map(),
    ownBundle: null,
    conversationBundles: new Map(),
    devices: [],
    recoveryEnabled: false,
    socket: null,
    pollTimer: null,
    syncInFlight: null,
    syncGeneration: 0,
    accountV2: null,
    accountEpochs: new Map(),
    accountMode: false,
    accountPasskeyReady: false,
    accountContactStatus: new Map(),
    accountGroupMetadata: new Map(),
    contactStatusGeneration: 0,
    accountContactRequests: new Set(),
    sendingText: new Set(),
    sendingImages: new Set(),
    messageDrafts: new Map(),
    dataRefreshGeneration: 0,
    accountIdentityChanges: new Set(),
    hiddenConversations: new Set(),
    deletingHistories: new Set(),
    profileDraftAvatar: "",
    profileDirty: false,
    profileSaving: false,
    profileAvatarGeneration: 0,
    profileAvatarProcessing: false,
    profileRefreshInFlight: null,
    lastProfileRefresh: 0,
    emojiCategory: "all",
    emojiSelection: null,
  };
  const $ = (selector) => document.querySelector(selector);
  const status = $("#chatStatus");

  function setStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", isError);
  }

  function formatActionError(error) {
    const message = error?.message || (typeof error === "string" ? error : "");
    const details = [];
    if (error?.code && error.code !== "HTTP_ERROR") details.push(error.code);
    if (error?.status) details.push(`HTTP ${error.status}`);
    return `${message || (details.length ? "The operation failed." : "No error details were returned.")}${details.length ? ` (${details.join(", ")})` : ""}`;
  }

  function currentToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setAvatar(host, alias, avatarDataUrl) {
    if (!host) return;
    const initial = Array.from(String(alias || "?").trim())[0]?.toLocaleUpperCase() || "?";
    host.replaceChildren();
    host.setAttribute("aria-hidden", "true");
    if (!/^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatarDataUrl || "")) {
      host.textContent = initial;
      return;
    }
    const image = document.createElement("img");
    image.alt = "";
    image.src = avatarDataUrl;
    image.addEventListener("error", () => { if (host.contains(image)) host.textContent = initial; }, { once: true });
    host.appendChild(image);
  }

  function createAvatar(alias, avatarDataUrl) {
    const host = document.createElement("span");
    host.className = "chat-avatar";
    setAvatar(host, alias, avatarDataUrl);
    return host;
  }

  function renderChatProfile() {
    const profile = state.profile;
    if (!profile) return;
    $("#chatProfileName").textContent = profile.alias;
    setAvatar($("#chatProfileAvatar"), profile.alias, profile.avatarDataUrl);
    if (!state.profileDirty && !state.profileSaving && !state.profileAvatarProcessing) {
      $("#chatProfileAlias").value = profile.alias;
      state.profileDraftAvatar = profile.avatarDataUrl || "";
    }
    setAvatar($("#chatProfileAvatarPreview"), $("#chatProfileAlias").value, state.profileDraftAvatar);
  }

  function setProfileFeedback(message, isError = false) {
    const feedback = $("#chatProfileFeedback");
    feedback.textContent = message || "";
    feedback.classList.toggle("is-error", isError);
  }

  function setProfileControls() {
    $("#saveChatProfile").disabled = state.profileSaving || state.profileAvatarProcessing;
    $("#cancelChatProfile").disabled = state.profileSaving;
    $("#chatProfileAlias").disabled = state.profileSaving;
    $("#chatProfileAvatarInput").disabled = state.profileSaving;
    $("#removeChatProfileAvatar").disabled = state.profileSaving || state.profileAvatarProcessing;
  }

  function closeProfileEditor() {
    if (state.profileSaving) return;
    state.profileAvatarGeneration += 1;
    state.profileAvatarProcessing = false;
    state.profileDirty = false;
    $("#chatProfileForm").hidden = true;
    $("#chatProfileAvatarInput").value = "";
    setProfileFeedback("");
    setProfileControls();
    renderChatProfile();
  }

  async function prepareProfileAvatar(file) {
    if (!file) return;
    const generation = ++state.profileAvatarGeneration;
    state.profileAvatarProcessing = true;
    setProfileControls();
    setProfileFeedback(t("chatProfileAvatarPreparing", "Preparing avatar..."));
    let url;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error(t("chatProfileAvatarTooLarge", "Choose an image smaller than 5 MB."));
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) throw new Error(t("chatProfileAvatarInvalid", "Choose a PNG, JPEG, WebP or GIF image."));
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error(t("chatProfileAvatarInvalid", "Choose a PNG, JPEG, WebP or GIF image."));
      const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("chatProfileAvatarFailed", "This image could not be processed."));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let encoded = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", .85));
      if (!encoded || encoded.type !== "image/webp") encoded = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .85));
      if (!encoded || encoded.size > 256 * 1024) throw new Error(t("chatProfileAvatarFailed", "This image could not be processed."));
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(t("chatProfileAvatarFailed", "This image could not be processed.")));
        reader.readAsDataURL(encoded);
      });
      if (generation !== state.profileAvatarGeneration) return;
      state.profileDraftAvatar = dataUrl;
      state.profileDirty = true;
      renderChatProfile();
      setProfileFeedback("");
    } catch (error) {
      if (generation === state.profileAvatarGeneration) setProfileFeedback(error?.message || t("chatProfileAvatarFailed", "This image could not be processed."), true);
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (generation === state.profileAvatarGeneration) {
        state.profileAvatarProcessing = false;
        $("#chatProfileAvatarInput").value = "";
        setProfileControls();
      }
    }
  }

  async function saveChatProfile(event) {
    event.preventDefault();
    if (state.profileSaving || state.profileAvatarProcessing) return;
    const alias = $("#chatProfileAlias").value.trim();
    if (Array.from(alias).length < 2 || Array.from(alias).length > 48 || !/^[\p{L}\p{N} _.-]+$/u.test(alias)) {
      setProfileFeedback(t("chatProfileNameInvalid", "Use 2–48 letters, numbers, spaces, _, . or -."), true);
      return;
    }
    state.profileSaving = true;
    setProfileControls();
    setProfileFeedback(t("chatProfileSaving", "Saving profile..."));
    try {
      const profile = await window.ALevelApi.updateChatProfile({ alias, avatarDataUrl: state.profileDraftAvatar });
      state.dataRefreshGeneration += 1;
      state.profile = profile;
      state.profileDirty = false;
      state.profileSaving = false;
      closeProfileEditor();
      renderGroupManagement(state.activeConversation || {});
      renderMessages();
      setStatus(t("chatProfileSaved", "Chat profile saved."));
    } catch (error) {
      setProfileFeedback(formatActionError(error), true);
    } finally {
      state.profileSaving = false;
      setProfileControls();
    }
  }

  function isHistoricalConversation(conversation) {
    return Boolean(conversation && (!isAccountConversation(conversation) || conversation.historical
      || (conversation.kind === "direct" && state.accountIdentityChanges.has(conversation.id))));
  }

  function forgetHistoricalConversation(conversationId, rememberHidden = true) {
    state.dataRefreshGeneration += 1;
    if (rememberHidden) state.hiddenConversations.add(conversationId);
    state.conversations = state.conversations.filter((conversation) => conversation.id !== conversationId);
    state.messageDrafts.delete(conversationId);
    state.accountEpochs.delete(conversationId);
    state.accountGroupMetadata.delete(conversationId);
    state.accountIdentityChanges.delete(conversationId);
    if (state.activeConversation?.id === conversationId) {
      state.syncGeneration += 1;
      state.syncInFlight = null;
      state.activeConversation = null;
      state.messages = [];
      state.cursor = "";
      $("#messageInput").value = "";
      stopPolling();
      state.socket?.close();
      state.socket = null;
    }
    renderContacts();
    renderActiveConversation();
    if (!state.activeConversation) renderMessages();
  }

  async function deleteHistoricalChat() {
    const conversation = state.activeConversation;
    if (!isHistoricalConversation(conversation) || state.deletingHistories.has(conversation.id)) return;
    if (!window.confirm(t("chatDeleteHistoryConfirm", "Remove this historical chat from your account's conversation list on all devices? Your friend's history stays available. This cannot be undone."))) return;
    state.deletingHistories.add(conversation.id);
    renderActiveConversation();
    try {
      await window.ALevelApi.deleteChatConversationHistory(conversation.id);
      forgetHistoricalConversation(conversation.id);
      setStatus(t("chatHistoryDeleted", "Historical chat removed from your account."));
    } catch (error) { setStatus(formatActionError(error), true); }
    finally {
      state.deletingHistories.delete(conversation.id);
      renderActiveConversation();
    }
  }

  function recentEmojis() {
    try {
      const values = JSON.parse(localStorage.getItem(`${EMOJI_RECENT_KEY}.${state.profile?.id || ""}`) || "[]");
      return Array.isArray(values) ? values.filter((value) => EMOJI_ENTRIES.some((entry) => entry.emoji === value)).slice(0, 24) : [];
    } catch (_error) { return []; }
  }

  function renderEmojiPicker() {
    const categories = $("#emojiCategories");
    const grid = $("#emojiGrid");
    if (!categories || !grid) return;
    const allCategories = [{ id: "all", key: "chatEmojiAll", label: "All" }, { id: "recent", key: "chatEmojiRecent", label: "Recent" }, ...EMOJI_CATEGORIES];
    categories.replaceChildren(...allCategories.map((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = category.id;
      button.setAttribute("aria-pressed", String(state.emojiCategory === category.id));
      button.textContent = t(category.key, category.label);
      return button;
    }));
    const query = $("#emojiSearch").value.trim().toLocaleLowerCase();
    const recent = recentEmojis();
    const candidates = state.emojiCategory === "recent"
      ? recent.map((emoji) => EMOJI_ENTRIES.find((entry) => entry.emoji === emoji)).filter(Boolean)
      : EMOJI_ENTRIES.filter((entry) => state.emojiCategory === "all" || entry.category === state.emojiCategory);
    const matching = candidates.filter((entry) => !query || `${entry.emoji} ${entry.keywords}`.toLocaleLowerCase().includes(query));
    grid.replaceChildren(...matching.map((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.emoji = entry.emoji;
      button.textContent = entry.emoji;
      button.title = entry.keywords;
      button.setAttribute("aria-label", `${entry.emoji} ${entry.keywords}`);
      return button;
    }));
    if (!matching.length) {
      const empty = document.createElement("p");
      empty.className = "chat-emoji-empty";
      empty.textContent = t("chatEmojiNoResults", "No emoji found.");
      grid.appendChild(empty);
    }
  }

  function closeEmojiPicker() {
    $("#emojiTray").hidden = true;
    $("#emojiButton").setAttribute("aria-expanded", "false");
  }

  function insertEmoji(emoji) {
    const input = $("#messageInput");
    const conversation = state.activeConversation;
    if (!conversation || input.disabled) return;
    const selection = state.emojiSelection?.conversationId === conversation.id ? state.emojiSelection : { start: input.selectionStart, end: input.selectionEnd };
    input.setRangeText(emoji, selection.start, selection.end, "end");
    state.messageDrafts.set(conversation.id, input.value);
    state.emojiSelection = { conversationId: conversation.id, start: input.selectionStart, end: input.selectionEnd };
    try { localStorage.setItem(`${EMOJI_RECENT_KEY}.${state.profile?.id || ""}`, JSON.stringify([emoji, ...recentEmojis().filter((value) => value !== emoji)].slice(0, 24))); } catch (_error) { }
    closeEmojiPicker();
    input.focus();
  }

  function isAccountConversation(conversation) {
    return conversation?.protocolVersion === "account-v2";
  }

  function conversationIsCurrent(conversationId, generation) {
    return state.activeConversation?.id === conversationId && state.syncGeneration === generation;
  }

  function conversationName(conversation) {
    return conversation.kind === "group"
      ? state.accountGroupMetadata.get(conversation.id)?.name || t("chatGroupTitle", "Group ({count} members)", { count: conversation.group?.memberCount || 0 })
      : conversation.peer?.alias || "Conversation";
  }

  function renderActiveConversation() {
    const conversation = state.activeConversation;
    $("#conversationEmpty").hidden = Boolean(conversation);
    $("#conversationActive").hidden = !conversation;
    if (!conversation) {
      $("#groupManagePanel").hidden = true;
      return;
    }
    $("#conversationTitle").textContent = conversationName(conversation);
    setAvatar($("#conversationAvatar"), conversationName(conversation), conversation.kind === "direct" ? conversation.peer?.avatarDataUrl : "");
    const legacyReadOnly = state.accountMode && !isAccountConversation(conversation);
    const rotationRequired = Boolean(conversation.rotationRequired);
    const identityChanged = state.accountIdentityChanges.has(conversation.id) || (isAccountConversation(conversation) && conversation.historical);
    $("#deleteHistoricalChat").hidden = !isHistoricalConversation(conversation);
    $("#deleteHistoricalChat").disabled = state.deletingHistories.has(conversation.id);
    const selfRole = conversation.role || conversation.group?.members?.find((member) => member.isSelf)?.role;
    $("#retentionSelect").value = String(conversation.retentionSeconds);
    $("#retentionSelect").disabled = legacyReadOnly || (isAccountConversation(conversation) && conversation.kind === "group" && selfRole !== "owner");
    $("#groupManageButton").hidden = conversation.kind !== "group" || !isAccountConversation(conversation);
    $("#messageInput").disabled = legacyReadOnly || rotationRequired || identityChanged;
    $("#sendMessage").disabled = legacyReadOnly || rotationRequired || identityChanged || state.sendingText.has(conversation.id);
    $("#imageInput").disabled = legacyReadOnly || rotationRequired || identityChanged || state.sendingImages.has(conversation.id);
    $("#emojiButton").disabled = legacyReadOnly || rotationRequired || identityChanged;
    if ($("#emojiButton").disabled) closeEmojiPicker();
    if (legacyReadOnly) $("#conversationSafety").textContent = "Historical chat: messages can be read on the original device. Start a new secure chat to send messages.";
    else if (isAccountConversation(conversation)) $("#conversationSafety").textContent = rotationRequired
      ? "A member left. An owner or administrator must update the group encryption before messages can be sent."
      : "Secure account chat";
    if (identityChanged) {
      const safety = $("#conversationSafety");
      safety.textContent = conversation.kind === "group"
        ? "A member changed their chat identity. The group owner must remove that member and invite them again before messages can be sent."
        : "A participant changed their chat identity. Existing messages remain in this historical conversation.";
      if (conversation.kind === "direct" && conversation.peer?.contactId) {
        const button = document.createElement("button");
        button.id = "startNewSecureChat";
        button.type = "button";
        button.className = "btn-secondary chat-small-action";
        button.textContent = "Start a new secure conversation";
        button.addEventListener("click", async () => {
          if (button.disabled || !window.confirm("A chat identity changed. Verify the change with your friend before continuing. Create a new secure conversation? Existing messages stay in this conversation.")) return;
          button.disabled = true;
          try {
            const created = await createAccountConversation("direct", [conversation.peer.contactId]);
            state.conversations = [created, ...state.conversations];
            await selectConversation(created);
            setStatus("New secure conversation created.");
          } catch (error) { setStatus(formatActionError(error), true); }
          finally { button.disabled = false; }
        });
        safety.appendChild(button);
      }
    }
    if (conversation.kind === "group" && isAccountConversation(conversation)) renderGroupManagement(conversation);
  }

  function showAccountIdentityChange(conversation, error) {
    if (!isAccountConversation(conversation) || error?.code !== "ACCOUNT_KEY_CHANGED") return;
    state.accountIdentityChanges.add(conversation.id);
    if (state.activeConversation?.id === conversation.id) renderActiveConversation();
  }

  function savedDevice() {
    try {
      return JSON.parse(localStorage.getItem(DEVICE_KEY) || "null");
    } catch (_error) {
      return null;
    }
  }

  function saveDevice(device) {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  }

  async function cacheLocalPlaintext(clientMessageId, plaintext) {
    state.localPlaintexts[clientMessageId] = plaintext;
    await cryptoCall("storeLocalPlaintext", { clientMessageId, plaintext });
  }

  async function getCachedLocalPlaintext(clientMessageId) {
    if (Object.prototype.hasOwnProperty.call(state.localPlaintexts, clientMessageId)) {
      return state.localPlaintexts[clientMessageId];
    }
    const plaintext = await cryptoCall("getLocalPlaintext", { clientMessageId });
    if (plaintext != null) state.localPlaintexts[clientMessageId] = plaintext;
    return plaintext;
  }

  function createCryptoWorker() {
    if (state.cryptoWorker) return state.cryptoWorker;
    const worker = new Worker("../assets/vendor/chat-crypto-worker.js?v=20261003-1", { name: "expassway-chat-crypto" });
    worker.onerror = (event) => {
      if (state.cryptoWorker !== worker) return;
      const detail = String(event?.message || "").trim();
      for (const pending of state.pendingCrypto.values()) {
        const error = new Error(detail || `The chat encryption worker stopped during ${pending.action}.`);
        error.code = "CRYPTO_WORKER_UNAVAILABLE";
        error.action = pending.action;
        pending.reject(error);
      }
      state.pendingCrypto.clear();
      worker.terminate();
      state.cryptoWorker = null;
      if (state.accountV2?.unlocked) {
        state.accountV2 = null;
        state.accountEpochs.clear();
        state.accountGroupMetadata.clear();
        state.messages = [];
        state.activeConversation = null;
        state.cursor = "";
        state.syncGeneration += 1;
        state.syncInFlight = null;
        stopPolling();
        state.socket?.close();
        state.socket = null;
        $("#chatApp").hidden = true;
        $("#chatSetupPanel").hidden = false;
        $("#enableAccountSync").hidden = true;
        $("#unlockAccountSync").hidden = false;
        setStatus("Chat encryption stopped. Unlock secure chat again to continue.", true);
      }
    };
    worker.onmessage = (event) => {
      const { id, ok, result, error, code } = event.data || {};
      const pending = state.pendingCrypto.get(id);
      if (!pending) return;
      state.pendingCrypto.delete(id);
      if (ok) pending.resolve(result);
      else {
        const failure = new Error(error || `Chat crypto operation failed during ${pending.action}.`);
        failure.code = code || "CRYPTO_ERROR";
        failure.action = pending.action;
        pending.reject(failure);
      }
    };
    state.cryptoWorker = worker;
    return worker;
  }

  function cryptoCall(action, payload) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      state.pendingCrypto.set(id, { resolve, reject, action });
      try {
        createCryptoWorker().postMessage({ id, action, payload });
      } catch (error) {
        state.pendingCrypto.delete(id);
        const failure = new Error(error?.message || `Could not start chat crypto operation ${action}.`);
        failure.code = error?.code || "CRYPTO_WORKER_UNAVAILABLE";
        failure.action = action;
        reject(failure);
      }
    });
  }

  function base64UrlToBytes(value) {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function bytesToBase64Url(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function publicKeyOptions(raw) {
    const source = raw?.publicKey || raw || {};
    const options = { ...source };
    options.challenge = base64UrlToBytes(source.challenge);
    if (source.user?.id) options.user = { ...source.user, id: base64UrlToBytes(source.user.id) };
    for (const field of ["allowCredentials", "excludeCredentials"]) {
      if (Array.isArray(source[field])) options[field] = source[field].map((credential) => ({
        ...credential,
        id: base64UrlToBytes(credential.id),
      }));
    }
    if (source.extensions?.prf?.eval?.first) {
      options.extensions = { ...source.extensions, prf: { ...source.extensions.prf, eval: {
        ...source.extensions.prf.eval,
        first: base64UrlToBytes(source.extensions.prf.eval.first),
      } } };
    }
    return options;
  }

  function serialiseCredential(credential) {
    const response = credential.response;
    const extensionResults = credential.getClientExtensionResults?.() || {};
    const prf = extensionResults.prf ? { enabled: Boolean(extensionResults.prf.enabled || extensionResults.prf.results?.first) } : undefined;
    const output = {
      id: credential.id,
      rawId: bytesToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      },
      clientExtensionResults: prf ? { prf } : {},
    };
    if (response.attestationObject) {
      output.response.attestationObject = bytesToBase64Url(response.attestationObject);
      output.response.transports = response.getTransports?.() || [];
    }
    if (response.authenticatorData) {
      output.response.authenticatorData = bytesToBase64Url(response.authenticatorData);
      output.response.signature = bytesToBase64Url(response.signature);
      if (response.userHandle) output.response.userHandle = bytesToBase64Url(response.userHandle);
    }
    return output;
  }

  function passkeyPrfOutput(credential) {
    const result = credential.getClientExtensionResults?.()?.prf?.results?.first;
    if (!result) {
      const error = new Error("This Passkey cannot produce the required PRF output. Choose a Passkey with PRF support.");
      error.code = "PASSKEY_PRF_UNAVAILABLE";
      throw error;
    }
    return bytesToBase64Url(result);
  }

  function supportsAccountPasskey() {
    return Boolean(window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
  }

  function isExistingPasskeyError(error) {
    const name = String(error?.name || "");
    const message = String(error?.message || error || "");
    return name === "InvalidStateError" || /not,? or is no longer,? usable/i.test(message);
  }

  function passkeyActionError(error, code, action) {
    if (error?.code) return error;
    const detail = String(error?.message || error || "");
    const wrapped = new Error(detail ? `${action}: ${detail}` : action);
    wrapped.name = error?.name || "Error";
    wrapped.code = code;
    wrapped.cause = error;
    return wrapped;
  }

  async function accountPasskeyAssertion() {
    const response = await window.ALevelApi.getChatPasskeyAuthenticationOptions();
    const publicKey = publicKeyOptions(response);
    let credential;
    try {
      credential = await navigator.credentials.get({ publicKey });
    } catch (error) {
      throw passkeyActionError(error, "PASSKEY_ASSERTION_FAILED", "Could not use the secure chat Passkey");
    }
    if (!credential) {
      const error = new Error("The Passkey prompt returned no credential.");
      error.code = "PASSKEY_ASSERTION_FAILED";
      throw error;
    }
    const prfOutput = passkeyPrfOutput(credential);
    const verified = await window.ALevelApi.verifyChatPasskey("authenticate", {
      challenge: response.publicKey?.challenge || response.challenge,
      credential: serialiseCredential(credential),
    });
    return { prfOutput, proof: verified?.proof || verified?.writeProof || "" };
  }

  async function unlockAccountSync() {
    const button = $("#unlockAccountSync");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const vault = await window.ALevelApi.getChatAccountVault();
      if (!vault) return await setupAccountSync();
      setStatus("Unlocking secure chat with your Passkey...");
      const assertion = await accountPasskeyAssertion();
      const unlocked = await cryptoCall("unlockAccountV2Vault", {
        userId: state.profile.id,
        keyVersion: vault.keyVersion,
        nonce: vault.nonce,
        ciphertext: vault.ciphertext,
        prfOutput: assertion.prfOutput,
      });
      state.accountV2 = { ...unlocked, proof: assertion.proof };
      $("#chatSetupPanel").hidden = true;
      $("#chatApp").hidden = false;
      setStatus("");
      await refreshData();
    } catch (error) {
      setStatus(formatActionError(error), true);
    } finally {
      button.disabled = false;
    }
  }

  async function ensureAccountState() {
    let bundle;
    try { bundle = await window.ALevelApi.getChatAccountKeyBundle(); }
    catch (error) {
      if (error?.status === 503 || error?.code === "CHAT_ACCOUNT_V2_DISABLED") return false;
      throw error;
    }
    state.accountMode = true;
    state.accountPasskeyReady = Boolean(bundle?.passkeyReady);
    $("#legacyDevicePanel").hidden = true;
    if (!supportsAccountPasskey()) {
      $("#chatSetupPanel").hidden = true;
      $("#chatUnsupportedPanel").hidden = false;
      return true;
    }
    const vault = bundle?.enabled ? await window.ALevelApi.getChatAccountVault() : null;
    $("#chatSetupPanel").hidden = false;
    $("#enableAccountSync").hidden = Boolean(vault);
    $("#unlockAccountSync").hidden = !vault;
    if (!vault) $("#chatApp").hidden = true;
    return true;
  }

  async function setupAccountSync() {
    if (!supportsAccountPasskey()) {
      $("#chatSetupPanel").hidden = true;
      $("#chatUnsupportedPanel").hidden = false;
      return;
    }
    const enable = $("#enableAccountSync");
    if (enable?.disabled) return;
    if (enable) enable.disabled = true;
    setStatus(state.accountPasskeyReady
      ? "Unlocking the existing Passkey to finish secure chat setup..."
      : "Creating a Passkey for secure chat...");
    try {
      if (!state.accountPasskeyReady) {
        const registration = await window.ALevelApi.getChatPasskeyRegistrationOptions();
        let credential = null;
        try {
          credential = await navigator.credentials.create({ publicKey: publicKeyOptions(registration) });
        } catch (error) {
          if (!isExistingPasskeyError(error)) {
            throw passkeyActionError(error, "PASSKEY_REGISTRATION_FAILED", "Could not create the secure chat Passkey");
          }
          state.accountPasskeyReady = true;
          setStatus("This device already has a secure chat Passkey. Unlocking it to finish setup...");
        }
        if (credential) {
          const registrationChallenge = registration.publicKey?.challenge || registration.challenge;
          if (!registrationChallenge) throw new Error("The Passkey registration challenge was missing. Refresh and try again.");
          await window.ALevelApi.verifyChatPasskey("register", {
            challenge: registrationChallenge,
            credential: serialiseCredential(credential),
          });
          state.accountPasskeyReady = true;
        }
      } else {
        setStatus("This device already has a secure chat Passkey. Unlocking it to finish setup...");
      }
      const assertion = await accountPasskeyAssertion();
      const generated = await cryptoCall("generateAccountV2Vault", {
        userId: state.profile.id,
        prfOutput: assertion.prfOutput,
      });
      const writeInput = { proof: assertion.proof };
      await window.ALevelApi.initializeChatAccount({
        ...writeInput,
        keyVersion: generated.keyVersion,
        encryptionPublicKey: generated.encryptionPublicKey,
        signingPublicKey: generated.signingPublicKey,
        fingerprint: generated.fingerprint,
        kdfVersion: generated.kdfVersion,
        nonce: generated.nonce,
        ciphertext: generated.ciphertext,
      });
      state.accountV2 = { ...generated, unlocked: true, proof: assertion.proof };
      $("#chatSetupPanel").hidden = true;
      $("#chatApp").hidden = false;
      setStatus("Secure chat is ready.");
      await refreshData();
    } catch (error) {
      setStatus(formatActionError(error), true);
      if (enable) enable.disabled = false;
    }
  }

  function extractInviteToken(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw, location.href);
      return url.searchParams.get("invite") || url.pathname.split("/").at(-1) || raw;
    } catch (_error) {
      return raw;
    }
  }

  function pendingInviteToken() {
    const fromUrl = new URL(location.href).searchParams.get("invite");
    return extractInviteToken(fromUrl || sessionStorage.getItem(PENDING_INVITE_KEY) || "");
  }

  function renderInvites(invites) {
    const host = $("#inviteList");
    if (!host) return;
    host.replaceChildren();
    invites.filter((invite) => invite.active).slice(0, 5).forEach((invite) => {
      const item = document.createElement("div");
      item.className = "chat-invite-item";
      item.innerHTML = `<div><strong></strong><small></small></div><span></span>`;
      item.querySelector("strong").textContent = t("chatInviteActive", "Active invite");
      item.querySelector("small").textContent = t("chatInviteShareHint", "Share the invite link shown above; it works once.");
      item.querySelector("span").textContent = new Date(invite.expiresAt).toLocaleDateString();
      host.appendChild(item);
    });
  }

  function renderContacts() {
    const host = $("#conversationList");
    if (!host) return;
    host.replaceChildren();
    if (!state.conversations.length && !state.accountMode) {
      const empty = document.createElement("p");
      empty.className = "chat-muted";
      empty.textContent = t("chatNoContacts", "No friends yet.");
      host.appendChild(empty);
    }
    state.conversations.forEach((conversation) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chat-conversation-item${state.activeConversation?.id === conversation.id ? " is-active" : ""}`;
      button.dataset.conversationId = conversation.id;
      button.innerHTML = `<div class="chat-contact-identity"><div><strong></strong><small></small></div></div>`;
      button.firstElementChild.prepend(createAvatar(conversationName(conversation), conversation.peer?.avatarDataUrl));
      if (conversation.kind === "group") {
        button.querySelector("strong").textContent = conversationName(conversation);
        button.querySelector("small").textContent = t("chatGroupMemberCount", "{count} members", {
          count: conversation.group?.memberCount || 0,
        });
      } else {
        button.querySelector("strong").textContent = conversation.peer?.alias || t("chatNoConversation", "Conversation");
        button.querySelector("small").textContent = isHistoricalConversation(conversation) ? t("chatHistoricalLabel", "Historical chat") : state.accountMode
          ? "End-to-end encrypted"
          : "Encrypted chat";
      }
      button.addEventListener("click", () => selectConversation(conversation).catch((error) => setStatus(formatActionError(error), true)));
      host.appendChild(button);
    });
    if (state.accountMode) {
      const existingPeers = new Set(state.conversations.flatMap((conversation) => isAccountConversation(conversation) && conversation.kind === "direct" && conversation.peer?.contactId ? [conversation.peer.contactId] : []));
      const available = state.contacts.filter((contact) => !existingPeers.has(contact.id));
      if (available.length) {
        const heading = document.createElement("p");
        heading.className = "chat-muted";
        heading.textContent = "Start a secure chat";
        host.appendChild(heading);
        available.forEach((contact) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "chat-conversation-item";
          const identity = document.createElement("span");
          identity.className = "chat-contact-identity";
          const name = document.createElement("strong");
          name.textContent = contact.profile?.alias || "Paired contact";
          identity.append(createAvatar(name.textContent, contact.profile?.avatarDataUrl), name);
          button.appendChild(identity);
          button.addEventListener("click", async () => {
            if (button.disabled) return;
            button.disabled = true;
            try {
              setStatus("Creating secure conversation...");
              const conversation = await createAccountConversation("direct", [contact.id]);
              state.conversations = [conversation, ...state.conversations];
              renderContacts();
              await selectConversation(conversation);
              setStatus("");
            } catch (error) { setStatus(formatActionError(error), true); }
            finally { button.disabled = false; }
          });
          host.appendChild(button);
        });
      }
    }
    renderGroupContactPicker();
  }

  function renderGroupContactPicker() {
    const host = $("#groupContactList");
    if (!host) return;
    const selected = new Set([...host.querySelectorAll("input:checked")].map((input) => input.value));
    host.replaceChildren();
    if (!state.contacts.length) {
      const empty = document.createElement("p");
      empty.className = "chat-muted";
      empty.textContent = t("chatGroupNeedsContacts", "Pair at least one friend before creating a group.");
      host.appendChild(empty);
      return;
    }
    state.contacts.forEach((contact) => {
      const label = document.createElement("label");
      label.className = "chat-group-contact-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = contact.id;
      const accountStatus = state.accountContactStatus.get(contact.id);
      checkbox.disabled = state.accountMode && accountStatus !== true;
      checkbox.checked = selected.has(contact.id) && accountStatus !== false;
      const text = document.createElement("span");
      text.textContent = contact.profile?.alias || t("chatNoConversation", "Conversation");
      label.append(checkbox, createAvatar(text.textContent, contact.profile?.avatarDataUrl), text);
      if (state.accountMode && accountStatus !== true) {
        const unavailable = document.createElement("small");
        unavailable.textContent = accountStatus === false
          ? t("chatContactSecureRequired", "Needs secure chat enabled")
          : t("chatContactSecureChecking", "Checking secure chat...");
        label.appendChild(unavailable);
      }
      host.appendChild(label);
      if (state.accountMode && !state.accountContactStatus.has(contact.id) && !state.accountContactRequests.has(contact.id)) {
        const generation = state.contactStatusGeneration;
        state.accountContactRequests.add(contact.id);
        window.ALevelApi.getChatContactAccountBundle(contact.id)
          .then((bundle) => {
            if (generation !== state.contactStatusGeneration) return;
            state.accountContactStatus.set(contact.id, Boolean(bundle?.enabled && bundle?.accountKey));
            renderGroupContactPicker();
            if (state.activeConversation?.kind === "group") renderGroupManagement(state.activeConversation);
          })
          .catch(() => {
            if (generation !== state.contactStatusGeneration) return;
            state.accountContactStatus.set(contact.id, false);
            renderGroupContactPicker();
          })
          .finally(() => { if (generation === state.contactStatusGeneration) state.accountContactRequests.delete(contact.id); });
      }
    });
  }

  function renderGroupManagement(conversation) {
    const host = $("#groupMemberList");
    if (!host) return;
    host.replaceChildren();
    const self = conversation.group?.members?.find((member) => member.isSelf);
    const canManage = ["owner", "admin"].includes(self?.role);
    for (const member of conversation.group?.members || []) {
      const row = document.createElement("div");
      row.className = "chat-device-item";
      const details = document.createElement("div");
      details.className = "chat-device-item__details";
      const name = document.createElement("strong");
      name.textContent = member.isSelf ? `${state.profile?.alias || member.alias || t("chatYou", "You")} (${t("chatYou", "You")})` : (member.alias || "Paired contact");
      const role = document.createElement("small");
      role.textContent = member.role || "member";
      details.append(name, role);
      const identity = document.createElement("div");
      identity.className = "chat-member-identity";
      identity.append(createAvatar(name.textContent, member.isSelf ? state.profile?.avatarDataUrl : member.avatarDataUrl), details);
      row.appendChild(identity);
      if (!member.isSelf && member.userId) {
        const controls = document.createElement("div");
        controls.className = "chat-device-item__actions";
        const addAction = (label, action, payload, rotate = false) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn-secondary chat-small-action";
          button.textContent = label;
          button.addEventListener("click", async () => {
            if (!window.confirm(`${label}: ${member.alias || "this member"}?`)) return;
            button.disabled = true;
            try {
              if (rotate) await rotateGroupWithMembers(conversation, action, [], payload);
              else await submitGroupControl(conversation, action, payload);
              await refreshData();
              if (state.activeConversation?.id === conversation.id) setStatus("");
            } catch (error) { setStatus(formatActionError(error), true); }
            finally { button.disabled = false; }
          });
          controls.appendChild(button);
        };
        if (canManage && member.role !== "owner" && (self.role === "owner" || member.role === "member")) addAction("Remove", "remove", { userId: member.userId }, true);
        if (self?.role === "owner" && member.role !== "owner") {
          addAction(member.role === "admin" ? "Make member" : "Make administrator", "role", { userId: member.userId, role: member.role === "admin" ? "member" : "admin" });
          addAction("Transfer ownership", "transfer", { userId: member.userId });
        }
        row.appendChild(controls);
      }
      host.appendChild(row);
    }
    const actions = $("#groupMemberActions");
    if (actions) {
      actions.hidden = false;
      $("#dissolveGroup").hidden = self?.role !== "owner";
      $("#leaveGroup").hidden = self?.role === "owner";
      $("#rotateGroupKey").hidden = !canManage || !conversation.rotationRequired;
      $("#inviteGroupMember").hidden = !canManage;
      $("#groupInviteContact").hidden = !canManage;
      const existing = new Set((conversation.group?.members || []).map((member) => member.contactId).filter(Boolean));
      const eligible = state.contacts.filter((contact) => !existing.has(contact.id) && state.accountContactStatus.get(contact.id) === true);
      const selectedContact = $("#groupInviteContact").value;
      $("#groupInviteContact").replaceChildren(...eligible.map((contact) => {
        const option = document.createElement("option");
        option.value = contact.id;
        option.textContent = contact.profile?.alias || "Paired contact";
        return option;
      }));
      if (eligible.some((contact) => contact.id === selectedContact)) $("#groupInviteContact").value = selectedContact;
      $("#inviteGroupMember").disabled = eligible.length === 0 || Number(conversation.group?.memberCount) >= 50;
    }
  }

  function setGroupFormVisible(visible) {
    const form = $("#groupCreatePanel");
    if (!form) return;
    form.hidden = !visible;
    if (visible) renderGroupContactPicker();
  }

  function renderDevices() {
    const host = $("#deviceList");
    if (!host) return;
    host.replaceChildren();
    const devices = state.devices.length ? state.devices : (state.device ? [state.device] : []);
    devices.forEach((device) => {
      const item = document.createElement("div");
      item.className = "chat-device-item";
      item.innerHTML = `<div class="chat-device-item__details"><strong></strong><small></small></div><div class="chat-device-item__actions"><button type="button" class="btn-secondary chat-device-approve"></button><button type="button" class="btn-secondary chat-device-backup"></button><button type="button" class="btn-secondary chat-device-revoke"></button></div>`;
      item.querySelector("strong").textContent = device.label || `Device ${device.deviceNumber || ""}`;
      item.querySelector("small").textContent = t("chatPrekeyCount", "Pre-keys: {count}", { count: device.oneTimePreKeyCount ?? "?" });
      const approve = item.querySelector(".chat-device-approve");
      const backup = item.querySelector(".chat-device-backup");
      const revoke = item.querySelector(".chat-device-revoke");
      approve.textContent = t("chatApproveDevice", "Create device approval token");
      backup.textContent = t("chatCreateBackup", "Create encrypted recovery backup");
      revoke.textContent = t("chatRevokeDevice", "Revoke device");
      approve.hidden = device.id !== state.device?.id || Boolean(device.revokedAt);
      backup.hidden = !state.recoveryEnabled || device.id !== state.device?.id || Boolean(device.revokedAt);
      revoke.hidden = device.id === state.device?.id || Boolean(device.revokedAt);
      approve.addEventListener("click", () => createDeviceApproval(device.id));
      backup.addEventListener("click", () => createRecoveryBackup(device.id));
      revoke.addEventListener("click", () => revokeDevice(device.id));
      host.appendChild(item);
    });
  }

  async function updateRecoveryAvailability() {
    const actions = [$("#createRecoveryBackup"), $("#restoreRecoveryBackup"), $("#restoreRecoveryBackupSetup")].filter(Boolean);
    if (!actions.length) return;
    try {
      await window.ALevelApi.getChatKeyBackup();
      state.recoveryEnabled = true;
      actions.forEach((button) => { button.hidden = false; });
    } catch (_error) {
      state.recoveryEnabled = false;
      actions.forEach((button) => { button.hidden = true; });
    }
  }

  async function createRecoveryBackup(deviceId) {
    if (!window.confirm(t("chatBackupWarning", "The backup excludes message plaintext but includes secure session state. Anyone with this recovery password may decrypt messages near the backup time."))) return;
    const password = window.prompt(t("chatRecoveryPasswordPrompt", "Enter a separate recovery password:"))?.trim() || "";
    if (!password) return;
    try {
      const backup = await cryptoCall("createRecoveryBackup", { userId: state.profile?.id, sourceDeviceId: deviceId, password });
      await window.ALevelApi.saveChatKeyBackup(backup);
      setStatus(t("chatBackupCreated", "Encrypted recovery backup saved. Keep the recovery password safe."));
      await refreshData();
    } catch (error) {
      setStatus(`${t("chatBackupFailed", "Could not save recovery backup: {message}", { message: error.message })}${error.code ? ` (${error.code})` : ""}`, true);
    }
  }

  async function restoreRecoveryBackup() {
    const source = window.prompt(t("chatRecoverySourcePrompt", "Enter the source device ID shown in the backup:"))?.trim() || "";
    const password = window.prompt(t("chatRecoveryPasswordPrompt", "Enter the separate recovery password:"))?.trim() || "";
    if (!source || !password) return;
    try {
      const backup = await window.ALevelApi.getChatKeyBackup();
      if (!backup || backup.sourceDeviceId !== source) throw new Error(t("chatBackupNotFound", "No recovery backup matches that source device."));
      const validation = await cryptoCall("restoreRecoveryBackup", { userId: state.profile?.id, backup, password });
      const backupDate = validation.createdAt ? new Date(validation.createdAt).toLocaleString() : "unknown";
      if (!window.confirm(t(
        "chatRecoveryConfirm",
        "Restore encrypted device state from {source}, created at {date}? The source device will be revoked after confirmation.",
        { source, date: backupDate },
      ))) {
        await cryptoCall("clearRestoredDeviceState", {});
        return;
      }
      const bundle = await cryptoCall("createRestoredDeviceBundle", { label: navigator.userAgent.includes("Mobile") ? "Restored mobile browser" : "Restored browser" });
      const restored = await window.ALevelApi.restoreChatKeyBackup({
        deviceId: bundle.deviceId,
        restoreOperationId: bundle.restoreOperationId,
        sourceDeviceId: bundle.sourceDeviceId,
        identityPublicKey: bundle.identityPublicKey,
        registrationId: bundle.registrationId,
        signedPreKey: bundle.signedPreKey,
        oneTimePreKeys: bundle.oneTimePreKeys,
        label: bundle.label,
      });
      await cryptoCall("commitRestoredDeviceState", { deviceId: bundle.deviceId });
      state.device = { ...restored.device, identityFingerprint: bundle.identityFingerprint };
      saveDevice(state.device);
      setStatus(t("chatRecoveryComplete", "Device recovery complete. The previous device was revoked."));
      await refreshData();
    } catch (error) {
      await cryptoCall("clearRestoredDeviceState", {}).catch(() => {});
      setStatus(t("chatRecoveryFailed", "Device recovery failed: {message}", { message: formatActionError(error) }), true);
    }
  }

  async function createDeviceApproval(deviceId) {
    try {
      const result = await window.ALevelApi.createChatDeviceApproval(deviceId);
      await navigator.clipboard?.writeText(result.token);
      setStatus(t("chatApprovalCopied", "Approval token copied. It is single-use and valid for 5 minutes."));
    } catch (error) {
      setStatus(t("chatApprovalFailed", "Could not create approval token: {message}", { message: formatActionError(error) }), true);
    }
  }

  async function revokeDevice(deviceId) {
    try {
      await window.ALevelApi.revokeChatDevice(deviceId);
      state.devices = state.devices.filter((device) => device.id !== deviceId);
      renderDevices();
      setStatus("");
    } catch (error) {
      setStatus(formatActionError(error), true);
    }
  }

  function renderMessages() {
    const host = $("#messageList");
    if (!host) return;
    host.replaceChildren();
    state.messages.forEach((message) => {
      const isMine = Boolean((message.senderUserId && message.senderUserId === state.profile?.id)
        || (message.senderDeviceId && message.senderDeviceId === state.device?.id));
      const item = document.createElement("article");
      item.className = `chat-message${isMine ? " is-mine" : ""}`;
      const decryptCode = message.decryptCode ? ` (${message.decryptCode})` : "";
      const text = message.deleted
        ? "[deleted]"
        : message.plaintext || `${t("chatDecryptFailed", "Could not decrypt this message.")}${decryptCode}`;
      item.innerHTML = `<small class="chat-message__sender" hidden></small><p></p><div class="chat-message__attachment" hidden></div><time></time>`;
      if (state.activeConversation?.kind === "group") {
        const sender = item.querySelector(".chat-message__sender");
        sender.hidden = false;
        const member = state.activeConversation.group?.members?.find((entry) => entry.userId === message.senderUserId);
        const name = isMine ? `${state.profile?.alias || t("chatYou", "You")} (${t("chatYou", "You")})`
          : member?.alias || message.senderAlias || "Paired contact";
        sender.textContent = name;
        const identity = document.createElement("div");
        identity.className = "chat-message__identity";
        const senderAvatar = isMine ? state.profile?.avatarDataUrl
          : member ? member.avatarDataUrl : message.senderAvatarDataUrl;
        identity.append(createAvatar(name, senderAvatar), sender);
        item.prepend(identity);
      }
      let structured = null;
      try { structured = JSON.parse(text); } catch (_error) { }
      if (structured?.kind === "image" && structured.attachmentId) {
        item.querySelector("p").textContent = structured.name || t("chatAttachImage", "Encrypted image");
        const attachment = item.querySelector(".chat-message__attachment");
        attachment.hidden = false;
        const downloadButton = document.createElement("button");
        downloadButton.type = "button";
        downloadButton.className = "btn-secondary chat-small-action";
        downloadButton.textContent = t("chatDownloadImage", "Download encrypted image");
        downloadButton.addEventListener("click", () => downloadImage(structured));
        attachment.appendChild(downloadButton);
      } else {
        item.querySelector("p").textContent = text;
      }
      item.querySelector("time").textContent = new Date(message.createdAt).toLocaleString();
      host.appendChild(item);
    });
    host.scrollTop = host.scrollHeight;
  }

  async function resetActiveSession() {
    const conversation = state.activeConversation;
    const peer = conversation?.peer;
    if (!conversation || !peer?.deviceId) return;
    if (!window.confirm(t("chatResetSessionConfirm", "Reset this secure session? You should compare the safety number with your friend first."))) return;
    try {
      await cryptoCall("resetSession", { deviceId: state.device.id, peerDeviceId: peer.deviceId, peerDeviceNumber: peer.deviceNumber });
      state.peerBundles.delete(peer.contactId);
      await renderSafetyNumber(conversation);
      setStatus(t("chatSessionReset", "Secure session reset. Send a new message to establish it again."));
    } catch (error) {
      setStatus(formatActionError(error), true);
    }
  }

  async function assertSafetyStable(conversation) {
    if (!conversation || !state.device) return;
    const peerDevices = await getPeerDevices(conversation);
    if (!peerDevices.length) return;
    const safety = await cryptoCall("safetyNumber", {
      localDeviceId: state.device.id,
      localDevices: state.devices.filter((item) => !item.revokedAt).map((item) => ({
        deviceId: item.id,
        deviceNumber: item.deviceNumber,
        identityKey: item.identityPublicKey,
      })),
      peerDevices,
    });
    const verified = await cryptoCall("getSafetyNumberVerification", { key: conversation.id });
    const changed = await cryptoCall("getSafetyNumberChange", { key: conversation.id });
    if (changed || (verified && verified !== safety)) {
      const error = new Error(t("chatSafetyChangedBlock", "The safety number changed. Verify it again before sending."));
      error.code = "SAFETY_NUMBER_CHANGED";
      throw error;
    }
    return peerDevices;
  }

  async function getPeerDevices(conversation) {
    if (conversation?.kind === "group") {
      const bundle = state.conversationBundles.get(conversation.id)
        || await window.ALevelApi.getChatConversationBundle(conversation.id);
      state.conversationBundles.set(conversation.id, bundle);
      return (bundle?.members || []).flatMap((member) => member.devices || []);
    }
    const contactId = conversation?.peer?.contactId;
    if (!contactId) return [];
    const bundle = state.peerBundles.get(contactId) || await window.ALevelApi.getChatContactBundle(contactId);
    state.peerBundles.set(contactId, bundle);
    return bundle?.devices || [];
  }

  async function getAccountRecipients(conversation) {
    const bundle = await window.ALevelApi.getChatConversationAccountBundle(conversation.id);
    const recipients = bundle?.members || [];
    if (!recipients.length || recipients.some((member) => !member.accountKey || (member.accountKey.status && member.accountKey.status !== "active"))) {
      const error = new Error("Every member must enable secure chat before this conversation can use account encryption.");
      error.code = "ACCOUNT_KEYS_REQUIRED";
      throw error;
    }
    return recipients.map((member) => ({
      userId: member.userId,
      keyVersion: member.accountKey.keyVersion,
      encryptionPublicKey: member.accountKey.encryptionPublicKey,
    }));
  }

  async function signAccountControl(conversationId, expectedEpoch, action, payload) {
    return cryptoCall("signAccountV2Control", { conversationId, expectedEpoch, action, payload });
  }

  async function submitGroupControl(conversation, action, payload) {
    const expectedEpoch = await currentAccountEpoch(conversation);
    const signed = await signAccountControl(conversation.id, expectedEpoch, action, payload);
    return window.ALevelApi.updateChatGroupMembers(conversation.id, signed);
  }

  async function createAccountConversation(kind, contactIds) {
    const conversationId = crypto.randomUUID();
    const recipients = [];
    for (const contactId of contactIds) {
      const bundle = await window.ALevelApi.getChatContactAccountBundle(contactId);
      if (!bundle?.enabled || !bundle?.accountKey) {
        const error = new Error("Every selected contact must enable secure chat first.");
        error.code = "ACCOUNT_NOT_ENABLED";
        throw error;
      }
      recipients.push({ userId: bundle.accountKey.userId, keyVersion: bundle.accountKey.keyVersion, encryptionPublicKey: bundle.accountKey.encryptionPublicKey });
    }
    const self = state.accountV2;
    recipients.push({ userId: state.profile.id, keyVersion: self.keyVersion, encryptionPublicKey: self.encryptionPublicKey });
    const epoch = await cryptoCall("createAccountV2Epoch", { conversationId, epoch: 1, recipients });
    const payload = { kind, contactIds, recipients: epoch.recipients };
    if (kind === "group") {
      payload.metadata = await cryptoCall("encryptAccountV2Metadata", {
        conversationId,
        epoch: 1,
        version: "1",
        plaintext: { name: "Encrypted group", avatarRef: null },
      });
      payload.metadata.version = 1;
    }
    const signed = await signAccountControl(conversationId, 0, "create", payload);
    return window.ALevelApi.createAccountChatConversation({ ...signed, version: "account-v2", conversationId });
  }

  async function rotateGroupWithMembers(conversation, action, contactIds = [], extraPayload = {}) {
    const expectedEpoch = await currentAccountEpoch(conversation);
    let recipients = await getAccountRecipients(conversation);
    if (action === "remove") recipients = recipients.filter((recipient) => recipient.userId !== extraPayload.userId);
    for (const contactId of contactIds) {
      const bundle = await window.ALevelApi.getChatContactAccountBundle(contactId);
      if (!bundle?.enabled || !bundle?.accountKey) throw new Error("The selected contact must enable secure chat first.");
      recipients.push({ userId: bundle.accountKey.userId, keyVersion: bundle.accountKey.keyVersion, encryptionPublicKey: bundle.accountKey.encryptionPublicKey });
    }
    const unique = [...new Map(recipients.map((recipient) => [recipient.userId, recipient])).values()];
    const nextEpoch = expectedEpoch + 1;
    const epoch = await cryptoCall("createAccountV2Epoch", { conversationId: conversation.id, epoch: nextEpoch, recipients: unique });
    const metadataVersion = String(Number(conversation.metadata?.version || 1) + 1);
    const metadata = await cryptoCall("encryptAccountV2Metadata", {
      conversationId: conversation.id,
      epoch: nextEpoch,
      version: metadataVersion,
      plaintext: state.accountGroupMetadata.get(conversation.id) || { name: "Encrypted group", avatarRef: null },
    });
    metadata.version = Number(metadataVersion);
    const signed = await signAccountControl(conversation.id, expectedEpoch, action, {
      ...extraPayload,
      ...(contactIds.length ? { contactIds } : {}),
      recipients: epoch.recipients,
      metadata,
    });
    try {
      const result = await window.ALevelApi.updateChatGroupMembers(conversation.id, signed);
      const accepted = result?.conversation;
      if (accepted?.id === conversation.id && isAccountConversation(accepted)) {
        const previous = state.conversations.find((item) => item.id === conversation.id);
        const active = state.activeConversation?.id === conversation.id ? state.activeConversation : null;
        const knownEpoch = Math.max(Number(previous?.currentEpoch ?? previous?.epoch ?? 0), Number(active?.currentEpoch ?? active?.epoch ?? 0));
        if (Number(accepted.currentEpoch ?? accepted.epoch) >= knownEpoch) {
          state.dataRefreshGeneration += 1;
          state.conversations = [accepted, ...state.conversations.filter((item) => item.id !== accepted.id)];
          if (active) state.activeConversation = accepted;
          state.accountIdentityChanges.delete(conversation.id);
          renderActiveConversation();
          renderContacts();
          if (active) setStatus("");
        }
      }
      return result;
    } catch (error) {
      showAccountIdentityChange(conversation, error);
      // Reopen accepted envelopes after a rejected candidate rotation.
      await openAccountEpochs(conversation).catch(() => {});
      throw error;
    }
  }

  async function openAccountEpochs(conversation) {
    if (!isAccountConversation(conversation) || !state.accountV2?.unlocked) return [];
    const payload = await window.ALevelApi.getChatConversationEpochs(conversation.id);
    const history = Array.isArray(payload?.epochs) ? payload.epochs : Array.isArray(payload) ? payload : [];
    const epochs = history.filter((item) => item.envelope?.keyVersion === state.accountV2.keyVersion);
    for (const item of epochs) {
      await cryptoCall("openAccountV2Envelope", {
        conversationId: conversation.id,
        epoch: item.epoch,
        envelope: item.envelope,
      });
    }
    state.accountEpochs.set(conversation.id, epochs);
    if (conversation.metadata && !epochs.some((item) => Number(item.epoch) === Number(conversation.metadata.epoch))) {
      const refreshed = await window.ALevelApi.getChatConversationAccountBundle(conversation.id);
      if (refreshed?.id === conversation.id && isAccountConversation(refreshed)) {
        Object.assign(conversation, refreshed);
        const active = state.activeConversation;
        if (active?.id === conversation.id && Number(refreshed.currentEpoch ?? refreshed.epoch) >= Number(active.currentEpoch ?? active.epoch ?? 0)) {
          Object.assign(active, refreshed);
        }
      }
    }
    if (conversation.metadata) {
      const decrypted = await cryptoCall("decryptAccountV2Metadata", {
        conversationId: conversation.id,
        ...conversation.metadata,
        version: String(conversation.metadata.version),
      });
      state.accountGroupMetadata.set(conversation.id, JSON.parse(decrypted.plaintext));
    }
    return epochs;
  }

  async function currentAccountEpoch(conversation) {
    const epochs = await openAccountEpochs(conversation);
    const current = [...epochs].sort((left, right) => Number(right.epoch) - Number(left.epoch))[0];
    if (!current) {
      const error = new Error("This account has no usable key for this conversation. Refresh the chat or ask its owner to restore your membership.");
      error.code = "EPOCH_KEY_UNAVAILABLE";
      throw error;
    }
    return Number(current.epoch);
  }

  async function sendAccountV2Payload(conversation, plaintext, attachmentRefs = [], contentEpoch = null) {
    const epoch = contentEpoch ?? await currentAccountEpoch(conversation);
    const clientMessageId = crypto.randomUUID();
    const encrypted = await cryptoCall("encryptAccountV2Message", {
      conversationId: conversation.id,
      clientMessageId,
      epoch,
      plaintext,
      attachmentRefs,
    });
    await window.ALevelApi.sendAccountV2Message({
      conversationId: conversation.id,
      clientMessageId,
      contentEpoch: encrypted.epoch,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      senderKeyId: encrypted.senderKeyId,
      signature: encrypted.signature,
      attachmentRefs: encrypted.attachmentRefs,
      sizeBucket: "small",
    });
    return clientMessageId;
  }

  async function getEncryptionRecipients(conversation) {
    const peerDevices = await getPeerDevices(conversation);
    if (!peerDevices.length) {
      const error = new Error(t("chatNoActiveGroupDevices", "No active recipient devices are available."));
      error.code = "NO_ACTIVE_RECIPIENT_DEVICES";
      throw error;
    }
    const ownBundle = state.ownBundle || await window.ALevelApi.getChatOwnDeviceBundle(state.device.id);
    state.ownBundle = ownBundle;
    const ownDevices = ownBundle?.devices || [];
    const recipients = [...peerDevices, ...ownDevices];
    const seen = new Set();
    return recipients.filter((device) => {
      if (!device?.deviceId || seen.has(device.deviceId)) return false;
      seen.add(device.deviceId);
      return true;
    });
  }

  function canRecoverSession(error) {
    return ["SESSION_MISSING", "DUPLICATE_OR_REPLAY", "MESSAGE_GAP_TOO_LARGE", "DECRYPT_FAILED"]
      .includes(error?.code);
  }

  async function refreshRecipient(device, conversation) {
    const isOwnDevice = state.ownBundle?.devices?.some((item) => item.deviceId === device.deviceId)
      || device.deviceId === state.device?.id;
    if (isOwnDevice) {
      state.ownBundle = null;
      const ownBundle = await window.ALevelApi.getChatOwnDeviceBundle(state.device.id);
      state.ownBundle = ownBundle;
      return (ownBundle?.devices || []).find((item) => item.deviceId === device.deviceId) || device;
    }
    if (conversation.kind === "group") {
      state.conversationBundles.delete(conversation.id);
    } else if (conversation.peer?.contactId) {
      state.peerBundles.delete(conversation.peer.contactId);
    }
    const fresh = await getPeerDevices(conversation);
    return fresh.find((item) => item.deviceId === device.deviceId) || device;
  }

  async function encryptForRecipient(conversation, device, plaintext) {
    let current = device;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await cryptoCall("processPreKeyBundle", {
          deviceId: state.device.id,
          peerDeviceId: current.deviceId,
          peerDeviceNumber: current.deviceNumber,
          bundle: current,
        });
        return await cryptoCall("encryptMessage", {
          deviceId: state.device.id,
          peerDeviceId: current.deviceId,
          peerDeviceNumber: current.deviceNumber,
          plaintext,
        });
      } catch (error) {
        if (attempt || !canRecoverSession(error)) throw error;
        // A stale local session can survive a device replacement. Rebuild only this
        // device pair, then retry with a freshly fetched public bundle.
        await cryptoCall("resetSession", {
          deviceId: state.device.id,
          peerDeviceId: current.deviceId,
          peerDeviceNumber: current.deviceNumber,
        });
        current = await refreshRecipient(current, conversation);
      }
    }
    throw new Error("The encrypted message could not be processed.");
  }

  async function downloadImage(metadata) {
    try {
      const blob = await window.ALevelApi.downloadChatAttachment(metadata.attachmentId);
      const bytes = await blob.arrayBuffer();
      const decrypted = await cryptoCall("decryptAttachment", { bytes, key: metadata.key, nonce: metadata.nonce });
      const imageBlob = new Blob([decrypted], { type: metadata.mime || "image/*" });
      const url = URL.createObjectURL(imageBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = metadata.name || "encrypted-image";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setStatus(t("chatAttachmentFailed", "Image upload failed: {message}", { message: formatActionError(error) }), true);
    }
  }

  async function decryptMessages(messages) {
    const result = [];
    for (const message of messages) {
      if (message.deleted) {
        result.push({ ...message, deleted: true });
        continue;
      }
      if (message.protocolVersion === "account-v2") {
        try {
          const decrypted = await cryptoCall("decryptAccountV2Message", {
            message: {
              conversationId: message.conversationId,
              clientMessageId: message.clientMessageId,
              epoch: message.contentEpoch,
              senderUserId: message.senderUserId,
              senderKeyId: message.senderKeyId || message.contentKeyVersion || "1",
              nonce: message.nonce,
              ciphertext: message.ciphertext,
              attachmentRefs: message.attachmentRefs || [],
              signature: message.signature,
            },
            signingPublicKey: message.senderSigningPublicKey,
          });
          result.push({ ...message, plaintext: decrypted.plaintext });
        } catch (error) {
          result.push({ ...message, plaintext: null, decryptCode: error?.code || "DECRYPT_FAILED" });
        }
        continue;
      }
      try {
        const cachedPlaintext = await getCachedLocalPlaintext(message.clientMessageId);
        if (cachedPlaintext != null) {
          result.push({ ...message, plaintext: cachedPlaintext });
          continue;
        }
      } catch (_error) {
        // A cache read failure should not prevent a normal decrypt attempt.
      }
      try {
        const outer = JSON.parse(atob(message.ciphertext.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - message.ciphertext.length % 4) % 4)));
        const selected = outer.recipients?.[state.device.id] || outer;
        if (!selected?.body) throw new Error("No ciphertext for this device.");
        const plaintext = await cryptoCall("decryptMessage", {
          deviceId: state.device.id,
          peerDeviceId: message.senderDeviceId,
          peerDeviceNumber: message.senderDeviceNumber || state.activeConversation?.peer?.deviceNumber || 1,
          ciphertext: selected,
        });
        result.push({ ...message, plaintext });
        try {
          await cacheLocalPlaintext(message.clientMessageId, plaintext);
        } catch (_error) {
          // The message is still usable in this render if local caching fails.
        }
      } catch (error) {
        result.push({ ...message, plaintext: null, decryptCode: error?.code || "DECRYPT_FAILED" });
      }
    }
    return result;
  }

  async function syncConversation() {
    if (!state.activeConversation || (!state.device && !state.accountV2?.unlocked)) return;
    const generation = state.syncGeneration;
    if (state.syncInFlight) {
      await state.syncInFlight;
      if (state.syncGeneration !== generation) return;
      return syncConversation();
    }
    state.syncInFlight = (async () => {
      const conversationId = state.activeConversation.id;
      if (isAccountConversation(state.activeConversation)) {
        let hasMore;
        do {
          const payload = await window.ALevelApi.syncChatEvents(conversationId, state.cursor);
          if (!conversationIsCurrent(conversationId, generation)) return;
          if (payload?.hidden) {
            forgetHistoricalConversation(conversationId);
            return;
          }
          const events = Array.isArray(payload?.events) ? payload.events : [];
          const incoming = events.filter((event) => event.type === "message" && event.message).map((event) => event.message);
          const controlsChanged = events.some((event) => !["message", "deleted"].includes(event.type));
          if (controlsChanged) {
            await refreshData();
            if (!conversationIsCurrent(conversationId, generation)) return;
          }
          const opened = new Set((state.accountEpochs.get(conversationId) || []).map((item) => Number(item.epoch)));
          if (controlsChanged || incoming.some((message) => !opened.has(Number(message.contentEpoch)))) {
            await openAccountEpochs(state.activeConversation);
            if (!conversationIsCurrent(conversationId, generation)) return;
            renderActiveConversation();
            renderContacts();
          }
          if (incoming.length) {
            const fresh = await decryptMessages(incoming);
            if (!conversationIsCurrent(conversationId, generation)) return;
            const known = new Map(state.messages.map((message) => [message.id, message]));
            fresh.forEach((message) => known.set(message.id, message));
            state.messages = [...known.values()].sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
          }
          for (const event of events.filter((item) => item.type === "deleted" && item.messageId)) {
            const existing = state.messages.find((message) => message.id === event.messageId);
            if (existing) Object.assign(existing, { deleted: true, plaintext: null, ciphertext: "" });
          }
          const nextCursor = payload?.nextCursor == null ? state.cursor : String(payload.nextCursor);
          hasMore = Boolean(payload?.hasMore && nextCursor !== state.cursor);
          state.cursor = nextCursor;
          renderMessages();
        } while (hasMore && conversationIsCurrent(conversationId, generation));
        return;
      }
      const payload = await window.ALevelApi.syncChatMessages(conversationId, state.cursor);
      if (state.syncGeneration !== generation || state.activeConversation?.id !== conversationId) return;
      if (payload?.hidden) {
        forgetHistoricalConversation(conversationId);
        return;
      }
      if (!state.device) return;
      const fresh = await decryptMessages(payload.messages || []);
      if (!conversationIsCurrent(conversationId, generation)) return;
      const known = new Set(state.messages.map((message) => message.id));
      state.messages = [...state.messages, ...fresh.filter((message) => !known.has(message.id))];
      state.cursor = payload.nextCursor || state.cursor;
      renderMessages();
    })().finally(() => {
      if (state.syncGeneration === generation) state.syncInFlight = null;
    });
    return state.syncInFlight;
  }

  function stopPolling() {
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(() => {
      if (document.hidden || !state.activeConversation) return;
      if (!state.syncInFlight) syncConversation().catch((error) => setStatus(formatActionError(error), true));
      if (Date.now() - state.lastProfileRefresh >= 30000) refreshPresentation().catch(() => {});
    }, 3000);
  }

  async function openRealtime() {
    if (!state.activeConversation || (!state.device && !state.accountV2?.unlocked)) return;
    const conversation = state.activeConversation;
    const conversationId = conversation.id;
    const generation = state.syncGeneration;
    if (!isAccountConversation(conversation) && !state.device) return;
    state.socket?.close();
    try {
      const ticket = await window.ALevelApi.createChatWebSocketTicket(conversationId, isAccountConversation(conversation) ? undefined : state.device.id);
      if (!conversationIsCurrent(conversationId, generation)) return;
      const base = window.ALevelApi.getBaseUrl() || location.origin;
      const wsUrl = new URL(`/api/chat/ws/${encodeURIComponent(conversationId)}`, base);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(wsUrl, [ticket.protocol, `ticket.${ticket.ticket}`]);
      socket.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!conversationIsCurrent(conversationId, generation)) return;
          if (payload.type === "sync" && payload.conversationId === conversationId) await syncConversation();
          else if (payload.type === "message" && payload.message?.conversationId === conversationId) await syncConversation();
        } catch (_error) {
        }
      };
      socket.onclose = () => {
        if (conversationIsCurrent(conversationId, generation)) startPolling();
      };
      state.socket = socket;
    } catch (_error) {
      // Cursor sync remains available when realtime is unavailable.
    }
  }

  async function selectConversation(conversation) {
    stopPolling();
    if (state.activeConversation) state.messageDrafts.set(state.activeConversation.id, $("#messageInput").value);
    const generation = ++state.syncGeneration;
    state.socket?.close();
    state.socket = null;
    state.syncInFlight = null;
    state.activeConversation = conversation;
    closeEmojiPicker();
    state.emojiSelection = null;
    $("#messageInput").value = state.messageDrafts.get(conversation.id) || "";
    $("#imageInput").value = "";
    state.messages = [];
    state.cursor = "";
    $("#groupManagePanel").hidden = true;
    renderActiveConversation();
    renderMessages();
    renderContacts();
    try {
      if (isAccountConversation(conversation)) {
        await openAccountEpochs(conversation);
      } else if (state.accountMode) {
        if (!state.device) {
          const existing = savedDevice();
          if (existing) {
            const devices = await window.ALevelApi.listChatDevices();
            const current = devices.find((device) => device.id === existing.id && !device.revokedAt);
            if (current) state.device = { ...existing, ...current };
          }
        }
        if (!state.device) {
          setStatus("This historical chat needs its original device to decrypt messages.", true);
          startPolling();
          return;
        }
      } else {
        await renderSafetyNumber(conversation);
      }
      if (!conversationIsCurrent(conversation.id, generation)) return;
      renderActiveConversation();
      await syncConversation();
      if (!conversationIsCurrent(conversation.id, generation)) return;
      await openRealtime();
      if (!conversationIsCurrent(conversation.id, generation)) return;
      startPolling();
    } catch (error) {
      showAccountIdentityChange(conversation, error);
      if (conversationIsCurrent(conversation.id, generation)) setStatus(formatActionError(error), true);
    }
  }

  async function renderSafetyNumber(conversation) {
    const host = $("#conversationSafety");
    if (!host) return;
    try {
      const peerDevices = await getPeerDevices(conversation);
      const safety = await cryptoCall("safetyNumber", {
        localDeviceId: state.device.id,
        localDevices: state.devices.filter((item) => !item.revokedAt).map((item) => ({
          deviceId: item.id,
          deviceNumber: item.deviceNumber,
          identityKey: item.identityPublicKey,
        })),
        peerDevices,
      });
      const verificationKey = conversation.id;
      const verified = await cryptoCall("getSafetyNumberVerification", { key: verificationKey });
      const safetyChanged = Boolean(verified && verified !== safety);
      const safetyChange = await cryptoCall("getSafetyNumberChange", { key: verificationKey });
      if (safetyChanged && safetyChange !== safety) {
        await cryptoCall("clearSafetyNumberVerification", { key: verificationKey });
        await cryptoCall("markSafetyNumberChanged", { key: verificationKey, safety });
      }
      const safetyNeedsVerification = safetyChanged || Boolean(safetyChange);
      host.replaceChildren();
      const label = document.createElement("span");
      const safetyStatus = safetyNeedsVerification
        ? t("chatSafetyChanged", "Safety number changed; verify again")
        : verified
          ? t("chatSafetyVerified", "Verified")
          : t("chatSafetyUnverified", "Not verified");
      label.textContent = `${t("chatSafetyNumber", "Safety number")}: ${safety} · ${safetyStatus}`;
      host.appendChild(label);
      if (conversation.kind === "group") {
        const memberNames = document.createElement("small");
        memberNames.className = "chat-device-fingerprints";
        memberNames.textContent = t(
          "chatGroupMembers",
          "Members: {members}",
          { members: (conversation.group?.members || []).map((member) => member.isSelf ? t("chatYou", "You") : member.alias).join(", ") || "-" },
        );
        host.appendChild(memberNames);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-secondary chat-small-action";
      button.textContent = verified === safety && !safetyNeedsVerification
        ? t("chatSafetyVerified", "Verified")
        : t("chatSafetyVerify", "Mark verified");
      button.addEventListener("click", async () => {
        try {
          await cryptoCall("setSafetyNumberVerification", { key: verificationKey, safety });
          if (state.activeConversation?.id === conversation.id) await renderSafetyNumber(conversation);
        } catch (error) { setStatus(formatActionError(error), true); }
      });
      host.appendChild(button);
      if (conversation.kind !== "group") {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "btn-secondary chat-small-action";
        reset.textContent = t("chatResetSession", "Reset secure session");
        reset.addEventListener("click", resetActiveSession);
        host.appendChild(reset);
      }
    } catch (error) {
      host.textContent = t("chatSecurityStatusUnavailable", "Secure identity status unavailable.");
      if (error?.code) setStatus(`${error.message} (${error.code})`, true);
    }
  }

  async function ensureDevice() {
    const existing = savedDevice();
    if (existing) {
      const serverDevices = await window.ALevelApi.listChatDevices();
      state.devices = serverDevices;
      const current = serverDevices.find((device) => device.id === existing.id && !device.revokedAt);
      if (!current) {
        localStorage.removeItem(DEVICE_KEY);
        $("#chatSetupPanel").hidden = false;
        return;
      }
      state.device = { ...existing, ...current };
      renderDevices();
      return;
    }
    $("#chatSetupPanel").hidden = false;
  }

  async function setupDevice() {
    const button = $("#generateDeviceKeys");
    button.disabled = true;
    setStatus(t("chatSetupLoading", "Generating device keys..."));
    try {
      const browserDeviceId = crypto.randomUUID();
      const bundle = await cryptoCall("generateDeviceBundle", { deviceId: browserDeviceId, label: navigator.userAgent.includes("Mobile") ? "Mobile browser" : "Browser" });
      const existingDevices = await window.ALevelApi.listChatDevices();
      let approvalToken = "";
      if (existingDevices.length) {
        approvalToken = window.prompt("Enter the one-time approval token from a trusted device.")?.trim() || "";
        if (!approvalToken) throw new Error("A trusted device approval token is required.");
      }
      const registered = await window.ALevelApi.registerChatDevice({ ...bundle, approvalToken });
      state.device = { ...registered.device, identityFingerprint: bundle.identityFingerprint };
      saveDevice(state.device);
      $("#chatSetupPanel").hidden = true;
      $("#chatApp").hidden = false;
      renderDevices();
      setStatus("");
      await refreshData();
    } catch (error) {
      setStatus(t("chatSetupFailed", "Device setup failed: {message}", { message: formatActionError(error) }), true);
      button.disabled = false;
    }
  }

  async function refreshData() {
    const generation = ++state.dataRefreshGeneration;
    const selectionGeneration = state.syncGeneration;
    const [profile, invites, contacts, conversations] = await Promise.all([
      window.ALevelApi.getChatProfile(),
      window.ALevelApi.listChatInvites(),
      window.ALevelApi.listChatContacts(),
      window.ALevelApi.listChatConversations(),
    ]);
    if (generation !== state.dataRefreshGeneration) return;
    if (selectionGeneration !== state.syncGeneration) return refreshData();
    for (const conversation of conversations) {
      if (!isAccountConversation(conversation) || conversation.kind !== "group") continue;
      const previous = state.conversations.find((item) => item.id === conversation.id);
      if (previous && Number(conversation.currentEpoch ?? conversation.epoch) > Number(previous.currentEpoch ?? previous.epoch)) {
        state.accountIdentityChanges.delete(conversation.id);
      }
    }
    state.profile = profile;
    state.contacts = contacts;
    state.conversations = conversations.filter((conversation) => !state.hiddenConversations.has(conversation.id));
    state.peerBundles.clear();
    state.conversationBundles.clear();
    state.ownBundle = null;
    state.contactStatusGeneration += 1;
    state.accountContactStatus.clear();
    state.accountContactRequests.clear();
    if (state.activeConversation) {
      const refreshed = state.conversations.find((conversation) => conversation.id === state.activeConversation.id);
      state.activeConversation = refreshed || null;
      if (!refreshed) {
        state.syncGeneration += 1;
        state.syncInFlight = null;
        state.messages = [];
        state.cursor = "";
        stopPolling();
        state.socket?.close();
        state.socket = null;
      }
    }
    if (!state.accountMode) {
      state.devices = await window.ALevelApi.listChatDevices();
      await ensurePrekeys();
      await updateRecoveryAvailability();
    }
    renderInvites(invites);
    state.lastProfileRefresh = Date.now();
    renderChatProfile();
    renderContacts();
    renderActiveConversation();
    if (!state.activeConversation) renderMessages();
    if (!state.accountMode) renderDevices();
  }

  async function refreshPresentation() {
    if (state.profileRefreshInFlight) return state.profileRefreshInFlight;
    const generation = state.dataRefreshGeneration;
    const selectionGeneration = state.syncGeneration;
    state.profileRefreshInFlight = (async () => {
      const [profile, contacts, conversations] = await Promise.all([
        window.ALevelApi.getChatProfile(), window.ALevelApi.listChatContacts(), window.ALevelApi.listChatConversations(),
      ]);
      if (generation !== state.dataRefreshGeneration || selectionGeneration !== state.syncGeneration) return;
      state.dataRefreshGeneration += 1;
      state.lastProfileRefresh = Date.now();
      state.profile = profile;
      state.contacts = contacts;
      state.conversations = conversations.filter((conversation) => !state.hiddenConversations.has(conversation.id));
      if (state.activeConversation) {
        const refreshed = state.conversations.find((conversation) => conversation.id === state.activeConversation.id);
        if (!refreshed) {
          forgetHistoricalConversation(state.activeConversation.id, false);
          renderChatProfile();
          return;
        }
        state.activeConversation = refreshed;
      }
      renderChatProfile();
      renderContacts();
      renderActiveConversation();
      renderMessages();
    })().finally(() => { state.profileRefreshInFlight = null; });
    return state.profileRefreshInFlight;
  }

  async function ensurePrekeys() {
    const current = state.devices.find((device) => device.id === state.device?.id && !device.revokedAt);
    if (!current || Number(current.oneTimePreKeyCount) >= 5) return;
    try {
      const refill = await cryptoCall("generatePreKeyRefill", { deviceId: state.device.id, count: 20 });
      await window.ALevelApi.refillChatDevicePreKeys(state.device.id, refill.oneTimePreKeys);
      state.devices = await window.ALevelApi.listChatDevices();
    } catch (error) {
      setStatus(t("chatPrekeyRefillFailed", "Could not replenish one-time pre-keys: {message}", { message: formatActionError(error) }), true);
    }
  }

  async function createGroup() {
    const button = $("#confirmCreateGroup");
    if (button.disabled) return;
    const selected = [...document.querySelectorAll("#groupContactList input[type=checkbox]:checked")]
      .map((input) => input.value);
    if (!selected.length) {
      setStatus(t("chatGroupSelectMembers", "Select at least one friend."), true);
      return;
    }
    if (selected.length > 49) {
      setStatus(t("chatGroupTooManyMembers", "A group can contain at most 50 people including you."), true);
      return;
    }
    button.disabled = true;
    try {
      const conversation = state.accountMode
        ? await createAccountConversation("group", selected)
        : await window.ALevelApi.createChatGroup(selected);
      state.conversations = [conversation, ...state.conversations.filter((item) => item.id !== conversation.id)];
      setGroupFormVisible(false);
      renderContacts();
      await selectConversation(conversation);
      setStatus(t("chatGroupCreated", "Encrypted group created."));
    } catch (error) {
      setStatus(t("chatGroupCreateFailed", "Could not create group: {message}", { message: formatActionError(error) }), true);
    } finally { button.disabled = false; }
  }

  async function createInvite() {
    try {
      const invite = await window.ALevelApi.createChatInvite();
      const url = new URL(location.href);
      url.search = `?invite=${encodeURIComponent(invite.token)}`;
      const inviteUrl = url.toString();
      $("#inviteToken").value = inviteUrl;
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(inviteUrl);
          copied = true;
        }
      } catch (_error) {
        // Private browsing may deny clipboard access; the URL remains visible for manual copying.
      }
      setStatus(t(
        copied ? "chatInviteCreated" : "chatInviteCreatedManualCopy",
        copied
          ? "Invite created. It expires in 7 days and can be used once."
          : "Invite created. Copy the URL from the invite field; it expires in 7 days and can be used once."
      ));
      try {
        await refreshData();
      } catch (error) {
        setStatus(t("chatInviteRefreshFailed", "Invite processed, but the chat list could not refresh: {message}", { message: error.message }), true);
      }
    } catch (error) {
      setStatus(t("chatInviteFailed", "Invite action failed: {message}", { message: error.message }), true);
    }
  }

  async function acceptInvite() {
    const raw = $("#inviteToken").value.trim();
    const token = extractInviteToken(raw);
    if (!token) {
      setStatus(t("chatInviteTokenMissing", "Paste the full invite URL or the invite token first."), true);
      return;
    }
    if (/^[A-Za-z0-9_-]{20,32}$/.test(token)) {
      setStatus(t("chatInviteIdNotToken", "This looks like an internal invite ID, not the invite token. Ask the creator to create a new invite and copy the full URL."), true);
      return;
    }
    try {
      await window.ALevelApi.acceptChatInvite(token);
      $("#inviteToken").value = "";
      sessionStorage.removeItem(PENDING_INVITE_KEY);
      setStatus(t("chatInviteAccepted", "Friend paired."));
      try {
        await refreshData();
      } catch (error) {
        setStatus(t("chatInviteRefreshFailed", "Friend paired, but the chat list could not refresh: {message}", { message: error.message }), true);
      }
    } catch (error) {
      if (error.code === "INVITE_SELF") {
        setStatus(t("chatInviteSelf", error.message), true);
        return;
      }
      const detail = error.code && error.code !== "HTTP_ERROR"
        ? `${error.message || "Request failed"} (${error.code})`
        : error.message || t("chatInviteUnknownError", "No error details were returned. Check the browser console and network response.");
      setStatus(t("chatInviteFailed", "Invite action failed: {message}", { message: detail }), true);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.activeConversation || (!state.device && !state.accountV2?.unlocked)) return;
    const conversation = state.activeConversation;
    if (state.accountMode && !isAccountConversation(conversation)) return;
    const input = $("#messageInput");
    const plaintext = input.value.trim();
    if (!plaintext) return;
    const button = $("#sendMessage");
    if (button.disabled) return;
    state.sendingText.add(conversation.id);
    button.disabled = true;
    let sent = false;
    setStatus(t("chatSending", "Encrypting and sending..."));
    try {
      if (isAccountConversation(conversation)) {
        await sendAccountV2Payload(conversation, plaintext);
        sent = true;
        if (state.messageDrafts.get(conversation.id)?.trim() === plaintext) state.messageDrafts.delete(conversation.id);
        if (state.activeConversation?.id === conversation.id) {
          if (input.value.trim() === plaintext) input.value = "";
          await syncConversation();
          setStatus("");
        }
        return;
      }
      await assertSafetyStable(conversation);
      const peers = await getEncryptionRecipients(conversation);
      if (!peers.length) throw new Error("The contact has no active device.");
      const recipients = {};
      for (const peer of peers) {
        recipients[peer.deviceId] = await encryptForRecipient(conversation, peer, plaintext);
      }
      const envelope = btoa(JSON.stringify({ version: 1, recipients })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const clientMessageId = crypto.randomUUID();
      await window.ALevelApi.sendChatMessage({
        conversationId: conversation.id,
        senderDeviceId: state.device.id,
        clientMessageId,
        protocolVersion: "signal-v1",
        ciphertext: envelope,
        sizeBucket: "small",
      });
      sent = true;
      if (state.messageDrafts.get(conversation.id)?.trim() === plaintext) state.messageDrafts.delete(conversation.id);
      await cacheLocalPlaintext(clientMessageId, plaintext).catch(() => {});
      if (state.activeConversation?.id === conversation.id) {
        if (input.value.trim() === plaintext) input.value = "";
        await syncConversation();
        setStatus("");
      }
    } catch (error) {
      showAccountIdentityChange(conversation, error);
      if (state.activeConversation?.id === conversation.id) setStatus(sent
        ? `Message sent, but chat refresh failed: ${formatActionError(error)}`
        : t("chatMessageFailed", "Message failed: {message}", { message: formatActionError(error) }), true);
    } finally {
      state.sendingText.delete(conversation.id);
      if (state.activeConversation?.id === conversation.id) renderActiveConversation();
    }
  }

  async function sendImage(file) {
    if (!file || !state.activeConversation || (!state.device && !state.accountV2?.unlocked)) return;
    const conversation = state.activeConversation;
    const generation = state.syncGeneration;
    if (state.accountMode && !isAccountConversation(conversation)) return;
    if (state.sendingImages.has(conversation.id)) return;
    if (file.size + 16 > 10 * 1024 * 1024) throw new Error("Encrypted images, including their authentication tag, must be 10 MB or smaller.");
    state.sendingImages.add(conversation.id);
    $("#imageInput").disabled = true;
    let sent = false;
    try {
      setStatus(t("chatSending", "Encrypting and sending..."));
      if (!isAccountConversation(conversation)) await assertSafetyStable(conversation);
      const contentEpoch = isAccountConversation(conversation) ? await currentAccountEpoch(conversation) : null;
      const encryptedFile = await cryptoCall("encryptAttachment", { bytes: await file.arrayBuffer() });
      const reservation = await window.ALevelApi.initChatAttachment({
        conversationId: conversation.id,
        sizeBytes: encryptedFile.bytes.byteLength,
        ...(contentEpoch == null ? {} : { protocolVersion: "account-v2", contentEpoch }),
      });
      await window.ALevelApi.uploadChatAttachment(reservation.attachmentId, encryptedFile.bytes);
      await window.ALevelApi.completeChatAttachment(reservation.attachmentId);
      const metadata = JSON.stringify({
        kind: "image",
        attachmentId: reservation.attachmentId,
        key: encryptedFile.key,
        nonce: encryptedFile.nonce,
        name: file.name,
        mime: file.type || "image/*",
      });
      if (isAccountConversation(conversation)) {
        await sendAccountV2Payload(conversation, metadata, [reservation.attachmentId], contentEpoch);
      } else {
        const peers = await getEncryptionRecipients(conversation);
        if (!peers.length) throw new Error("The contact has no active device.");
        const recipients = {};
        for (const peer of peers) {
          recipients[peer.deviceId] = await encryptForRecipient(conversation, peer, metadata);
        }
        const envelope = btoa(JSON.stringify({ version: 1, recipients })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        const clientMessageId = crypto.randomUUID();
        await window.ALevelApi.sendChatMessage({
          conversationId: conversation.id,
          senderDeviceId: state.device.id,
          clientMessageId,
          protocolVersion: "signal-v1",
          ciphertext: envelope,
          attachmentRefs: [reservation.attachmentId],
        });
        await cacheLocalPlaintext(clientMessageId, metadata).catch(() => {});
      }
      sent = true;
      if (conversationIsCurrent(conversation.id, generation)) {
        $("#imageInput").value = "";
        await syncConversation();
        setStatus("");
      }
    } catch (error) {
      showAccountIdentityChange(conversation, error);
      if (sent) {
        if (conversationIsCurrent(conversation.id, generation)) setStatus(`Image sent, but chat refresh failed: ${formatActionError(error)}`, true);
      } else throw error;
    } finally {
      state.sendingImages.delete(conversation.id);
      if (state.activeConversation?.id === conversation.id) {
        $("#imageInput").value = "";
        renderActiveConversation();
      }
    }
  }

  function wireEvents() {
    $("#editChatProfile")?.addEventListener("click", () => {
      if (state.profileSaving) return;
      $("#chatProfileForm").hidden = false;
      renderChatProfile();
      $("#chatProfileAlias").focus();
    });
    $("#chatProfileForm")?.addEventListener("submit", saveChatProfile);
    $("#cancelChatProfile")?.addEventListener("click", closeProfileEditor);
    $("#chatProfileAlias")?.addEventListener("input", () => { state.profileDirty = true; renderChatProfile(); });
    $("#chatProfileAvatarInput")?.addEventListener("change", (event) => prepareProfileAvatar(event.target.files?.[0]));
    $("#removeChatProfileAvatar")?.addEventListener("click", () => {
      if (state.profileSaving || state.profileAvatarProcessing) return;
      state.profileDraftAvatar = "";
      state.profileDirty = true;
      renderChatProfile();
    });
    $("#deleteHistoricalChat")?.addEventListener("click", deleteHistoricalChat);
    $("#enableAccountSync")?.addEventListener("click", setupAccountSync);
    $("#unlockAccountSync")?.addEventListener("click", unlockAccountSync);
    $("#groupManageButton")?.addEventListener("click", () => {
      const panel = $("#groupManagePanel");
      if (!state.activeConversation || state.activeConversation.kind !== "group" || !panel) return;
      panel.hidden = false;
      renderGroupManagement(state.activeConversation);
    });
    $("#closeGroupManage")?.addEventListener("click", () => { $("#groupManagePanel").hidden = true; });
    $("#leaveGroup")?.addEventListener("click", async () => {
      const conversation = state.activeConversation;
      if (!conversation || !window.confirm("Leave this group? A remaining owner or administrator must rotate the encryption epoch.")) return;
      try {
        const expectedEpoch = await currentAccountEpoch(conversation);
        const signed = await signAccountControl(conversation.id, expectedEpoch, "leave", {});
        await window.ALevelApi.leaveChatGroup(conversation.id, signed);
        $("#groupManagePanel").hidden = true;
        await refreshData();
      } catch (error) { setStatus(formatActionError(error), true); }
    });
    $("#inviteGroupMember")?.addEventListener("click", async () => {
      const conversation = state.activeConversation;
      const contactId = $("#groupInviteContact")?.value;
      if (!conversation || !contactId) return;
      try {
        await rotateGroupWithMembers(conversation, "add", [contactId]);
        $("#groupManagePanel").hidden = true;
        await refreshData();
      } catch (error) { setStatus(formatActionError(error), true); }
    });
    $("#rotateGroupKey")?.addEventListener("click", async () => {
      const conversation = state.activeConversation;
      if (!conversation || !isAccountConversation(conversation)) return;
      const button = $("#rotateGroupKey");
      button.disabled = true;
      try {
        setStatus("Updating group encryption...");
        await rotateGroupWithMembers(conversation, "rotate");
        await refreshData();
        setStatus("Group encryption updated.");
      } catch (error) { setStatus(formatActionError(error), true); }
      finally { button.disabled = false; }
    });
    $("#dissolveGroup")?.addEventListener("click", async () => {
      const conversation = state.activeConversation;
      if (!conversation || !window.confirm("Disband this group?")) return;
      try {
        const expectedEpoch = await currentAccountEpoch(conversation);
        const signed = await signAccountControl(conversation.id, expectedEpoch, "dissolve", {});
        await window.ALevelApi.dissolveChatGroup(conversation.id, signed);
        $("#groupManagePanel").hidden = true;
        await refreshData();
      } catch (error) { setStatus(formatActionError(error), true); }
    });
    $("#generateDeviceKeys")?.addEventListener("click", setupDevice);
    $("#createGroup")?.addEventListener("click", () => setGroupFormVisible(true));
    $("#confirmCreateGroup")?.addEventListener("click", createGroup);
    $("#cancelCreateGroup")?.addEventListener("click", () => setGroupFormVisible(false));
    $("#createInvite")?.addEventListener("click", createInvite);
    $("#acceptInvite")?.addEventListener("click", acceptInvite);
    $("#createRecoveryBackup")?.addEventListener("click", () => createRecoveryBackup(state.device?.id));
    $("#restoreRecoveryBackup")?.addEventListener("click", restoreRecoveryBackup);
    $("#restoreRecoveryBackupSetup")?.addEventListener("click", restoreRecoveryBackup);
    $("#refreshChat")?.addEventListener("click", () => refreshData().catch((error) => setStatus(formatActionError(error), true)));
    $("#messageForm")?.addEventListener("submit", sendMessage);
    $("#imageInput")?.addEventListener("change", (event) => sendImage(event.target.files?.[0]).catch((error) => setStatus(t("chatAttachmentFailed", "Image upload failed: {message}", { message: formatActionError(error) }), true)));
    $("#messageInput")?.addEventListener("input", () => {
      if (state.activeConversation) state.messageDrafts.set(state.activeConversation.id, $("#messageInput").value);
    });
    $("#emojiButton")?.addEventListener("click", () => {
      if ($("#messageInput").disabled) return;
      if (!$("#emojiTray").hidden) { closeEmojiPicker(); return; }
      const input = $("#messageInput");
      state.emojiSelection = { conversationId: state.activeConversation?.id, start: input.selectionStart, end: input.selectionEnd };
      $("#emojiTray").hidden = false;
      $("#emojiButton").setAttribute("aria-expanded", "true");
      renderEmojiPicker();
      $("#emojiSearch").focus();
    });
    $("#emojiSearch")?.addEventListener("input", renderEmojiPicker);
    $("#emojiSearch")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        $("#emojiGrid button")?.focus();
      }
    });
    $("#emojiCategories")?.addEventListener("click", (event) => {
      const category = event.target.closest("button[data-category]");
      if (!category) return;
      state.emojiCategory = category.dataset.category;
      $("#emojiSearch").value = "";
      renderEmojiPicker();
      $("#emojiCategories").querySelector(`[data-category="${state.emojiCategory}"]`)?.focus();
    });
    $("#emojiGrid")?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-emoji]");
      if (button) insertEmoji(button.dataset.emoji);
    });
    $("#emojiGrid")?.addEventListener("keydown", (event) => {
      const buttons = [...$("#emojiGrid").querySelectorAll("button[data-emoji]")];
      const index = buttons.indexOf(event.target);
      if (index < 0) return;
      const columns = getComputedStyle($("#emojiGrid")).gridTemplateColumns.split(" ").length;
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
      let next = offsets[event.key] == null ? null : index + offsets[event.key];
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = buttons.length - 1;
      if (next != null) { event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus(); }
    });
    $("#emojiTray")?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeEmojiPicker(); $("#messageInput").focus(); }
    });
    document.addEventListener("click", (event) => {
      const path = event.composedPath();
      if (!path.includes($("#emojiTray")) && !path.includes($("#emojiButton"))) closeEmojiPicker();
    });
    window.addEventListener("alevel:languagechange", () => {
      renderChatProfile();
      renderContacts();
      renderActiveConversation();
      if (!$("#emojiTray").hidden) renderEmojiPicker();
    });
    $("#retentionSelect")?.addEventListener("change", async (event) => {
      if (!state.activeConversation) return;
      const conversation = state.activeConversation;
      const generation = state.syncGeneration;
      const retentionSeconds = Number(event.target.value);
      event.target.disabled = true;
      try {
        if (isAccountConversation(conversation)) await submitGroupControl(conversation, "retention", { retentionSeconds });
        else await window.ALevelApi.updateChatConversationSettings(conversation.id, retentionSeconds);
        await refreshData();
      } catch (error) {
        if (conversationIsCurrent(conversation.id, generation)) {
          event.target.value = String(conversation.retentionSeconds);
          setStatus(formatActionError(error), true);
        }
      } finally {
        if (conversationIsCurrent(conversation.id, generation)) renderActiveConversation();
      }
    });
  }

  async function initialize() {
    const invite = pendingInviteToken();
    if (!currentToken()) {
      if (invite) sessionStorage.setItem(PENDING_INVITE_KEY, invite);
      const next = `chat.html${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
      location.href = `login.html?next=${encodeURIComponent(next)}`;
      return;
    }
    try {
      wireEvents();
      if (invite) $("#inviteToken").value = invite;
      state.profile = await window.ALevelApi.getChatProfile();
      renderChatProfile();
      const accountConfigured = await ensureAccountState();
      if (accountConfigured) {
        if (state.accountV2?.unlocked) {
          $("#chatApp").hidden = false;
          await refreshData();
        }
        return;
      }
      $("#enableAccountSync").hidden = true;
      $("#unlockAccountSync").hidden = true;
      $("#generateDeviceKeys").hidden = false;
      await ensureDevice();
      const existing = savedDevice();
      if (!existing) {
        await updateRecoveryAvailability();
        return;
      }
      $("#chatApp").hidden = false;
      await refreshData();
      if (invite) $("#inviteToken").value = invite;
    } catch (error) {
      if (error?.code === "CHAT_NOT_ENABLED" || error?.status === 503) {
        $("#chatSetupPanel").hidden = true;
        $("#chatDisabledPanel").hidden = false;
      } else {
        setStatus(formatActionError(error), true);
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
  window.addEventListener("beforeunload", () => {
    stopPolling();
    state.socket?.close();
  });
})();
