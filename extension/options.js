const SERVICE_PRESETS = {
  deepseek:{kind:"llm-openai",name:"DeepSeek",endpointUrl:"https://api.deepseek.com/v1/chat/completions",model:"deepseek-chat",group:"大模型"},
  openai:{kind:"llm-openai",name:"OpenAI",endpointUrl:"https://api.openai.com/v1/chat/completions",model:"",group:"大模型"},
  qwen:{kind:"llm-openai",name:"Qwen / 通义千问",endpointUrl:"https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",model:"qwen-flash",group:"大模型"},
  glm:{kind:"llm-openai",name:"智谱 GLM",endpointUrl:"https://open.bigmodel.cn/api/paas/v4/chat/completions",model:"glm-4-flash",group:"大模型"},
  doubao:{kind:"llm-openai",name:"豆包 / 火山方舟",endpointUrl:"https://ark.cn-beijing.volces.com/api/v3/chat/completions",model:"",group:"大模型"},
  siliconflow:{kind:"llm-openai",name:"SiliconFlow / 硅基流动",endpointUrl:"https://api.siliconflow.cn/v1/chat/completions",model:"",group:"大模型"},
  openrouter:{kind:"llm-openai",name:"OpenRouter",endpointUrl:"https://openrouter.ai/api/v1/chat/completions",model:"",group:"大模型"},
  gemini:{kind:"llm-gemini",name:"Google Gemini",baseUrl:"https://generativelanguage.googleapis.com",model:"",group:"大模型"},
  anthropic:{kind:"llm-anthropic",name:"Anthropic Claude",baseUrl:"https://api.anthropic.com",model:"",group:"大模型"},
  custom:{kind:"llm-openai",name:"OpenAI-Compatible",endpointUrl:"",model:"",group:"大模型"},
  deepl:{kind:"nmt-deepl",name:"DeepL API",baseUrl:"https://api-free.deepl.com",modelType:"latency_optimized",group:"专业 NMT"},
  aliyun:{kind:"nmt-aliyun",name:"阿里云机器翻译",endpointUrl:"https://mt.cn-hangzhou.aliyuncs.com/",region:"cn-hangzhou",group:"专业 NMT"},
  volc:{kind:"nmt-volc",name:"火山引擎机器翻译",endpointUrl:"https://translate.volcengineapi.com/",region:"cn-north-1",group:"专业 NMT"},
  tencent:{kind:"nmt-tencent",name:"腾讯云机器翻译（兼容接口）",endpointUrl:"https://tmt.tencentcloudapi.com/",region:"ap-guangzhou",action:"TextTranslate",version:"2018-03-21",group:"专业 NMT"}
};

const SERVICE_PICKER_META = {
  deepl:{icon:"DL",desc:"专业 NMT · 欧洲语言与正式文本表现好"},
  aliyun:{icon:"阿",desc:"专业 NMT · 国内稳定，适合大量正文翻译"},
  volc:{icon:"火",desc:"专业 NMT · 火山引擎 TranslateText"},
  tencent:{icon:"腾",desc:"专业 NMT · 兼容存量腾讯云 TMT"},
  deepseek:{icon:"DS",desc:"大模型 · 翻译 + 查词 + 学习"},
  qwen:{icon:"Q",desc:"大模型 · 通义千问 / DashScope"},
  doubao:{icon:"豆",desc:"大模型 · 豆包 / 火山方舟"},
  glm:{icon:"GL",desc:"大模型 · 智谱 GLM"},
  siliconflow:{icon:"SF",desc:"大模型聚合 · 硅基流动"},
  openrouter:{icon:"OR",desc:"大模型聚合 · OpenRouter"},
  openai:{icon:"OA",desc:"大模型 · OpenAI"},
  gemini:{icon:"G",desc:"大模型 · Google Gemini"},
  anthropic:{icon:"A",desc:"大模型 · Anthropic Claude"},
  custom:{icon:"＋",desc:"自定义 OpenAI-Compatible 接口"}
};

const $ = (id) => document.getElementById(id);
let currentSettings = null;
let servicePool = [];
let selectedServiceId = null;
let dragServiceId = null;

init();

