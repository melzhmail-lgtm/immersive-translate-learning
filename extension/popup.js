const translateBtn = document.getElementById("translateBtn");
const settingsBtn = document.getElementById("settingsBtn");
const vocabBtn = document.getElementById("vocabBtn");
const providerText = document.getElementById("providerText");
const providerDot = document.getElementById("providerDot");
const pageState = document.getElementById("pageState");
const layerSeg = document.getElementById("layerSeg");
let currentSettings = null;

init();

async function init() {
  const settings = await send({ type: "getSettings" });
  if (settings) {
    providerText.textContent = `${label(settings.provider)} · ${settings.model || "未设置模型"}`;
    providerDot.classList.toggle("ready", Boolean(settings.apiKey && settings.model));
    currentSettings = settings;
    setLayerUI(settings);
  }
  refreshPageState();
}

translateBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  translateBtn.disabled = true;
  translateBtn.textContent = "正在开始翻译…";
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "translateNow" });
    if (resp?.ok) {
      translateBtn.textContent = "已开始 · 滚动时继续翻译";
      setTimeout(refreshPageState, 800);
    }
  } catch (e) {
    translateBtn.textContent = "当前页面无法注入";
  } finally {
    setTimeout(() => { translateBtn.disabled = false; refreshPageState(); }, 900);
  }
});

layerSeg.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-layer]");
  if (!btn || !currentSettings) return;
  const key = btn.dataset.layer;
  currentSettings[key] = !Boolean(currentSettings[key]);
  if (!currentSettings.displayOriginal && !currentSettings.outputEnglish && !currentSettings.outputChinese) {
    currentSettings.outputChinese = true;
  }
  setLayerUI(currentSettings);
  const patch = {
    displayOriginal: currentSettings.displayOriginal !== false,
    outputEnglish: currentSettings.outputEnglish === true,
    outputChinese: currentSettings.outputChinese !== false
  };
  await send({ type: "saveSettings", settings: patch });
  const tab = await getActiveTab();
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "refreshSettings" }).catch(() => {});
});

settingsBtn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "openExtensionPage", hash: "api" }));
vocabBtn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "openExtensionPage", hash: "vocab" }));

function setLayerUI(settings) {
  layerSeg.querySelectorAll("button[data-layer]").forEach((b) => {
    const key = b.dataset.layer;
    const active = key === "displayOriginal"
      ? settings.displayOriginal !== false
      : key === "outputEnglish"
        ? settings.outputEnglish === true
        : settings.outputChinese !== false;
    b.classList.toggle("active", active);
  });
}

async function refreshPageState() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "getPageState" });
    if (resp?.ok) {
      if (resp.error) pageState.textContent = `需重试 · ${resp.translated || 0} 段`;
      else if (resp.processing) pageState.textContent = `翻译中 · ${resp.translated || 0} 段`;
      else pageState.textContent = resp.translated ? `已翻译 ${resp.translated} 段` : (resp.enabled ? "翻译已开启" : "未开启");
      translateBtn.textContent = resp.enabled ? "扫描并翻译新内容" : "立即开启翻译";
    }
  } catch { pageState.textContent = "此页面不可用"; }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function label(p) {
  return ({ deepseek: "DeepSeek", openai: "OpenAI", gemini: "Gemini", anthropic: "Claude", custom: "自定义" })[p] || p;
}

async function send(message) {
  const resp = await chrome.runtime.sendMessage(message);
  if (!resp?.ok) return null;
  return resp.result;
}
