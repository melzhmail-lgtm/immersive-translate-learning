const DEFAULTS = {
  provider: "deepseek",
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  targetLanguage: "zh-CN",
  sourceLanguage: "auto",
  translationMode: "bilingual",
  displayOriginal: true,
  outputEnglish: false,
  outputChinese: true,
  pronunciationLocale: "en-US",
  autoTranslate: false,
  autoTranslateEnglish: true,
  translateVisibleOnly: true,
  maxBatchChars: 3600,
  cacheEnabled: true,
  floatingToolbar: true,
  translateUi: true,
  hoverLookup: true,
  globalWordLookup: true,
  hoverLookupDelay: 650,
  servicePool: [],
  serviceTimeoutMs: 18000
};

const SERVICE_PRESETS = {
  deepseek: { kind: "llm-openai", name: "DeepSeek", endpointUrl: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat" },
  openai: { kind: "llm-openai", name: "OpenAI", endpointUrl: "https://api.openai.com/v1/chat/completions", model: "" },
  qwen: { kind: "llm-openai", name: "Qwen / 通义千问", endpointUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-flash" },
  glm: { kind: "llm-openai", name: "智谱 GLM", endpointUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4-flash" },
  doubao: { kind: "llm-openai", name: "豆包 / 火山方舟", endpointUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", model: "" },
  siliconflow: { kind: "llm-openai", name: "SiliconFlow / 硅基流动", endpointUrl: "https://api.siliconflow.cn/v1/chat/completions", model: "" },
  openrouter: { kind: "llm-openai", name: "OpenRouter", endpointUrl: "https://openrouter.ai/api/v1/chat/completions", model: "" },
  gemini: { kind: "llm-gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com", model: "" },
  anthropic: { kind: "llm-anthropic", name: "Anthropic Claude", baseUrl: "https://api.anthropic.com", model: "" },
  custom: { kind: "llm-openai", name: "OpenAI-Compatible", endpointUrl: "", model: "" },
  deepl: { kind: "nmt-deepl", name: "DeepL API", baseUrl: "https://api-free.deepl.com", modelType: "latency_optimized" },
  aliyun: { kind: "nmt-aliyun", name: "阿里云机器翻译", endpointUrl: "https://mt.cn-hangzhou.aliyuncs.com/", region: "cn-hangzhou" },
  volc: { kind: "nmt-volc", name: "火山引擎机器翻译", endpointUrl: "https://translate.volcengineapi.com/", region: "cn-north-1" },
  tencent: { kind: "nmt-tencent", name: "腾讯云机器翻译（兼容接口）", endpointUrl: "https://tmt.tencentcloudapi.com/", region: "ap-guangzhou", action: "TextTranslate", version: "2018-03-21" }
};

function newServiceFromPreset(preset, overrides = {}) {
  const base = SERVICE_PRESETS[preset] || SERVICE_PRESETS.custom;
  return {
    id: overrides.id || crypto.randomUUID(),
    preset,
    kind: base.kind,
    name: base.name,
    enabled: true,
    apiKey: "",
    secretKey: "",
    accessKeyId: "",
    accessKeySecret: "",
    secretId: "",
    endpointUrl: base.endpointUrl || "",
    baseUrl: base.baseUrl || "",
    model: base.model || "",
    modelType: base.modelType || "",
    region: base.region || "",
    action: base.action || "",
    version: base.version || "",
    timeoutMs: 18000,
    ...overrides
  };
}

function normalizeServicePool(settings) {
  const raw = Array.isArray(settings?.servicePool) ? settings.servicePool : [];
  if (raw.length) return raw.map((x) => ({ ...newServiceFromPreset(x?.preset || kindToPreset(x?.kind), {}), ...x, enabled: x?.enabled !== false }));
  const legacyProvider = String(settings?.provider || "deepseek");
  const preset = ["deepseek","openai","gemini","anthropic","custom"].includes(legacyProvider) ? legacyProvider : "custom";
  const migrated = newServiceFromPreset(preset, {
    name: preset === "custom" ? "原有自定义接口" : (SERVICE_PRESETS[preset]?.name || legacyProvider),
    apiKey: String(settings?.apiKey || ""),
    baseUrl: String(settings?.baseUrl || SERVICE_PRESETS[preset]?.baseUrl || ""),
    endpointUrl: preset === "custom" ? legacyEndpoint(settings) : (SERVICE_PRESETS[preset]?.endpointUrl || ""),
    model: String(settings?.model || SERVICE_PRESETS[preset]?.model || "")
  });
  return [migrated];
}

function legacyEndpoint(settings) {
  const base = String(settings?.baseUrl || "").replace(/\/+$/, "");
  if (!base) return "";
  return base.endsWith("/chat/completions") ? base : (base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`);
}

function kindToPreset(kind) {
  if (kind === "llm-gemini") return "gemini";
  if (kind === "llm-anthropic") return "anthropic";
  if (kind === "nmt-deepl") return "deepl";
  if (kind === "nmt-aliyun") return "aliyun";
  if (kind === "nmt-volc") return "volc";
  if (kind === "nmt-tencent") return "tencent";
  return "custom";
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (current[key] === undefined) patch[key] = value;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  await ensureContextMenu();
});

async function ensureContextMenu() {
  if (!chrome.contextMenus) return;
  await new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
  chrome.contextMenus.create({
    id: "context-translate-selection",
    title: "翻译选中内容",
    contexts: ["selection"]
  });
}

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "context-translate-selection" || !info.selectionText || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, {
    type: "showContextTranslation",
    text: info.selectionText
  }).catch(() => {});
});

// Unpacked extensions are often refreshed with the browser's "Reload" button.
// Create the menu on service-worker startup too, so right-click translation is
// available even when Chrome does not emit an install/update event.
ensureContextMenu().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "translateBatch":
      return translateBatch(message.items || [], message.meta || {});
    case "lookupWord":
      return lookupWord(message.payload || {});
    case "lookupMiniWord":
      return lookupMiniWord(message.payload || {});
    case "translateSelection":
      return translateSelection(message.payload || {});
    case "saveSelectionVocab":
      return saveSelectionVocab(message.payload || {});
    case "setVocabStatus":
      return setVocabStatus(message.key, message.status);
    case "getSettings":
      return getSettings();
    case "saveSettings": {
      const next = { ...(message.settings || {}) };
      if (Array.isArray(next.servicePool)) next.servicePool = normalizeServicePool({ servicePool: next.servicePool });
      await chrome.storage.local.set(next);
      return getSettings();
    }
    case "testService":
      return testService(message.service || {});
    case "getVocab":
      return getVocab();
    case "deleteVocab":
      return deleteVocab(message.key);
    case "clearVocab":
      await chrome.storage.local.set({ vocabStore: {} });
      return true;
    case "reloadExtension":
      setTimeout(() => chrome.runtime.reload(), 80);
      return true;
    case "openExtensionPage": {
      const hash = String(message.hash || "").replace(/[^a-z-]/gi, "");
      await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash ? `#${hash}` : ""}`) });
      return true;
    }
    default:
      throw new Error("Unknown message type");
  }
}

async function getSettings() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const merged = { ...DEFAULTS, ...data };
  merged.servicePool = normalizeServicePool(merged);
  return merged;
}

async function translateBatch(items, meta) {
  if (!items.length) return [];
  const settings = await getSettings();
  requireProviderReady(settings, "translation");

  const cacheResult = await chrome.storage.local.get("translationCache");
  const store = cacheResult.translationCache || {};
  const results = new Array(items.length);
  const missing = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const segments = normalizeIncomingSegments(item);
    const sourceLang = String(item.sourceLang || detectSourceLanguage(item.text || segments.map((x) => x.source).join(" ")));
    item.sourceLang = sourceLang;
    const targetSignature = segments.map((seg) => requestedTargetsForSource(settings, seg.source, sourceLang)).join("|");
    const cacheKey = await stableHash(
      `seg-v7|${servicePoolSignature(settings)}|${settings.displayOriginal !== false}|${settings.outputEnglish === true}|${settings.outputChinese !== false}|${settings.targetLanguage}|${item.kind || "content"}|${targetSignature}|${JSON.stringify(segments)}`
    );
    const cached = settings.cacheEnabled ? store[cacheKey] : null;
    if (cached?.segments?.length === segments.length && cachedSegmentsComplete(cached.segments, segments, settings, sourceLang)) {
      results[i] = { id: item.id, text: cached.text || "", segments: cached.segments, cached: true };
    } else {
      missing.push({ ...item, index: i, cacheKey, segments });
    }
  }

  const unitsByTarget = new Map();
  for (const item of missing) {
    item.segments.forEach((seg, segIndex) => {
      for (const target of requestedTargetsForSource(settings, seg.source, item.sourceLang)) {
        if (!unitsByTarget.has(target)) unitsByTarget.set(target, []);
        unitsByTarget.get(target).push({
          uid: `${item.id}::${segIndex}::${target}`,
          itemId: String(item.id),
          segIndex,
          source: seg.source,
          kind: item.kind || "content",
          target
        });
      }
    });
  }

  const translatedUnits = new Map();

  for (const [target, units] of unitsByTarget.entries()) {
    for (let offset = 0; offset < units.length;) {
      const chunk = [];
      let chars = 0;
      while (offset < units.length && chunk.length < 10) {
        const unit = units[offset];
        if (chunk.length && chars + unit.source.length > 1900) break;
        chunk.push(unit);
        chars += unit.source.length;
        offset++;
      }
      if (!chunk.length) chunk.push(units[offset++]);

      let map = new Map();
      try {
        map = await translateSegmentChunk(settings, chunk, target);
      } catch (_) {
        // Missing/malformed batch results are recovered by individual retries.
      }

      for (const unit of chunk) {
        let translated = map.get(unit.uid) || null;
        let targetText = String(translated?.text || "").trim();

        if (!isSegmentComplete(unit.source, targetText, target, unit.kind)) {
          translated = await translateSingleSegment(settings, unit, target);
          targetText = String(translated?.text || "").trim();
        }
        if (!isSegmentComplete(unit.source, targetText, target, unit.kind)) {
          translated = await translateSingleSegment(settings, unit, target, true);
          targetText = String(translated?.text || "").trim();
        }
        if (!isSegmentComplete(unit.source, targetText, target, unit.kind)) {
          throw new Error(`模型没有完整翻译这一句：${unit.source.slice(0, 48)}${unit.source.length > 48 ? "…" : ""}`);
        }

        translatedUnits.set(unit.uid, {
          text: targetText,
          alignments: normalizeAlignments(unit.source, targetText, translated?.alignments)
        });
      }
    }
  }

  for (const item of missing) {
    const translatedSegments = item.segments.map((seg, segIndex) => {
      const translations = {};
      const targets = requestedTargetsForSource(settings, seg.source, item.sourceLang);
      for (const target of targets) {
        const translated = translatedUnits.get(`${item.id}::${segIndex}::${target}`) || {};
        const targetText = String(translated.text || "").trim();
        if (!targetText) throw new Error(`模型未返回完整译文：${item.id}`);
        translations[target] = {
          target: targetText,
          alignments: Array.isArray(translated.alignments) ? translated.alignments : []
        };
      }

      const preferred = preferredTranslation(translations);
      return {
        source: seg.source,
        paragraph: Number.isFinite(Number(seg.paragraph)) ? Number(seg.paragraph) : 0,
        translations,
        target: preferred?.target || "",
        alignments: preferred?.alignments || []
      };
    });

    const text = translatedSegments.map((seg) => seg.target).filter(Boolean).join("\n");
    results[item.index] = { id: item.id, text, segments: translatedSegments, cached: false };
    if (settings.cacheEnabled) {
      store[item.cacheKey] = { text, segments: translatedSegments, t: Date.now(), url: meta.url || "" };
    }
  }

  if (settings.cacheEnabled) {
    pruneObject(store, 4200);
    await chrome.storage.local.set({ translationCache: store });
  }
  return results;
}

function cachedSegmentsComplete(cachedSegments, sourceSegments, settings, sourceLang = "") {
  if (!Array.isArray(cachedSegments) || cachedSegments.length !== sourceSegments.length) return false;
  return cachedSegments.every((cached, idx) => {
    const source = sourceSegments[idx]?.source || "";
    if (String(cached?.source || "") !== source) return false;
    const targets = requestedTargetsForSource(settings, source, sourceLang);
    return targets.every((target) => String(cached?.translations?.[target]?.target || "").trim());
  });
}

function preferredTranslation(translations) {
  if (!translations || typeof translations !== "object") return null;
  const zhKey = Object.keys(translations).find((k) => k.startsWith("zh"));
  if (zhKey) return translations[zhKey];
  if (translations.en) return translations.en;
  const first = Object.keys(translations)[0];
  return first ? translations[first] : null;
}

function requestedTargetsForSource(settings, source, sourceLangHint = "") {
  const lang = sourceLangHint || detectSourceLanguage(source);
  const targets = [];
  const chineseTarget = String(settings.targetLanguage || "zh-CN").startsWith("zh")
    ? String(settings.targetLanguage || "zh-CN")
    : "zh-CN";

  if (settings.outputEnglish === true && lang !== "en") targets.push("en");
  if (settings.outputChinese !== false && lang !== "zh") targets.push(chineseTarget);
  return [...new Set(targets)];
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

function normalizeIncomingSegments(item) {
  const supplied = Array.isArray(item?.segments) ? item.segments : [];
  const clean = supplied
    .map((x, index) => ({
      source: String(typeof x === "string" ? x : x?.source || "").trim(),
      paragraph: Number.isFinite(Number(x?.paragraph)) ? Number(x.paragraph) : 0,
      index
    }))
    .filter((x) => x.source);
  if (clean.length) return clean.map(({ source, paragraph }) => ({ source, paragraph }));
  return segmentSourceTextDetailed(String(item?.text || ""));
}

function segmentSourceTextDetailed(text) {
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
    if (/^(?:[A-Ha-h]|\d{1,2})[.)、．]\s+\S/.test(paragraph)) {
      splitLongSegment(paragraph, pieces);
    } else {
      const sentenceMatches = paragraph.match(/[^.!?。！？]+(?:[.!?。！？]+["'’”）)]*)?|[^.!?。！？]+$/g) || [paragraph];
      for (const sentence of sentenceMatches) splitLongSegment(sentence.trim(), pieces);
    }
    pieces.filter(Boolean).forEach((source) => out.push({ source, paragraph: paragraphIndex }));
  });
  return out;
}

function segmentSourceText(text) {
  const normalized = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return [];

  const out = [];
  for (const paragraph of normalized.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
    const sentenceMatches = paragraph.match(/[^.!?。！？]+(?:[.!?。！？]+["'’”）)]*)?|[^.!?。！？]+$/g) || [paragraph];
    for (const sentence of sentenceMatches) {
      splitLongSegment(sentence.trim(), out);
    }
  }
  return out.filter(Boolean);
}

function splitLongSegment(text, out) {
  const value = String(text || "").trim();
  if (!value) return;
  if (value.length <= 280) {
    out.push(value);
    return;
  }

  let rest = value;
  while (rest.length > 280) {
    const window = rest.slice(0, 280);
    let cut = Math.max(window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(", "), window.lastIndexOf("；"), window.lastIndexOf("，"));
    if (cut < 120) cut = window.lastIndexOf(" ");
    if (cut < 120) cut = 280;
    else cut += 1;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
}

async function translateSegmentChunk(settings, chunk, target) {
  return translateChunkWithServicePool(settings, chunk, target);
}

async function translateSingleSegment(settings, unit, target, finalAttempt = false) {
  const map = await translateChunkWithServicePool(settings, [unit], target, { single: true, finalAttempt });
  return map.get(unit.uid) || { text: "", alignments: [] };
}

function normalizeAlignments(source, target, raw) {
  if (!Array.isArray(raw)) return [];
  const sourceText = String(source || "");
  const targetText = String(target || "");
  const result = [];
  let sourceCursor = 0;
  let targetCursor = 0;

  for (const item of raw.slice(0, 36)) {
    const s = String(item?.source || "").replace(/\s+/g, " ").trim();
    const t = String(item?.target || "").replace(/\s+/g, " ").trim();
    if (!s || !t) continue;

    let sIndex = sourceText.indexOf(s, sourceCursor);
    if (sIndex < 0) sIndex = sourceText.toLowerCase().indexOf(s.toLowerCase(), sourceCursor);
    if (sIndex < 0) sIndex = sourceText.toLowerCase().indexOf(s.toLowerCase());
    if (sIndex < 0) continue;

    let tIndex = targetText.indexOf(t, targetCursor);
    if (tIndex < 0) tIndex = targetText.indexOf(t);
    if (tIndex < 0) continue;

    result.push({ source: s, target: t });
    sourceCursor = Math.max(sourceCursor, sIndex + s.length);
    targetCursor = Math.max(targetCursor, tIndex + t.length);
  }

  return result;
}

function charsOfSegments(items) {
  return items.reduce((n, x) => n + String(x.source || "").length, 0);
}

function isSegmentComplete(source, translated, target = "", kind = "content") {
  const s = String(source || "").trim();
  const t = String(translated || "").trim();
  if (!s || !t) return false;
  if (kind === "ui") return t.length >= 1;

  if (String(target).startsWith("zh") && /[A-Za-z]/.test(s) && s.length > 12) {
    if (!/[\u3400-\u9fff]/.test(t)) return false;
  }
  if (target === "en" && /[\u0600-\u06ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(s) && s.length > 8) {
    if (!/[A-Za-z]/.test(t)) return false;
  }

  if (s.length <= 20) return t.length >= 2;
  const ratio = String(target).startsWith("zh") ? 0.22 : (target === "en" ? 0.34 : 0.2);
  if (t.length < Math.max(4, Math.floor(s.length * ratio))) return false;

  // For a full prose sentence, a missing terminal mark is a useful truncation signal.
  // Do not apply this to short labels or clause fragments.
  if (s.length >= 55 && /[.!?。！？]["'’”）)]*$/.test(s)) {
    if (!/[.!?。！？]["'’”）)]*$/.test(t)) return false;
  }
  return true;
}

async function lookupWord(payload) {
  const settings = await getSettings();
  requireProviderReady(settings, "structured");
  const word = String(payload.word || "").trim();
  const sentence = String(payload.sentence || "").trim();
  if (!word) throw new Error("没有可查询的单词");

  const system = `You are an English vocabulary tutor embedded in a reading tool. The learner studies English from the exact real-world context they encountered. Return JSON only.
Required schema:
{
  "lemma":"dictionary base form",
  "ipa":"American English IPA",
  "pos":"part of speech",
  "contextMeaning":"short Chinese meaning that fits the supplied sentence",
  "coreMeaning":"one concise Chinese explanation of the core sense",
  "sentenceTranslation":"natural Chinese translation of the supplied sentence",
  "senseExamples":[
    {"sense":"another useful Chinese meaning","note":"short usage note","en":"natural English example","zh":"Chinese translation"}
  ],
  "collocations":[{"text":"English collocation","meaning":"Chinese meaning"}],
  "wordFormation":{
    "available":true,
    "parts":[{"part":"prefix/root/suffix","type":"prefix|root|suffix|stem","meaning":"concise Chinese meaning"}],
    "explanation":"one short Chinese explanation"
  }
}
Rules:
1. The current-context meaning and the supplied sentence are the priority.
2. Give 2-4 genuinely useful additional senses. Every additional sense MUST have its own example sentence immediately paired with it.
3. Give 3-5 useful collocations.
4. For wordFormation, only decompose the word when the morphology/etymology is linguistically defensible and helpful to a learner. Never invent or force a root split. If uncertain, return {"available":false,"parts":[],"explanation":""}.
5. If the selected form is inflected, lemma must be the dictionary base form.
6. Keep explanations concise and practical. Return valid JSON only.`;

  const user = JSON.stringify({ word, sentence, title: payload.title || "", url: payload.url || "" });
  const raw = await callProvider(settings, system, user, { temperature: 0.15, maxTokens: 1500 });
  const data = parseJsonObject(raw);

  data.lemma = String(data.lemma || word).trim();
  data.ipa = String(data.ipa || "").trim();
  data.pos = String(data.pos || "").trim();
  data.contextMeaning = String(data.contextMeaning || "").trim();
  data.coreMeaning = String(data.coreMeaning || "").trim();
  data.sentenceTranslation = String(data.sentenceTranslation || "").trim();
  data.senseExamples = Array.isArray(data.senseExamples) ? data.senseExamples.slice(0, 4).map((x) => ({
    sense: String(x?.sense || "").trim(),
    note: String(x?.note || "").trim(),
    en: String(x?.en || "").trim(),
    zh: String(x?.zh || "").trim()
  })).filter((x) => x.sense || x.en) : [];
  data.collocations = Array.isArray(data.collocations) ? data.collocations.slice(0, 6).map((x) => ({
    text: String(x?.text || "").trim(),
    meaning: String(x?.meaning || "").trim()
  })).filter((x) => x.text) : [];
  data.wordFormation = normalizeWordFormation(data.wordFormation);

  // 向后兼容 V0.1 数据结构，方便旧词库继续显示。
  data.extendedSenses = data.senseExamples.map((x) => ({ sense: x.sense, note: x.note }));
  data.examples = data.senseExamples.filter((x) => x.en).map((x) => ({ en: x.en, zh: x.zh }));

  const key = normalizeKey(data.lemma || word);
  const all = await getVocab();
  const entry = all[key] || {
    key,
    lemma: data.lemma || word,
    ipa: data.ipa,
    pos: data.pos,
    coreMeaning: data.coreMeaning,
    senseExamples: data.senseExamples,
    extendedSenses: data.extendedSenses,
    collocations: data.collocations,
    examples: data.examples,
    wordFormation: data.wordFormation,
    status: "encountered",
    firstSeenAt: Date.now(),
    encounters: []
  };

  entry.lemma = data.lemma || entry.lemma;
  entry.ipa = data.ipa || entry.ipa;
  entry.pos = data.pos || entry.pos;
  entry.coreMeaning = data.coreMeaning || entry.coreMeaning;
  entry.senseExamples = data.senseExamples?.length ? data.senseExamples : (entry.senseExamples || []);
  entry.extendedSenses = data.extendedSenses?.length ? data.extendedSenses : (entry.extendedSenses || []);
  entry.collocations = data.collocations?.length ? data.collocations : (entry.collocations || []);
  entry.examples = data.examples?.length ? data.examples : (entry.examples || []);
  entry.wordFormation = data.wordFormation?.available ? data.wordFormation : (entry.wordFormation || data.wordFormation);
  entry.lastSeenAt = Date.now();
  entry.encounters = Array.isArray(entry.encounters) ? entry.encounters : [];

  const encounter = {
    id: crypto.randomUUID(),
    word,
    sentence,
    sentenceTranslation: data.sentenceTranslation,
    contextMeaning: data.contextMeaning,
    url: payload.url || "",
    title: payload.title || "",
    sourceType: payload.sourceType || "web",
    speaker: payload.speaker || "",
    timestamp: payload.timestamp ?? null,
    createdAt: Date.now()
  };
  const duplicate = entry.encounters.some((e) => e.url === encounter.url && e.sentence === encounter.sentence && e.word === encounter.word);
  if (!duplicate) entry.encounters.unshift(encounter);
  entry.encounters = entry.encounters.slice(0, 30);

  all[key] = entry;
  await chrome.storage.local.set({ vocabStore: all });
  return { ...data, key, status: entry.status, encounterCount: entry.encounters.length };
}

async function lookupMiniWord(payload) {
  const settings = await getSettings();
  requireProviderReady(settings, "structured");
  const word = String(payload.word || "").trim();
  const sentence = String(payload.sentence || "").trim().slice(0, 520);
  if (!word) throw new Error("没有可查询的单词");

  const cacheResult = await chrome.storage.local.get("miniWordCache");
  const cache = cacheResult.miniWordCache || {};
  const cacheKey = await stableHash(`${servicePoolSignature(settings, "structured")}|${word.toLowerCase()}|${sentence}`);
  if (cache[cacheKey]?.data) return cache[cacheKey].data;

  const system = `You are a compact English dictionary tooltip. Return JSON only with exactly:
{"lemma":"base form","ipa":"American English IPA","pos":"part of speech","meaning":"concise Chinese meaning in this sentence"}
Use the supplied sentence to resolve the correct sense. Keep meaning under 28 Chinese characters when possible.`;
  const user = JSON.stringify({ word, sentence });
  const raw = await callProvider(settings, system, user, { temperature: 0.1, maxTokens: 220 });
  const obj = parseJsonObject(raw);
  const data = {
    lemma: String(obj.lemma || word).trim(),
    ipa: String(obj.ipa || "").trim(),
    pos: String(obj.pos || "").trim(),
    meaning: String(obj.meaning || "").trim()
  };

  cache[cacheKey] = { data, t: Date.now() };
  pruneObject(cache, 1200);
  await chrome.storage.local.set({ miniWordCache: cache });
  return data;
}

async function translateSelection(payload) {
  const settings = await getSettings();
  requireProviderReady(settings, "structured");

  const text = String(payload.text || "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("没有选中可翻译的内容");
  if (text.length > 2400) throw new Error("一次选中的文字太长，请缩短后再翻译");

  if (/^[A-Za-z]+(?:['’][A-Za-z]+)*$/.test(text)) {
    const word = await lookupMiniWord({ word: text, sentence: text });
    return {
      kind: "word",
      lemma: word.lemma,
      ipa: word.ipa,
      pos: word.pos,
      meaning: word.meaning,
      translation: word.meaning
    };
  }

  const cacheResult = await chrome.storage.local.get("selectionTranslationCache");
  const cache = cacheResult.selectionTranslationCache || {};
  const key = await stableHash(`sel-v2|${servicePoolSignature(settings)}|${settings.targetLanguage}|${text}`);
  if (cache[key]?.translation) return cache[key];

  const system = `Translate the selected text naturally and completely into ${languageLabel(settings.targetLanguage || "zh-CN")}.
Do not summarize, explain, censor, or add content. Preserve names, numbers, tone, and meaning.
Return JSON only: {"translation":"..."}`;
  const raw = await callProvider(settings, system, JSON.stringify({ text }), {
    temperature: 0.05,
    maxTokens: Math.min(2600, Math.max(500, Math.ceil(text.length * 2.2)))
  });
  const obj = parseJsonObject(raw);
  const result = { kind: "text", translation: String(obj.translation || "").trim() };
  if (!result.translation) throw new Error("模型没有返回译文");

  cache[key] = { ...result, t: Date.now() };
  pruneObject(cache, 800);
  await chrome.storage.local.set({ selectionTranslationCache: cache });
  return result;
}

async function saveSelectionVocab(payload) {
  const text = String(payload.text || "").replace(/\s+/g, " ").trim();
  const translation = String(payload.translation || payload.meaning || "").trim();
  if (!text) throw new Error("没有可保存的内容");

  const all = await getVocab();
  const key = `phrase-${await stableHash(text.toLowerCase())}`;
  const existing = all[key] || {
    key,
    entryType: /^[A-Za-z]+(?:['’][A-Za-z]+)*$/.test(text) ? "word" : "phrase",
    lemma: String(payload.lemma || text).trim(),
    ipa: String(payload.ipa || "").trim(),
    pos: String(payload.pos || "").trim(),
    coreMeaning: translation,
    status: "learning",
    firstSeenAt: Date.now(),
    encounters: []
  };

  existing.lemma = String(payload.lemma || existing.lemma || text).trim();
  existing.ipa = String(payload.ipa || existing.ipa || "").trim();
  existing.pos = String(payload.pos || existing.pos || "").trim();
  existing.coreMeaning = translation || existing.coreMeaning || "";
  existing.status = "learning";
  existing.lastSeenAt = Date.now();
  existing.encounters = Array.isArray(existing.encounters) ? existing.encounters : [];

  const encounter = {
    id: crypto.randomUUID(),
    word: text,
    sentence: String(payload.context || text).trim(),
    sentenceTranslation: translation,
    contextMeaning: translation,
    url: String(payload.url || ""),
    title: String(payload.title || ""),
    seenAt: Date.now()
  };
  existing.encounters.unshift(encounter);
  existing.encounters = existing.encounters.slice(0, 30);
  all[key] = existing;
  await chrome.storage.local.set({ vocabStore: all });
  return { key, status: existing.status, encounterCount: existing.encounters.length };
}

function normalizeWordFormation(value) {
  if (!value || value.available === false || !Array.isArray(value.parts) || !value.parts.length) {
    return { available: false, parts: [], explanation: "" };
  }
  const parts = value.parts.slice(0, 5).map((x) => ({
    part: String(x?.part || "").trim(),
    type: String(x?.type || "").trim(),
    meaning: String(x?.meaning || "").trim()
  })).filter((x) => x.part);
  return {
    available: Boolean(parts.length),
    parts,
    explanation: String(value.explanation || "").trim()
  };
}

async function getVocab() {
  const { vocabStore = {} } = await chrome.storage.local.get("vocabStore");
  return vocabStore;
}

async function setVocabStatus(key, status) {
  const all = await getVocab();
  if (!all[key]) throw new Error("词条不存在");
  all[key].status = status === "learning" ? "learning" : "encountered";
  all[key].updatedAt = Date.now();
  await chrome.storage.local.set({ vocabStore: all });
  return all[key];
}

async function deleteVocab(key) {
  const all = await getVocab();
  delete all[key];
  await chrome.storage.local.set({ vocabStore: all });
  return true;
}

function requireProviderReady(settings, task = "structured") {
  const services = servicesForTask(settings, task);
  if (!services.length) {
    if (task === "structured") throw new Error("请至少启用一个可用于词典/学习功能的大模型 API");
    throw new Error("请至少启用一个翻译服务 API");
  }
}

function servicePoolSignature(settings, task = "translation") {
  return servicesForTask(settings, task).map((s) => [s.id, s.kind, s.endpointUrl || s.baseUrl || "", s.model || "", s.enabled !== false].join("~")).join("|");
}

function servicesForTask(settings, task = "translation") {
  const pool = normalizeServicePool(settings).filter((s) => s.enabled !== false);
  if (task === "structured") return pool.filter(isLlmService);
  return pool.filter((s) => isLlmService(s) || isNmtService(s));
}

function isLlmService(s) { return String(s?.kind || "").startsWith("llm-"); }
function isNmtService(s) { return String(s?.kind || "").startsWith("nmt-"); }

const SERVICE_RUNTIME = new Map();
function serviceAvailableNow(s) {
  const h = SERVICE_RUNTIME.get(s.id);
  return !h?.cooldownUntil || h.cooldownUntil <= Date.now();
}
function noteServiceFailure(s, err) {
  const msg = String(err?.message || err || "");
  const retryable = /429|rate|limit|timeout|timed out|network|fetch|5\d\d/i.test(msg);
  const cooldown = retryable ? 30000 : (/401|403|unauthor|invalid.*key|signature/i.test(msg) ? 120000 : 8000);
  SERVICE_RUNTIME.set(s.id, { lastError: msg.slice(0, 240), lastErrorAt: Date.now(), cooldownUntil: Date.now() + cooldown });
}
function noteServiceSuccess(s) {
  SERVICE_RUNTIME.set(s.id, { lastSuccessAt: Date.now(), cooldownUntil: 0, lastError: "" });
}

async function translateChunkWithServicePool(settings, chunk, target, opts = {}) {
  const services = servicesForTask(settings, "translation");
  if (!services.length) throw new Error("没有可用翻译服务");
  const errors = [];
  for (const service of services) {
    if (!serviceAvailableNow(service) && services.some((x) => x !== service && serviceAvailableNow(x))) continue;
    try {
      let result;
      if (isNmtService(service)) result = await callNmtBatch(service, chunk.map((x) => x.source), target);
      else result = await callLlmTranslationChunk(service, chunk, target, opts);
      noteServiceSuccess(service);
      if (isNmtService(service)) {
        const map = new Map();
        chunk.forEach((u, i) => map.set(u.uid, { text: String(result[i] || "").trim(), alignments: [] }));
        return map;
      }
      return result;
    } catch (e) {
      noteServiceFailure(service, e);
      errors.push(`${service.name || service.preset}: ${e?.message || e}`);
    }
  }
  throw new Error(`所有翻译服务均失败：${errors.slice(0, 4).join("；")}`);
}

async function callLlmTranslationChunk(service, chunk, target, opts = {}) {
  const single = opts.single === true;
  if (single) {
    const unit = chunk[0];
    const system = `Translate this ONE source segment completely into ${languageLabel(target)}.\nDo not summarize, omit, explain, or add content.\nFor prose, return 2-8 useful compact phrase alignments when practical. Each alignment.source must be an exact substring of the source and alignment.target an exact substring of the translation. For UI labels, alignments may be [].\nReturn JSON only: {"text":"complete translation","alignments":[{"source":"exact source phrase","target":"exact translated phrase"}]}`;
    const raw = await callLlmProfile(service, system, JSON.stringify({ text: unit.source, kind: unit.kind || "content" }), { temperature: 0, maxTokens: opts.finalAttempt ? 3200 : 2200 });
    const obj = parseJsonObject(raw);
    return new Map([[unit.uid, { text: String(obj.text || "").trim(), alignments: Array.isArray(obj.alignments) ? obj.alignments : [] }]]);
  }

  const system = `You are the translation engine of an immersive bilingual reader. Translate EVERY input segment completely into ${languageLabel(target)}.\nEach input has a unique id and is one sentence, clause, or short UI label.\nRules:\n1. Return one output object for every input id. Never omit an id.\n2. Translate the entire segment. Never summarize, shorten, explain, or stop early.\n3. Keep names, numbers, units, links, emojis, and factual meaning intact.\n4. For UI labels, be short and idiomatic and return alignments as [].\n5. For prose, return only 2-8 useful natural phrase alignments when practical; do not align every function word.\n6. alignment.source must be an exact source substring and alignment.target an exact translated substring.\n7. Return valid JSON only: [{"id":"...","text":"complete translation","alignments":[{"source":"...","target":"..."}]}]`;
  const user = JSON.stringify(chunk.map((u) => ({ id: u.uid, text: u.source, kind: u.kind })));
  const raw = await callLlmProfile(service, system, user, { temperature: 0.02, maxTokens: Math.min(7000, Math.max(1200, Math.ceil(charsOfSegments(chunk) * 2.55))) });
  const parsed = parseJsonArray(raw);
  return new Map(parsed.map((x) => [String(x.id), { text: String(x.text || "").trim(), alignments: Array.isArray(x.alignments) ? x.alignments : [] }]));
}

async function callProvider(settings, system, user, opts = {}) {
  const services = servicesForTask(settings, "structured");
  if (!services.length) throw new Error("学习/词典功能需要至少配置一个大模型 API");
  const errors = [];
  for (const service of services) {
    if (!serviceAvailableNow(service) && services.some((x) => x !== service && serviceAvailableNow(x))) continue;
    try {
      const out = await callLlmProfile(service, system, user, opts);
      noteServiceSuccess(service);
      return out;
    } catch (e) {
      noteServiceFailure(service, e);
      errors.push(`${service.name || service.preset}: ${e?.message || e}`);
    }
  }
  throw new Error(`所有大模型接口均失败：${errors.slice(0, 4).join("；")}`);
}

async function callLlmProfile(service, system, user, opts = {}) {
  if (!service.apiKey) throw new Error("未填写 API Key");
  if (!service.model) throw new Error("未填写模型名称");
  if (service.kind === "llm-gemini") return callGeminiProfile(service, system, user, opts);
  if (service.kind === "llm-anthropic") return callAnthropicProfile(service, system, user, opts);
  return callOpenAIProfile(service, system, user, opts);
}

async function callOpenAIProfile(service, system, user, opts) {
  const url = String(service.endpointUrl || "").trim() || legacyEndpoint(service);
  if (!url) throw new Error("未填写 Chat Completions 地址");
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${service.apiKey}` },
    body: JSON.stringify({ model: service.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens || 1800, stream: false })
  }, service.timeoutMs);
  const data = await safeJson(res);
  if (!res.ok) throw new Error(apiError(data, res.status));
  return data?.choices?.[0]?.message?.content || "";
}

async function callGeminiProfile(service, system, user, opts) {
  const base = normalizeBaseUrl(service.baseUrl || "https://generativelanguage.googleapis.com");
  const model = service.model.replace(/^models\//, "");
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(service.apiKey)}`;
  const res = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxTokens || 1800, responseMimeType: "application/json" } }) }, service.timeoutMs);
  const data = await safeJson(res);
  if (!res.ok) throw new Error(apiError(data, res.status));
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
}

async function callAnthropicProfile(service, system, user, opts) {
  const base = normalizeBaseUrl(service.baseUrl || "https://api.anthropic.com");
  const res = await fetchWithTimeout(`${base}/v1/messages`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": service.apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: service.model, system, messages: [{ role: "user", content: user }], temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens || 1800 }) }, service.timeoutMs);
  const data = await safeJson(res);
  if (!res.ok) throw new Error(apiError(data, res.status));
  return data?.content?.map((p) => p.text || "").join("") || "";
}

async function callNmtBatch(service, texts, target) {
  if (service.kind === "nmt-deepl") return callDeepL(service, texts, target);
  if (service.kind === "nmt-aliyun") return callAliyunNmt(service, texts, target);
  if (service.kind === "nmt-volc") return callVolcNmt(service, texts, target);
  if (service.kind === "nmt-tencent") return callTencentNmt(service, texts, target);
  throw new Error("未知 NMT 服务");
}

function nmtTargetCode(target, provider) {
  const t = String(target || "");
  if (provider === "deepl") {
    if (t === "zh-CN" || t === "zh-TW") return "ZH-HANS";
    if (t === "en") return "EN-US";
    return t.toUpperCase();
  }
  if (t === "zh-CN") return "zh";
  if (t === "zh-TW") return provider === "volc" ? "zh-Hant" : "zh-TW";
  return t.split("-")[0].toLowerCase();
}

async function callDeepL(service, texts, target) {
  if (!service.apiKey) throw new Error("未填写 DeepL API Key");
  const base = normalizeBaseUrl(service.baseUrl || "https://api-free.deepl.com");
  const body = { text: texts, target_lang: nmtTargetCode(target, "deepl"), preserve_formatting: true, show_billed_characters: true };
  if (service.modelType) body.model_type = service.modelType;
  const res = await fetchWithTimeout(`${base}/v2/translate`, { method: "POST", headers: { "Authorization": `DeepL-Auth-Key ${service.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }, service.timeoutMs);
  const data = await safeJson(res);
  if (!res.ok) throw new Error(apiError(data, res.status));
  return (data?.translations || []).map((x) => x.text || "");
}

async function callAliyunNmt(service, texts, target) {
  if (!service.accessKeyId || !service.accessKeySecret) throw new Error("未填写阿里云 AccessKey ID / Secret");
  const endpoint = normalizeBaseUrl(service.endpointUrl || "https://mt.cn-hangzhou.aliyuncs.com");
  const out = [];
  for (const text of texts) {
    const params = { Format: "JSON", Version: "2018-10-12", AccessKeyId: service.accessKeyId, SignatureMethod: "HMAC-SHA1", SignatureVersion: "1.0", SignatureNonce: crypto.randomUUID(), Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), Action: "TranslateGeneral", FormatType: "text", SourceLanguage: "auto", TargetLanguage: nmtTargetCode(target, "aliyun"), SourceText: text, Scene: "general" };
    const canonical = Object.keys(params).sort().map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`).join("&");
    const stringToSign = `POST&%2F&${rfc3986(canonical)}`;
    const sig = await hmacBase64("SHA-1", service.accessKeySecret + "&", stringToSign);
    const body = canonical + `&Signature=${rfc3986(sig)}`;
    const res = await fetchWithTimeout(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, service.timeoutMs);
    const data = await safeJson(res);
    if (!res.ok || data?.Code) throw new Error(apiError(data, res.status));
    const translated = data?.Data?.Translated || data?.Data?.TranslatedText || data?.Translated || "";
    if (!translated) throw new Error("阿里云未返回译文");
    out.push(translated);
  }
  return out;
}

async function callVolcNmt(service, texts, target) {
  if (!service.accessKeyId || !service.secretKey) throw new Error("未填写火山引擎 AccessKey / SecretKey");
  const host = new URL(service.endpointUrl || "https://translate.volcengineapi.com/").host;
  const endpoint = `https://${host}/?Action=TranslateText&Version=2020-06-01`;
  const bodyText = JSON.stringify({ TargetLanguage: nmtTargetCode(target, "volc"), TextList: texts });
  const now = new Date();
  const xDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const shortDate = xDate.slice(0, 8);
  const region = service.region || "cn-north-1";
  const svc = "translate";
  const payloadHash = await sha256Hex(bodyText);
  const canonicalQuery = "Action=TranslateText&Version=2020-06-01";
  const canonicalHeaders = `host:${host}\nx-content-sha256:${payloadHash}\nx-date:${xDate}\n`;
  const signedHeaders = "host;x-content-sha256;x-date";
  const canonicalRequest = `POST\n/\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${shortDate}/${region}/${svc}/request`;
  const stringToSign = `HMAC-SHA256\n${xDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const kDate = await hmacBytes("SHA-256", utf8(service.secretKey), shortDate);
  const kRegion = await hmacBytes("SHA-256", kDate, region);
  const kService = await hmacBytes("SHA-256", kRegion, svc);
  const kSigning = await hmacBytes("SHA-256", kService, "request");
  const signature = bytesToHex(await hmacBytes("SHA-256", kSigning, stringToSign));
  const authorization = `HMAC-SHA256 Credential=${service.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetchWithTimeout(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Host": host, "X-Date": xDate, "X-Content-Sha256": payloadHash, "Authorization": authorization }, body: bodyText }, service.timeoutMs);
  const data = await safeJson(res);
  if (!res.ok || data?.ResponseMetadata?.Error) throw new Error(data?.ResponseMetadata?.Error?.Message || apiError(data, res.status));
  return (data?.TranslationList || []).map((x) => x.Translation || "");
}

async function callTencentNmt(service, texts, target) {
  if (!service.secretId || !service.secretKey) throw new Error("未填写腾讯云 SecretId / SecretKey");
  const out = [];
  for (const text of texts) {
    const url = new URL(service.endpointUrl || "https://tmt.tencentcloudapi.com/");
    const host = url.host;
    const payload = JSON.stringify({ SourceText: text, Source: "auto", Target: nmtTargetCode(target, "tencent"), ProjectId: 0 });
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const serviceName = "tmt";
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
    const signedHeaders = "content-type;host";
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256Hex(payload)}`;
    const scope = `${date}/${serviceName}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
    const secretDate = await hmacBytes("SHA-256", utf8("TC3" + service.secretKey), date);
    const secretService = await hmacBytes("SHA-256", secretDate, serviceName);
    const secretSigning = await hmacBytes("SHA-256", secretService, "tc3_request");
    const signature = bytesToHex(await hmacBytes("SHA-256", secretSigning, stringToSign));
    const authorization = `TC3-HMAC-SHA256 Credential=${service.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const headers = { "Authorization": authorization, "Content-Type": "application/json; charset=utf-8", "Host": host, "X-TC-Action": service.action || "TextTranslate", "X-TC-Timestamp": String(timestamp), "X-TC-Version": service.version || "2018-03-21", "X-TC-Region": service.region || "ap-guangzhou" };
    const res = await fetchWithTimeout(url.toString(), { method: "POST", headers, body: payload }, service.timeoutMs);
    const data = await safeJson(res);
    const response = data?.Response || {};
    if (!res.ok || response.Error) throw new Error(response?.Error?.Message || apiError(data, res.status));
    if (!response.TargetText) throw new Error("腾讯云未返回译文；如果你的账号已无法使用旧 TextTranslate 接口，请调整 Action/Endpoint 或改用其它服务");
    out.push(response.TargetText);
  }
  return out;
}

async function testService(raw) {
  const service = { ...newServiceFromPreset(raw?.preset || kindToPreset(raw?.kind), {}), ...raw, enabled: true };
  const started = Date.now();
  let output = "";
  if (isNmtService(service)) {
    output = (await callNmtBatch(service, ["Hello world"], "zh-CN"))[0] || "";
  } else {
    output = await callLlmProfile(service, 'Return JSON only: {"ok":true,"translation":"你好"}', 'Translate: Hello', { temperature: 0, maxTokens: 80 });
  }
  return { ok: true, ms: Date.now() - started, preview: String(output || "").slice(0, 120) };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(4000, Number(timeoutMs || 18000)));
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (e) { if (e?.name === "AbortError") throw new Error("API 请求超时"); throw e; }
  finally { clearTimeout(timer); }
}

function rfc3986(value) { return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }
function utf8(value) { return new TextEncoder().encode(String(value)); }
function bytesToHex(bytes) { return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256Hex(value) { return bytesToHex(await crypto.subtle.digest("SHA-256", utf8(value))); }
async function hmacBytes(hashName, key, message) {
  const keyData = key instanceof Uint8Array || key instanceof ArrayBuffer ? key : utf8(key);
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: { name: hashName } }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, utf8(message)));
}
async function hmacBase64(hashName, key, message) {
  const bytes = await hmacBytes(hashName, key, message);
  let binary = ""; bytes.forEach((b) => binary += String.fromCharCode(b)); return btoa(binary);
}

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function apiError(data, status) {
  return data?.error?.message || data?.Error?.Message || data?.Message || data?.message || data?.Response?.Error?.Message || data?.raw || `API 请求失败 (${status})`;
}

function parseJsonArray(raw) {
  const cleaned = cleanJsonText(raw);
  let data;
  try { data = JSON.parse(cleaned); } catch (e) {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("模型返回的翻译 JSON 无法解析");
    data = JSON.parse(cleaned.slice(start, end + 1));
  }
  if (!Array.isArray(data)) throw new Error("模型返回格式不是数组");
  return data;
}

function parseJsonObject(raw) {
  const cleaned = cleanJsonText(raw);
  let data;
  try { data = JSON.parse(cleaned); } catch (e) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("模型返回的词典 JSON 无法解析");
    data = JSON.parse(cleaned.slice(start, end + 1));
  }
  if (!data || Array.isArray(data) || typeof data !== "object") throw new Error("模型返回格式不是对象");
  return data;
}

function cleanJsonText(raw) {
  return String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function normalizeKey(text) {
  return String(text || "").trim().toLowerCase().replace(/[^a-z0-9'-]+/g, "-").replace(/^-+|-+$/g, "") || String(text || "").trim().toLowerCase();
}

function pruneObject(obj, max) {
  const entries = Object.entries(obj);
  if (entries.length <= max) return;
  entries.sort((a, b) => (a[1]?.t || 0) - (b[1]?.t || 0));
  for (let i = 0; i < entries.length - max; i++) delete obj[entries[i][0]];
}

async function stableHash(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function languageLabel(code) {
  const map = { "zh-CN": "Simplified Chinese", "zh-TW": "Traditional Chinese", en: "English", ja: "Japanese", ko: "Korean" };
  return map[code] || code;
}