async function init() {
  bindNav(); bindButtons(); activateHashPanel();
  window.addEventListener("hashchange", activateHashPanel);
  const resp = await chrome.runtime.sendMessage({ type:"getSettings" });
  if (!resp?.ok) return toast(resp?.error || "读取设置失败");
  currentSettings = resp.result;
  servicePool = Array.isArray(currentSettings.servicePool) ? structuredClone(currentSettings.servicePool) : [];
  if (!servicePool.length) servicePool = [createService("deepseek")];
  selectedServiceId = servicePool[0]?.id || null;
  fillReading(currentSettings); renderServicePool(); renderEditor(); await renderVocab();
}

function activateHashPanel(){ const panel=(location.hash||"#api").slice(1); const btn=document.querySelector(`nav button[data-panel="${CSS.escape(panel)}"]`); if(btn) btn.click(); }
function bindNav(){ document.querySelectorAll("nav button").forEach((btn)=>btn.addEventListener("click",()=>{ document.querySelectorAll("nav button").forEach((x)=>x.classList.toggle("active",x===btn)); document.querySelectorAll(".panel").forEach((x)=>x.classList.toggle("active",x.id===`panel-${btn.dataset.panel}`)); if(btn.dataset.panel==="vocab") renderVocab(); })); }
function bindButtons(){
  $("saveApi").addEventListener("click", saveApi);
  $("saveReading").addEventListener("click", saveReading);
  $("addService").addEventListener("click", openServicePicker);
  $("closeServicePicker").addEventListener("click", closeServicePicker);
  $("cancelServicePicker").addEventListener("click", closeServicePicker);
  $("serviceSearch").addEventListener("input", renderServicePicker);
  $("servicePicker").addEventListener("click", (e) => {
    if (e.target === $("servicePicker")) closeServicePicker();
  });
  $("servicePicker").addEventListener("cancel", (e) => {
    e.preventDefault();
    closeServicePicker();
  });
  $("deleteService").addEventListener("click", deleteSelectedService);
  $("testService").addEventListener("click", testSelectedService);
  $("exportVocab").addEventListener("click", exportVocab);
  $("clearVocab").addEventListener("click", clearVocab);
}

function createService(preset){ const p=SERVICE_PRESETS[preset]||SERVICE_PRESETS.custom; return { id:crypto.randomUUID(), preset, kind:p.kind, name:p.name, enabled:true, apiKey:"", secretKey:"", accessKeyId:"", accessKeySecret:"", secretId:"", endpointUrl:p.endpointUrl||"", baseUrl:p.baseUrl||"", model:p.model||"", modelType:p.modelType||"", region:p.region||"", action:p.action||"", version:p.version||"", timeoutMs:18000 }; }
function isNmt(s){ return String(s?.kind||"").startsWith("nmt-"); }

function renderServicePool(){
  const box=$("servicePool");
  box.innerHTML=servicePool.map((s,i)=>`<div class="serviceItem ${s.id===selectedServiceId?'selected':''}" draggable="true" data-id="${esc(s.id)}"><span class="dragHandle" title="拖拽排序">⠿</span><button class="serviceMain" data-select="${esc(s.id)}"><span class="serviceIndex">${i+1}</span><span class="serviceText"><b>${esc(s.name||'未命名')}</b><small>${esc(isNmt(s)?'NMT · 正文翻译': 'LLM · 翻译 + 学习')}</small></span></button><label class="tinySwitch"><input type="checkbox" data-enable="${esc(s.id)}" ${s.enabled!==false?'checked':''}><span></span></label></div>`).join("");
  box.querySelectorAll("[data-select]").forEach((el)=>el.addEventListener("click",()=>{ selectedServiceId=el.dataset.select; renderServicePool(); renderEditor(); }));
  box.querySelectorAll("[data-enable]").forEach((el)=>el.addEventListener("change",()=>{ const s=servicePool.find(x=>x.id===el.dataset.enable); if(s) s.enabled=el.checked; renderServicePool(); }));
  box.querySelectorAll(".serviceItem").forEach((el)=>{
    el.addEventListener("dragstart",()=>{ dragServiceId=el.dataset.id; el.classList.add("dragging"); });
    el.addEventListener("dragend",()=>{ dragServiceId=null; el.classList.remove("dragging"); });
    el.addEventListener("dragover",(e)=>{ e.preventDefault(); el.classList.add("dragOver"); });
    el.addEventListener("dragleave",()=>el.classList.remove("dragOver"));
    el.addEventListener("drop",(e)=>{ e.preventDefault(); el.classList.remove("dragOver"); reorderService(dragServiceId,el.dataset.id); });
  });
}
function reorderService(fromId,toId){ if(!fromId||fromId===toId)return; const from=servicePool.findIndex(x=>x.id===fromId), to=servicePool.findIndex(x=>x.id===toId); if(from<0||to<0)return; const [item]=servicePool.splice(from,1); servicePool.splice(to,0,item); renderServicePool(); toast("优先级已调整，记得保存"); }

