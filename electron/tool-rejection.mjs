/** A trusted local preflight rejection, before the requested effect started.
 * Never infer this classification from a remote response, error text or an
 * arbitrary thrown Error: a started action can have an unknown outcome.
 */
export function shellRejectionGuidance(command = '', previewRequested = false) {
  if (previewRequested || /^\s*play(?:\s|$)/i.test(command)) return {
    guidance: 'play ist ein eigenes Anvil-Werkzeug für die HTML-Vorschau, kein Shell-Befehl. Rufe play direkt mit keys oder actions auf. Falls es nicht angeboten wird, mit select_tools({"names":["play"]}) nachladen. Der Shell-Befehl wurde nicht ausgeführt.',
    suggestedTools: ['play', 'select_tools'],
  };
  return {
    guidance: 'Der Befehl wurde nicht ausgeführt. Zum Lesen von Projektdateien read_file verwenden. shell unterstützt Projektstarter und bekannte Testbefehle; Pipes, Umleitungen und Befehlsverkettungen sind nicht verfügbar.',
    suggestedTools: ['read_file'],
  };
}

export function mcpInspectionGuidance(de = true) {
  return {
    guidance: de
      ? 'Dieser Dienstaufruf wurde vor der Ausführung abgewiesen. Verwende mcp_list und wähle ein vorhandenes Lesewerkzeug für Szenendaten, Objekte oder die aktuelle Ansicht. Python mit anderem Code bleibt für diesen Prüfauftrag gesperrt. Benenne den ungeprüften Blickwinkel, falls kein passendes Lesewerkzeug verfügbar ist.'
      : 'This service call was rejected before execution. Use mcp_list to find an available read tool for scene information, objects or the current view. Retrying Python with different code remains blocked in this inspection. Report any angle that the available read tools cannot verify.',
    suggestedTools: ['mcp_list', 'mcp_call'],
  };
}

/** @typedef {{guidance?: string, suggestedTools?: string[]}} RejectionOptions */
/** @param {string} message @param {RejectionOptions} [options] */
export function toolRejectionResult(message, { guidance = '', suggestedTools = [] } = {}) {
  return { ok: false, error: [message, guidance].filter(Boolean).join(' '), rejected: true, definitelyNotExecuted: true,
    ...(suggestedTools.length ? { suggestedTools } : {}) };
}

export class ToolRejection extends Error {
  /** @param {string} message @param {RejectionOptions} [options] */
  constructor(message, { guidance = '', suggestedTools = [] } = {}) {
    super([message, guidance].filter(Boolean).join(' '));
    this.name = 'ToolRejection';
    this.suggestedTools = suggestedTools;
  }
  result() {
    return toolRejectionResult(this.message, { suggestedTools: this.suggestedTools });
  }
}
