/** Evaluate simple expressions against recorded primitive values only. Never executes code. */
export function evaluateRecordedLocals(expression, locals) {
  try {
    const tokens = String(expression).match(/\s*(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_$][\w$]*|===|!==|==|!=|<=|>=|&&|\|\||[()+*/%<>!\-])/gi) || [];
    if (tokens.map(x => x.trim()).join('') !== String(expression).replace(/\s+(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/g, '')) throw Error('Nur primitive aufgezeichnete Werte, Klammern und einfache Operatoren sind verfügbar.');
    const ts = tokens.map(x => x.trim()); let at = 0;
    const precedence = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
    const primitive = raw => { try { const value = JSON.parse(raw); if (value === null || ['number', 'string', 'boolean'].includes(typeof value)) return value; } catch { /* Native repr remains text. */ } return raw; };
    const atom = () => {
      const token = ts[at++]; if (['+', '-', '!'].includes(token)) { const x = atom(); return token === '+' ? +x : token === '-' ? -x : !x; }
      if (token === '(') { const x = parse(1); if (ts[at++] !== ')') throw Error('Klammer fehlt.'); return x; }
      if (!token) throw Error('Wert fehlt.');
      if (/^\d/.test(token)) return Number(token);
      if (token.startsWith('"')) return JSON.parse(token);
      if (token.startsWith("'")) return token.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      if (['true', 'false', 'null'].includes(token)) return JSON.parse(token);
      if (!Object.hasOwn(locals, token)) throw Error(`Nicht aufgezeichnet: ${token}`);
      return primitive(locals[token]);
    };
    const operations = { '+': (a,b) => a+b, '-': (a,b) => a-b, '*': (a,b) => a*b, '/': (a,b) => a/b, '%': (a,b) => a%b, '==': (a,b) => a===b, '===': (a,b) => a===b, '!=': (a,b) => a!==b, '!==': (a,b) => a!==b, '<': (a,b) => a<b, '>': (a,b) => a>b, '<=': (a,b) => a<=b, '>=': (a,b) => a>=b, '&&': (a,b) => a&&b, '||': (a,b) => a||b };
    const parse = min => { let value = atom(); while ((precedence[ts[at]] || 0) >= min) { const operator = ts[at++], right = parse(precedence[operator] + 1); value = operations[operator](value, right); } return value; };
    const result = parse(1); if (at !== ts.length) throw Error('Ausdruck wird in der Trace-Ansicht nicht unterstützt.');
    return String(result).slice(0, 1000);
  } catch (error) { return `Trace: ${error.message}`; }
}