function openServicePicker(){
  $("serviceSearch").value="";
  renderServicePicker();
  const dialog=$("servicePicker");
  if(typeof dialog.showModal==="function") dialog.showModal();
  else dialog.setAttribute("open","");
  setTimeout(()=>$("serviceSearch").focus(),0);
}

function closeServicePicker(){
  const dialog=$("servicePicker");
  if(dialog.open && typeof dialog.close==="function") dialog.close();
  else dialog.removeAttribute("open");
}

function renderServicePicker(){
  const q=String($("serviceSearch").value||"").trim().toLowerCase();
  const body=$("servicePickerBody");
  const groups=["专业 NMT","大模型"];
  const html=groups.map((group)=>{
    const items=Object.entries(SERVICE_PRESETS).filter(([key,p])=>{
      if(p.group!==group) return false;
      if(!q) return true;
      const meta=SERVICE_PICKER_META[key]||{};
      return `${key} ${p.name} ${p.group} ${meta.desc||""}`.toLowerCase().includes(q);
    });
    if(!items.length) return "";
    return `<section class="pickerGroup"><div class="pickerGroupTitle"><b>${esc(group)}</b><span>${group==="专业 NMT"?"正文翻译优先：速度快、成本低":"翻译 + 查词 + 词根 + 例句等学习能力"}</span></div><div class="pickerGrid">${items.map(([key,p])=>{
      const meta=SERVICE_PICKER_META[key]||{};
      const already=servicePool.some((s)=>s.preset===key);
      return `<button class="providerCard" type="button" data-add-preset="${esc(key)}">
        <span class="providerIcon ${p.group==="专业 NMT"?"nmt":"llm"}">${esc(meta.icon||p.name.slice(0,2))}</span>
        <span class="providerCopy"><b>${esc(p.name)}</b><small>${esc(meta.desc||p.group)}</small></span>
        <span class="providerAdd">${already?"再加一组":"添加"}</span>
      </button>`;
    }).join("")}</div></section>`;
  }).join("");
  body.innerHTML=html || `<div class="pickerEmpty">没有找到匹配的服务。你也可以搜索“custom”添加自定义 OpenAI-Compatible 接口。</div>`;
  body.querySelectorAll("[data-add-preset]").forEach((btn)=>btn.addEventListener("click",()=>addServicePreset(btn.dataset.addPreset)));
}

function addServicePreset(preset){
  if(!SERVICE_PRESETS[preset]) return toast("没有这个服务");
  const s=createService(preset);
  servicePool.push(s);
  selectedServiceId=s.id;
  renderServicePool();
  renderEditor();
  closeServicePicker();
  toast(`已添加 ${s.name}`);
}

function selectedService(){ return servicePool.find(x=>x.id===selectedServiceId) || null; }

