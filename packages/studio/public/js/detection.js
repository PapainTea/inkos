// InkOS Studio — AIGC Detection Settings Page
import { $, escapeHtml, requestJson, showToast } from "./utils.js";

// ── Provider Definitions ──

const PROVIDERS = [
  {
    key: "gptzero",
    name: "GPTZero",
    hasFields: true,
    defaults: {
      apiUrl: "https://api.gptzero.me/v2/predict/text",
      apiKeyEnv: "GPTZERO_API_KEY",
    },
  },
  {
    key: "originality",
    name: "Originality",
    hasFields: true,
    defaults: {
      apiUrl: "https://api.originality.ai/api/v1/scan/ai",
      apiKeyEnv: "ORIGINALITY_API_KEY",
    },
  },
  {
    key: "custom",
    name: "Custom",
    hasFields: true,
    defaults: {
      apiUrl: "",
      apiKeyEnv: "",
    },
    placeholders: {
      apiUrl: "https://your-api.com/detect",
      apiKeyEnv: "CUSTOM_DETECT_KEY",
    },
  },
  {
    key: "claude",
    name: "Claude \u4F30\u7B97 (Built-in)",
    hasFields: false,
    hasPrompt: true,
    description: "\u4F7F\u7528 LLM \u81EA\u8BC4\u4F30 AI \u6982\u7387\uFF08\u65E0\u9700\u989D\u5916\u914D\u7F6E\uFF0C\u51C6\u786E\u5EA6\u6709\u9650\uFF09",
    defaultPrompt: "\u4F60\u662F\u4E00\u4E2A AIGC \u5185\u5BB9\u68C0\u6D4B\u4E13\u5BB6\u3002\u8BF7\u5206\u6790\u4EE5\u4E0B\u6587\u672C\uFF0C\u5224\u65AD\u5176 AI \u751F\u6210\u6982\u7387\u3002\n\u8F93\u51FA\u683C\u5F0F\uFF1A\n- aiProbability: 0-100 \u7684\u6574\u6570\n- reasons: \u7B80\u77ED\u7406\u7531\u5217\u8868 (3-5\u6761)\n- suggestion: \u4E00\u53E5\u8BDD\u5EFA\u8BAE\n\u8BF7\u7528 JSON \u683C\u5F0F\u8F93\u51FA\u3002",
  },
];

// ── Render ──

