/** Shared by settings, API payloads and the native CLI bridge. Sources: anleitungen/thinking.md.
 * Kept under electron so the packaged desktop includes the native dependency.
 */
/** @typedef {'off'|'auto'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max'} ThinkingMode */
/** @type {readonly ThinkingMode[]} */
export const THINKING_MODES = ['off', 'auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/** @type {ThinkingMode[]} */
const BASIC = ['low', 'medium', 'high'];
/** @type {ThinkingMode[]} */
const LOCAL = ['off', 'auto', ...BASIC];
/** @param {string} provider */
export function isLocalThinking(provider) {
  return ['ollama', 'lmstudio', 'llamacpp', 'localai', 'jan', 'vllm', 'koboldcpp', 'textgen', 'openwebui', 'gpt4all', 'custom'].includes(provider);
}
/** @param {string} model */
export function claudeAdaptive(model) {
  return /(?:fable|mythos)|(?:opus|sonnet)[-.](?:5|4[-.][678])/i.test(model);
}
/** @param {string} model */
export function claudeMandatory(model) { return /fable|mythos/i.test(model); }

/** Conservative model capabilities: unknown models keep their provider default.
 * @param {string} provider
 * @param {string} model
 * @param {string|null} [cli]
 * @returns {ThinkingMode[]}
 */
export function thinkingModes(provider, model, cli = null) {
  const m = model.toLowerCase();
  if (!cli && isLocalThinking(provider)) return [...LOCAL];
  if (cli === 'claude' || provider === 'anthropic' || (cli === 'copilot' && /claude/.test(m))) {
    const off = cli === 'copilot' || claudeMandatory(m) ? [] : /** @type {ThinkingMode[]} */ (['off']);
    if (claudeAdaptive(m)) {
      const xhigh = /fable|mythos|(?:opus|sonnet)[-.]5|opus[-.]4[-.][78]/.test(m);
      return [...off, 'auto', ...BASIC, ...(xhigh ? /** @type {ThinkingMode[]} */ (['xhigh']) : []), 'max'];
    }
    if (/claude-(?:3[-.]7|(?:opus|sonnet|haiku)[-.]4)/.test(m))
      return cli === 'copilot' ? ['auto'] : [...off, 'auto', ...BASIC];
    return ['auto'];
  }
  if (cli === 'codex' || ['openai', 'azure', 'codex'].includes(provider) || (cli === 'copilot' && /gpt-|^o[134]/.test(m))) {
    if (/(?:-|^)pro(?:-|$)|chat-latest/.test(m)) return ['auto'];
    if (/gpt-6|gpt-5\.6/.test(m))
      return [...(!cli && !/gpt-6/.test(m) ? /** @type {ThinkingMode[]} */ (['off']) : []), 'auto', ...BASIC, 'xhigh', 'max'];
    if (/gpt-5\.[2345]/.test(m))
      return [...(!cli && !/codex|pro/.test(m) ? /** @type {ThinkingMode[]} */ (['off']) : []), 'auto', ...BASIC, 'xhigh'];
    if (/gpt-5\.1/.test(m)) return [...(!cli && !/codex/.test(m) ? /** @type {ThinkingMode[]} */ (['off']) : []), 'auto', ...BASIC];
    if (/gpt-5/.test(m)) return ['auto', ...(cli ? [] : /** @type {ThinkingMode[]} */ (['minimal'])), ...BASIC];
    if (/(?:^|\/)o[134](?:-|$)/.test(m)) return ['auto', ...BASIC];
    return ['auto'];
  }
  if (provider === 'google') {
    if (/gemini-(?:2\.5|3)/.test(m)) return [
      ...(/gemini-2\.5-flash/.test(m) ? /** @type {ThinkingMode[]} */ (['off']) : []),
      'auto', 'minimal', ...BASIC,
    ];
    return ['auto'];
  }
  if (provider === 'xai' || provider === 'grok') {
    if (/grok-4\.6/.test(m)) return ['auto', ...BASIC, 'xhigh'];
    if (/grok-4\.5/.test(m)) return ['auto', ...BASIC];
    if (/grok-3-mini/.test(m)) return ['auto', 'low', 'high'];
    return ['auto'];
  }
  if (provider === 'deepseek' && /deepseek-v4/.test(m)) return ['off', 'auto', 'low', 'high', 'max'];
  if (provider === 'openrouter') {
    const slash = m.indexOf('/');
    if (slash > 0) {
      const owner = m.slice(0, slash);
      if (['openai', 'anthropic', 'google', 'x-ai'].includes(owner))
        return thinkingModes(owner === 'x-ai' ? 'xai' : owner, m.slice(slash + 1));
    }
    return ['auto'];
  }
  return ['auto'];
}

/** Keep saved preferences when switching models; UI and transport agree on the effective value.
 * @param {string} provider @param {string} model @param {string} value @param {string|null} [cli]
 * @returns {ThinkingMode}
 */
export function effectiveThinking(provider, model, value, cli = null) {
  return thinkingModes(provider, model, cli).find(v => v === value) ?? 'auto';
}