function renderEditor(){
  const s=selectedService(); const box=$("serviceEditor");
  if(!s){ $("editorTitle").textContent="服务配置"; box.innerHTML='<div class="empty">请先添加或选择一个服务。</div>'; return; }
  const preset=SERVICE_PRESETS[s.preset]||{}; $("editorTitle").textContent=s.name||preset.name||"服务配置"; $("editorSub").textContent=`${preset.group||''} · 当前优先级 ${servicePool.findIndex(x=>x.id===s.id)+1}`;
  let fields=`<label>显示名称<input data-field="name" value="${escAttr(s.name||'')}"></label><label>服务类型<select data-field="preset">${Object.entries(SERVICE_PRESETS).map(([k,p])=>`<option value="${k}" ${k===s.preset?'selected':''}>${esc(p.group)} · ${esc(p.name)}</option>`).join('')}</select></label>`;
  if(s.kind==="llm-openai") fields+=`<label>Chat Completions URL<input data-field="endpointUrl" value="${escAttr(s.endpointUrl||'')}" placeholder="https://.../chat/completions"></label><label>API Key<input data-field="apiKey" type="password" value="${escAttr(s.apiKey||'')}" autocomplete="off"></label><label>Model<input data-field="model" value="${escAttr(s.model||'')}" placeholder="模型或 Endpoint ID"></label>`;
  else if(s.kind==="llm-gemini"||s.kind==="llm-anthropic") fields+=`<label>Base URL<input data-field="baseUrl" value="${escAttr(s.baseUrl||'')}"></label><label>API Key<input data-field="apiKey" type="password" value="${escAttr(s.apiKey||'')}" autocomplete="off"></label><label>Model<input data-field="model" value="${escAttr(s.model||'')}"></label>`;
  else if(s.kind==="nmt-deepl") fields+=`<label>Base URL<input data-field="baseUrl" value="${escAttr(s.baseUrl||'https://api-free.deepl.com')}"></label><label>DeepL API Key<input data-field="apiKey" type="password" value="${escAttr(s.apiKey||'')}" autocomplete="off"></label><label>模型策略<select data-field="modelType"><option value="latency_optimized" ${s.modelType==='latency_optimized'?'selected':''}>latency_optimized（低延迟）</option><option value="prefer_quality_optimized" ${s.modelType==='prefer_quality_optimized'?'selected':''}>prefer_quality_optimized</option><option value="quality_optimized" ${s.modelType==='quality_optimized'?'selected':''}>quality_optimized</option></select></label>`;
  else if(s.kind==="nmt-aliyun") fields+=`<label>Endpoint<input data-field="endpointUrl" value="${escAttr(s.endpointUrl||'https://mt.cn-hangzhou.aliyuncs.com/')}"></label><label>AccessKey ID<input data-field="accessKeyId" value="${escAttr(s.accessKeyId||'')}"></label><label>AccessKey Secret<input data-field="accessKeySecret" type="password" value="${escAttr(s.accessKeySecret||'')}" autocomplete="off"></label>`;
  else if(s.kind==="nmt-volc") fields+=`<label>Endpoint<input data-field="endpointUrl" value="${escAttr(s.endpointUrl||'https://translate.volcengineapi.com/')}"></label><label>AccessKey ID<input data-field="accessKeyId" value="${escAttr(s.accessKeyId||'')}"></label><label>Secret Access Key<input data-field="secretKey" type="password" value="${escAttr(s.secretKey||'')}" autocomplete="off"></label><label>Region<input data-field="region" value="${escAttr(s.region||'cn-north-1')}"></label>`;
  else if(s.kind==="nmt-tencent") fields+=`<div class="hint warningHint">腾讯云在 2026 年公开 API 文档中已移除旧 TextTranslate 条目；这里保留兼容适配器给仍可调用的存量账号，并允许你修改 Endpoint / Action / Version。测试成功后再启用。</div><label>Endpoint<input data-field="endpointUrl" value="${escAttr(s.endpointUrl||'https://tmt.tencentcloudapi.com/')}"></label><label>SecretId<input data-field="secretId" value="${escAttr(s.secretId||'')}"></label><label>SecretKey<input data-field="secretKey" type="password" value="${escAttr(s.secretKey||'')}" autocomplete="off"></label><div class="grid2"><label>Region<input data-field="region" value="${escAttr(s.region||'ap-guangzhou')}"></label><label>Action<input data-field="action" value="${escAttr(s.action||'TextTranslate')}"></label></div><label>Version<input data-field="version" value="${escAttr(s.version||'2018-03-21')}"></label>`;
  fields+=`<div class="grid2"><label>超时（毫秒）<input data-field="timeoutMs" type="number" min="4000" max="60000" step="1000" value="${Number(s.timeoutMs||18000)}"></label><label class="switchRow editorSwitch"><span><b>启用该服务</b><small>关闭后保留配置但不参与路由。</small></span><input data-field="enabled" type="checkbox" ${s.enabled!==false?'checked':''}></label></div>`;
  box.innerHTML=fields;
  box.querySelectorAll('[data-field]').forEach((el)=>el.addEventListener('input',()=>updateField(el))); box.querySelectorAll('select[data-field],input[type=checkbox][data-field]').forEach((el)=>el.addEventListener('change',()=>updateField(el)));
}
function updateField(el){ const s=selectedService(); if(!s)return; const field=el.dataset.field; if(field==='preset'){ const fresh=createService(el.value); const keep={id:s.id,enabled:s.enabled,name:fresh.name,preset:fresh.preset,kind:fresh.kind}; Object.assign(s,fresh,keep); renderServicePool(); renderEditor(); return; } s[field]=el.type==='checkbox'?el.checked:(el.type==='number'?Number(el.value):el.value); if(field==='name') renderServicePool(); }
function deleteSelectedService(){ const idx=servicePool.findIndex(x=>x.id===selectedServiceId); if(idx<0)return; if(!confirm(`删除“${servicePool[idx].name}”吗？`))return; servicePool.splice(idx,1); selectedServiceId=servicePool[Math.min(idx,servicePool.length-1)]?.id||null; renderServicePool(); renderEditor(); }
async function testSelectedService(){ const s=selectedService(); if(!s)return; syncEditorValues(); const el=$("testResult"); el.textContent="正在测试…"; const resp=await chrome.runtime.sendMessage({type:"testService",service:s}); if(!resp?.ok){ el.textContent=`失败：${resp?.error||'未知错误'}`; el.classList.add('errorHint'); return; } el.classList.remove('errorHint'); el.textContent=`连接成功 · ${resp.result.ms} ms · ${resp.result.preview||'OK'}`; }
function syncEditorValues(){ document.querySelectorAll('#serviceEditor [data-field]').forEach(updateField); }