export function renderDetection() {
  const container = $("detection-view");
  if (!container) return;

  container.innerHTML = `
    <div class="detection-page">
      <div class="detection-header">
        <h1 class="font-serif">AIGC \u68C0\u6D4B\u8BBE\u7F6E</h1>
        <p class="detection-subtitle">\u914D\u7F6E AI \u5185\u5BB9\u68C0\u6D4B\u670D\u52A1\uFF0C\u652F\u6301\u591A\u4E2A\u68C0\u6D4B\u65B9\u6848</p>
      </div>

      <!-- Provider Cards -->
      <div class="detection-grid">
        ${PROVIDERS.map(renderProviderCard).join("")}
      </div>

      <!-- Default Provider -->
      <div class="detection-section">
        <h2 class="detection-section-title">\u9ED8\u8BA4\u68C0\u6D4B\u65B9\u6848</h2>
        <div class="form-field">
          <span>\u9ED8\u8BA4 Provider</span>
          <select id="detect-default-provider">
            ${PROVIDERS.map(p => `<option value="${p.key}">${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </div>
      </div>

      <!-- Global Settings -->
      <div class="detection-section">
        <h2 class="detection-section-title">\u5168\u5C40\u8BBE\u7F6E</h2>
        <div class="form-grid">
          <div class="form-field">
            <span>\u68C0\u6D4B\u9608\u503C (%)</span>
            <input type="number" id="detect-threshold" min="0" max="100" value="50">
          </div>
          <div class="form-field">
            <span>\u6700\u5927\u91CD\u8BD5\u6B21\u6570</span>
            <input type="number" id="detect-max-retries" min="1" max="10" value="3">
          </div>
          <div class="form-field span-2">
            <label class="form-check">
              <input type="checkbox" id="detect-auto-rewrite">
              \u68C0\u6D4B\u4E0D\u901A\u8FC7\u65F6\u81EA\u52A8\u91CD\u5199
            </label>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="detection-actions">
        <button class="btn accent" id="detect-save">\u4FDD\u5B58\u8BBE\u7F6E</button>
        <button class="btn ghost" id="detect-test-btn">\u6D4B\u8BD5\u68C0\u6D4B</button>
      </div>

      <!-- Test Area -->
      <div class="detection-section">
        <h2 class="detection-section-title">\u68C0\u6D4B\u6D4B\u8BD5</h2>
        <div class="form-field">
          <span>\u8F93\u5165\u6D4B\u8BD5\u6587\u672C</span>
          <textarea id="detect-test-input" rows="5" placeholder="\u7C98\u8D34\u6216\u8F93\u5165\u8981\u68C0\u6D4B\u7684\u6587\u672C\u2026"></textarea>
        </div>
        <div id="detect-test-result" class="detection-result"></div>
      </div>
    </div>
  `;

  loadDetectionConfig();
}

function renderProviderCard(provider) {
  if (!provider.hasFields) {
    // Built-in provider (Claude) — with optional prompt customization
    const promptBlock = provider.hasPrompt ? `
      <div class="detection-card-body">
        <div class="form-field">
          <span>检测 Prompt</span>
          <textarea id="detect-prompt-${provider.key}" class="detection-prompt-input"
                    placeholder="${escapeHtml(provider.defaultPrompt || "")}" rows="5"></textarea>
        </div>
      </div>` : "";
    return `
      <div class="detection-card">
        <div class="detection-card-header">
          <span class="detection-card-name">${escapeHtml(provider.name)}</span>
          <span class="detection-card-badge builtin">\u5185\u7F6E</span>
        </div>
        <p class="detection-card-desc">${escapeHtml(provider.description)}</p>
        ${promptBlock}
      </div>`;
  }

  const d = provider.defaults;
  const ph = provider.placeholders || {};

  return `
    <div class="detection-card">
      <div class="detection-card-header">
        <span class="detection-card-name">${escapeHtml(provider.name)}</span>
        <label class="form-check detection-card-toggle">
          <input type="checkbox" id="detect-enabled-${provider.key}">
          \u542F\u7528
        </label>
      </div>
      <div class="detection-card-body">
        <div class="form-field">
          <span>API URL</span>
          <input type="text" id="detect-url-${provider.key}"
                 value="${escapeHtml(d.apiUrl)}"
                 placeholder="${escapeHtml(ph.apiUrl || "")}">
        </div>
        <div class="form-field">
          <span>API Key \u73AF\u5883\u53D8\u91CF\u540D</span>
          <input type="text" id="detect-key-${provider.key}"
                 value="${escapeHtml(d.apiKeyEnv)}"
                 placeholder="${escapeHtml(ph.apiKeyEnv || "")}">
        </div>
      </div>
    </div>`;
}

// ── Data ──

async function loadDetectionConfig() {
  try {
    const res = await requestJson("/api/detection-config");
    if (!res || !res.ok) return;
    const cfg = res.data ?? res;

    // Provider settings
    for (const p of PROVIDERS) {
      if (!p.hasFields) continue;
      const pc = cfg.providers?.[p.key];
      if (!pc) continue;
      const urlEl = $(`detect-url-${p.key}`);
      const keyEl = $(`detect-key-${p.key}`);
      const enEl = $(`detect-enabled-${p.key}`);
      if (urlEl && pc.apiUrl) urlEl.value = pc.apiUrl;
      if (keyEl && pc.apiKeyEnv) keyEl.value = pc.apiKeyEnv;
      if (enEl) enEl.checked = !!pc.enabled;
    }

    // Claude prompt
    const promptEl = $("detect-prompt-claude");
    if (promptEl && cfg.claudePrompt) promptEl.value = cfg.claudePrompt;

    // Default provider
    const defEl = $("detect-default-provider");
    if (defEl && cfg.defaultProvider) defEl.value = cfg.defaultProvider;

    // Global
    const thEl = $("detect-threshold");
    const arEl = $("detect-auto-rewrite");
    const mrEl = $("detect-max-retries");
    if (thEl && cfg.threshold != null) thEl.value = cfg.threshold;
    if (arEl) arEl.checked = !!cfg.autoRewrite;
    if (mrEl && cfg.maxRetries != null) mrEl.value = cfg.maxRetries;
  } catch {
    // Config endpoint may not exist yet — leave defaults
  }
}

function gatherConfig() {
  const providers = {};
  for (const p of PROVIDERS) {
    if (!p.hasFields) continue;
    providers[p.key] = {
      apiUrl: $(`detect-url-${p.key}`)?.value?.trim() || "",
      apiKeyEnv: $(`detect-key-${p.key}`)?.value?.trim() || "",
      enabled: !!$(`detect-enabled-${p.key}`)?.checked,
    };
  }

  const claudePrompt = $("detect-prompt-claude")?.value?.trim() || "";

  return {
    providers,
    defaultProvider: $("detect-default-provider")?.value || "claude",
    threshold: Number($("detect-threshold")?.value) || 50,
    autoRewrite: !!$("detect-auto-rewrite")?.checked,
    maxRetries: Number($("detect-max-retries")?.value) || 3,
    ...(claudePrompt ? { claudePrompt } : {}),
  };
}

async function saveConfig() {
  try {
    const body = gatherConfig();
    await requestJson("/api/detection-config", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    showToast("\u68C0\u6D4B\u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
  } catch (err) {
    showToast(String(err.message || err), "error");
  }
}

async function runTest() {
  const text = $("detect-test-input")?.value?.trim();
  if (!text) {
    showToast("\u8BF7\u8F93\u5165\u6D4B\u8BD5\u6587\u672C", "warn");
    return;
  }

  const resultEl = $("detect-test-result");
  if (resultEl) resultEl.innerHTML = '<span class="detection-result-loading">\u68C0\u6D4B\u4E2D\u2026</span>';

  const provider = $("detect-default-provider")?.value || "gptzero";
  const endpoint = provider === "claude" ? "/api/detect" : "/api/detect-external";

  try {
    const res = await requestJson(endpoint, {
      method: "POST",
      body: JSON.stringify({ content: text, provider }),
    });

    if (!resultEl) return;

    const rawScore = res.score ?? res.aiProbability ?? res.data?.score;
    // External APIs return 0-1, Claude returns 0-100 via aiProbability
    const isExternal = provider !== "claude";
    const score = rawScore != null ? (isExternal ? Math.round(rawScore * 100) : Math.round(rawScore)) : null;
    const label = res.label ?? res.data?.label ?? (score != null ? "" : "\u672A\u77E5");
    const threshold = Number($("detect-threshold")?.value) || 50;
    const pass = score != null ? score < threshold : false;
    const passLabel = pass ? "\u901A\u8FC7" : "\u672A\u901A\u8FC7";
    const passClass = pass ? "pass" : "fail";

    resultEl.innerHTML = `
      <div class="detection-result-card ${passClass}">
        <div class="detection-result-score">${score != null ? score + "%" : "--"}</div>
        <div class="detection-result-label">${escapeHtml(label || passLabel)}</div>
        <div class="detection-result-verdict ${passClass}">${escapeHtml(passLabel)}</div>
      </div>`;
  } catch (err) {
    if (resultEl) {
      resultEl.innerHTML = `<div class="detection-result-card fail">
        <div class="detection-result-label">\u68C0\u6D4B\u5931\u8D25: ${escapeHtml(String(err.message || err))}</div>
      </div>`;
    }
  }
}

// ── Init ──

export function initDetection() {
  const saveBtn = $("detect-save");
  if (saveBtn) saveBtn.addEventListener("click", saveConfig);

  const testBtn = $("detect-test-btn");
  if (testBtn) testBtn.addEventListener("click", runTest);
}
