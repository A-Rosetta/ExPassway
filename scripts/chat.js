(function () {
  const TOKEN_KEY = "alevel.authToken";
  const DEVICE_KEY = "expassway.chat.device.v1";
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
    accountBundle: null,
    authToken: "",
    accountSessionGeneration: 0,
    passkeyEnrollment: null,
    passkeyEnrollmentBusy: false,
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
    userSearchGeneration: 0,
    globalDiscussion: null,
    globalInfo: null,
    globalPendingCount: 0,
    globalReconcileInFlight: null,
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

  function assertAccountSession(generation) {
    if (generation !== state.accountSessionGeneration || !state.authToken || state.authToken !== currentToken()) {
      const error = new Error("Your login session changed. Sign in again before unlocking secure chat.");
      error.code = "CHAT_SESSION_CHANGED";
      throw error;
    }
  }

  function lockLocalChatSession() {
    state.accountSessionGeneration += 1;
    state.dataRefreshGeneration += 1;
    state.syncGeneration += 1;
    state.accountV2 = null;
    state.accountEpochs.clear();
    state.accountGroupMetadata.clear();
    state.localPlaintexts = {};
    state.messageDrafts.clear();
    state.messages = [];
    state.activeConversation = null;
    state.conversations = [];
    state.contacts = [];
    state.cursor = "";
    state.syncInFlight = null;
    state.passkeyEnrollmentBusy = false;
    stopPolling();
    state.socket?.close();
    state.socket = null;
    for (const pending of state.pendingCrypto.values()) pending.reject(new Error("The chat login session ended."));
    state.pendingCrypto.clear();
    state.cryptoWorker?.terminate();
    state.cryptoWorker = null;
    $("#messageInput").value = "";
    $("#messageList").replaceChildren();
    $("#chatApp").hidden = true;
    $("#chatSetupPanel").hidden = !currentToken();
    $("#enableAccountSync").hidden = Boolean(state.accountBundle?.accountKey);
    $("#unlockAccountSync").hidden = !state.accountBundle?.accountKey;
    renderPasskeyEnrollment();
  }

  async function saveUnlockedSession() {
    if (!state.accountV2?.unlocked || state.authToken !== currentToken()) return;
    try {
      await window.ALevelChatSession?.save(cryptoCall, { userId: state.profile.id, credentialId: state.accountV2.credentialId });
    } catch (_error) {
      // Browsers may block IndexedDB. The normal Passkey unlock remains usable.
    }
  }

  async function restoreUnlockedSession(bundle) {
    if (!bundle?.accountKey || !window.ALevelChatSession) return false;
    const generation = state.accountSessionGeneration;
    const versions = await retainedAccountVaults();
    assertAccountSession(generation);
    const accountKeys = [{ ...bundle.accountKey, credentialIds: bundle.credentialIds || [] },
      ...versions.filter((version) => version.keyVersion !== bundle.accountKey.keyVersion).map((version) => ({
        ...version.accountKey, credentialIds: (version.wrappers || []).map((wrapper) => wrapper.credentialId).filter(Boolean),
      }))];
    const restored = await window.ALevelChatSession.restore(cryptoCall, { userId: state.profile.id, accountKeys });
    if (!restored?.unlocked) {
      if (state.authToken !== currentToken()) assertAccountSession(generation);
      return false;
    }
    assertAccountSession(generation);
    state.accountV2 = { ...restored, missingVaultVersions: versions.filter((version) => version.keyVersion !== restored.keyVersion
      && !restored.retainedKeyVersions.includes(version.keyVersion)).map((version) => version.keyVersion) };
    $("#chatSetupPanel").hidden = true;
    $("#chatUnsupportedPanel").hidden = true;
    $("#chatApp").hidden = false;
    renderPasskeyEnrollment();
    setStatus("");
    return true;
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
      $("#chatProfileUserId").value = profile.chatUserId || "";
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
    $("#chatProfileUserId").disabled = state.profileSaving;
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
    const chatUserId = $("#chatProfileUserId").value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,47}$/.test(chatUserId)) {
      setProfileFeedback(t("chatUserIdInvalid", "Use 3–48 letters, numbers, dots, hyphens or underscores for your user ID."), true);
      return;
    }
    if (Array.from(alias).length < 2 || Array.from(alias).length > 48 || !/^[\p{L}\p{N} _.-]+$/u.test(alias)) {
      setProfileFeedback(t("chatProfileNameInvalid", "Use 2–48 letters, numbers, spaces, _, . or -."), true);
      return;
    }
    state.profileSaving = true;
    setProfileControls();
    setProfileFeedback(t("chatProfileSaving", "Saving profile..."));
    try {
      const profile = await window.ALevelApi.updateChatProfile({ chatUserId, alias, avatarDataUrl: state.profileDraftAvatar });
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
    if (conversation?.isGlobalDiscussion || conversation?.globalDiscussion) return t("chatGlobalDiscussionTitle", "Global Discussion");
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
    const worker = new Worker("../assets/vendor/chat-crypto-worker.js?v=20261005-3", { name: "expassway-chat-crypto" });
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
        renderPasskeyEnrollment();
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
    if (source.extensions?.prf?.evalByCredential) {
      options.extensions = { ...options.extensions, prf: { ...options.extensions?.prf,
        evalByCredential: Object.fromEntries(Object.entries(source.extensions.prf.evalByCredential).map(([id, evaluation]) => [id, {
          ...evaluation, first: base64UrlToBytes(evaluation.first),
          ...(evaluation.second ? { second: base64UrlToBytes(evaluation.second) } : {}),
        }])) } };
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

  async function accountPasskeyAssertion(input = {}) {
    const response = await window.ALevelApi.getChatPasskeyAuthenticationOptions(input);
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
    return { prfOutput, proof: verified?.proof || verified?.writeProof || "",
      credentialId: verified?.credentialId || credential.id,
      keyVersion: verified?.keyVersion || input.keyVersion || null };
  }

  function matchingVault(vault, credentialId) {
    if (!vault) return null;
    const wrapper = vault.wrappers?.find((item) => item.credentialId === credentialId);
    if (wrapper) return { ...vault, ...wrapper };
    if (!vault.credentialId || vault.credentialId === credentialId) return vault;
    return null;
  }

  async function retainedAccountVaults(currentVault) {
    if (!window.ALevelApi.getChatAccountVaults) return currentVault ? [currentVault] : [];
    const payload = await window.ALevelApi.getChatAccountVaults();
    return Array.isArray(payload) ? payload : Array.isArray(payload?.vaults) ? payload.vaults : [];
  }

  function validateUnlockedIdentity(unlocked, accountKey) {
    if (accountKey?.keyVersion === unlocked.keyVersion
      && ((accountKey.fingerprint && accountKey.fingerprint !== unlocked.fingerprint)
        || (accountKey.encryptionPublicKey && accountKey.encryptionPublicKey !== unlocked.encryptionPublicKey)
        || (accountKey.signingPublicKey && accountKey.signingPublicKey !== unlocked.signingPublicKey))) {
      const error = new Error("The unlocked vault does not match your existing chat identity. Keep your existing Passkeys and try again.");
      error.code = "ACCOUNT_IDENTITY_CHANGED";
      throw error;
    }
  }

  function expectedVaultIdentity(accountKey, keyVersion) {
    if (!accountKey || accountKey.keyVersion !== keyVersion) return {};
    return { expectedFingerprint: accountKey.fingerprint, expectedEncryptionPublicKey: accountKey.encryptionPublicKey,
      expectedSigningPublicKey: accountKey.signingPublicKey };
  }

  async function unlockExistingAccount(vault, assertion) {
    const generation = state.accountSessionGeneration;
    assertAccountSession(generation);
    const selected = matchingVault(vault, assertion.credentialId);
    if (!selected) {
      const error = new Error("This Passkey has not been synchronized with your chat history. Unlock with an existing Passkey, then synchronize it.");
      error.code = "ACCOUNT_VAULT_WRAPPER_MISSING";
      throw error;
    }
    const unlocked = await cryptoCall("unlockAccountV2Vault", {
      userId: state.profile.id, keyVersion: selected.keyVersion,
      nonce: selected.nonce, ciphertext: selected.ciphertext, prfOutput: assertion.prfOutput,
      ...expectedVaultIdentity(vault.accountKey || state.accountBundle?.accountKey, selected.keyVersion),
    });
    assertAccountSession(generation);
    validateUnlockedIdentity(unlocked, state.accountBundle?.accountKey);
    state.accountV2 = { ...unlocked, proof: assertion.proof, credentialId: assertion.credentialId };
    const versions = await retainedAccountVaults(vault);
    assertAccountSession(generation);
    for (const historical of versions) {
      if (historical.keyVersion === unlocked.keyVersion) continue;
      const wrapped = matchingVault(historical, assertion.credentialId);
      if (!wrapped) continue;
      try {
        const restored = await cryptoCall("unlockAccountV2Vault", {
          userId: state.profile.id, keyVersion: wrapped.keyVersion, nonce: wrapped.nonce,
          ciphertext: wrapped.ciphertext, prfOutput: assertion.prfOutput, retainOnly: true,
          ...expectedVaultIdentity(historical.accountKey, wrapped.keyVersion),
        });
        assertAccountSession(generation);
        validateUnlockedIdentity(restored, historical.accountKey);
      } catch (error) {
        // Older records without a credential ID are only candidates. A failed
        // candidate cannot justify discarding the successfully unlocked head.
        if (!wrapped.legacyCandidate || error?.code !== "ACCOUNT_VAULT_UNLOCK_FAILED") throw error;
      }
    }
    const cryptoState = await cryptoCall("getAccountV2State");
    assertAccountSession(generation);
    state.accountV2.retainedKeyVersions = cryptoState.retainedKeyVersions || [];
    const availableVersions = new Set([unlocked.keyVersion, ...state.accountV2.retainedKeyVersions]);
    state.accountV2.missingVaultVersions = versions.filter((historical) => !availableVersions.has(historical.keyVersion)).map((historical) => historical.keyVersion);
    $("#chatSetupPanel").hidden = true;
    $("#chatApp").hidden = false;
    renderPasskeyEnrollment();
    setStatus("");
    await saveUnlockedSession();
    await refreshData();
  }

  async function unlockAccountSync() {
    const generation = state.accountSessionGeneration;
    const button = $("#unlockAccountSync");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const vault = await window.ALevelApi.getChatAccountVault();
      if (!vault) {
        const bundle = await window.ALevelApi.getChatAccountKeyBundle();
        if (bundle?.accountKey) throw new Error("Your existing chat vault is unavailable. Keep your existing Passkeys and try again.");
        return await setupAccountSync();
      }
      setStatus("Unlocking secure chat with your Passkey...");
      const assertion = await accountPasskeyAssertion();
      assertAccountSession(generation);
      await unlockExistingAccount(vault, assertion);
    } catch (error) {
      setStatus(formatActionError(error), true);
    } finally {
      button.disabled = false;
    }
  }

  async function ensureAccountState() {
    const generation = state.accountSessionGeneration;
    let bundle;
    try { bundle = await window.ALevelApi.getChatAccountKeyBundle(); }
    catch (error) {
      if (error?.status === 503 || error?.code === "CHAT_ACCOUNT_V2_DISABLED") return false;
      throw error;
    }
    assertAccountSession(generation);
    state.accountMode = true;
    state.accountBundle = bundle;
    state.accountPasskeyReady = Boolean(bundle?.passkeyReady);
    $("#legacyDevicePanel").hidden = true;
    if (await restoreUnlockedSession(bundle)) return true;
    if (!supportsAccountPasskey()) {
      $("#chatSetupPanel").hidden = true;
      $("#chatUnsupportedPanel").hidden = false;
      return true;
    }
    const vault = bundle?.enabled || bundle?.accountKey ? await window.ALevelApi.getChatAccountVault() : null;
    $("#chatSetupPanel").hidden = false;
    $("#enableAccountSync").hidden = Boolean(vault || bundle?.accountKey);
    $("#unlockAccountSync").hidden = !vault && !bundle?.accountKey;
    if (!vault) $("#chatApp").hidden = true;
    renderPasskeyEnrollment();
    return true;
  }

  async function setupAccountSync() {
    const generation = state.accountSessionGeneration;
    if (!supportsAccountPasskey()) {
      $("#chatSetupPanel").hidden = true;
      $("#chatUnsupportedPanel").hidden = false;
      return;
    }
    const enable = $("#enableAccountSync");
    if (enable?.disabled) return;
    if (state.accountV2?.unlocked) return;
    if (enable) enable.disabled = true;
    let generatedCandidate = false;
    setStatus(state.accountPasskeyReady
      ? "Unlocking the existing Passkey to finish secure chat setup..."
      : "Creating a Passkey for secure chat...");
    try {
      const existingVault = await window.ALevelApi.getChatAccountVault();
      const existingBundle = await window.ALevelApi.getChatAccountKeyBundle();
      state.accountBundle = existingBundle;
      assertAccountSession(generation);
      if (existingVault) {
        const assertion = await accountPasskeyAssertion();
        assertAccountSession(generation);
        return await unlockExistingAccount(existingVault, assertion);
      }
      if (existingBundle?.accountKey) throw new Error("Your existing chat vault is unavailable. Keep your existing Passkeys and try again.");
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
          assertAccountSession(generation);
          const registrationChallenge = registration.publicKey?.challenge || registration.challenge;
          if (!registrationChallenge) throw new Error("The Passkey registration challenge was missing. Refresh and try again.");
          await window.ALevelApi.verifyChatPasskey("register", {
            challenge: registrationChallenge,
            credential: serialiseCredential(credential),
          });
          assertAccountSession(generation);
          state.accountPasskeyReady = true;
        }
      } else {
        setStatus("This device already has a secure chat Passkey. Unlocking it to finish setup...");
      }
      const assertion = await accountPasskeyAssertion();
      assertAccountSession(generation);
      // A second browser may finish setup while the Passkey prompt is open.
      // Never generate replacement keys for an account with an existing vault.
      const currentVault = await window.ALevelApi.getChatAccountVault();
      assertAccountSession(generation);
      if (currentVault) return await unlockExistingAccount(currentVault, assertion);
      const generated = await cryptoCall("generateAccountV2Vault", {
        userId: state.profile.id,
        prfOutput: assertion.prfOutput,
      });
      assertAccountSession(generation);
      generatedCandidate = true;
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
      assertAccountSession(generation);
      state.accountV2 = { ...generated, unlocked: true, proof: assertion.proof, credentialId: assertion.credentialId,
        retainedKeyVersions: [], missingVaultVersions: [] };
      generatedCandidate = false;
      $("#chatSetupPanel").hidden = true;
      $("#chatApp").hidden = false;
      setStatus("Secure chat is ready.");
      renderPasskeyEnrollment();
      await saveUnlockedSession();
      await refreshData();
    } catch (error) {
      if (generatedCandidate && !state.accountV2?.unlocked) await cryptoCall("lockAccountV2Vault").catch(() => {});
      setStatus(formatActionError(error), true);
    } finally {
      if (enable) enable.disabled = false;
    }
  }

  function renderPasskeyEnrollment() {
    const panel = $("#chatPasskeySyncPanel");
    if (!panel) return;
    panel.hidden = !state.passkeyEnrollment;
    const unlocked = Boolean(state.accountV2?.unlocked);
    const button = $("#continuePasskeyEnrollment");
    if (button) button.disabled = !unlocked || state.passkeyEnrollmentBusy;
    const message = $("#chatPasskeySyncStatus");
    if (message) message.textContent = state.passkeyEnrollmentBusy
      ? t("chatPasskeySyncWorking", "Synchronizing Passkey access to your chat history…")
      : !unlocked ? t("chatPasskeySyncUnlockFirst", "Unlock secure chat with an existing Passkey to keep your chat history.") : "";
    const missingHistory = Boolean(state.accountV2?.missingVaultVersions?.length);
    const historyStatus = $("#chatPasskeyHistoryStatus");
    if (historyStatus) {
      historyStatus.hidden = !missingHistory;
      historyStatus.textContent = missingHistory
        ? t("chatPasskeyHistoryPending", "Some older chat history needs another existing Passkey. Keep your existing Passkeys and synchronize access.") : "";
    }
    const restore = $("#restoreAccountHistory");
    if (restore) {
      restore.hidden = !missingHistory;
      restore.disabled = !unlocked || state.passkeyEnrollmentBusy;
    }
  }

  async function synchronizeAccountPasskey() {
    if (state.passkeyEnrollmentBusy || !state.accountV2?.unlocked || !state.passkeyEnrollment) return;
    state.passkeyEnrollmentBusy = true;
    const generation = state.accountSessionGeneration;
    renderPasskeyEnrollment();
    try {
      let targetId = state.passkeyEnrollment.credentialId;
      if (!targetId) {
        const registration = await window.ALevelApi.getPasskeyRegistrationOptions(currentToken());
        const credential = await navigator.credentials.create({ publicKey: publicKeyOptions(registration) });
        assertAccountSession(generation);
        if (!credential) throw new DOMException("The Passkey prompt was cancelled.", "NotAllowedError");
        const saved = await window.ALevelApi.registerPasskey(currentToken(), {
          challenge: (registration.publicKey || registration).challenge, credential: serialiseCredential(credential),
        });
        assertAccountSession(generation);
        targetId = saved?.credentialId || credential.id;
        // Keep the created credential for a cancelled prompt or failed upload.
        state.passkeyEnrollment.credentialId = targetId;
        const retryUrl = new URL(location.href);
        retryUrl.searchParams.delete("passkeys");
        retryUrl.searchParams.set("passkey", targetId);
        history.replaceState(null, "", retryUrl);
      }
      const versions = await retainedAccountVaults(await window.ALevelApi.getChatAccountVault());
      assertAccountSession(generation);
      if (!versions.length) throw new Error("The existing encrypted account vault is unavailable.");
      const loaded = await cryptoCall("getAccountV2State");
      assertAccountSession(generation);
      const unlockedVersions = new Set([loaded.keyVersion, ...(loaded.retainedKeyVersions || [])]);
      for (const vault of versions) {
        if (unlockedVersions.has(vault.keyVersion)) continue;
        setStatus(t("chatPasskeySyncHistory", "Verify an existing Passkey to preserve an older chat vault."));
        const existing = await accountPasskeyAssertion({ keyVersion: vault.keyVersion });
        assertAccountSession(generation);
        const selected = matchingVault(vault, existing.credentialId);
        if (!selected) throw new Error("An existing Passkey is required to preserve this historical chat vault.");
        const restored = await cryptoCall("unlockAccountV2Vault", {
          userId: state.profile.id, keyVersion: selected.keyVersion, prfOutput: existing.prfOutput,
          nonce: selected.nonce, ciphertext: selected.ciphertext, retainOnly: true,
          ...expectedVaultIdentity(vault.accountKey, selected.keyVersion),
        });
        assertAccountSession(generation);
        validateUnlockedIdentity(restored, vault.accountKey);
        unlockedVersions.add(vault.keyVersion);
        state.accountV2.retainedKeyVersions = [...unlockedVersions].filter((version) => version !== state.accountV2.keyVersion);
        state.accountV2.missingVaultVersions = versions.filter((historical) => !unlockedVersions.has(historical.keyVersion)).map((historical) => historical.keyVersion);
      }
      for (const vault of versions) {
        const existingWrapper = matchingVault(vault, targetId);
        if (existingWrapper && !existingWrapper.legacyCandidate) continue;
        const target = await accountPasskeyAssertion({ credentialId: targetId, keyVersion: vault.keyVersion, purpose: "account-wrap" });
        assertAccountSession(generation);
        if (target.credentialId !== targetId) throw new Error("Choose the Passkey being synchronized.");
        const wrapped = await cryptoCall("wrapAccountV2Vault", {
          userId: state.profile.id, keyVersion: vault.keyVersion, credentialId: targetId, prfOutput: target.prfOutput,
        });
        assertAccountSession(generation);
        validateUnlockedIdentity(wrapped, vault.accountKey);
        await window.ALevelApi.saveChatAccountVaultWrapper({
          proof: target.proof, keyVersion: wrapped.keyVersion, credentialId: targetId,
          nonce: wrapped.nonce, ciphertext: wrapped.ciphertext, signature: wrapped.signature,
        });
        assertAccountSession(generation);
      }
      state.accountV2.retainedKeyVersions = [...unlockedVersions].filter((version) => version !== state.accountV2.keyVersion);
      state.accountV2.missingVaultVersions = [];
      state.accountV2.credentialId = targetId;
      await saveUnlockedSession();
      assertAccountSession(generation);
      state.passkeyEnrollment = null;
      const url = new URL(location.href);
      url.searchParams.delete("passkeys");
      url.searchParams.delete("passkey");
      history.replaceState(null, "", url);
      setStatus(t("chatPasskeySyncComplete", "This Passkey now signs in and unlocks secure chat. Your chat identity and history are unchanged."));
    } catch (error) {
      setStatus(`${t("chatPasskeySyncFailed", "Passkey synchronization is incomplete. Keep your existing Passkeys and try again.")} ${formatActionError(error)}`, true);
    } finally {
      state.passkeyEnrollmentBusy = false;
      renderPasskeyEnrollment();
    }
  }

  function renderUserSearchResults(results, query = "") {
    const host = $("#chatUserSearchResults");
    if (!host) return;
    host.replaceChildren();
    const users = Array.isArray(results) ? results : [];
    if (!users.length) {
      const empty = document.createElement("p");
      empty.className = "chat-muted";
      empty.textContent = query
        ? t("chatSearchNoResults", "No secure chat user found.")
        : t("chatSearchHint", "Search for a secure chat user ID to add a friend.");
      host.appendChild(empty);
      return;
    }
    users.forEach((user) => {
      const item = document.createElement("div");
      item.className = "chat-user-search-result";
      const identity = document.createElement("div");
      identity.className = "chat-contact-identity";
      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = user.alias || user.chatUserId || t("chatUnknownUser", "Secure chat user");
      const id = document.createElement("small");
      id.textContent = user.chatUserId || "";
      details.append(name, id);
      identity.append(createAvatar(name.textContent, user.avatarDataUrl), details);
      item.appendChild(identity);
      const alreadyContact = Boolean(user.isContact || user.contactId || state.contacts.some((contact) => contact.id === user.contactId));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-secondary chat-small-action";
      button.textContent = alreadyContact ? t("chatAlreadyFriend", "Added") : t("chatAddFriend", "Add");
      button.disabled = alreadyContact || user.enabled === false;
      if (user.enabled === false) button.title = t("chatSearchNeedsSecure", "This user has not enabled secure chat.");
      button.addEventListener("click", async () => {
        if (button.disabled || !user.chatUserId) return;
        button.disabled = true;
        try {
          await window.ALevelApi.addChatContactByUserId(user.chatUserId);
          button.textContent = t("chatAlreadyFriend", "Added");
          setStatus(t("chatFriendAdded", "Friend added."));
          await refreshData();
        } catch (error) {
          button.disabled = false;
          setStatus(formatActionError(error), true);
        }
      });
      item.appendChild(button);
      host.appendChild(item);
    });
  }

  async function searchChatUsers(event) {
    event?.preventDefault();
    const input = $("#chatUserSearchInput");
    const button = $("#chatUserSearchButton");
    const query = input?.value.trim() || "";
    if (query.length < 3) {
      renderUserSearchResults([], query);
      setStatus(t("chatSearchTooShort", "Enter at least 3 characters to search."), true);
      return;
    }
    const generation = ++state.userSearchGeneration;
    if (button) button.disabled = true;
    try {
      setStatus(t("chatSearchingUsers", "Searching secure chat users..."));
      const response = await window.ALevelApi.searchChatUsers(query);
      if (generation !== state.userSearchGeneration) return;
      const users = Array.isArray(response) ? response : response?.users || response?.results || [];
      renderUserSearchResults(users, query);
      setStatus("");
    } catch (error) {
      if (generation !== state.userSearchGeneration) return;
      renderUserSearchResults([], query);
      setStatus(formatActionError(error), true);
    } finally {
      if (generation === state.userSearchGeneration && button) button.disabled = false;
    }
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
    const orderedConversations = [...state.conversations].sort((left, right) => Number(Boolean(right.isGlobalDiscussion || right.globalDiscussion)) - Number(Boolean(left.isGlobalDiscussion || left.globalDiscussion)));
    state.conversations = orderedConversations;
    const globalDiscussion = orderedConversations.find((conversation) => conversation.isGlobalDiscussion || conversation.globalDiscussion);
    state.globalDiscussion = globalDiscussion || null;
    const globalPanel = $("#globalDiscussionPanel");
    if (globalPanel) {
      const globalInfo = state.globalInfo || {};
      const waitingForMembership = Boolean(globalInfo.global && globalInfo.conversationId && !globalDiscussion && !globalInfo.optedOut && (globalInfo.siteRole === "admin" || globalInfo.studentCanLeave));
      globalPanel.hidden = !globalDiscussion && !globalInfo.needsBootstrap && !waitingForMembership;
      if (globalDiscussion || globalInfo.needsBootstrap || waitingForMembership) {
        const memberCount = Number(globalDiscussion?.group?.memberCount || globalDiscussion?.memberCount || globalInfo.activeMemberCount || 0);
        $("#globalDiscussionMeta").textContent = (globalInfo.needsBootstrap || waitingForMembership) && !globalInfo.canManage
          ? t("chatGlobalWaitingForAdmin", "An administrator is preparing the encrypted discussion.")
          : t("chatGlobalDiscussionMeta", "{count} members · end-to-end encrypted", { count: memberCount });
        $("#globalDiscussionPending").textContent = globalInfo.needsBootstrap && !globalInfo.canManage ? "" : state.globalPendingCount
          ? t("chatGlobalPending", "{count} secure chat accounts need an encryption update.", { count: state.globalPendingCount })
          : "";
        $("#globalDiscussionPending").hidden = (globalInfo.needsBootstrap || waitingForMembership) && !globalInfo.canManage || !state.globalPendingCount;
        const role = globalDiscussion?.role || globalDiscussion?.group?.members?.find((member) => member.isSelf)?.role || "member";
        $("#leaveGlobalDiscussion").hidden = !globalDiscussion || role === "admin" || role === "owner" || globalDiscussion.siteRole === "admin";
        $("#openGlobalDiscussion").hidden = !globalDiscussion;
        $("#bootstrapGlobalDiscussion").hidden = !globalInfo.needsBootstrap || !globalInfo.canManage;
        $("#rotateGlobalDiscussion").hidden = !globalDiscussion || !globalInfo.pendingCount || !globalInfo.canManage;
      }
    }
    orderedConversations.forEach((conversation) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chat-conversation-item${state.activeConversation?.id === conversation.id ? " is-active" : ""}`;
      button.dataset.conversationId = conversation.id;
      button.innerHTML = `<div class="chat-contact-identity"><div><strong></strong><small></small></div></div>`;
      button.firstElementChild.prepend(createAvatar(conversationName(conversation), conversation.peer?.avatarDataUrl));
      if (conversation.kind === "group") {
        button.querySelector("strong").textContent = conversation.isGlobalDiscussion || conversation.globalDiscussion
          ? t("chatGlobalDiscussionTitle", "Global Discussion") : conversationName(conversation);
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
    const isGlobal = Boolean(conversation.isGlobalDiscussion || conversation.globalDiscussion);
    const canManage = !isGlobal && ["owner", "admin"].includes(self?.role);
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
        if (!isGlobal && self?.role === "owner" && member.role !== "owner") {
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
      $("#dissolveGroup").hidden = isGlobal || self?.role !== "owner";
      $("#leaveGroup").hidden = self?.role === "owner" || (isGlobal && (self?.role === "admin" || conversation.siteRole === "admin"));
      $("#leaveGroup").textContent = isGlobal ? t("chatLeaveGlobalDiscussion", "Leave discussion") : t("chatLeaveGroup", "Leave group");
      $("#rotateGroupKey").hidden = isGlobal || !canManage || !conversation.rotationRequired;
      $("#inviteGroupMember").hidden = isGlobal || !canManage;
      $("#groupInviteContact").hidden = isGlobal || !canManage;
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
      $("#inviteGroupMember").disabled = eligible.length === 0 || Number(conversation.group?.memberCount) >= (isGlobal ? 1000 : 50);
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
    const unlockedVersions = new Set([state.accountV2.keyVersion, ...(state.accountV2.retainedKeyVersions || [])]);
    const epochs = history.filter((item) => unlockedVersions.has(item.envelope?.keyVersion));
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
    const [profile, contacts, conversations, globalInfo] = await Promise.all([
      window.ALevelApi.getChatProfile(),
      window.ALevelApi.listChatContacts(),
      window.ALevelApi.listChatConversations(),
      state.accountMode ? window.ALevelApi.getGlobalChatDiscussion().catch(() => null) : Promise.resolve(null),
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
    state.globalInfo = globalInfo || null;
    state.globalPendingCount = Number(globalInfo?.pendingCount || 0);
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
    state.lastProfileRefresh = Date.now();
    renderChatProfile();
    renderContacts();
    renderActiveConversation();
    if (!state.activeConversation) renderMessages();
    if (!state.accountMode) renderDevices();
    scheduleGlobalDiscussionReconcile();
  }

  async function refreshPresentation() {
    if (state.profileRefreshInFlight) return state.profileRefreshInFlight;
    const generation = state.dataRefreshGeneration;
    const selectionGeneration = state.syncGeneration;
    state.profileRefreshInFlight = (async () => {
      const [profile, contacts, conversations, globalInfo] = await Promise.all([
        window.ALevelApi.getChatProfile(), window.ALevelApi.listChatContacts(), window.ALevelApi.listChatConversations(),
        state.accountMode ? window.ALevelApi.getGlobalChatDiscussion().catch(() => null) : Promise.resolve(null),
      ]);
      if (generation !== state.dataRefreshGeneration || selectionGeneration !== state.syncGeneration) return;
      state.dataRefreshGeneration += 1;
      state.lastProfileRefresh = Date.now();
      state.profile = profile;
      state.globalInfo = globalInfo || null;
      state.globalPendingCount = Number(globalInfo?.pendingCount || 0);
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
      scheduleGlobalDiscussionReconcile();
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

  function globalRecipientInput(item) {
    const key = item?.accountKey || item;
    if (!key?.userId || !key?.keyVersion || !key?.encryptionPublicKey) return null;
    return { userId: key.userId, keyVersion: key.keyVersion, encryptionPublicKey: key.encryptionPublicKey };
  }

  function globalRecipients(info) {
    const members = info?.conversation?.group?.members || info?.conversation?.members || [];
    const pending = Array.isArray(info?.pendingRecipients) ? info.pendingRecipients : [];
    return [...new Map([...members, ...pending].map((item) => {
      const value = globalRecipientInput(item);
      return value ? [value.userId, value] : null;
    }).filter(Boolean)).values()];
  }

  async function globalEpochPayload(conversationId, epoch, recipients) {
    const created = await cryptoCall("createAccountV2Epoch", { conversationId, epoch, recipients });
    const metadata = await cryptoCall("encryptAccountV2Metadata", {
      conversationId,
      epoch,
      version: 1,
      plaintext: { name: t("chatGlobalDiscussionTitle", "Global Discussion"), avatarRef: null },
    });
    return { recipients: created.recipients, metadata };
  }

  async function initializeGlobalDiscussion() {
    const button = $("#bootstrapGlobalDiscussion");
    const info = state.globalInfo;
    if (!info?.needsBootstrap || button?.disabled) return;
    const recipients = globalRecipients(info);
    if (!recipients.length) {
      setStatus(t("chatGlobalNoRecipients", "No enabled secure chat account is ready to join yet."), true);
      return;
    }
    if (button) button.disabled = true;
    try {
      const conversationId = crypto.randomUUID();
      const payload = await globalEpochPayload(conversationId, 1, recipients);
      await window.ALevelApi.createGlobalChatDiscussion({ conversationId, ...payload });
      setStatus(t("chatGlobalInitialized", "Global discussion initialized."));
      await refreshData();
    } catch (error) {
      setStatus(t("chatGlobalInitializeFailed", "Could not initialize the global discussion: {message}", { message: formatActionError(error) }), true);
    } finally { if (button) button.disabled = false; }
  }

  function scheduleGlobalDiscussionReconcile() {
    const info = state.globalInfo;
    if (!state.accountV2?.unlocked || !info?.canManage || (!info.needsBootstrap && !Number(info.pendingCount) && !info.rotationRequired)) return;
    if (state.globalReconcileInFlight) return;
    state.globalReconcileInFlight = Promise.resolve().then(async () => {
      if (info.needsBootstrap) await initializeGlobalDiscussion();
      else await rotateGlobalDiscussion();
    }).catch((error) => setStatus(t("chatGlobalAutoUpdateFailed", "Could not sync the global discussion: {message}", { message: formatActionError(error) }), true))
      .finally(() => { state.globalReconcileInFlight = null; });
  }

  async function rotateGlobalDiscussion() {
    const info = state.globalInfo;
    const conversation = state.globalDiscussion;
    if (!conversation || !info || !Number.isSafeInteger(Number(conversation.currentEpoch ?? conversation.epoch))) return;
    const recipients = globalRecipients(info);
    if (!recipients.length) return;
    const button = $("#rotateGlobalDiscussion");
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      const expectedEpoch = Number(conversation.currentEpoch ?? conversation.epoch);
      const epoch = expectedEpoch + 1;
      const payload = await globalEpochPayload(conversation.id, epoch, recipients);
      await window.ALevelApi.rotateGlobalChatDiscussion({ conversationId: conversation.id, expectedEpoch, epoch, ...payload });
      setStatus(t("chatGlobalRotated", "Global discussion encryption updated."));
      await refreshData();
    } catch (error) {
      setStatus(t("chatGlobalRotateFailed", "Could not update global discussion encryption: {message}", { message: formatActionError(error) }), true);
    } finally { if (button) button.disabled = false; }
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
    $("#chatProfileUserId")?.addEventListener("input", () => { state.profileDirty = true; renderChatProfile(); });
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
    $("#continuePasskeyEnrollment")?.addEventListener("click", synchronizeAccountPasskey);
    $("#restoreAccountHistory")?.addEventListener("click", () => {
      if (state.passkeyEnrollmentBusy || !state.accountV2?.credentialId) return;
      state.passkeyEnrollment = { credentialId: state.accountV2.credentialId };
      renderPasskeyEnrollment();
      $("#chatPasskeySyncPanel")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    $("#groupManageButton")?.addEventListener("click", () => {
      const panel = $("#groupManagePanel");
      if (!state.activeConversation || state.activeConversation.kind !== "group" || !panel) return;
      panel.hidden = false;
      renderGroupManagement(state.activeConversation);
    });
    $("#closeGroupManage")?.addEventListener("click", () => { $("#groupManagePanel").hidden = true; });
    $("#leaveGroup")?.addEventListener("click", async () => {
      const conversation = state.activeConversation;
      const isGlobal = Boolean(conversation?.isGlobalDiscussion || conversation?.globalDiscussion);
      const self = conversation?.group?.members?.find((member) => member.isSelf);
      const role = conversation?.role || self?.role;
      if (!conversation || (isGlobal && (conversation.siteRole === "admin" || role === "admin" || role === "owner"))) {
        if (isGlobal) setStatus(t("chatGlobalAdminCannotLeave", "Administrators cannot leave the global discussion."), true);
        return;
      }
      if (!window.confirm(isGlobal ? t("chatLeaveGlobalConfirm", "Leave the global discussion? You can be invited again by an administrator.") : t("chatLeaveGroupConfirm", "Leave this group? A remaining owner or administrator must rotate the encryption epoch."))) return;
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
    $("#chatUserSearchForm")?.addEventListener("submit", searchChatUsers);
    $("#openGlobalDiscussion")?.addEventListener("click", async () => {
      const conversation = state.globalDiscussion;
      if (!conversation) return;
      try { await selectConversation(conversation); } catch (error) { setStatus(formatActionError(error), true); }
    });
    $("#bootstrapGlobalDiscussion")?.addEventListener("click", () => initializeGlobalDiscussion());
    $("#rotateGlobalDiscussion")?.addEventListener("click", () => rotateGlobalDiscussion());
    $("#leaveGlobalDiscussion")?.addEventListener("click", async () => {
      const conversation = state.globalDiscussion;
      const self = conversation?.group?.members?.find((member) => member.isSelf);
      const role = conversation?.role || self?.role;
      if (!conversation || conversation.siteRole === "admin" || role === "admin" || role === "owner") {
        setStatus(t("chatGlobalAdminCannotLeave", "Administrators cannot leave the global discussion."), true);
        return;
      }
      if (!window.confirm(t("chatLeaveGlobalConfirm", "Leave the global discussion? You can be invited again by an administrator."))) return;
      try {
        const expectedEpoch = await currentAccountEpoch(conversation);
        const signed = await signAccountControl(conversation.id, expectedEpoch, "leave", { globalDiscussion: true });
        await window.ALevelApi.leaveChatGroup(conversation.id, signed);
        await refreshData();
      } catch (error) { setStatus(formatActionError(error), true); }
    });
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
      renderPasskeyEnrollment();
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
    const enrollmentQuery = new URL(location.href).searchParams;
    const requestedCredential = enrollmentQuery.get("passkey");
    if (requestedCredential || enrollmentQuery.get("passkeys") === "add") {
      state.passkeyEnrollment = { credentialId: requestedCredential || null };
    }
    if (!currentToken()) {
      const next = "chat.html";
      location.href = `login.html?next=${encodeURIComponent(next)}`;
      return;
    }
    try {
      state.authToken = currentToken();
      const generation = state.accountSessionGeneration;
      wireEvents();
      window.addEventListener("expassway:chat-session-cleared", lockLocalChatSession);
      state.profile = await window.ALevelApi.getChatProfile();
      assertAccountSession(generation);
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