async function saveApi(){ syncEditorValues(); const settings={ servicePool, targetLanguage:$("targetLanguage").value, maxBatchChars:Math.max(800,Math.min(12000,Number($("maxBatchChars").value||3600))) }; const resp=await chrome.runtime.sendMessage({type:"saveSettings",settings}); if(!resp?.ok)return toast(resp?.error||'保存失败'); currentSettings=resp.result; servicePool=structuredClone(resp.result.servicePool||servicePool); toast('翻译服务池已保存'); notifyTabs(); }
function fillReading(s){ $("targetLanguage").value=s.targetLanguage||'zh-CN'; $("maxBatchChars").value=s.maxBatchChars||3600; $("autoTranslateEnglish").checked=s.autoTranslateEnglish!==false; $("autoTranslate").checked=Boolean(s.autoTranslate); $("translateVisibleOnly").checked=s.translateVisibleOnly!==false; $("cacheEnabled").checked=s.cacheEnabled!==false; $("floatingToolbar").checked=s.floatingToolbar!==false; $("translateUi").checked=s.translateUi!==false; $("hoverLookup").checked=s.hoverLookup!==false; $("globalWordLookup").checked=s.globalWordLookup!==false; $("hoverLookupDelay").value=s.hoverLookupDelay||650; $("displayOriginal").checked=s.displayOriginal!==false; $("outputEnglish").checked=s.outputEnglish===true; $("outputChinese").checked=s.outputChinese!==false; $("pronunciationLocale").value=s.pronunciationLocale||'en-US'; }
async function saveReading(){ const settings={autoTranslateEnglish:$("autoTranslateEnglish").checked,autoTranslate:$("autoTranslate").checked,translateVisibleOnly:$("translateVisibleOnly").checked,cacheEnabled:$("cacheEnabled").checked,floatingToolbar:$("floatingToolbar").checked,translateUi:$("translateUi").checked,hoverLookup:$("hoverLookup").checked,globalWordLookup:$("globalWordLookup").checked,hoverLookupDelay:Math.max(350,Math.min(1500,Number($("hoverLookupDelay").value||650))),displayOriginal:$("displayOriginal").checked,outputEnglish:$("outputEnglish").checked,outputChinese:$("outputChinese").checked,pronunciationLocale:$("pronunciationLocale").value}; if(!settings.displayOriginal&&!settings.outputEnglish&&!settings.outputChinese){settings.outputChinese=true;$("outputChinese").checked=true;} const resp=await chrome.runtime.sendMessage({type:'saveSettings',settings}); if(!resp?.ok)return toast(resp?.error||'保存失败'); currentSettings=resp.result; toast('阅读设置已保存'); notifyTabs(); }
async function notifyTabs(){ const tabs=await chrome.tabs.query({}); for(const tab of tabs){ if(tab.id) chrome.tabs.sendMessage(tab.id,{type:'refreshSettings'}).catch(()=>{}); } }
function escAttr(text){ return esc(text).replace(/`/g,'&#96;'); }

async function renderVocab() {
  const resp = await chrome.runtime.sendMessage({ type: "getVocab" });
  if (!resp?.ok) return;
  const entries = Object.values(resp.result || {}).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  const learning = entries.filter((x) => x.status === "learning").length;
  const encounters = entries.reduce((n, x) => n + (x.encounters?.length || 0), 0);
  $("vocabStats").innerHTML = `<div class="stat"><b>${entries.length}</b> 个词</div><div class="stat"><b>${encounters}</b> 次真实遇见</div><div class="stat"><b>${learning}</b> 个正在学习</div>`;
  if (!entries.length) {
    $("vocabList").innerHTML = `<div class="empty">还没有记录。去英文网页双击一个单词，你看到的原句会自动保存在这里。</div>`;
    return;
  }
  $("vocabList").innerHTML = entries.map(renderEntry).join("");
  $("vocabList").querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "deleteVocab", key: btn.dataset.delete });
    renderVocab();
  }));
  $("vocabList").querySelectorAll("[data-toggle]").forEach((btn) => btn.addEventListener("click", async () => {
    const next = btn.dataset.status === "learning" ? "encountered" : "learning";
    await chrome.runtime.sendMessage({ type: "setVocabStatus", key: btn.dataset.toggle, status: next });
    renderVocab();
  }));
}

function renderEntry(x) {
  const encounters = (x.encounters || []).slice(0, 3).map((e) => `<div class="encounter"><div class="sentence">${esc(e.sentence || "")}</div><div class="translation">${esc(e.sentenceTranslation || e.contextMeaning || "")}</div><div class="meta">${esc(e.title || e.url || "网页")}${e.speaker ? ` · ${esc(e.speaker)}` : ""}</div></div>`).join("");
  const formation = x.wordFormation?.available && Array.isArray(x.wordFormation.parts)
    ? `<div class="formationLine">构词：${x.wordFormation.parts.map((p) => `<span><b>${esc(p.part || "")}</b> ${esc(p.meaning || "")}</span>`).join(" + ")}</div>`
    : "";
  const senses = (x.senseExamples || []).slice(0, 2).map((s) => `<span class="sensePill">${esc(s.sense || "")}</span>`).join("");
  return `<article class="vocabCard"><div class="vocabTop"><div><div class="vocabWord"><b>${esc(x.lemma || "")}</b><span class="ipa">${esc(x.ipa || "")}</span><span class="status ${x.status === "learning" ? "learning" : ""}">${x.status === "learning" ? "正在学习" : "遇见过"}</span></div><div class="meaning">${esc(x.coreMeaning || "")}</div>${formation}${senses ? `<div class="sensePills">${senses}</div>` : ""}</div><div class="cardActions"><button class="miniBtn" data-toggle="${esc(x.key)}" data-status="${esc(x.status || "encountered")}">${x.status === "learning" ? "移出学习" : "加入学习"}</button><button class="miniBtn" data-delete="${esc(x.key)}">删除</button></div></div><div class="encounters">${encounters}</div></article>`;
}

async function exportVocab() {
  const resp = await chrome.runtime.sendMessage({ type: "getVocab" });
  if (!resp?.ok) return;
  const blob = new Blob([JSON.stringify(resp.result || {}, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `context-translate-vocab-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function clearVocab() {
  if (!confirm("确定清空全部场景词库吗？此操作暂时不可恢复。")) return;
  const resp = await chrome.runtime.sendMessage({ type: "clearVocab" });
  if (resp?.ok) { toast("场景词库已清空"); renderVocab(); }
}

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(el.__timer);
  el.__timer = setTimeout(() => el.classList.remove("show"), 2200);
}

function esc(text) {
  return String(text ?? "").replace(/[&<>'"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
}
