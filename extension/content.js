(() => {
  if (window.__contextTranslateLoaded) return;
  window.__contextTranslateLoaded = true;

  const state = {
    enabled: false,
    mode: "bilingual",
    settings: null,
    observer: null,
    mutationObserver: null,
    queue: [],
    queued: new WeakSet(),
    processing: false,
    blockCounter: 0,
    bubble: null,
    miniLookup: null,
    pairPeek: null,
    hoverTimer: null,
    hoverHideTimer: null,
    hoverWordKey: "",
    hoverPoint: null,
    toolbar: null,
    lastError: "",
    translatedCount: 0,
    mutationRoots: new Set(),
    mutationTimer: null,
    pointerRaf: 0,
    lastPointer: null,
    wordProbeTimer: null,
    lastWordProbe: null,
    selectionAction: null,
    selectionResult: null,
    lastContextPoint: { x: Math.round(window.innerWidth * 0.55), y: Math.round(window.innerHeight * 0.35) },
    activeAlignment: null,
    scrollScanTimer: null,
    lastRescueScanAt: 0,
    firstRenderDone: false,
    autoProbeTimer: null
  };

  const CONTENT_SELECTORS = [
    "p", "li", "blockquote", "figcaption",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "td", "th", "dd", "dt",
    "[data-testid='tweetText']",
    "ytd-comment-thread-renderer #content-text",
    "ytd-transcript-segment-renderer .segment-text"
  ].join(",");

  const UI_REGIONS = [
    "header", "nav", "aside", "[role='banner']", "[role='navigation']", "[role='complementary']",
    "[data-testid='sidebarColumn']",
    "[data-testid^='AppTabBar_']", "[aria-label='Primary']", "[aria-label='Timeline: Trending now']"
  ].join(",");

  const UI_TEXT_SELECTORS = "span,a,button,h1,h2,h3,h4,p,div";
  const RESCUE_TEXT_SELECTORS = "a,[role='link'],span,strong,b,div,button";

  const SKIP = [
    "script", "style", "noscript", "code", "pre", "kbd", "samp",
    "textarea", "input", "select", "svg", "canvas",
    "[contenteditable='true']", "[translate='no']",
    ".ct-translation", ".ct-ui-translation", ".ct-word-bubble", ".ct-mini-lookup", ".ct-pair-peek", ".ct-float-toolbar", ".ct-toast"
  ].join(",");

  const UI_SKIP = [
    "script", "style", "noscript", "code", "pre", "kbd", "samp",
    "textarea", "input", "select", "svg", "canvas",
    "[contenteditable='true']", "[translate='no']",
    ".ct-translation", ".ct-ui-translation", ".ct-word-bubble", ".ct-mini-lookup", ".ct-pair-peek", ".ct-float-toolbar", ".ct-toast"
  ].join(",");

  init();

  async function init() {
    try {
      const resp = await sendRuntime({ type: "getSettings" });
      if (!resp?.ok) return;
      state.settings = resp.result;
      state.mode = resp.result.translationMode || "bilingual";
      syncToolbarVisibility();

      const sitePreference = await getSiteTranslationPreference();
      if (sitePreference === true || state.settings.autoTranslate === true) {
        scheduleAutoEnable();
        return;
      }
      if (sitePreference === false) return;

      if (state.settings.autoTranslateEnglish !== false) {
        scheduleEnglishAutoDetect();
      }
    } catch (e) {
      console.warn("沉浸式翻译&学习 init failed", e);
    }
  }

  function scheduleAutoEnable() {
    const run = () => {
      if (!state.enabled) enableTranslation(false).catch((e) => console.warn("沉浸式翻译&学习 auto start failed", e));
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      queueMicrotask(run);
    }
  }

  function scheduleEnglishAutoDetect() {
    const lang = String(document.documentElement?.lang || "").toLowerCase();
    if (lang === "en" || lang.startsWith("en-")) {
      scheduleAutoEnable();
      return;
    }

    const probe = () => {
      if (state.enabled || state.settings?.autoTranslateEnglish === false) return;
      if (pageLooksMostlyEnglish()) {
        enableTranslation(false).catch((e) => console.warn("沉浸式翻译&学习 English auto start failed", e));
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        clearTimeout(state.autoProbeTimer);
        state.autoProbeTimer = setTimeout(probe, 0);
      }, { once: true });
    } else {
      queueMicrotask(probe);
    }

    clearTimeout(state.autoProbeTimer);
    state.autoProbeTimer = setTimeout(probe, 650);
  }

  function pageLooksMostlyEnglish() {
    const lang = String(document.documentElement?.lang || "").toLowerCase();
    if (lang === "en" || lang.startsWith("en-")) return true;

    const sample = [
      document.title || "",
      String(document.body?.innerText || "").slice(0, 9000)
    ].join("\n");
    if (!sample.trim()) return false;

    const latin = (sample.match(/[A-Za-z]/g) || []).length;
    const englishWords = (sample.match(/\b[A-Za-z][A-Za-z'’-]{1,}\b/g) || []).length;
    const han = (sample.match(/[\u3400-\u9fff]/g) || []).length;
    const kana = (sample.match(/[\u3040-\u30ff]/g) || []).length;
    const hangul = (sample.match(/[\uac00-\ud7af]/g) || []).length;
    const arabic = (sample.match(/[\u0600-\u06ff]/g) || []).length;
    const other = han + kana + hangul + arabic;

    return englishWords >= 18 && latin >= 90 && latin / Math.max(1, latin + other * 1.7) >= 0.68;
  }

  async function getSiteTranslationPreference() {
    try {
      const key = location.origin || `${location.protocol}//${location.host}`;
      const data = await chrome.storage.local.get("siteTranslationPrefs");
      const prefs = data?.siteTranslationPrefs || {};
      return Object.prototype.hasOwnProperty.call(prefs, key) ? Boolean(prefs[key]) : null;
    } catch (_) {
      return null;
    }
  }

  async function setSiteTranslationPreference(value) {
    try {
      const key = location.origin || `${location.protocol}//${location.host}`;
      const data = await chrome.storage.local.get("siteTranslationPrefs");
      const prefs = { ...(data?.siteTranslationPrefs || {}) };
      prefs[key] = Boolean(value);
      const keys = Object.keys(prefs);
      if (keys.length > 300) {
        for (const oldKey of keys.slice(0, keys.length - 300)) delete prefs[oldKey];
      }
      await chrome.storage.local.set({ siteTranslationPrefs: prefs });
    } catch (_) {}
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (message.type === "translateNow") {
        await setSiteTranslationPreference(true);
        await enableTranslation(true);
        sendResponse({ ok: true, translated: state.translatedCount });
        return;
      }
      if (message.type === "toggleTranslation") {
        if (state.enabled) {
          await setSiteTranslationPreference(false);
          disableTranslation();
        } else {
          await setSiteTranslationPreference(true);
          await enableTranslation(true);
        }
        sendResponse({ ok: true, enabled: state.enabled, translated: state.translatedCount });
        return;
      }
      if (message.type === "setTranslationMode") {
        state.mode = message.mode || "bilingual";
        applyMode();
        updateToolbar();
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "refreshSettings") {
        const resp = await sendRuntime({ type: "getSettings" });
        if (resp?.ok) {
          const previous = state.settings || {};
          const next = resp.result;
          const hardChanged = ["provider", "apiKey", "baseUrl", "model", "targetLanguage"]
            .some((key) => String(previous?.[key] ?? "") !== String(next?.[key] ?? ""));
          const enabledNewLayer =
            (previous?.outputEnglish !== true && next?.outputEnglish === true) ||
            (previous?.outputChinese === false && next?.outputChinese !== false);

          state.settings = next;
          state.mode = state.settings.translationMode || state.mode;
          syncToolbarVisibility();

          if (state.settings.autoTranslate && !state.enabled) await enableTranslation();
          else if (state.settings.autoTranslateEnglish !== false && !state.enabled) scheduleEnglishAutoDetect();
          if (state.enabled) {
            if (hardChanged) {
              resetRenderedTranslations();
              applyMode();
              collect(document, true);
              processQueue();
            } else {
              const anchor = captureViewportAnchor();
              applyMode();
              if (enabledNewLayer) queueLayerRefresh();
              collect(document, false);
              restoreViewportAnchor(anchor);
              processQueue();
            }
          } else {
            const anchor = captureViewportAnchor();
            applyMode();
            restoreViewportAnchor(anchor);
          }
        }
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "rescanMissing") {
        const count = forceMissingScan();
        sendResponse({ ok: true, queued: count });
        return;
      }
      if (message.type === "showContextTranslation") {
        const text = String(message.text || "").trim();
        if (text) {
          await translateSelectionAndShow(text, state.lastContextPoint, "context-menu");
        }
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "getPageState") {
        sendResponse({
          ok: true,
          enabled: state.enabled,
          translated: document.querySelectorAll(".ct-translation[data-ready='1'],[data-ct-kind='ui'][data-ct-done='1']").length,
          queued: state.queue.length,
          processing: state.processing,
          error: state.lastError
        });
        return;
      }
    })().catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  });

  document.addEventListener("dblclick", handleDoubleClick, true);
  document.addEventListener("click", handleGlobalWordClick, true);
  document.addEventListener("click", handleDynamicContentClick, true);
  document.addEventListener("pointermove", queuePointerMove, { capture: true, passive: true });
  document.addEventListener("mouseup", handleSelectionMouseUp, true);
  document.addEventListener("keyup", handleSelectionKeyUp, true);
  document.addEventListener("contextmenu", (e) => {
    state.lastContextPoint = { x: e.clientX, y: e.clientY };
    closeSelectionAction();
  }, true);
  document.addEventListener("scroll", () => {
    closeSelectionAction();
    scheduleScrollRescue();
  }, { capture: true, passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMiniLookup();
      closeBubble();
      closeSelectionAction();
      closeSelectionResult();
      clearActiveAlignment();
      hidePairPeek();
    }
  }, true);

  async function enableTranslation(force = false) {
    if (state.enabled && !force) return;
    if (!state.settings) {
      const settingsResp = await sendRuntime({ type: "getSettings" });
      if (!settingsResp?.ok) throw new Error(settingsResp?.error || "无法读取设置");
      state.settings = settingsResp.result;
    }
    state.mode = state.settings.translationMode || "bilingual";
    state.enabled = true;
    state.lastError = "";
    state.firstRenderDone = false;
    document.documentElement.classList.add("ct-enabled");

    setupObserver();
    setupMutationObserver();
    applyMode();
    syncToolbarVisibility();

    // First paint path: current/near viewport only.
    collectContent(document, false);
    if (state.settings?.translateUi !== false) collectUi(document, false);
    prioritizeQueue();
    updateToolbar();
    processQueue();

    // Wider rescue scanning waits for idle time so it does not block first screen.
    const finishInitialScan = () => {
      if (!state.enabled) return;
      if (state.settings?.translateUi !== false) collectRescueText(document, false);
      collectContent(document, false);
      prioritizeQueue();
      processQueue();
    };
    if ("requestIdleCallback" in window) {
      requestIdleCallback(finishInitialScan, { timeout: 550 });
    } else {
      setTimeout(finishInitialScan, 160);
    }
  }

  function disableTranslation() {
    state.enabled = false;
    document.documentElement.classList.remove("ct-enabled", "ct-mode-translated-only");
    state.observer?.disconnect();
    state.mutationObserver?.disconnect();
    state.queue = [];
    document.querySelectorAll("[data-ct-queued='1']").forEach((el) => {
      el.removeAttribute("data-ct-queued");
      state.queued.delete(el);
      el.classList.remove("ct-pending");
    });
    document.querySelectorAll("[data-ct-original-hidden='1']").forEach((el) => {
      el.style.removeProperty("display");
      el.removeAttribute("data-ct-original-hidden");
    });
    document.querySelectorAll(".ct-source-replaced").forEach((el) => {
      el.classList.remove("ct-source-replaced");
      el.removeAttribute("data-ct-interleaved-source");
    });
    updateToolbar();
  }

  function setupObserver() {
    state.observer?.disconnect();
    state.observer = new IntersectionObserver((entries) => {
      let added = false;
      for (const entry of entries) {
        if (entry.isIntersecting && enqueue(entry.target, entry.target.dataset.ctKind || "content")) added = true;
      }
      if (added) processQueue();
    }, { rootMargin: "1100px 0px 1400px 0px", threshold: 0.001 });
  }

  function setupMutationObserver() {
    state.mutationObserver?.disconnect();
    state.mutationObserver = new MutationObserver((mutations) => {
      if (!state.enabled) return;
      for (const mutation of mutations) {
        const targetEl = mutation.target?.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target?.parentElement;
        if (targetEl?.closest?.(".ct-translation,.ct-ui-translation,.ct-word-bubble,.ct-mini-lookup,.ct-pair-peek,.ct-float-toolbar,.ct-toast,.ct-selection-action,.ct-selection-result")) {
          continue;
        }

        if (targetEl) markDynamicRoot(targetEl);

        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            if (!el || el.closest?.(".ct-translation,.ct-ui-translation,.ct-word-bubble,.ct-mini-lookup,.ct-pair-peek,.ct-float-toolbar,.ct-toast,.ct-selection-action,.ct-selection-result")) continue;
            markDynamicRoot(el);
          }
        }
      }
      scheduleDynamicFlush();
    });
    state.mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function markDynamicRoot(el) {
    if (!el?.isConnected) return;
    const content = el.matches?.(CONTENT_SELECTORS) ? el : el.closest?.(CONTENT_SELECTORS);
    if (content) state.mutationRoots.add(content);

    const uiRegion = el.matches?.(UI_REGIONS) ? el : el.closest?.(UI_REGIONS);
    if (uiRegion) state.mutationRoots.add(uiRegion);

    if (!content && !uiRegion) state.mutationRoots.add(el);
  }

  function scheduleDynamicFlush(delay = 90) {
    clearTimeout(state.mutationTimer);
    state.mutationTimer = setTimeout(() => {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => flushDynamicRoots(), { timeout: 180 });
      } else {
        flushDynamicRoots();
      }
    }, delay);
  }

  function flushDynamicRoots() {
    if (!state.enabled) return;
    const roots = [...state.mutationRoots];
    state.mutationRoots.clear();

    for (const root of roots) {
      if (!root?.isConnected) continue;
      if (root.matches?.(CONTENT_SELECTORS)) refreshChangedCandidate(root, "content");
      if (root.matches?.(UI_TEXT_SELECTORS) && root.closest?.(UI_REGIONS)) refreshChangedCandidate(root, "ui");
      collect(root, false);

      const ancestorContent = root.closest?.(CONTENT_SELECTORS);
      if (ancestorContent && ancestorContent !== root) refreshChangedCandidate(ancestorContent, "content");
    }
    processQueue();
  }

  function refreshChangedCandidate(el, kind) {
    if (!el?.isConnected || el.dataset.ctDone !== "1") return;
    const current = kind === "ui" ? getUiSourceText(el) : getSourceText(el);
    const previous = el.dataset.ctSourceSnapshot || "";
    if (!current || current === previous) return;

    el.removeAttribute("data-ct-done");
    el.removeAttribute("data-ct-queued");
    el.removeAttribute("data-ct-original-hidden");
    el.style.removeProperty("display");
    state.queued.delete(el);

    const pair = el.dataset.ctPair || el.dataset.ctBlockId || "";
    let translation = el.nextElementSibling;
    if (!translation?.classList?.contains(kind === "ui" ? "ct-ui-translation" : "ct-translation")) {
      translation = pair
        ? document.querySelector(`${kind === "ui" ? ".ct-ui-translation" : ".ct-translation"}[data-ct-pair="${CSS.escape(pair)}"]`)
        : null;
    }
    translation?.classList.add("ct-stale");
    clearActiveAlignment();
    prepareCandidate(el, kind, true);
  }

  function collect(root, eager = false) {
    collectContent(root, eager);
    if (state.settings?.translateUi !== false) {
      collectUi(root, eager);
      collectRescueText(root, eager);
    }
    if (state.settings?.translateVisibleOnly === false || eager) processQueue();
  }

  function collectContent(root, eager) {
    const nodes = [];
    if (root.matches?.(CONTENT_SELECTORS)) nodes.push(root);
    root.querySelectorAll?.(CONTENT_SELECTORS).forEach((el) => nodes.push(el));
    for (const el of nodes) prepareCandidate(el, "content", eager);
  }

  function collectUi(root, eager) {
    const regions = [];
    if (root.matches?.(UI_REGIONS)) regions.push(root);
    root.querySelectorAll?.(UI_REGIONS).forEach((el) => regions.push(el));

    // X/Twitter uses deeply nested spans in both the left navigation and right sidebar.
    // Scan leaf text containers instead of relying on a particular DOM depth.
    for (const region of regions) {
      if (region.closest?.(".ct-word-bubble,.ct-mini-lookup,.ct-pair-peek,.ct-float-toolbar")) continue;
      const candidates = new Set();
      if (hasOwnUiText(region)) candidates.add(region);
      region.querySelectorAll?.("span,a,button,[role='link'],[role='button'],h1,h2,h3,h4,p,div").forEach((el) => {
        if (hasOwnUiText(el)) candidates.add(el);
      });
      for (const el of candidates) prepareCandidate(el, "ui", eager);
    }
  }

  function collectRescueText(root, eager) {
    if (!root?.querySelectorAll && !root?.matches) return;
    const candidates = [];
    if (root.matches?.(RESCUE_TEXT_SELECTORS)) candidates.push(root);
    root.querySelectorAll?.(RESCUE_TEXT_SELECTORS).forEach((el) => candidates.push(el));

    let inspected = 0;
    for (const el of candidates) {
      if (++inspected > 1800) break;
      if (!isRescueTextCandidate(el, eager)) continue;
      el.dataset.ctRescue = "1";
      prepareCandidate(el, "ui", eager);
    }
  }

  function isRescueTextCandidate(el, eager = false) {
    if (!el || !el.isConnected || el.closest(UI_SKIP)) return false;
    if (el.closest?.(UI_REGIONS)) return false;
    if (el.closest?.(`${CONTENT_SELECTORS},.ct-translation,.ct-ui-translation,.ct-word-bubble,.ct-mini-lookup,.ct-pair-peek,.ct-float-toolbar,.ct-toast`)) return false;
    if (!el.closest?.("main,[role='main'],article,section")) return false;
    if (!isVisible(el)) return false;
    if (!eager && !nearViewport(el, 1350)) return false;

    const text = getUiSourceText(el);
    if (text.length < 5 || text.length > 280) return false;
    if (!containsLetters(text) || !hasRequestedTranslationForText(text)) return false;
    if (/^[@#][A-Za-z0-9_]{1,40}$/.test(text)) return false;
    if (/^[\d\s,.%+\-KMB:/]+$/i.test(text)) return false;

    const latinWords = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
    const nonLatin = (text.match(/[\u0600-\u06FF\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
    if (latinWords.length < 2 && nonLatin < 3 && text.length < 14) return false;
    return true;
  }

  function scheduleScrollRescue() {
    if (!state.enabled || state.settings?.translateUi === false) return;
    clearTimeout(state.scrollScanTimer);
    state.scrollScanTimer = setTimeout(() => {
      const now = Date.now();
      if (now - state.lastRescueScanAt < 500) return;
      state.lastRescueScanAt = now;
      collectRescueText(document, false);
      processQueue();
    }, 220);
  }

  function forceMissingScan() {
    if (!state.enabled) return 0;
    const before = state.queue.length;
    state.lastError = "";
    collect(document, true);
    document.querySelectorAll("[data-ct-kind]").forEach((el) => {
      if (el.dataset.ctDone === "1" || el.dataset.ctQueued === "1") return;
      prepareCandidate(el, el.dataset.ctKind || "content", true);
    });
    const added = Math.max(0, state.queue.length - before);
    processQueue();
    showToast(added ? `补漏扫描：新增 ${added} 处` : "补漏扫描完成：当前附近未发现新内容");
    return added;
  }

  function hasOwnUiText(el) {
    if (!el || el.closest?.(".ct-translation,.ct-ui-translation,.ct-word-bubble,.ct-mini-lookup,.ct-pair-peek,.ct-float-toolbar,.ct-toast")) return false;
    return Boolean(getUiSourceText(el));
  }

  function getUiSourceText(el) {
    if (!el) return "";
    if (el.dataset?.ctUiSource) return el.dataset.ctUiSource;
    const direct = [...(el.childNodes || [])]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (direct) return direct;

    const foreignChildren = [...(el.children || [])].filter((child) => !child.classList?.contains("ct-ui-translation"));
    if (!foreignChildren.length) {
      return String(el.textContent || "").replace(/\s+/g, " ").trim();
    }

    const meaningfulChildren = foreignChildren.filter((child) => {
      const tag = child.tagName?.toLowerCase();
      if (["svg", "img", "path"].includes(tag)) return false;
      return String(child.textContent || "").trim();
    });
    if (!meaningfulChildren.length) {
      return String(el.textContent || "").replace(/\s+/g, " ").trim();
    }
    return "";
  }

  function prepareCandidate(el, kind, eager) {
    if (el.dataset.ctDone === "1" || el.dataset.ctQueued === "1") return;
    if (kind === "content" ? !isContentEligible(el) : !isUiEligible(el)) return;
    if (!el.dataset.ctBlockId) el.dataset.ctBlockId = `ct-${++state.blockCounter}`;
    el.dataset.ctKind = kind;
    if (state.settings?.translateVisibleOnly === false || nearViewport(el, kind === "ui" ? 600 : 1500) || eager && nearViewport(el, 1700)) {
      enqueue(el, kind);
    } else {
      state.observer?.observe(el);
    }
  }

  function isContentEligible(el) {
    if (!el || !el.isConnected || el.closest(SKIP)) return false;
    if (el.dataset.ctDone === "1") return false;
    if (!isVisible(el) && el.dataset.ctInterleavedSource !== "1") return false;

    if (el.closest?.(UI_REGIONS) && !el.matches?.("[data-testid='tweetText']")) return false;

    const tag = el.tagName?.toLowerCase();
    if (["li", "td", "th", "dd", "dt"].includes(tag) && el.querySelector?.("p,blockquote,h1,h2,h3,h4,h5,h6")) return false;
    if (!el.matches("[data-testid='tweetText']") && el.querySelector?.("[data-testid='tweetText'],p,blockquote,h1,h2,h3,h4,h5,h6") && tag === "div") return false;

    const text = getSourceText(el);
    if (text.length < 3 || text.length > 16000) return false;
    if (!containsLetters(text)) return false;
    if (/^(https?:\/\/|www\.)\S+$/i.test(text)) return false;
    if (!hasRequestedTranslationForText(text)) return false;
    return true;
  }

  function isUiEligible(el) {
    if (!el || !el.isConnected || el.closest(UI_SKIP)) return false;
    if (el.dataset.ctDone === "1") return false;
    if (!isVisible(el)) return false;

    const rescue = el.dataset.ctRescue === "1";
    if (!rescue) {
      // UI scanning must never touch tweet/article prose.
      if (el.closest?.("[data-testid='tweetText'],article,[role='article']")) return false;
      if (el.matches?.(CONTENT_SELECTORS) || el.querySelector?.("[data-testid='tweetText']")) return false;
    } else {
      if (el.closest?.(CONTENT_SELECTORS)) return false;
    }

    const text = getUiSourceText(el);
    const maxLen = rescue ? 280 : 180;
    if (text.length < 2 || text.length > maxLen || !containsLetters(text)) return false;
    if (!hasRequestedTranslationForText(text)) return false;
    if (/^[@#][A-Za-z0-9_]{1,30}$/.test(text)) return false;
    if (/^[\d\s,.%+\-KMB]+$/i.test(text)) return false;
    const region = el.closest(UI_REGIONS);
    if (!region && !rescue) return false;
    return true;
  }

  function hasRequestedTranslationForText(text) {
    const lang = detectSourceLanguage(text);
    if (state.settings?.outputEnglish === true && lang !== "en") return true;
    if (state.settings?.outputChinese !== false && lang !== "zh") return true;
    return false;
  }

  function detectSourceLanguage(text) {
    const value = String(text || "");
    const arabic = (value.match(/[\u0600-\u06FF]/g) || []).length;
    const kana = (value.match(/[\u3040-\u30ff]/g) || []).length;
    const hangul = (value.match(/[\uac00-\ud7af]/g) || []).length;
    const han = (value.match(/[\u3400-\u9fff]/g) || []).length;
    const cyrillic = (value.match(/[\u0400-\u04ff]/g) || []).length;
    const latin = (value.match(/[A-Za-z]/g) || []).length;
    if (arabic >= 2 && arabic >= latin) return "ar";
    if (kana >= 1) return "ja";
    if (hangul >= 2) return "ko";
    if (han >= 2 && kana === 0) return "zh";
    if (cyrillic >= 2) return "other";
    if (latin >= 2) return "en";
    return "other";
  }

  function isVisible(el) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 4 && rect.height > 4;
  }

  function nearViewport(el, margin = 900) {
    const r = el.getBoundingClientRect();
    return r.bottom >= -margin && r.top <= window.innerHeight + margin;
  }

  function getSourceText(el) {
    return String(el.innerText || el.textContent || "")
      .replace(/[\t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function containsLetters(text) {
    return /[A-Za-z\u00C0-\u024F\u4E00-\u9FFF\u3040-\u30ff\uac00-\ud7af]/.test(text);
  }


  function queuePriority(el) {
    if (!el?.isConnected) return 999999;
    const r = el.getBoundingClientRect();
    const viewportMid = window.innerHeight / 2;
    const elementMid = Math.max(0, Math.min(window.innerHeight, (r.top + r.bottom) / 2));
    let distance = Math.abs(elementMid - viewportMid);
    if (r.bottom >= 0 && r.top <= window.innerHeight) distance -= 1400;
    if ((el.dataset?.ctKind || "content") === "ui") distance += 240;
    return distance;
  }

  function prioritizeQueue() {
    state.queue.sort((a, b) => queuePriority(a) - queuePriority(b));
  }

  function enqueue(el, kind = "content") {
    const eligible = kind === "ui" ? isUiEligible(el) : isContentEligible(el);
    if (!state.enabled || !eligible || state.queued.has(el)) return false;
    state.queued.add(el);
    el.dataset.ctQueued = "1";
    el.dataset.ctKind = kind;
    state.queue.push(el);
    updateToolbar();
    return true;
  }

  async function processQueue() {
    if (state.processing || !state.enabled || !state.queue.length) return;
    state.processing = true;
    updateToolbar();

    try {
      while (state.queue.length && state.enabled) {
        prioritizeQueue();
        const firstBatch = !state.firstRenderDone;
        const configuredMax = Number(state.settings?.maxBatchChars || 3600);
        const maxChars = firstBatch ? Math.min(configuredMax, 1500) : Math.min(configuredMax, 3600);
        const maxItems = firstBatch ? 4 : 7;
        const batch = [];
        let chars = 0;

        while (state.queue.length && batch.length < maxItems) {
          const el = state.queue.shift();
          const kind = el?.dataset?.ctKind || "content";
          const eligible = kind === "ui" ? isUiEligible(el) : isContentEligible(el);
          if (!el?.isConnected || !eligible) {
            clearQueued(el);
            continue;
          }
          const text = kind === "ui" ? getUiSourceText(el) : getSourceText(el);
          if (batch.length && chars + text.length > maxChars) {
            state.queue.unshift(el);
            break;
          }
          chars += text.length;
          const segments = kind === "ui" ? [{ source: text, paragraph: 0 }] : segmentTextDetailed(text);
          const sourceLang = detectSourceLanguage(text);
          el.dataset.ctSourceLang = sourceLang;
          batch.push({ el, id: el.dataset.ctBlockId, text, sourceSnapshot: text, segments, tag: el.tagName.toLowerCase(), kind, sourceLang });
        }

        if (!batch.length) continue;
        batch.forEach(({ el, kind }) => { if (kind === "content") el.classList.add("ct-pending"); });

        let resp;
        try {
          resp = await sendRuntime({
            type: "translateBatch",
            items: batch.map(({ id, text, segments, tag, kind, sourceLang }) => ({ id, text, segments, tag, kind, sourceLang })),
            meta: { url: location.href, title: document.title }
          });
        } catch (e) {
          resp = { ok: false, error: e?.message || String(e) };
        }

        if (!resp?.ok) {
          const msg = resp?.error || "翻译失败";
          state.lastError = msg;
          batch.forEach(({ el }) => {
            el.classList.remove("ct-pending");
            clearQueued(el);
          });
          showToast(msg);
          updateToolbar();
          break;
        }

        const rows = Array.isArray(resp.result) ? resp.result : [];
        const map = new Map(rows.map((x) => [String(x.id), x]));
        for (const item of batch) {
          const row = map.get(String(item.id));
          item.el.classList.remove("ct-pending");
          clearQueued(item.el);

          const currentText = item.kind === "ui" ? getUiSourceText(item.el) : getSourceText(item.el);
          if (currentText !== item.sourceSnapshot) {
            item.el.removeAttribute("data-ct-done");
            prepareCandidate(item.el, item.kind, true);
            continue;
          }

          if (!row?.text && !row?.segments?.length) continue;
          renderTranslation(item.el, row, item.kind);
          state.firstRenderDone = true;
          item.el.dataset.ctDone = "1";
          item.el.dataset.ctSourceSnapshot = item.sourceSnapshot;
          state.observer?.unobserve(item.el);
        }

        state.translatedCount = document.querySelectorAll(".ct-translation[data-ready='1'],[data-ct-kind='ui'][data-ct-done='1']").length;
        state.lastError = "";
        updateToolbar();
      }
    } finally {
      state.processing = false;
      updateToolbar();
    }
  }

  function segmentTextDetailed(text) {
    const normalized = String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!normalized) return [];

    const out = [];
    const paragraphs = normalized.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    paragraphs.forEach((paragraph, paragraphIndex) => {
      const pieces = [];
      // Multiple-choice/list options such as "A. Zhanjiang, China?" are one
      // semantic row. Do not split the "A." away from the option text.
      if (/^(?:[A-Ha-h]|\d{1,2})[.)、．]\s+\S/.test(paragraph)) {
        splitLongTextSegment(paragraph, pieces);
      } else {
        const matches = paragraph.match(/[^.!?。！？]+(?:[.!?。！？]+["'’”）)]*)?|[^.!?。！？]+$/g) || [paragraph];
        for (const sentence of matches) splitLongTextSegment(sentence.trim(), pieces);
      }
      pieces.filter(Boolean).forEach((source) => out.push({ source, paragraph: paragraphIndex }));
    });
    return out;
  }

  function segmentText(text) {
    return segmentTextDetailed(text).map((x) => x.source);
  }

  function splitLongTextSegment(text, out) {
    if (!text) return;
    if (text.length <= 280) { out.push(text); return; }
    let rest = text;
    while (rest.length > 280) {
      const head = rest.slice(0, 280);
      let cut = Math.max(head.lastIndexOf("; "), head.lastIndexOf(": "), head.lastIndexOf(", "), head.lastIndexOf("；"), head.lastIndexOf("，"));
      if (cut < 120) cut = head.lastIndexOf(" ");
      if (cut < 120) cut = 280; else cut += 1;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }

  function clearQueued(el) {
    if (!el) return;
    state.queued.delete(el);
    el.removeAttribute?.("data-ct-queued");
  }

  function renderTranslation(el, row, kind = "content") {
    if (kind === "ui") return renderUiTranslation(el, row);

    let box = el.nextElementSibling;
    if (!box || !box.classList.contains("ct-translation")) {
      box = document.createElement("div");
      box.className = "ct-translation";
      el.insertAdjacentElement("afterend", box);
    }

    const pair = el.dataset.ctBlockId || `ct-${++state.blockCounter}`;
    el.dataset.ctPair = pair;
    box.dataset.ctPair = pair;
    box.dataset.sourceTag = el.tagName.toLowerCase();
    box.dataset.ready = "1";
    box.classList.remove("ct-stale");
    box.replaceChildren();

    const segments = normalizeRenderedSegments(row);
    box.__ctSegments = segments;
    el.__ctSegments = segments;

    const preferredSegments = segments.map((seg) => {
      const preferred = getPreferredSegmentTranslation(seg);
      return {
        source: seg.source,
        paragraph: seg.paragraph,
        target: preferred?.target || "",
        alignments: preferred?.alignments || []
      };
    });
    buildAlignmentRefs(el, box, preferredSegments);

    const paragraphIndexes = [...new Set(segments.map((x) => Number(x.paragraph || 0)))];
    const interleave = el.matches?.("[data-testid='tweetText']") && paragraphIndexes.length > 1 && !hasInlineExpandControl(el);
    box.classList.toggle("ct-interleaved", interleave);

    if (interleave) {
      el.dataset.ctInterleavedSource = "1";
      el.classList.add("ct-source-replaced");
      renderInterleavedParagraphs(box, segments);
    } else {
      el.removeAttribute("data-ct-interleaved-source");
      el.classList.remove("ct-source-replaced");
      renderTranslationParagraphs(box, segments);
    }

    applyMode();
  }

  function hasInlineExpandControl(el) {
    const controls = el?.querySelectorAll?.("a,button,[role='button']") || [];
    for (const control of controls) {
      const label = String(control.innerText || control.textContent || control.getAttribute?.("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (/show more|read more|see more|展开|显示更多|查看更多|全文/.test(label)) return true;
    }
    return false;
  }

  function normalizeRenderedSegments(row) {
    const raw = Array.isArray(row?.segments) && row.segments.length
      ? row.segments
      : segmentTextDetailed(String(row?.text || "")).map((x) => ({
          source: x.source,
          paragraph: x.paragraph,
          target: x.source,
          alignments: []
        }));

    return raw.map((x, index) => {
      const translations = {};
      if (x?.translations && typeof x.translations === "object") {
        for (const [lang, value] of Object.entries(x.translations)) {
          const target = String(value?.target || "").trim();
          if (!target) continue;
          translations[lang] = {
            target,
            alignments: normalizeSegmentAlignments(value?.alignments)
          };
        }
      }

      if (!Object.keys(translations).length && String(x?.target || "").trim()) {
        const fallbackLang = state.settings?.targetLanguage || "zh-CN";
        translations[fallbackLang] = {
          target: String(x.target || "").trim(),
          alignments: normalizeSegmentAlignments(x.alignments)
        };
      }

      return {
        source: String(x?.source || "").trim(),
        paragraph: Number.isFinite(Number(x?.paragraph)) ? Number(x.paragraph) : 0,
        translations,
        index
      };
    }).filter((x) => x.source);
  }

  function getPreferredSegmentTranslation(seg) {
    if (!seg?.translations) return null;
    const zhKey = Object.keys(seg.translations).find((k) => k.startsWith("zh"));
    if (zhKey && seg.translations[zhKey]) return seg.translations[zhKey];
    if (seg.translations.en) return seg.translations.en;
    const first = Object.keys(seg.translations)[0];
    return first ? seg.translations[first] : null;
  }

  function outputLanguageOrder(segments) {
    const all = new Set();
    segments.forEach((seg) => Object.keys(seg.translations || {}).forEach((lang) => all.add(lang)));
    const out = [];
    if (all.has("en")) out.push("en");
    [...all].filter((x) => x.startsWith("zh")).forEach((x) => out.push(x));
    [...all].filter((x) => x !== "en" && !x.startsWith("zh")).forEach((x) => out.push(x));
    return out;
  }

  function languageBadge() {
    return "//";
  }

  function languageLabelForUi(lang) {
    if (lang === "en") return "English translation";
    if (String(lang).startsWith("zh")) return "Chinese translation";
    return `${String(lang || "translation")} translation`;
  }

  function renderTranslationParagraphs(box, segments) {
    const groups = groupSegmentsByParagraph(segments);
    for (const group of groups) {
      const paragraph = document.createElement("div");
      paragraph.className = "ct-translation-paragraph";
      paragraph.dataset.ctParagraph = String(group.index);

      for (const lang of outputLanguageOrder(group.segments)) {
        const row = document.createElement("div");
        row.className = "ct-lang-row";
        row.dataset.ctLang = lang;

        const badge = document.createElement("span");
        badge.className = "ct-lang-badge";
        badge.textContent = languageBadge(lang);
        badge.setAttribute("aria-label", languageLabelForUi(lang));
        badge.title = languageLabelForUi(lang);
        row.appendChild(badge);

        const content = document.createElement("span");
        content.className = "ct-lang-content";
        appendLanguageSegments(content, group.segments, lang);
        row.appendChild(content);
        paragraph.appendChild(row);
      }
      box.appendChild(paragraph);
    }
  }

  function renderInterleavedParagraphs(box, segments) {
    const groups = groupSegmentsByParagraph(segments);
    for (const group of groups) {
      const wrap = document.createElement("div");
      wrap.className = "ct-interleaved-paragraph";
      wrap.dataset.ctParagraph = String(group.index);

      if (state.settings?.displayOriginal !== false) {
        const sourceRow = document.createElement("div");
        sourceRow.className = "ct-source-paragraph";
        appendAlignedSourceSegments(sourceRow, group.segments);
        wrap.appendChild(sourceRow);
      }

      for (const lang of outputLanguageOrder(group.segments)) {
        const row = document.createElement("div");
        row.className = "ct-lang-row";
        row.dataset.ctLang = lang;

        const badge = document.createElement("span");
        badge.className = "ct-lang-badge";
        badge.textContent = languageBadge(lang);
        badge.setAttribute("aria-label", languageLabelForUi(lang));
        badge.title = languageLabelForUi(lang);
        row.appendChild(badge);

        const content = document.createElement("span");
        content.className = "ct-lang-content";
        appendLanguageSegments(content, group.segments, lang);
        row.appendChild(content);
        wrap.appendChild(row);
      }

      box.appendChild(wrap);
    }
  }

  function groupSegmentsByParagraph(segments) {
    const map = new Map();
    for (const seg of segments) {
      const index = Number(seg.paragraph || 0);
      if (!map.has(index)) map.set(index, []);
      map.get(index).push(seg);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([index, list]) => ({ index, segments: list }));
  }

  function appendLanguageSegments(container, segments, lang) {
    let first = true;
    for (const seg of segments) {
      const translated = seg.translations?.[lang];
      if (!translated?.target) continue;
      if (!first) container.appendChild(document.createTextNode(" "));
      const line = document.createElement("span");
      line.className = "ct-translation-line ct-translation-segment";
      line.dataset.ctSegIndex = String(seg.index);
      line.dataset.ctLang = lang;
      line.__ctSegment = seg;
      renderAlignedTarget(line, {
        target: translated.target,
        alignments: translated.alignments
      }, seg.index, lang);
      container.appendChild(line);
      first = false;
    }
  }

  function appendAlignedSourceSegments(container, segments) {
    let first = true;
    for (const seg of segments) {
      if (!first) container.appendChild(document.createTextNode(" "));
      const span = document.createElement("span");
      span.className = "ct-source-segment";
      span.dataset.ctSegIndex = String(seg.index);
      renderAlignedSource(span, seg);
      container.appendChild(span);
      first = false;
    }
  }

  function renderAlignedSource(container, seg) {
    const source = String(seg.source || "");
    const preferred = getPreferredSegmentTranslation(seg);
    const alignments = preferred?.alignments || [];
    if (!source || !alignments.length) {
      container.textContent = source;
      return;
    }

    let cursor = 0;
    let renderedAny = false;
    alignments.forEach((alignment, alignIndex) => {
      const phrase = String(alignment.source || "").trim();
      if (!phrase) return;
      let pos = source.indexOf(phrase, cursor);
      if (pos < 0) pos = source.toLowerCase().indexOf(phrase.toLowerCase(), cursor);
      if (pos < 0) return;

      if (pos > cursor) container.appendChild(document.createTextNode(source.slice(cursor, pos)));
      const span = document.createElement("span");
      span.className = "ct-source-align-unit";
      span.dataset.ctSegIndex = String(seg.index);
      span.dataset.ctAlignIndex = String(alignIndex);
      span.textContent = source.slice(pos, pos + phrase.length);
      span.__ctAlignment = alignment;
      container.appendChild(span);
      cursor = pos + phrase.length;
      renderedAny = true;
    });

    if (!renderedAny) {
      container.textContent = source;
      return;
    }
    if (cursor < source.length) container.appendChild(document.createTextNode(source.slice(cursor)));
  }

  function normalizeSegmentAlignments(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 30).map((x) => ({
      source: String(x?.source || "").replace(/\s+/g, " ").trim(),
      target: String(x?.target || "").replace(/\s+/g, " ").trim()
    })).filter((x) => x.source && x.target);
  }

  function buildAlignmentRefs(source, translation, segments) {
    const full = normalizeForAlignment(getSourceText(source));
    const refs = [];
    let segmentCursor = 0;

    segments.forEach((seg, segmentIndex) => {
      const segSource = normalizeForAlignment(seg.source);
      let segStart = segSource ? full.indexOf(segSource, segmentCursor) : -1;
      if (segStart < 0 && segSource) segStart = full.indexOf(segSource);
      if (segStart < 0) segStart = segmentCursor;
      let phraseCursor = 0;

      seg.alignments.forEach((alignment, alignIndex) => {
        const phrase = normalizeForAlignment(alignment.source);
        if (!phrase) return;
        let rel = segSource.indexOf(phrase, phraseCursor);
        if (rel < 0) rel = segSource.toLowerCase().indexOf(phrase.toLowerCase(), phraseCursor);
        if (rel < 0) rel = segSource.toLowerCase().indexOf(phrase.toLowerCase());
        if (rel < 0) return;

        refs.push({
          segmentIndex,
          alignIndex,
          start: segStart + rel,
          end: segStart + rel + phrase.length,
          source: alignment.source,
          target: alignment.target
        });
        phraseCursor = Math.max(phraseCursor, rel + phrase.length);
      });

      segmentCursor = Math.max(segmentCursor, segStart + segSource.length);
    });

    source.__ctAlignmentRefs = refs;
    translation.__ctAlignmentRefs = refs;
  }

  function renderAlignedTarget(line, seg, segmentIndex, lang = "") {
    const target = String(seg.target || "");
    const alignments = Array.isArray(seg.alignments) ? seg.alignments : [];
    if (!target || !alignments.length) {
      line.textContent = target;
      return;
    }

    let cursor = 0;
    let renderedAny = false;
    alignments.forEach((alignment, alignIndex) => {
      const phrase = String(alignment.target || "").trim();
      if (!phrase) return;
      let pos = target.indexOf(phrase, cursor);
      if (pos < 0) pos = target.indexOf(phrase);
      if (pos < 0) return;

      if (pos > cursor) line.appendChild(document.createTextNode(target.slice(cursor, pos)));
      const span = document.createElement("span");
      span.className = "ct-align-unit";
      span.dataset.ctSegIndex = String(segmentIndex);
      span.dataset.ctAlignIndex = String(alignIndex);
      span.dataset.ctLang = lang;
      span.textContent = target.slice(pos, pos + phrase.length);
      span.__ctAlignment = alignment;
      line.appendChild(span);
      cursor = pos + phrase.length;
      renderedAny = true;
    });

    if (!renderedAny) {
      line.textContent = target;
      return;
    }
    if (cursor < target.length) line.appendChild(document.createTextNode(target.slice(cursor)));
  }

  function renderUiTranslation(el, row) {
    const seg = row?.segments?.[0] || {};
    const translations = seg?.translations && typeof seg.translations === "object"
      ? seg.translations
      : { [state.settings?.targetLanguage || "zh-CN"]: { target: seg?.target || row?.text || "" } };

    const en = String(translations.en?.target || "").replace(/\s+/g, " ").trim();
    const zhKey = Object.keys(translations).find((k) => k.startsWith("zh"));
    const zh = zhKey ? String(translations[zhKey]?.target || "").replace(/\s+/g, " ").trim() : "";

    if (en) el.dataset.ctUiEn = en; else delete el.dataset.ctUiEn;
    if (zh) el.dataset.ctUiZh = zh; else delete el.dataset.ctUiZh;

    const pair = el.dataset.ctBlockId || `ct-${++state.blockCounter}`;
    el.dataset.ctPair = pair;
    el.classList.add("ct-ui-output");
    updateUiTranslationDisplay(el);
  }

  function updateUiTranslationDisplay(el) {
    if (!el) return;
    const sourceText = el.dataset.ctUiSource || getUiSourceText(el);
    const sourceLang = detectSourceLanguage(sourceText);
    const parts = [];
    if (state.settings?.outputEnglish === true && sourceLang !== "en" && el.dataset.ctUiEn) {
      parts.push(el.dataset.ctUiEn);
    }
    if (state.settings?.outputChinese !== false && sourceLang !== "zh" && el.dataset.ctUiZh) {
      parts.push(el.dataset.ctUiZh);
    }
    if (!parts.length) {
      el.classList.remove("ct-ui-bilingual");
      delete el.dataset.ctUiTranslation;
      return;
    }
    el.dataset.ctUiTranslation = parts.join(" / ");
    el.classList.add("ct-ui-bilingual");
    el.classList.toggle("ct-ui-long", sourceText.length > 34 || /\n/.test(sourceText));
  }

  function queuePointerMove(e) {
    state.lastPointer = { x: e.clientX, y: e.clientY, target: e.target, buttons: e.buttons };
    if (state.pointerRaf) return;
    state.pointerRaf = requestAnimationFrame(() => {
      state.pointerRaf = 0;
      const p = state.lastPointer;
      if (!p) return;
      handleAlignmentPointer(p);
      scheduleWordHoverProbe(p);
    });
  }

  function scheduleWordHoverProbe(p) {
    if (state.settings?.globalWordLookup === false || state.settings?.hoverLookup === false) return;
    const prev = state.lastWordProbe;
    const sameTarget = prev?.target === p.target;
    const moved = prev ? Math.hypot((prev.x || 0) - p.x, (prev.y || 0) - p.y) : 999;
    if (sameTarget && moved < 5) return;
    state.lastWordProbe = { x: p.x, y: p.y, target: p.target };
    clearTimeout(state.wordProbeTimer);
    state.wordProbeTimer = setTimeout(() => {
      handleGlobalWordHover(state.lastPointer || p);
    }, 55);
  }

  function handleAlignmentPointer(e) {
    if (!state.enabled || state.bubble || state.selectionResult) return clearActiveAlignment();

    const target = e.target?.nodeType === Node.ELEMENT_NODE ? e.target : e.target?.parentElement;
    if (!target || target.closest?.(".ct-word-bubble,.ct-mini-lookup,.ct-selection-action,.ct-selection-result,.ct-float-toolbar")) {
      return clearActiveAlignment();
    }

    const targetAlign = target.closest?.(".ct-align-unit");
    if (targetAlign) {
      const translation = targetAlign.closest(".ct-translation");
      const pair = translation?.dataset?.ctPair;
      const source = pair ? document.querySelector(`[data-ct-pair="${CSS.escape(pair)}"][data-ct-kind="content"]`) : null;
      const alignment = targetAlign.__ctAlignment;
      const segIndex = Number(targetAlign.dataset.ctSegIndex);
      if (source && alignment) {
        activateAlignment(source, translation, segIndex, alignment, e.x, e.y, "target");
        return;
      }
    }

    const sourceAlign = target.closest?.(".ct-source-align-unit");
    if (sourceAlign) {
      const translation = sourceAlign.closest(".ct-translation");
      const pair = translation?.dataset?.ctPair;
      const source = pair ? document.querySelector(`[data-ct-pair="${CSS.escape(pair)}"][data-ct-kind="content"]`) : null;
      const alignment = sourceAlign.__ctAlignment;
      const segIndex = Number(sourceAlign.dataset.ctSegIndex);
      if (source && alignment) {
        activateAlignment(source, translation, segIndex, alignment, e.x, e.y, "source");
        return;
      }
    }

    const source = target.closest?.("[data-ct-pair][data-ct-kind='content']");
    if (source?.__ctAlignmentRefs?.length && source.contains(target)) {
      const offset = normalizedOffsetAtPoint(source, e.x, e.y);
      if (offset >= 0) {
        let ref = source.__ctAlignmentRefs.find((x) => offset >= x.start && offset <= x.end);
        if (!ref) {
          ref = source.__ctAlignmentRefs
            .map((x) => ({ x, d: Math.min(Math.abs(offset - x.start), Math.abs(offset - x.end)) }))
            .sort((a, b) => a.d - b.d)[0];
          if (ref && ref.d > 2) ref = null;
          else ref = ref?.x || null;
        }
        if (ref) {
          const translation = source.nextElementSibling?.classList?.contains("ct-translation")
            ? source.nextElementSibling
            : document.querySelector(`.ct-translation[data-ct-pair="${CSS.escape(source.dataset.ctPair || "")}"]`);
          if (translation) {
            activateAlignment(source, translation, ref.segmentIndex, ref, e.x, e.y, "source");
            return;
          }
        }
      }
    }

    clearActiveAlignment();
  }

  function activateAlignment(source, translation, segmentIndex, alignment, x, y, direction) {
    const sourcePhrase = normalizeForAlignment(alignment?.source || "");
    if (!sourcePhrase) return clearActiveAlignment();
    const key = `${source.dataset.ctPair || ""}:${segmentIndex}:${sourcePhrase.toLowerCase()}:${direction}`;
    if (state.activeAlignment?.key === key) {
      positionPairPeek(x, y);
      return;
    }

    clearActiveAlignment();
    state.activeAlignment = { key, source, translation, segmentIndex, sourcePhrase };

    translation.querySelectorAll(".ct-align-unit").forEach((el) => {
      const sameSegment = Number(el.dataset.ctSegIndex) === segmentIndex;
      const sameSource = normalizeForAlignment(el.__ctAlignment?.source || "").toLowerCase() === sourcePhrase.toLowerCase();
      el.classList.toggle("ct-align-hover", sameSegment && sameSource);
    });
    translation.querySelectorAll(".ct-source-align-unit").forEach((el) => {
      const sameSegment = Number(el.dataset.ctSegIndex) === segmentIndex;
      const sameSource = normalizeForAlignment(el.__ctAlignment?.source || "").toLowerCase() === sourcePhrase.toLowerCase();
      el.classList.toggle("ct-source-align-hover", sameSegment && sameSource);
    });

    const ref = source.__ctAlignmentRefs?.find((r) =>
      r.segmentIndex === segmentIndex && normalizeForAlignment(r.source).toLowerCase() === sourcePhrase.toLowerCase()
    );
    if (ref && window.Highlight && CSS?.highlights && source.dataset.ctInterleavedSource !== "1") {
      const range = rangeFromNormalizedOffsets(source, ref.start, ref.end);
      if (range) {
        try { CSS.highlights.set("ct-source-pair", new Highlight(range)); } catch (_) {}
      }
    }

    if (direction === "target") {
      showPairPeek(alignment.source, x, y, "en");
    } else {
      const counterparts = collectAlignmentCounterparts(translation, segmentIndex, sourcePhrase);
      showPairPeek(counterparts || alignment.target || "", x, y, "zh");
    }
  }

  function collectAlignmentCounterparts(translation, segmentIndex, sourcePhrase) {
    const rows = [];
    const seen = new Set();
    translation.querySelectorAll(".ct-align-unit").forEach((el) => {
      if (Number(el.dataset.ctSegIndex) !== segmentIndex) return;
      if (normalizeForAlignment(el.__ctAlignment?.source || "").toLowerCase() !== sourcePhrase.toLowerCase()) return;
      const lang = el.dataset.ctLang || "";
      const text = String(el.__ctAlignment?.target || el.textContent || "").trim();
      if (!text) return;
      const label = lang === "en" ? "EN" : (lang.startsWith("zh") ? "中" : lang.toUpperCase());
      const value = `${label ? `${label} · ` : ""}${text}`;
      if (!seen.has(value)) {
        seen.add(value);
        rows.push(value);
      }
    });
    return rows.join("\n");
  }

  function clearActiveAlignment() {
    if (state.activeAlignment?.translation) {
      state.activeAlignment.translation.querySelectorAll(".ct-align-hover").forEach((el) => el.classList.remove("ct-align-hover"));
      state.activeAlignment.translation.querySelectorAll(".ct-source-align-hover").forEach((el) => el.classList.remove("ct-source-align-hover"));
    }
    if (CSS?.highlights) {
      try { CSS.highlights.delete("ct-source-pair"); } catch (_) {}
    }
    state.activeAlignment = null;
    hidePairPeek();
  }

  function normalizeForAlignment(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizedOffsetAtPoint(root, x, y) {
    let node, offset;
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      node = pos?.offsetNode;
      offset = Number(pos?.offset || 0);
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      node = range?.startContainer;
      offset = Number(range?.startOffset || 0);
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node.parentElement)) return -1;

    const map = buildNormalizedDomMap(root);
    const idx = map.positions.findIndex((p) => p.node === node && offset >= p.startOffset && offset <= p.endOffset);
    return idx;
  }

  function buildNormalizedDomMap(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || p.closest?.(".ct-ui-translation,.ct-translation")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let normalized = "";
    const positions = [];
    let node;
    let pendingSpace = null;

    while ((node = walker.nextNode())) {
      const raw = node.textContent || "";
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (/\s/.test(ch)) {
          if (normalized && !normalized.endsWith(" ")) pendingSpace = { node, startOffset: i, endOffset: i + 1 };
          continue;
        }
        if (pendingSpace) {
          normalized += " ";
          positions.push(pendingSpace);
          pendingSpace = null;
        }
        normalized += ch;
        positions.push({ node, startOffset: i, endOffset: i + 1 });
      }
    }

    if (normalized.startsWith(" ")) {
      normalized = normalized.slice(1);
      positions.shift();
    }
    return { normalized, positions };
  }

  function rangeFromNormalizedOffsets(root, start, end) {
    const map = buildNormalizedDomMap(root);
    const cleanStart = Math.max(0, Math.min(start, map.positions.length - 1));
    const cleanEnd = Math.max(cleanStart + 1, Math.min(end, map.positions.length));
    const a = map.positions[cleanStart];
    const b = map.positions[cleanEnd - 1];
    if (!a || !b) return null;
    try {
      const range = document.createRange();
      range.setStart(a.node, a.startOffset);
      range.setEnd(b.node, b.endOffset);
      return range;
    } catch (_) {
      return null;
    }
  }

  function showPairPeek(text, x, y, lang) {
    if (!text || state.miniLookup || state.bubble || state.selectionResult) return;
    let peek = state.pairPeek;
    if (!peek?.isConnected) {
      peek = document.createElement("div");
      peek.className = "ct-pair-peek";
      document.documentElement.appendChild(peek);
      state.pairPeek = peek;
    }
    peek.lang = lang === "en" ? "en" : "zh-CN";
    peek.textContent = text;
    positionPairPeek(x, y);
    peek.classList.add("show");
  }

  function positionPairPeek(x, y) {
    const peek = state.pairPeek;
    if (!peek?.isConnected) return;
    peek.style.left = `${Math.min(window.innerWidth - 20, Math.max(12, x + 12))}px`;
    peek.style.top = `${Math.min(window.innerHeight - 20, Math.max(12, y + 16))}px`;
    requestAnimationFrame(() => {
      if (!peek?.isConnected) return;
      const r = peek.getBoundingClientRect();
      if (r.right > window.innerWidth - 10) peek.style.left = `${Math.max(10, x - r.width - 12)}px`;
      if (r.bottom > window.innerHeight - 10) peek.style.top = `${Math.max(10, y - r.height - 12)}px`;
    });
  }

  function hidePairPeek() {
    if (!state.pairPeek) return;
    state.pairPeek.classList.remove("show");
  }

  function captureViewportAnchor() {
    const y = Math.max(90, Math.min(window.innerHeight - 90, Math.round(window.innerHeight * 0.36)));
    const xs = [0.48, 0.38, 0.58, 0.28, 0.68].map((n) => Math.round(window.innerWidth * n));

    for (const x of xs) {
      const node = document.elementFromPoint(x, y);
      const pairNode = node?.closest?.("[data-ct-pair]");
      const pair = pairNode?.dataset?.ctPair;
      if (!pair) continue;
      const rect = pairNode.getBoundingClientRect();
      return { pair, top: rect.top, y, scrollY: window.scrollY };
    }

    const visible = [...document.querySelectorAll("[data-ct-pair]")].find((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 80 && r.top < window.innerHeight - 80;
    });
    if (visible?.dataset?.ctPair) {
      return { pair: visible.dataset.ctPair, top: visible.getBoundingClientRect().top, y, scrollY: window.scrollY };
    }
    return { pair: "", top: 0, y, scrollY: window.scrollY };
  }

  function restoreViewportAnchor(anchor) {
    if (!anchor) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!anchor.pair) {
        if (Math.abs(window.scrollY - anchor.scrollY) > 2) window.scrollTo({ top: anchor.scrollY, left: window.scrollX, behavior: "auto" });
        return;
      }
      const escaped = CSS.escape(anchor.pair);
      const candidates = [
        document.querySelector(`[data-ct-kind="content"][data-ct-pair="${escaped}"]`),
        document.querySelector(`.ct-translation[data-ct-pair="${escaped}"]`),
        document.querySelector(`[data-ct-pair="${escaped}"]`)
      ].filter(Boolean);
      const target = candidates.find((el) => {
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && r.height > 0;
      });
      if (!target) return;
      const delta = target.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 1) window.scrollBy({ top: delta, left: 0, behavior: "auto" });
    }));
  }

  function queueLayerRefresh() {
    document.querySelectorAll("[data-ct-kind='content'][data-ct-done='1'],[data-ct-kind='ui'][data-ct-done='1']").forEach((el) => {
      const kind = el.dataset.ctKind || "content";
      el.removeAttribute("data-ct-done");
      el.removeAttribute("data-ct-queued");
      state.queued.delete(el);
      if (kind === "content") {
        const pair = el.dataset.ctPair || el.dataset.ctBlockId || "";
        const existing = pair ? document.querySelector(`.ct-translation[data-ct-pair="${CSS.escape(pair)}"]`) : el.nextElementSibling;
        existing?.classList.add("ct-stale");
      }
      prepareCandidate(el, kind, false);
    });
  }

  function applyMode() {
    const showOriginal = state.settings?.displayOriginal !== false;
    document.documentElement.classList.toggle("ct-hide-original", !showOriginal);

    document.querySelectorAll(`${CONTENT_SELECTORS}[data-ct-done='1'][data-ct-kind='content']`).forEach((el) => {
      if (el.dataset.ctInterleavedSource === "1") {
        // Multi-paragraph X posts are reconstructed inside the translation box so
        // original/translation paragraphs can alternate naturally.
        el.classList.add("ct-source-replaced");
        el.dataset.ctOriginalHidden = "1";
        return;
      }
      el.classList.remove("ct-source-replaced");
      if (!showOriginal) {
        el.style.setProperty("display", "none", "important");
        el.dataset.ctOriginalHidden = "1";
      } else if (el.dataset.ctOriginalHidden === "1") {
        el.style.removeProperty("display");
        el.removeAttribute("data-ct-original-hidden");
      }
    });

    document.querySelectorAll(".ct-source-paragraph").forEach((el) => {
      el.style.display = showOriginal ? "block" : "none";
    });
    document.querySelectorAll(".ct-lang-row[data-ct-lang='en']").forEach((el) => {
      el.style.display = state.settings?.outputEnglish === true ? "flex" : "none";
    });
    document.querySelectorAll(".ct-lang-row").forEach((el) => {
      if (!String(el.dataset.ctLang || "").startsWith("zh")) return;
      el.style.display = state.settings?.outputChinese !== false ? "flex" : "none";
    });
    document.querySelectorAll(".ct-ui-output").forEach(updateUiTranslationDisplay);
    updateToolbar();
  }

  function resetRenderedTranslations() {
    document.querySelectorAll(".ct-translation").forEach((el) => el.remove());
    document.querySelectorAll(".ct-ui-output,.ct-ui-bilingual").forEach((el) => {
      el.classList.remove("ct-ui-output", "ct-ui-bilingual");
      delete el.dataset.ctUiTranslation;
      delete el.dataset.ctUiEn;
      delete el.dataset.ctUiZh;
    });
    document.querySelectorAll("[data-ct-kind]").forEach((el) => {
      el.removeAttribute("data-ct-done");
      el.removeAttribute("data-ct-queued");
      el.removeAttribute("data-ct-source-snapshot");
      el.removeAttribute("data-ct-interleaved-source");
      el.classList.remove("ct-source-replaced", "ct-pending");
      if (el.dataset.ctOriginalHidden === "1") {
        el.style.removeProperty("display");
        el.removeAttribute("data-ct-original-hidden");
      }
      state.queued.delete(el);
    });
    state.queue = [];
    state.translatedCount = 0;
  }

  function handleDoubleClick(e) {
    if (e.target.closest?.(".ct-word-bubble,.ct-mini-lookup,.ct-float-toolbar")) return;
    const sel = window.getSelection();
    const text = (sel?.toString() || "").trim();
    if (!text || text.length > 48 || !/^[A-Za-z][A-Za-z'’-]*$/.test(text)) return;
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range) return;
    const rect = range.getBoundingClientRect();
    const sentence = extractSentence(sel.anchorNode, text);
    openWordBubble({ word: text, sentence, rect });
  }

  function handleGlobalWordClick(e) {
    if (String(window.getSelection()?.toString() || "").trim()) return;
    if (state.settings?.globalWordLookup === false || state.settings?.hoverLookup === false) return;
    if (e.detail > 1) return;
    if (e.target.closest?.(".ct-word-bubble,.ct-mini-lookup,.ct-float-toolbar,input,textarea,select,button,a")) return;
    const hit = wordAtPoint(e.clientX, e.clientY);
    if (!hit) return;
    clearTimeout(state.hoverTimer);
    showGlobalMiniLookup(hit.word, hit.sentence, hit.rect, true, hit.pairTranslation || "");
  }

  function handleGlobalWordHover(e) {
    if (state.settings?.globalWordLookup === false || state.settings?.hoverLookup === false) return;
    if (e.buttons) return;
    const target = e.target?.nodeType === Node.ELEMENT_NODE ? e.target : e.target?.parentElement;
    if (target?.closest?.(".ct-word-bubble,.ct-mini-lookup,.ct-float-toolbar,.ct-selection-action,.ct-selection-result,input,textarea,select")) return;

    const hit = wordAtPoint(e.x, e.y);
    if (!hit) {
      state.hoverWordKey = "";
      clearTimeout(state.hoverTimer);
      return;
    }

    const key = `${hit.word.toLowerCase()}|${hit.sentence}`;
    if (key === state.hoverWordKey) return;
    state.hoverWordKey = key;
    state.hoverPoint = hit;
    clearTimeout(state.hoverTimer);
    state.hoverTimer = setTimeout(() => {
      if (state.hoverWordKey === key && state.hoverPoint) {
        showGlobalMiniLookup(hit.word, hit.sentence, hit.rect, false, hit.pairTranslation || "");
      }
    }, Number(state.settings?.hoverLookupDelay || 650));
  }

  function wordAtPoint(x, y) {
    let node, offset;
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      node = pos?.offsetNode; offset = pos?.offset;
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      node = range?.startContainer; offset = range?.startOffset;
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const parent = node.parentElement;
    if (!parent || (parent.closest(SKIP) && !parent.closest(".ct-source-paragraph,.ct-lang-row[data-ct-lang='en']"))) return null;
    const text = node.textContent || "";
    let o = Math.max(0, Math.min(Number(offset || 0), text.length));
    if (o === text.length && o > 0) o--;
    const re = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
    let m;
    while ((m = re.exec(text))) {
      if (o >= m.index && o <= m.index + m[0].length) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const sentence = extractSentence(node, m[0]);
        let pairTranslation = "";
        const sourceBlock = parent.closest?.("[data-ct-pair][data-ct-kind='content']");
        if (sourceBlock?.__ctAlignmentRefs?.length) {
          const normalizedOffset = normalizedOffsetAtPoint(sourceBlock, x, y);
          const ref = sourceBlock.__ctAlignmentRefs.find((r) => normalizedOffset >= r.start && normalizedOffset <= r.end);
          if (ref) pairTranslation = ref.target || "";
        }
        return { word: m[0], sentence, rect, pairTranslation };
      }
    }
    return null;
  }

  async function showGlobalMiniLookup(word, sentence, rect, immediate, pairTranslation = "") {
    hidePairPeek();
    closeMiniLookup();
    const mini = document.createElement("div");
    mini.className = "ct-mini-lookup ct-global-lookup";
    mini.innerHTML = `<div class="ct-mini-loading"><span class="ct-mini-dot"></span><b>${escapeHtml(word)}</b><span>查询中…</span></div>`;
    document.documentElement.appendChild(mini);
    state.miniLookup = mini;
    positionMiniLookup(mini, rect);
    mini.addEventListener("mouseenter", () => clearTimeout(state.hoverHideTimer));
    mini.addEventListener("mouseleave", () => { state.hoverHideTimer = setTimeout(closeMiniLookup, 500); });

    try {
      const resp = await sendRuntime({ type: "lookupMiniWord", payload: { word, sentence } });
      if (state.miniLookup !== mini) return;
      if (!resp?.ok) throw new Error(resp?.error || "查询失败");
      const d = resp.result || {};
      mini.innerHTML = `
        <div class="ct-mini-head"><b>${escapeHtml(d.lemma || word)}</b><span>${escapeHtml(d.pos || "")}</span><button data-mini-speak="${escapeAttr(d.lemma || word)}" title="发音">🔊</button></div>
        <div class="ct-mini-ipa">${escapeHtml(d.ipa || "")}</div>
        <div class="ct-mini-meaning">${escapeHtml(d.meaning || "")}</div>
        ${pairTranslation ? `<div class="ct-mini-pair">${escapeHtml(pairTranslation)}</div>` : ""}
        <div class="ct-mini-context">${escapeHtml(sentence || "")}</div>`;
      mini.querySelector("[data-mini-speak]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        speakText(ev.currentTarget.dataset.miniSpeak || word);
      });
      positionMiniLookup(mini, rect);
      if (!immediate) state.hoverHideTimer = setTimeout(closeMiniLookup, 2600);
    } catch (err) {
      if (state.miniLookup === mini) mini.innerHTML = `<div class="ct-mini-error">${escapeHtml(err?.message || "查询失败")}</div>`;
    }
  }

  function handleSelectionMouseUp(e) {
    if (e.target.closest?.(".ct-word-bubble,.ct-mini-lookup,.ct-selection-action,.ct-selection-result,.ct-float-toolbar")) return;
    setTimeout(() => showSelectionActionFromCurrentSelection(), 12);
  }

  function handleSelectionKeyUp(e) {
    if (!e.shiftKey && !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    setTimeout(() => showSelectionActionFromCurrentSelection(), 12);
  }

  function showSelectionActionFromCurrentSelection() {
    const sel = window.getSelection();
    const selected = String(sel?.toString() || "").replace(/\s+/g, " ").trim();
    if (!selected || selected.length > 1200 || !sel?.rangeCount) {
      closeSelectionAction();
      return;
    }
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer?.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer?.parentElement;
    if (container?.closest?.(".ct-word-bubble,.ct-mini-lookup,.ct-selection-action,.ct-selection-result,.ct-float-toolbar")) return;

    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    closeSelectionAction();
    const action = document.createElement("button");
    action.className = "ct-selection-action";
    action.type = "button";
    action.textContent = "翻译";
    action.title = "翻译选中内容";
    action.addEventListener("mousedown", (ev) => ev.preventDefault());
    action.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeSelectionAction();
      translateSelectionAndShow(selected, rect, "selection");
    });
    action.setAttribute("popover", "manual");
    (document.body || document.documentElement).appendChild(action);
    try { action.showPopover?.(); } catch (_) {}
    state.selectionAction = action;
    positionSelectionAction(action, rect);
  }

  function positionSelectionAction(action, rect) {
    const width = 58;
    const x = Math.min(window.innerWidth - width - 10, Math.max(10, rect.left + rect.width / 2 - width / 2));
    let y = rect.top - 42;
    if (y < 8) y = Math.min(window.innerHeight - 38, rect.bottom + 8);
    action.style.setProperty("left", `${x}px`, "important");
    action.style.setProperty("top", `${y}px`, "important");
  }

  function closeSelectionAction() {
    try { state.selectionAction?.hidePopover?.(); } catch (_) {}
    state.selectionAction?.remove();
    state.selectionAction = null;
  }

  async function translateSelectionAndShow(text, anchor, origin = "selection") {
    closeSelectionAction();
    closeSelectionResult();
    closeMiniLookup();
    clearActiveAlignment();

    const result = document.createElement("div");
    result.className = "ct-selection-result";
    result.innerHTML = `<div class="ct-selection-loading"><span class="ct-mini-dot"></span><span>正在翻译…</span></div>`;
    result.setAttribute("popover", "manual");
    (document.body || document.documentElement).appendChild(result);
    try { result.showPopover?.(); } catch (_) {}
    state.selectionResult = result;
    positionSelectionResult(result, anchor);

    try {
      const resp = await sendRuntime({
        type: "translateSelection",
        payload: { text, url: location.href, title: document.title, origin }
      });
      if (state.selectionResult !== result) return;
      if (!resp?.ok) throw new Error(resp?.error || "翻译失败");
      const d = resp.result || {};
      result.innerHTML = `
        <div class="ct-selection-head">
          <span>${escapeHtml(d.kind === "word" ? `${d.lemma || text}${d.ipa ? ` · ${d.ipa}` : ""}` : "选中翻译")}</span>
          <button class="ct-selection-close" type="button">×</button>
        </div>
        <div class="ct-selection-source">${escapeHtml(text)}</div>
        <div class="ct-selection-target">${escapeHtml(d.translation || d.meaning || "")}</div>
        <div class="ct-selection-actions">
          ${/[A-Za-z]/.test(text) ? `<button type="button" data-sel-speak>🔊 原文</button>` : ""}
          <button type="button" data-sel-copy>复制译文</button>
          <button type="button" data-sel-save>加入词库</button>
        </div>`;
      result.querySelector(".ct-selection-close")?.addEventListener("click", closeSelectionResult);
      result.querySelector("[data-sel-speak]")?.addEventListener("click", () => speakText(text));
      result.querySelector("[data-sel-copy]")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(d.translation || d.meaning || "");
          showToast("译文已复制");
        } catch (_) {}
      });
      result.querySelector("[data-sel-save]")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        const oldText = btn.textContent;
        btn.textContent = "保存中…";
        try {
          const saveResp = await sendRuntime({
            type: "saveSelectionVocab",
            payload: {
              text,
              translation: d.translation || d.meaning || "",
              lemma: d.lemma || "",
              ipa: d.ipa || "",
              pos: d.pos || "",
              context: text,
              url: location.href,
              title: document.title
            }
          });
          if (!saveResp?.ok) throw new Error(saveResp?.error || "保存失败");
          btn.textContent = "✓ 已加入";
          showToast("已加入场景词库");
        } catch (err) {
          btn.textContent = oldText;
          btn.disabled = false;
          showToast(err?.message || "保存失败");
        }
      });
      positionSelectionResult(result, anchor);
    } catch (err) {
      if (state.selectionResult === result) {
        result.innerHTML = `<div class="ct-selection-head"><span>翻译失败</span><button class="ct-selection-close" type="button">×</button></div><div class="ct-mini-error">${escapeHtml(err?.message || "翻译失败")}</div>`;
        result.querySelector(".ct-selection-close")?.addEventListener("click", closeSelectionResult);
      }
    }
  }

  function positionSelectionResult(result, anchor) {
    const x0 = Number(anchor?.x ?? anchor?.left ?? window.innerWidth * 0.55);
    const y0 = Number(anchor?.y ?? anchor?.bottom ?? window.innerHeight * 0.35);
    result.style.setProperty("left", `${Math.max(10, Math.min(window.innerWidth - 24, x0 + 12))}px`, "important");
    result.style.setProperty("top", `${Math.max(10, Math.min(window.innerHeight - 24, y0 + 12))}px`, "important");
    requestAnimationFrame(() => {
      if (!result?.isConnected) return;
      const r = result.getBoundingClientRect();
      if (r.right > window.innerWidth - 10) result.style.setProperty("left", `${Math.max(10, x0 - r.width - 12)}px`, "important");
      if (r.bottom > window.innerHeight - 10) result.style.setProperty("top", `${Math.max(10, y0 - r.height - 12)}px`, "important");
    });
  }

  function closeSelectionResult() {
    try { state.selectionResult?.hidePopover?.(); } catch (_) {}
    state.selectionResult?.remove();
    state.selectionResult = null;
  }

  function handleDynamicContentClick(e) {
    const target = e.target?.nodeType === Node.ELEMENT_NODE ? e.target : e.target?.parentElement;
    if (!target || target.closest?.(".ct-word-bubble,.ct-mini-lookup,.ct-selection-action,.ct-selection-result,.ct-float-toolbar")) return;
    const label = String(target.innerText || target.getAttribute?.("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const mayExpand = /show more|read more|see more|more replies|展开|显示更多|查看更多|全文/.test(label);
    if (!mayExpand) return;

    const region = target.closest?.("[data-testid='tweet'],article,[role='article'],main") || document.body;
    [80, 260, 700].forEach((delay) => {
      setTimeout(() => {
        markDynamicRoot(region);
        region.querySelectorAll?.(CONTENT_SELECTORS).forEach((el) => state.mutationRoots.add(el));
        scheduleDynamicFlush(30);
      }, delay);
    });
  }

  function extractSentence(node, word) {
    const block = node?.parentElement?.closest?.("p,li,blockquote,figcaption,h1,h2,h3,h4,h5,h6,td,th,[data-testid='tweetText'],div") || node?.parentElement;
    const text = (block?.innerText || node?.textContent || word).replace(/\s+/g, " ").trim();
    const idx = text.toLowerCase().indexOf(word.toLowerCase());
    if (idx < 0) return text.slice(0, 360);

    const before = text.slice(0, idx);
    const sentenceStart = Math.max(before.lastIndexOf(". "), before.lastIndexOf("? "), before.lastIndexOf("! "), before.lastIndexOf("。"), before.lastIndexOf("！"), before.lastIndexOf("？"));
    const left = sentenceStart >= 0 ? sentenceStart + (/[.!?]/.test(before[sentenceStart]) ? 2 : 1) : Math.max(0, idx - 160);
    const after = text.slice(idx + word.length);
    const endCandidates = [after.indexOf(". "), after.indexOf("? "), after.indexOf("! "), after.indexOf("。"), after.indexOf("！"), after.indexOf("？")].filter((x) => x >= 0);
    const right = endCandidates.length ? idx + word.length + Math.min(...endCandidates) + 1 : Math.min(text.length, idx + word.length + 260);
    return text.slice(left, right).trim().slice(0, 560);
  }

  async function openWordBubble({ word, sentence, rect }) {
    closeBubble();
    const bubble = document.createElement("div");
    bubble.className = "ct-word-bubble";
    bubble.innerHTML = `
      <div class="ct-bubble-loading">
        <div class="ct-spinner"></div>
        <div><strong>${escapeHtml(word)}</strong><span>正在理解这个语境…</span></div>
      </div>`;
    document.documentElement.appendChild(bubble);
    state.bubble = bubble;
    positionBubble(bubble, rect);

    try {
      const resp = await sendRuntime({
        type: "lookupWord",
        payload: { word, sentence, url: location.href, title: document.title, sourceType: isYouTube() ? "youtube" : "web" }
      });
      if (!state.bubble || state.bubble !== bubble) return;
      if (!resp?.ok) {
        bubble.innerHTML = `<div class="ct-bubble-error">${escapeHtml(resp?.error || "查询失败")}</div>`;
        return;
      }
      renderWordBubble(bubble, resp.result, sentence);
      positionBubble(bubble, rect);
    } catch (e) {
      if (state.bubble === bubble) bubble.innerHTML = `<div class="ct-bubble-error">${escapeHtml(e?.message || "查询失败")}</div>`;
    }
  }

  function renderWordBubble(bubble, data, sentence) {
    const collocations = (data.collocations || []).slice(0, 5).map((x) => `
      <span class="ct-chip">${renderLearnableText(x.text || "", x.text || "")}<small>${escapeHtml(x.meaning || "")}</small></span>`).join("");

    const currentExample = `
      <article class="ct-sense-row is-current">
        <div class="ct-sense-top"><span class="ct-sense-badge">当前语境</span><b>${escapeHtml(data.contextMeaning || data.coreMeaning || "")}</b></div>
        ${data.coreMeaning ? `<div class="ct-sense-note">${escapeHtml(data.coreMeaning)}</div>` : ""}
        <div class="ct-example-row">
          <button class="ct-speak-example" data-speak="${escapeAttr(sentence || "")}" title="朗读原句">🔊</button>
          <div><div class="ct-example-en">${renderLearnableText(sentence || "", sentence || "")}</div><div class="ct-example-zh">${escapeHtml(data.sentenceTranslation || "")}</div></div>
        </div>
      </article>`;

    const senseRows = (data.senseExamples || []).slice(0, 4).map((x) => `
      <article class="ct-sense-row">
        <div class="ct-sense-top"><b>${escapeHtml(x.sense || "")}</b>${x.note ? `<span>${escapeHtml(x.note)}</span>` : ""}</div>
        ${x.en ? `<div class="ct-example-row"><button class="ct-speak-example" data-speak="${escapeAttr(x.en)}" title="朗读例句">🔊</button><div><div class="ct-example-en">${renderLearnableText(x.en, x.en)}</div><div class="ct-example-zh">${escapeHtml(x.zh || "")}</div></div></div>` : ""}
      </article>`).join("");

    const fallbackRows = !senseRows ? (data.extendedSenses || []).slice(0, 3).map((x, i) => {
      const ex = (data.examples || [])[i] || {};
      return `<article class="ct-sense-row"><div class="ct-sense-top"><b>${escapeHtml(x.sense || "")}</b>${x.note ? `<span>${escapeHtml(x.note)}</span>` : ""}</div>${ex.en ? `<div class="ct-example-row"><button class="ct-speak-example" data-speak="${escapeAttr(ex.en)}" title="朗读例句">🔊</button><div><div class="ct-example-en">${renderLearnableText(ex.en, ex.en)}</div><div class="ct-example-zh">${escapeHtml(ex.zh || "")}</div></div></div>` : ""}</article>`;
    }).join("") : "";

    const formation = renderWordFormation(data.wordFormation);
    const learning = data.status === "learning";

    bubble.innerHTML = `
      <div class="ct-bubble-head">
        <div>
          <div class="ct-word-row"><strong>${escapeHtml(data.lemma || "")}</strong><span class="ct-pos">${escapeHtml(data.pos || "")}</span></div>
          <div class="ct-ipa">${escapeHtml(data.ipa || "")}</div>
        </div>
        <div class="ct-head-actions">
          <button class="ct-icon-btn" data-act="speak-word" title="单词发音">🔊</button>
          <button class="ct-icon-btn" data-act="close" title="关闭">×</button>
        </div>
      </div>

      <div class="ct-learning-hint">例句里的英文可 <b>单击</b>，或悬停约 ${Math.round(Number(state.settings?.hoverLookupDelay || 650) / 100) / 10} 秒，查看中文 + 音标。</div>

      <section class="ct-section-block">
        <div class="ct-section-title">词义 · 例句</div>
        <div class="ct-sense-list">${currentExample}${senseRows || fallbackRows}</div>
      </section>

      ${formation}
      ${collocations ? `<section class="ct-section-block"><div class="ct-section-title">常见搭配</div><div class="ct-chips">${collocations}</div></section>` : ""}

      <div class="ct-bubble-foot">
        <span data-role="encounter-status">已遇见 ${Number(data.encounterCount || 1)} 次 · 已记录这个场景</span>
        <button class="ct-learning-btn ${learning ? "is-learning" : ""}" data-act="learning">${learning ? "✓ 正在学习" : "加入学习"}</button>
      </div>`;

    bubble.addEventListener("click", async (e) => {
      const closeBtn = e.target.closest("[data-act='close']");
      if (closeBtn) return closeBubble();

      const speakWordBtn = e.target.closest("[data-act='speak-word']");
      if (speakWordBtn) return speakText(data.lemma || "");

      const speakExampleBtn = e.target.closest("[data-speak]");
      if (speakExampleBtn) return speakText(speakExampleBtn.dataset.speak || "");

      const token = e.target.closest(".ct-learnable");
      if (token) {
        e.preventDefault();
        clearTimeout(state.hoverTimer);
        await showMiniLookup(token, token.dataset.context || sentence || "", true);
        return;
      }

      const learningBtn = e.target.closest("[data-act='learning']");
      if (learningBtn) {
        learningBtn.disabled = true;
        const wasLearning = learningBtn.classList.contains("is-learning");
        const next = wasLearning ? "encountered" : "learning";
        const original = learningBtn.textContent;
        learningBtn.textContent = "保存中…";
        try {
          const resp = await sendRuntime({ type: "setVocabStatus", key: data.key, status: next });
          if (!resp?.ok) throw new Error(resp?.error || "保存失败");
          const on = next === "learning";
          data.status = next;
          learningBtn.classList.toggle("is-learning", on);
          learningBtn.textContent = on ? "✓ 正在学习" : "加入学习";
          showToast(on ? "已加入学习" : "已移出学习");
        } catch (err) {
          learningBtn.textContent = original;
          showToast(err?.message || "保存失败");
        } finally {
          learningBtn.disabled = false;
        }
      }
    });

    bubble.addEventListener("mouseover", (e) => {
      if (state.settings?.hoverLookup === false) return;
      const token = e.target.closest(".ct-learnable");
      if (!token || token.contains(e.relatedTarget)) return;
      clearTimeout(state.hoverTimer);
      clearTimeout(state.hoverHideTimer);
      state.hoverTimer = setTimeout(() => showMiniLookup(token, token.dataset.context || sentence || "", false), Number(state.settings?.hoverLookupDelay || 650));
    });

    bubble.addEventListener("mouseout", (e) => {
      const token = e.target.closest(".ct-learnable");
      if (!token || token.contains(e.relatedTarget)) return;
      clearTimeout(state.hoverTimer);
      state.hoverHideTimer = setTimeout(closeMiniLookup, 900);
    });
  }

  function renderWordFormation(formation) {
    if (!formation || formation.available === false || !Array.isArray(formation.parts) || !formation.parts.length) return "";
    const parts = formation.parts.slice(0, 5).map((p) => `
      <div class="ct-morph-part"><b>${escapeHtml(p.part || "")}</b><span>${escapeHtml(p.type || "")}</span><small>${escapeHtml(p.meaning || "")}</small></div>`).join("");
    return `<section class="ct-section-block"><div class="ct-section-title">构词拆解</div><div class="ct-morph-flow">${parts}</div>${formation.explanation ? `<div class="ct-formation-note">${escapeHtml(formation.explanation)}</div>` : ""}</section>`;
  }

  function renderLearnableText(text, context) {
    const input = String(text || "");
    const pieces = input.split(/([A-Za-z]+(?:['’][A-Za-z]+)?)/g);
    return pieces.map((piece) => {
      if (/^[A-Za-z]+(?:['’][A-Za-z]+)?$/.test(piece)) {
        return `<span class="ct-learnable" data-word="${escapeAttr(piece)}" data-context="${escapeAttr(context || input)}">${escapeHtml(piece)}</span>`;
      }
      return escapeHtml(piece);
    }).join("");
  }

  async function showMiniLookup(tokenEl, sentence, immediate) {
    if (!tokenEl?.isConnected) return;
    const word = tokenEl.dataset.word || tokenEl.textContent || "";
    if (!word) return;

    closeMiniLookup();
    const mini = document.createElement("div");
    mini.className = "ct-mini-lookup";
    mini.innerHTML = `<div class="ct-mini-loading"><span class="ct-mini-dot"></span><b>${escapeHtml(word)}</b><span>查询中…</span></div>`;
    document.documentElement.appendChild(mini);
    state.miniLookup = mini;
    positionMiniLookup(mini, tokenEl.getBoundingClientRect());

    try {
      const resp = await sendRuntime({ type: "lookupMiniWord", payload: { word, sentence } });
      if (state.miniLookup !== mini) return;
      if (!resp?.ok) throw new Error(resp?.error || "查询失败");
      const d = resp.result || {};
      mini.innerHTML = `
        <div class="ct-mini-head"><b>${escapeHtml(d.lemma || word)}</b><span>${escapeHtml(d.pos || "")}</span><button data-mini-speak="${escapeAttr(d.lemma || word)}" title="发音">🔊</button></div>
        <div class="ct-mini-ipa">${escapeHtml(d.ipa || "")}</div>
        <div class="ct-mini-meaning">${escapeHtml(d.meaning || "")}</div>`;
      mini.querySelector("[data-mini-speak]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        speakText(e.currentTarget.dataset.miniSpeak || word);
      });
      positionMiniLookup(mini, tokenEl.getBoundingClientRect());
      if (!immediate) state.hoverHideTimer = setTimeout(closeMiniLookup, 2200);
    } catch (e) {
      if (state.miniLookup === mini) mini.innerHTML = `<div class="ct-mini-error">${escapeHtml(e?.message || "查询失败")}</div>`;
    }
  }

  function positionMiniLookup(mini, rect) {
    const margin = 10;
    const width = Math.min(290, window.innerWidth - margin * 2);
    mini.style.width = `${width}px`;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    mini.style.left = `${left}px`;
    mini.style.top = `${Math.max(margin, rect.bottom + 8)}px`;
    requestAnimationFrame(() => {
      if (!mini.isConnected) return;
      const r = mini.getBoundingClientRect();
      if (r.bottom > window.innerHeight - margin && rect.top > r.height + 12) mini.style.top = `${rect.top - r.height - 8}px`;
    });
  }

  function closeMiniLookup() {
    clearTimeout(state.hoverTimer);
    clearTimeout(state.hoverHideTimer);
    state.miniLookup?.remove();
    state.miniLookup = null;
  }

  function speakText(text) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.settings?.pronunciationLocale || "en-US";
    u.rate = text.split(/\s+/).length > 3 ? 0.92 : 0.88;
    window.speechSynthesis.speak(u);
  }

  function closeBubble() {
    hidePairPeek();
    closeMiniLookup();
    state.bubble?.remove();
    state.bubble = null;
  }

  function positionBubble(bubble, rect) {
    const margin = 12;
    const width = Math.min(520, window.innerWidth - margin * 2);
    bubble.style.width = `${width}px`;
    const leftBase = rect.left + window.scrollX + rect.width / 2 - width / 2;
    bubble.style.left = `${Math.max(window.scrollX + margin, Math.min(leftBase, window.scrollX + window.innerWidth - width - margin))}px`;
    bubble.style.top = `${rect.bottom + window.scrollY + 10}px`;
    requestAnimationFrame(() => {
      if (!bubble.isConnected) return;
      const r = bubble.getBoundingClientRect();
      if (r.bottom > window.innerHeight - margin && rect.top > Math.min(r.height, window.innerHeight * 0.72) + margin) {
        const maxHeight = Math.min(r.height, window.innerHeight - margin * 2);
        bubble.style.top = `${rect.top + window.scrollY - maxHeight - 10}px`;
      }
    });
  }

  function syncToolbarVisibility() {
    const show = state.settings?.floatingToolbar !== false;
    if (!show) {
      state.toolbar?.remove();
      state.toolbar = null;
      return;
    }
    ensureToolbar();
    updateToolbar();
  }

  function ensureToolbar() {
    if (state.toolbar?.isConnected) return state.toolbar;
    const wrap = document.createElement("div");
    wrap.className = "ct-float-toolbar";
    wrap.innerHTML = `
      <button class="ct-float-trigger" data-float="toggle-panel" title="沉浸式翻译&学习">译</button>
      <div class="ct-float-panel">
        <div class="ct-float-head"><div><b>沉浸式翻译&学习</b><span data-float-status>未开启</span></div><button data-float="collapse" title="收起">×</button></div>
        <button class="ct-float-primary" data-float="toggle-translation">开始翻译</button>
        <div class="ct-float-seg ct-layer-seg"><button data-layer="displayOriginal">原文</button><button data-layer="outputEnglish">EN</button><button data-layer="outputChinese">中文</button></div>
        <div class="ct-float-actions"><button data-float="rescan">补漏扫描</button><button data-float="vocab">场景词库</button><button data-float="settings">设置</button><button data-float="reload">重载扩展</button></div>
        <div class="ct-float-tip">网页英文可直接悬停/单击拾词；双击展开完整学习卡。</div>
      </div>`;
    document.documentElement.appendChild(wrap);
    state.toolbar = wrap;

    wrap.addEventListener("click", async (e) => {
      const layerBtn = e.target.closest("[data-layer]");
      if (layerBtn) {
        const key = layerBtn.dataset.layer;
        const current = key === "displayOriginal"
          ? state.settings?.displayOriginal !== false
          : key === "outputEnglish"
            ? state.settings?.outputEnglish === true
            : state.settings?.outputChinese !== false;
        state.settings[key] = !current;
        if (!state.settings.displayOriginal && !state.settings.outputEnglish && !state.settings.outputChinese) {
          state.settings.outputChinese = true;
        }
        const anchor = captureViewportAnchor();
        const enablingNewLayer =
          (key === "outputEnglish" && state.settings.outputEnglish === true) ||
          (key === "outputChinese" && state.settings.outputChinese !== false);
        await sendRuntime({ type: "saveSettings", settings: {
          displayOriginal: state.settings.displayOriginal !== false,
          outputEnglish: state.settings.outputEnglish === true,
          outputChinese: state.settings.outputChinese !== false
        } }).catch(() => {});
        applyMode();
        if (enablingNewLayer) queueLayerRefresh();
        restoreViewportAnchor(anchor);
        processQueue();
        return;
      }
      const btn = e.target.closest("[data-float]");
      if (!btn) return;
      const act = btn.dataset.float;
      if (act === "toggle-panel") return wrap.classList.toggle("is-open");
      if (act === "collapse") return wrap.classList.remove("is-open");
      if (act === "toggle-translation") {
        if (state.enabled) {
          await setSiteTranslationPreference(false);
          disableTranslation();
        } else {
          await setSiteTranslationPreference(true);
          await enableTranslation(true);
        }
        return;
      }
      if (act === "rescan") {
        forceMissingScan();
        return;
      }
      if (act === "settings") return sendRuntime({ type: "openExtensionPage", hash: "reading" });
      if (act === "vocab") return sendRuntime({ type: "openExtensionPage", hash: "vocab" });
      if (act === "reload") return sendRuntime({ type: "reloadExtension" });
    });
    return wrap;
  }

  function updateToolbar() {
    const wrap = state.toolbar;
    if (!wrap?.isConnected) return;
    const status = wrap.querySelector("[data-float-status]");
    const toggle = wrap.querySelector("[data-float='toggle-translation']");
    const trigger = wrap.querySelector(".ct-float-trigger");
    const count = document.querySelectorAll(".ct-translation[data-ready='1'],[data-ct-kind='ui'][data-ct-done='1']").length;
    state.translatedCount = count;

    let label = "未开启";
    if (state.enabled && state.processing) label = `翻译中 · ${count} 段`;
    else if (state.enabled && state.lastError) label = `需重试 · ${count} 段`;
    else if (state.enabled) label = `已开启 · ${count} 段`;
    if (status) status.textContent = label;
    if (toggle) toggle.textContent = state.enabled ? (state.lastError ? "重试翻译" : "暂停翻译") : "开始翻译";
    trigger?.classList.toggle("is-active", state.enabled);
    wrap.querySelectorAll("[data-layer]").forEach((b) => {
      const key = b.dataset.layer;
      const active = key === "displayOriginal"
        ? state.settings?.displayOriginal !== false
        : key === "outputEnglish"
          ? state.settings?.outputEnglish === true
          : state.settings?.outputChinese !== false;
      b.classList.toggle("active", active);
    });
  }

  function showToast(text) {
    let t = document.querySelector(".ct-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "ct-toast";
      document.documentElement.appendChild(t);
    }
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(t.__timer);
    t.__timer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  function isYouTube() {
    return /(^|\.)youtube\.com$/.test(location.hostname);
  }

  async function sendRuntime(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (e) {
      const msg = String(e?.message || "");
      if (/Extension context invalidated|Receiving end does not exist|Could not establish connection/i.test(msg)) {
        showReloadRequired();
        throw new Error("扩展刚刚更新，请刷新当前网页后继续");
      }
      throw new Error(msg || "扩展通信失败，请刷新页面后重试");
    }
  }

  function showReloadRequired() {
    if (document.querySelector(".ct-reload-required")) return;
    const box = document.createElement("div");
    box.className = "ct-reload-required";
    box.innerHTML = `<b>沉浸式翻译&学习 已更新</b><span>当前网页还在运行旧版本。</span><button type="button">立即刷新</button>`;
    box.querySelector("button").addEventListener("click", () => location.reload());
    document.documentElement.appendChild(box);
  }

  function escapeHtml(text) {
    const d = document.createElement("div");
    d.textContent = String(text ?? "");
    return d.innerHTML;
  }

  function escapeAttr(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }
})();
