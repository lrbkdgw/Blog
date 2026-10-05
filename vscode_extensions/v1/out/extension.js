"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));

// src/core/showBox.ts
function splitTopLevel(input, separators = ",;") {
  const output = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if ("([{".indexOf(char) >= 0) depth += 1;
    if (")]}".indexOf(char) >= 0) depth = Math.max(0, depth - 1);
    if (depth === 0 && separators.indexOf(char) >= 0) {
      const piece = input.slice(start, index).trim();
      if (piece) output.push(piece);
      start = index + 1;
    }
  }
  const rest = input.slice(start).trim();
  if (rest) output.push(rest);
  return output;
}
function numberOr(value, fallback) {
  if (value === void 0 || !value.trim()) return fallback;
  const parsed = Number(value.trim());
  return isFinite(parsed) ? parsed : fallback;
}
function parseVariable(raw) {
  const match = raw.trim().match(/^([^\s:=\[\](){}]+)([\s\S]*)$/);
  if (!match) return null;
  const name = match[1];
  let remainder = match[2].trim();
  let type = "integer";
  const typeMatch = remainder.match(
    /^:\s*(integer|int|z|整数|rational|number|float|q|有理数|string|text|s|字符串)/i
  );
  if (typeMatch) {
    const normalized = typeMatch[1].toLowerCase();
    type = ["string", "text", "s", "\u5B57\u7B26\u4E32"].indexOf(normalized) >= 0 ? "string" : ["rational", "number", "float", "q", "\u6709\u7406\u6570"].indexOf(normalized) >= 0 ? "rational" : "integer";
    remainder = remainder.slice(typeMatch[0].length).trim();
  }
  const fastSet = /\{faster_set\}/i.test(remainder);
  remainder = remainder.replace(/\{faster_set\}/gi, "").trim();
  let defaultText;
  const defaultMatch = remainder.match(/^=\s*([^\[\]()]+?)(?=\s*(?:\[|\(|$))/);
  if (defaultMatch) {
    defaultText = defaultMatch[1].trim();
    remainder = remainder.slice(defaultMatch[0].length).trim();
  }
  const rangeMatch = remainder.match(/^[\[(]\s*([\s\S]*?)\s*[\])]$/);
  const limits = rangeMatch ? splitTopLevel(rangeMatch[1]) : [];
  if (type === "string") {
    const minLength = Math.max(0, Math.floor(numberOr(limits[0], 0)));
    const maxLength = Math.max(minLength, Math.floor(numberOr(limits[1], 100)));
    const initial = (defaultText === void 0 ? "" : defaultText).slice(0, maxLength);
    return { name, type, minLength, maxLength, initial };
  }
  const min = numberOr(limits[0], type === "integer" ? 0 : -100);
  const max = Math.max(min, numberOr(limits[1], type === "integer" ? 100 : 100));
  const defaultStep = type === "integer" ? 1 : 0.1;
  const suppliedStep = Math.abs(numberOr(limits[2], defaultStep));
  const step = suppliedStep || defaultStep;
  const parsedInitial = numberOr(defaultText, min <= 0 && max >= 0 ? 0 : min);
  const roundedInitial = type === "integer" ? Math.round(parsedInitial) : parsedInitial;
  return {
    name,
    type,
    min,
    max,
    step,
    fastSet: type === "rational" && fastSet,
    initial: Math.min(max, Math.max(min, roundedInitial))
  };
}
var MAPPING_PATTERN = /\*&([^:*&{}()\s]+):\{([\s\S]*?)\}\*&/g;
function parseShowMappings(content) {
  const pattern = new RegExp(MAPPING_PATTERN.source, "g");
  const mappings = [];
  let match;
  while (match = pattern.exec(content)) {
    const values = [];
    const seen = {};
    for (const pair of splitTopLevel(match[2], ";")) {
      const comma = pair.indexOf(",");
      if (comma < 0) continue;
      const key = pair.slice(0, comma).trim();
      const value = pair.slice(comma + 1).trim().replace(/%$/, "").trim();
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(seen, key)) values[seen[key]] = [key, value];
      else {
        seen[key] = values.length;
        values.push([key, value]);
      }
    }
    if (values.length) mappings.push({ name: match[1].trim(), values });
  }
  return mappings;
}
function mappingValue(mapping, key) {
  for (const pair of mapping.values) if (pair[0] === key) return pair[1];
  return void 0;
}
function mappingVariable(mapping) {
  const keys = mapping.values.map((pair) => pair[0]);
  const numeric = keys.map((key) => Number(key));
  const allNumeric = numeric.every((key) => isFinite(key));
  const allIntegers = allNumeric && numeric.every((key) => key === Math.round(key));
  if (allNumeric) {
    const min = Math.min.apply(null, numeric);
    const max = Math.max.apply(null, numeric);
    return {
      name: mapping.name,
      type: allIntegers ? "integer" : "rational",
      min,
      max,
      step: allIntegers ? 1 : 0.1,
      initial: numeric[0]
    };
  }
  return {
    name: mapping.name,
    type: "string",
    minLength: 0,
    maxLength: Math.max.apply(null, [20].concat(keys.map((key) => key.length))),
    initial: keys[0] || ""
  };
}
function parseShowVariables(specification, content) {
  const order = [];
  const variables = {};
  const remember = (variable) => {
    if (!Object.prototype.hasOwnProperty.call(variables, variable.name)) order.push(variable.name);
    variables[variable.name] = variable;
  };
  for (const raw of splitTopLevel(specification)) {
    const variable = parseVariable(raw);
    if (variable) remember(variable);
  }
  for (const mapping of parseShowMappings(content)) {
    if (!Object.prototype.hasOwnProperty.call(variables, mapping.name)) remember(mappingVariable(mapping));
  }
  return order.map((name) => variables[name]);
}
function showValueKey(value) {
  if (typeof value === "number") {
    return value === Math.round(value) ? String(value) : String(Number(value.toFixed(12)));
  }
  return value;
}
function formatNumber(value) {
  if (!isFinite(value)) return "\u672A\u5B9A\u4E49";
  if (Math.abs(value) < 1e-12) return "0";
  return String(Number(value.toFixed(10)));
}
function evaluateShowFormula(source, values) {
  let cursor = 0;
  const skip = () => {
    while (/\s/.test(source[cursor] || "")) cursor += 1;
  };
  const parseExpression = () => {
    let value = parseTerm();
    while (value !== null) {
      skip();
      const operator = source[cursor];
      if (operator !== "+" && operator !== "-") break;
      cursor += 1;
      const next = parseTerm();
      if (next === null) return null;
      value = operator === "+" ? value + next : value - next;
    }
    return value;
  };
  const parseTerm = () => {
    let value = parsePower();
    while (value !== null) {
      skip();
      const operator = source[cursor];
      if (operator !== "*" && operator !== "/") break;
      cursor += 1;
      const next = parsePower();
      if (next === null || operator === "/" && next === 0) return null;
      value = operator === "*" ? value * next : value / next;
    }
    return value;
  };
  const parsePower = () => {
    let value = parsePrimary();
    skip();
    if (value !== null && source[cursor] === "^") {
      cursor += 1;
      const exponent = parsePower();
      if (exponent === null) return null;
      value = Math.pow(value, exponent);
    }
    return value;
  };
  const parsePrimary = () => {
    skip();
    if (source[cursor] === "+") {
      cursor += 1;
      return parsePrimary();
    }
    if (source[cursor] === "-") {
      cursor += 1;
      const value2 = parsePrimary();
      return value2 === null ? null : -value2;
    }
    if (source[cursor] === "(") {
      cursor += 1;
      const value2 = parseExpression();
      skip();
      if (source[cursor] !== ")") return null;
      cursor += 1;
      return value2;
    }
    const remainder = source.slice(cursor);
    const number = remainder.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) {
      cursor += number[0].length;
      return Number(number[0]);
    }
    const identifier = remainder.match(/^[\p{L}_][\p{L}\p{N}_-]*/u);
    if (!identifier) return null;
    cursor += identifier[0].length;
    const value = values[identifier[0]];
    return typeof value === "number" && isFinite(value) ? value : null;
  };
  const result = parseExpression();
  skip();
  return result === null || cursor !== source.length || !isFinite(result) ? null : result;
}
function unwrapPlaceholder(value) {
  const trimmed = value.trim();
  return trimmed.charAt(0) === "[" && trimmed.charAt(trimmed.length - 1) === "]" ? trimmed.slice(1, -1).trim() : trimmed;
}
function shiftDecimal(value, places) {
  if (value === 0) return 0;
  const parts = String(value).split("e");
  const coefficient = parts[0];
  const exponent = parts.length > 1 ? parts[1] : "0";
  return Number(coefficient + "e" + (Number(exponent) + places));
}
function formatDirectionalRound(value, places, mode) {
  if (places !== Math.round(places) || Math.abs(places) > 100) return "\u672A\u5B9A\u4E49";
  const shifted = shiftDecimal(value, places);
  if (!isFinite(shifted)) return "\u672A\u5B9A\u4E49";
  const nearest = Math.round(shifted);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(shifted)) * 8;
  const stableShifted = Math.abs(shifted - nearest) <= tolerance ? nearest : shifted;
  const rounded = mode === "floor" ? Math.floor(stableShifted) : Math.ceil(stableShifted);
  const result = shiftDecimal(rounded, -places);
  if (!isFinite(result)) return "\u672A\u5B9A\u4E49";
  const normalized = result === 0 ? 0 : result;
  return places > 0 ? normalized.toFixed(places) : String(normalized);
}
function initialShowValues(variables) {
  const values = {};
  for (const variable of variables) values[variable.name] = variable.initial;
  return values;
}
function matchBalanced(source, openParen) {
  let depth = 1;
  let cursor = openParen + 1;
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === "(") depth += 1;
    if (source[cursor] === ")") depth -= 1;
    if (depth > 0) cursor += 1;
  }
  return depth === 0 ? cursor : -1;
}
function findShowTokens(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const marker = source.substr(index, 2);
    if (marker !== "*&" && marker !== "&*") {
      index += 1;
      continue;
    }
    const rest = source.slice(index);
    if (marker === "*&") {
      const mapping = rest.match(/^\*&([^:*&{}()\s]+):\{[\s\S]*?\}\*&/);
      if (mapping) {
        tokens.push({ kind: "map", start: index, end: index + mapping[0].length, arg: mapping[1].trim() });
        index += mapping[0].length;
        continue;
      }
      const show = rest.match(/^\*&show\(([^)]+)\)\*&/);
      if (show) {
        tokens.push({ kind: "show", start: index, end: index + show[0].length, arg: show[1].trim() });
        index += show[0].length;
        continue;
      }
      const hs = rest.match(/^\*&hs\(/);
      if (hs) {
        const close = matchBalanced(source, index + 5);
        if (close > 0 && source.substr(close + 1, 2) === "*&") {
          tokens.push({ kind: "hs", start: index, end: close + 3, arg: source.slice(index + 5, close) });
          index = close + 3;
          continue;
        }
      }
    }
    const rounding = rest.match(/^(?:\*&|&\*)(floor|ceil)\(/);
    if (rounding) {
      const openParen = index + rounding[0].length - 1;
      const close = matchBalanced(source, openParen);
      const suffix = marker === "&*" ? "&*" : "*&";
      if (close > 0 && source.substr(close + 1, 2) === suffix) {
        tokens.push({
          kind: rounding[1],
          start: index,
          end: close + 3,
          arg: source.slice(openParen + 1, close)
        });
        index = close + 3;
        continue;
      }
    }
    index += 1;
  }
  return tokens;
}
function evaluateShowToken(token, values, mappings) {
  if (token.kind === "map") {
    for (const mapping of mappings) {
      if (mapping.name !== token.arg) continue;
      const key = showValueKey(values[token.arg] === void 0 ? "" : values[token.arg]);
      const value = mappingValue(mapping, key);
      return value === void 0 ? "" : value;
    }
    return "";
  }
  if (token.kind === "show") {
    const value = values[token.arg];
    return value === void 0 ? "\u672A\u5B9A\u4E49" : showValueKey(value);
  }
  if (token.kind === "hs") {
    const result = evaluateShowFormula(token.arg.trim(), values);
    return result === null ? "\u672A\u5B9A\u4E49" : formatNumber(result);
  }
  const args = splitTopLevel(token.arg, ",");
  const number = args.length === 2 ? evaluateShowFormula(unwrapPlaceholder(args[0]), values) : null;
  const places = args.length === 2 ? evaluateShowFormula(unwrapPlaceholder(args[1]), values) : null;
  if (number === null || places === null) return "\u672A\u5B9A\u4E49";
  return formatDirectionalRound(number, places, token.kind);
}
function renderShowContent(body, values, mappings, wrap) {
  const tokens = findShowTokens(body);
  let output = "";
  let cursor = 0;
  for (const token of tokens) {
    output += body.slice(cursor, token.start);
    const text = evaluateShowToken(token, values, mappings);
    output += wrap ? wrap(token, text) : text;
    cursor = token.end;
  }
  return output + body.slice(cursor);
}

// src/core/transform.ts
var CALLOUT_TITLES = {
  info: "\u4FE1\u606F\u63D0\u793A",
  note: "\u6CE8\u8BB0",
  tip: "\u63D0\u793A",
  success: "\u6210\u529F",
  warning: "\u8B66\u544A",
  error: "\u9519\u8BEF",
  danger: "\u5371\u9669"
};
var CALLOUT_ICONS = {
  info: "\u2139",
  note: "\u2139",
  tip: "\u2139",
  success: "\u2713",
  warning: "\u26A0",
  error: "\u2715",
  danger: "\u2715"
};
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function hashString(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) + hash + value.charCodeAt(index) | 0;
  }
  return (hash >>> 0).toString(36);
}
function protectedRanges(body) {
  const ranges = [];
  const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|$)/gm;
  let match;
  while (match = fence.exec(body)) ranges.push([match.index, match.index + match[0].length]);
  const inline = /(`+)(?:[\s\S]*?[^`])?\1(?!`)/g;
  while (match = inline.exec(body)) ranges.push([match.index, match.index + match[0].length]);
  const math = /\$\$[\s\S]*?\$\$|\$[^$\n]+?\$/g;
  while (match = math.exec(body)) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}
function isProtected(ranges, token) {
  for (const range of ranges) if (token.start >= range[0] && token.end <= range[1]) return true;
  return false;
}
function variableMeta(variable) {
  if (variable.type === "string") {
    return "\u5B57\u7B26\u4E32 " + (variable.minLength || 0) + "\u2013" + (variable.maxLength === void 0 ? 100 : variable.maxLength) + " \u5B57";
  }
  const label = variable.type === "integer" ? "\u6574\u6570" : "\u6709\u7406\u6570";
  return label + " \u2208 [" + variable.min + ", " + variable.max + "]";
}
function controlsHtml(variables, prefix, interactive) {
  if (!variables.length) return "";
  if (!interactive) {
    const items = variables.map((variable) => {
      return '<span class="' + prefix + '-var"><code>' + escapeHtml(variable.name) + '</code><span class="' + prefix + '-var-value">' + escapeHtml(showValueKey(variable.initial)) + '</span><span class="' + prefix + '-var-meta">' + escapeHtml(variableMeta(variable)) + "</span></span>";
    });
    return '<div class="' + prefix + '-showbox-vars">' + items.join("") + "</div>";
  }
  const rows = variables.map((variable) => {
    const value = escapeHtml(showValueKey(variable.initial));
    const name = escapeHtml(variable.name);
    const head = '<span class="' + prefix + '-ctl-head"><span class="' + prefix + '-ctl-name">' + name + '</span><span class="' + prefix + '-ctl-meta">' + escapeHtml(variableMeta(variable)) + "</span></span>";
    if (variable.type === "string") {
      return '<label class="' + prefix + '-ctl">' + head + '<input class="' + prefix + '-ctl-text" type="text" value="' + value + '" minlength="' + (variable.minLength || 0) + '" maxlength="' + (variable.maxLength === void 0 ? 100 : variable.maxLength) + '" data-sl-input="' + name + '"></label>';
    }
    const canSlide = variable.type === "integer" || variable.fastSet;
    const bounds = ' min="' + variable.min + '" max="' + variable.max + '" step="' + (variable.step || 1) + '"';
    const slider = canSlide ? '<input class="' + prefix + '-ctl-range" type="range" value="' + value + '"' + bounds + ' data-sl-input="' + name + '" aria-label="' + name + ' \u6ED1\u52A8\u6761">' : "";
    return '<label class="' + prefix + '-ctl">' + head + '<span class="' + prefix + '-ctl-inputs"><input class="' + prefix + '-ctl-number" type="number" value="' + value + '"' + bounds + ' data-sl-input="' + name + '">' + slider + "</span></label>";
  });
  return '<div class="' + prefix + '-showbox-controls">' + rows.join("") + "</div>";
}
function renderShowBox(title, variableSpec, body, options = {}) {
  const prefix = options.prefix || "starlog";
  const interactive = options.interactive !== false;
  const variables = parseShowVariables(variableSpec, body);
  const mappings = parseShowMappings(body);
  const values = initialShowValues(variables);
  const ranges = interactive ? protectedRanges(body) : [];
  const rendered = renderShowContent(body, values, mappings, (token, text) => {
    if (!interactive || isProtected(ranges, token)) return text;
    return '<span class="' + prefix + '-dyn" data-sl-kind="' + token.kind + '" data-sl-arg="' + escapeHtml(token.arg) + '">' + escapeHtml(text) + "</span>";
  });
  const model = encodeURIComponent(JSON.stringify({ variables, mappings }));
  const identifier = hashString(title + "\0" + variableSpec + "\0" + body);
  const heading = '<div class="' + prefix + '-showbox-head"><span class="' + prefix + '-showbox-icon" aria-hidden="true">\u{1F39B}</span><span class="' + prefix + '-showbox-title">' + escapeHtml(title || "\u4EA4\u4E92\u5C55\u793A") + "</span></div>";
  const lines = [];
  lines.push("");
  lines.push(
    '<div class="' + prefix + '-showbox" data-sl-box="' + identifier + '"' + (interactive ? ' data-sl-model="' + escapeHtml(model) + '"' : "") + ">"
  );
  lines.push(heading);
  lines.push('<div class="' + prefix + '-showbox-body">');
  lines.push("");
  lines.push(rendered);
  lines.push("");
  lines.push("</div>");
  const controls = controlsHtml(variables, prefix, interactive);
  if (controls) lines.push(controls);
  lines.push("</div>");
  lines.push("");
  return { lines };
}
function isTableLine(line) {
  return line.indexOf("|") >= 0;
}
function convertMergeMarkersForMpe(markdown) {
  return mapOutsideFences(markdown, (line) => {
    if (!isTableLine(line)) return line;
    return line.replace(/(^|\|)([ \t]*)<([ \t]*)(?=\||$)/g, (_all, head, left) => head + left + " ");
  });
}
function mapOutsideFences(markdown, mapper) {
  const lines = markdown.split("\n");
  let fence = null;
  return lines.map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = null;
      return line;
    }
    return fence ? line : mapper(line);
  }).join("\n");
}
function transformMarkdown(markdown, options = {}) {
  if (!markdown) return "";
  const prefix = options.prefix || "starlog";
  const interactive = options.interactive !== false;
  const lines = markdown.split("\n");
  const result = [];
  const stack = [];
  let inCodeFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inCodeFence = !inCodeFence;
      result.push(line);
      continue;
    }
    if (inCodeFence) {
      result.push(line);
      continue;
    }
    const showMatch = line.match(/^\s*::show_begin\{([^}]*)\}\{([\s\S]*)\}\s*$/i);
    if (showMatch) {
      const body = [];
      let end = i + 1;
      while (end < lines.length && !/^\s*::show_end\s*$/i.test(lines[end])) {
        body.push(lines[end]);
        end += 1;
      }
      if (end < lines.length) {
        const rendered = renderShowBox(showMatch[1], showMatch[2], body.join("\n"), options);
        for (const outputLine of rendered.lines) result.push(outputLine);
        i = end;
        continue;
      }
    }
    const tuackMatch = line.match(/^ *(?::{2,})(?:cute-table)\s*\{([^}]+)\}\s*$/i);
    if (tuackMatch) {
      const style = tuackMatch[1].trim().toLowerCase();
      result.push("");
      result.push('<div class="' + prefix + "-table-wrapper " + prefix + "-table-" + escapeHtml(style) + '">');
      result.push("");
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j += 1;
      while (j < lines.length && lines[j].indexOf("|") >= 0) {
        result.push(lines[j]);
        j += 1;
      }
      result.push("");
      result.push("</div>");
      result.push("");
      i = j - 1;
      continue;
    }
    const closeMatch = line.match(/^ *(:{3,})\s*$/);
    if (closeMatch && stack.length > 0) {
      const colons = closeMatch[1].length;
      const top = stack[stack.length - 1];
      if (colons >= top.colonsCount) {
        stack.pop();
        result.push("");
        result.push("</div>");
        result.push("</details>");
        result.push("");
        continue;
      }
    }
    const openMatch = line.match(
      /^ *(:{3,})(info|success|warning|error|note|tip|danger)(?:\[([\s\S]*?)\])?(?:\{(open)\})?\s*$/i
    );
    if (openMatch) {
      const colonsCount = openMatch[1].length;
      const type = openMatch[2].toLowerCase();
      const rawTitle = openMatch[3] !== void 0 && openMatch[3] !== "" ? openMatch[3] : CALLOUT_TITLES[type];
      const isOpen = Boolean(openMatch[4]);
      stack.push({ colonsCount, type });
      result.push("");
      result.push(
        '<details class="' + prefix + "-callout " + prefix + "-callout-" + type + '" data-callout="' + type + '"' + (isOpen ? " open" : "") + ">"
      );
      result.push(
        '<summary class="' + prefix + '-callout-summary"><span class="' + prefix + '-callout-icon" aria-hidden="true">' + CALLOUT_ICONS[type] + '</span><span class="' + prefix + '-callout-title">' + escapeHtml(rawTitle) + "</span></summary>"
      );
      result.push('<div class="' + prefix + '-callout-content">');
      result.push("");
      continue;
    }
    result.push(line);
  }
  while (stack.pop()) {
    result.push("");
    result.push("</div>");
    result.push("</details>");
  }
  const output = result.join("\n");
  return interactive ? output : convertMergeMarkersForMpe(output);
}

// src/markdownIt.ts
function mergeTableCells(state) {
  const tokens = state.tokens;
  const removed = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "tbody_open") continue;
    const bodyStart = index;
    let bodyEnd = index;
    let depth = 0;
    for (let scan = index; scan < tokens.length; scan += 1) {
      if (tokens[scan].type === "tbody_open") depth += 1;
      if (tokens[scan].type === "tbody_close") {
        depth -= 1;
        if (depth === 0) {
          bodyEnd = scan;
          break;
        }
      }
    }
    const rows = [];
    let current = null;
    for (let scan = bodyStart + 1; scan < bodyEnd; scan += 1) {
      const token = tokens[scan];
      if (token.type === "tr_open") {
        current = [];
        rows.push(current);
        continue;
      }
      if (token.type === "td_open" && current) {
        const inline = scan + 1 < bodyEnd && tokens[scan + 1].type === "inline" ? scan + 1 : -1;
        let close = scan + 1;
        while (close < bodyEnd && tokens[close].type !== "td_close") close += 1;
        current.push({
          open: scan,
          inline,
          close,
          text: inline >= 0 ? tokens[inline].content.trim() : "",
          row: rows.length - 1,
          col: current.length,
          rowspan: 1,
          colspan: 1,
          hidden: false,
          parent: null
        });
      }
    }
    if (rows.length) {
      const width = Math.max.apply(null, rows.map((row) => row.length));
      const root = (row, col) => {
        let cell = rows[row] && rows[row][col] ? rows[row][col] : null;
        while (cell && cell.parent) cell = cell.parent;
        return cell;
      };
      for (let r = 0; r < rows.length; r += 1) {
        for (let c = 0; c < width; c += 1) {
          const cell = rows[r] && rows[r][c];
          if (!cell) continue;
          if (cell.text === "<" && c > 0) {
            const target = root(r, c - 1);
            if (target) {
              if (target.row === r) target.colspan += 1;
              cell.hidden = true;
              cell.parent = target;
            }
          } else if (cell.text === "^" && r > 0) {
            const target = root(r - 1, c);
            if (target) {
              if (target.col === c) target.rowspan += 1;
              cell.hidden = true;
              cell.parent = target;
            }
          }
        }
      }
      for (const row of rows) {
        for (const cell of row) {
          if (cell.hidden) {
            for (let scan = cell.open; scan <= cell.close; scan += 1) removed[scan] = true;
            continue;
          }
          if (cell.rowspan > 1) tokens[cell.open].attrSet("rowspan", String(cell.rowspan));
          if (cell.colspan > 1) tokens[cell.open].attrSet("colspan", String(cell.colspan));
        }
      }
    }
    index = bodyEnd;
  }
  if (removed.length) {
    state.tokens = tokens.filter((_token, position) => !removed[position]);
  }
}
function extendMarkdownIt(md) {
  md.set({ html: true });
  md.core.ruler.before("normalize", "starlog_preprocess", (state) => {
    state.src = transformMarkdown(state.src, { interactive: true });
  });
  md.core.ruler.push("starlog_table_merge", (state) => {
    mergeTableCells(state);
  });
  return md;
}

// src/core/sourceConvert.ts
function fenceMarker(line) {
  const match = line.match(/^\s*(`{3,}|~{3,})/);
  return match ? match[1][0] : null;
}
function escapePlainMarkdown(value) {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
}
function convertShowBoxesToMarkdown(markdown) {
  const lines = markdown.split("\n");
  const output = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = fenceMarker(line);
    if (marker) {
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      output.push(line);
      continue;
    }
    if (fence) {
      output.push(line);
      continue;
    }
    const start = line.match(/^\s*::show_begin\{([^}]*)\}\{([\s\S]*)\}\s*$/i);
    if (!start) {
      output.push(line);
      continue;
    }
    const body = [];
    let end = index + 1;
    while (end < lines.length && !/^\s*::show_end\s*$/i.test(lines[end])) {
      body.push(lines[end]);
      end += 1;
    }
    if (end >= lines.length) {
      output.push(line);
      continue;
    }
    const bodySource = body.join("\n");
    const variables = parseShowVariables(start[2], bodySource);
    const mappings = parseShowMappings(bodySource);
    const rendered = renderShowContent(bodySource, initialShowValues(variables), mappings);
    const title = start[1].trim() || "\u4EA4\u4E92\u5C55\u793A";
    output.push("**" + escapePlainMarkdown(title) + "**");
    output.push("");
    output.push(rendered);
    output.push("");
    index = end;
  }
  return output.join("\n");
}
function parseTableRow(line) {
  const trimmed = line.trim();
  if (trimmed.indexOf("|") < 0) return null;
  const source = trimmed.charAt(0) === "|" ? trimmed.slice(1) : trimmed;
  const withoutTrailing = source.slice(-1) === "|" && source.slice(-2) !== "\\|" ? source.slice(0, -1) : source;
  const cells = [];
  let current = "";
  let escaped = false;
  let codeTicks = 0;
  for (let index = 0; index < withoutTrailing.length; index += 1) {
    const char = withoutTrailing[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "`") {
      let count = 1;
      while (withoutTrailing[index + count] === "`") count += 1;
      current += new Array(count + 1).join("`");
      index += count - 1;
      codeTicks = codeTicks === count ? 0 : codeTicks === 0 ? count : codeTicks;
      continue;
    }
    if (char === "|" && codeTicks === 0) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return { cells };
}
function isAlignmentRow(row) {
  return Boolean(row && row.cells.length > 0 && row.cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell)));
}
function serializeTableRow(cells) {
  return "| " + cells.map((cell) => cell.trim()).join(" | ") + " |";
}
function expandMergedTableCells(markdown) {
  const lines = markdown.split("\n");
  const output = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = fenceMarker(line);
    if (marker) {
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      output.push(line);
      continue;
    }
    if (fence || line.indexOf("|") < 0) {
      output.push(line);
      continue;
    }
    let end = index;
    const group = [];
    while (end < lines.length && lines[end].trim() && lines[end].indexOf("|") >= 0) {
      group.push(lines[end]);
      end += 1;
    }
    const parsed = group.map(parseTableRow);
    if (group.length < 2 || !parsed[0] || !isAlignmentRow(parsed[1])) {
      output.push(line);
      continue;
    }
    const resolved = [];
    for (let rowIndex = 0; rowIndex < parsed.length; rowIndex += 1) {
      const row = parsed[rowIndex];
      if (!row) continue;
      const cells = row.cells.slice();
      if (rowIndex > 1) {
        for (let column = 0; column < cells.length; column += 1) {
          const token = cells[column].trim();
          if (token === "<") cells[column] = cells[column - 1] === void 0 ? "" : cells[column - 1];
          if (token === "^") {
            const above = resolved[rowIndex - 1];
            cells[column] = above && above[column] !== void 0 ? above[column] : "";
          }
        }
      }
      resolved[rowIndex] = cells;
      output.push(serializeTableRow(cells));
    }
    index = end - 1;
  }
  return output.join("\n");
}
function quotePrefix(depth) {
  return depth > 0 ? new Array(depth + 1).join("> ") : "";
}
function convertLuoguExtensionsToMarkdown(markdown) {
  const lines = markdown.split("\n");
  const output = [];
  const callouts = [];
  let fence = null;
  for (const line of lines) {
    const marker = fenceMarker(line);
    if (marker) {
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      output.push(quotePrefix(callouts.length) + line);
      continue;
    }
    if (fence) {
      output.push(quotePrefix(callouts.length) + line);
      continue;
    }
    if (/^\s*:{2,}cute-table\s*\{[^}]+\}\s*$/i.test(line)) continue;
    const close = line.match(/^\s*(:{3,})\s*$/);
    if (close && callouts.length > 0 && close[1].length >= callouts[callouts.length - 1]) {
      callouts.pop();
      output.push(quotePrefix(callouts.length).replace(/\s+$/, ""));
      continue;
    }
    const open = line.match(
      /^\s*(:{3,})(info|success|warning|error|note|tip|danger)(?:\[([\s\S]*?)\])?(?:\{open\})?\s*$/i
    );
    if (open) {
      callouts.push(open[1].length);
      const type = open[2].toLowerCase();
      const title = open[3] === void 0 || open[3] === "" ? CALLOUT_TITLES[type] : open[3];
      output.push(quotePrefix(callouts.length) + "**" + title + "**");
      output.push(quotePrefix(callouts.length).replace(/\s+$/, ""));
      continue;
    }
    output.push((quotePrefix(callouts.length) + line).replace(/\s+$/, ""));
  }
  return output.join("\n");
}
function convertMarkdownForCopy(markdown, target) {
  if (target === "direct") return markdown;
  const withoutBlogExtensions = convertShowBoxesToMarkdown(markdown);
  if (target === "luogu") return withoutBlogExtensions;
  return convertLuoguExtensionsToMarkdown(expandMergedTableCells(withoutBlogExtensions));
}

// src/mpeSetup.ts
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var vscode = __toESM(require("vscode"));
var MPE_EXTENSION_ID = "shd101wyy.markdown-preview-enhanced";
var BEGIN_MARK = "/* ===== starlog-markdown:begin ===== */";
var END_MARK = "/* ===== starlog-markdown:end ===== */";
var PARSER_MARK = "starlog-markdown:parser";
function crossnoteDirectory(scope) {
  if (scope === "global") return path.join(os.homedir(), ".crossnote");
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder || folder.uri.scheme !== "file") return void 0;
  return path.join(folder.uri.fsPath, ".crossnote");
}
function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return void 0;
  }
}
function mergeStyle(existing, block) {
  const wrapped = BEGIN_MARK + "\n" + block.trim() + "\n" + END_MARK + "\n";
  if (!existing || existing.indexOf(BEGIN_MARK) < 0) {
    return (existing ? existing.replace(/\s+$/, "") + "\n\n" : "") + wrapped;
  }
  const start = existing.indexOf(BEGIN_MARK);
  const end = existing.indexOf(END_MARK);
  if (end < start) return existing.replace(/\s+$/, "") + "\n\n" + wrapped;
  return existing.slice(0, start) + wrapped + existing.slice(end + END_MARK.length).replace(/^\n/, "");
}
function installMpeSupport(context, scope) {
  const directory = crossnoteDirectory(scope);
  if (!directory) throw new Error("\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u672C\u5730\u5DE5\u4F5C\u533A\u6587\u4EF6\u5939\uFF0C\u65E0\u6CD5\u5B89\u88C5\u5DE5\u4F5C\u533A\u7EA7 MPE \u652F\u6301\u3002");
  const parserSource = path.join(context.extensionPath, "resources", "mpe", "parser.js");
  const styleSource = path.join(context.extensionPath, "resources", "mpe", "style.less");
  const parser = fs.readFileSync(parserSource, "utf8");
  const style = fs.readFileSync(styleSource, "utf8");
  fs.mkdirSync(directory, { recursive: true });
  const parserTarget = path.join(directory, "parser.js");
  const existingParser = readIfExists(parserTarget);
  let parserBackup;
  if (existingParser !== void 0 && existingParser.indexOf(PARSER_MARK) < 0 && existingParser.trim()) {
    parserBackup = parserTarget + ".bak-" + Date.now();
    fs.writeFileSync(parserBackup, existingParser, "utf8");
  }
  fs.writeFileSync(parserTarget, parser, "utf8");
  const styleTarget = path.join(directory, "style.less");
  const existingStyle = readIfExists(styleTarget);
  fs.writeFileSync(styleTarget, mergeStyle(existingStyle, style), "utf8");
  return { directory, parserBackup, styleMerged: existingStyle !== void 0 };
}
function uninstallMpeSupport(scope) {
  const directory = crossnoteDirectory(scope);
  if (!directory) throw new Error("\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u672C\u5730\u5DE5\u4F5C\u533A\u6587\u4EF6\u5939\u3002");
  const parserTarget = path.join(directory, "parser.js");
  const existingParser = readIfExists(parserTarget);
  if (existingParser !== void 0 && existingParser.indexOf(PARSER_MARK) >= 0) {
    fs.unlinkSync(parserTarget);
  }
  const styleTarget = path.join(directory, "style.less");
  const existingStyle = readIfExists(styleTarget);
  if (existingStyle && existingStyle.indexOf(BEGIN_MARK) >= 0) {
    const start = existingStyle.indexOf(BEGIN_MARK);
    const end = existingStyle.indexOf(END_MARK);
    const cleaned = end >= start ? existingStyle.slice(0, start) + existingStyle.slice(end + END_MARK.length).replace(/^\n/, "") : existingStyle;
    fs.writeFileSync(styleTarget, cleaned.replace(/^\s+/, ""), "utf8");
  }
  return directory;
}
function installedParserVersion(scope) {
  const directory = crossnoteDirectory(scope);
  if (!directory) return void 0;
  const content = readIfExists(path.join(directory, "parser.js"));
  if (!content || content.indexOf(PARSER_MARK) < 0) return void 0;
  const match = content.match(/starlog-markdown:parser\s+v([0-9a-zA-Z.\-]+)/);
  return match ? match[1] : "unknown";
}
function isMpeInstalled() {
  return Boolean(vscode.extensions.getExtension(MPE_EXTENSION_ID));
}
async function enableExtendedTableSyntax() {
  const configuration = vscode.workspace.getConfiguration("markdown-preview-enhanced");
  if (configuration.get("enableExtendedTableSyntax")) return false;
  await configuration.update("enableExtendedTableSyntax", true, vscode.ConfigurationTarget.Global);
  return true;
}

// src/extension.ts
var STATE_PROMPTED = "starlog.mpePrompted";
function currentMarkdownEditor() {
  const editor = vscode2.window.activeTextEditor;
  if (editor && editor.document.languageId === "markdown") return editor;
  void vscode2.window.showWarningMessage("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A Markdown \u6587\u4EF6\u3002");
  return void 0;
}
async function pickScope() {
  const hasWorkspace = Boolean(vscode2.workspace.workspaceFolders && vscode2.workspace.workspaceFolders.length);
  const picks = [
    { label: "\u5168\u5C40\uFF08~/.crossnote\uFF09", description: "\u5BF9\u6240\u6709\u9879\u76EE\u751F\u6548\uFF0C\u63A8\u8350", scope: "global" },
    { label: "\u5F53\u524D\u5DE5\u4F5C\u533A\uFF08.crossnote\uFF09", description: hasWorkspace ? "\u53EA\u5BF9\u672C\u4ED3\u5E93\u751F\u6548" : "\u9700\u8981\u5148\u6253\u5F00\u6587\u4EF6\u5939", scope: "workspace" }
  ];
  const picked = await vscode2.window.showQuickPick(picks, { title: "\u5B89\u88C5\u5230\u54EA\u91CC\uFF1F", placeHolder: "\u9009\u62E9 Markdown Preview Enhanced \u914D\u7F6E\u76EE\u5F55" });
  return picked ? picked.scope : void 0;
}
async function runInstall(context, scope) {
  const target = scope || await pickScope();
  if (!target) return;
  try {
    const result = installMpeSupport(context, target);
    const switched = await enableExtendedTableSyntax();
    const notes = [`\u5DF2\u5199\u5165 ${result.directory}`];
    if (result.parserBackup) notes.push(`\u539F\u6709 parser.js \u5DF2\u5907\u4EFD\u4E3A ${result.parserBackup}`);
    if (switched) notes.push("\u5DF2\u5F00\u542F MPE \u7684\u300C\u6269\u5C55\u8868\u683C\u8BED\u6CD5\u300D\u4EE5\u652F\u6301\u5355\u5143\u683C\u5408\u5E76");
    const action = await vscode2.window.showInformationMessage(
      "Markdown Preview Enhanced \u652F\u6301\u5DF2\u5B89\u88C5\uFF1A" + notes.join("\uFF1B") + "\u3002\u91CD\u65B0\u6253\u5F00 MPE \u9884\u89C8\u5373\u53EF\u751F\u6548\u3002",
      "\u6253\u5F00\u914D\u7F6E\u76EE\u5F55"
    );
    if (action === "\u6253\u5F00\u914D\u7F6E\u76EE\u5F55") {
      await vscode2.commands.executeCommand("revealFileInOS", vscode2.Uri.file(result.directory));
    }
  } catch (error) {
    void vscode2.window.showErrorMessage("\u5B89\u88C5\u5931\u8D25\uFF1A" + String(error instanceof Error ? error.message : error));
  }
}
async function runUninstall() {
  const target = await pickScope();
  if (!target) return;
  try {
    const directory = uninstallMpeSupport(target);
    void vscode2.window.showInformationMessage("\u5DF2\u4ECE " + directory + " \u79FB\u9664\u672C\u6269\u5C55\u5199\u5165\u7684 MPE \u652F\u6301\u3002");
  } catch (error) {
    void vscode2.window.showErrorMessage("\u79FB\u9664\u5931\u8D25\uFF1A" + String(error instanceof Error ? error.message : error));
  }
}
async function copyConverted(target, label) {
  const editor = currentMarkdownEditor();
  if (!editor) return;
  const selection = editor.selection;
  const source = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
  await vscode2.env.clipboard.writeText(convertMarkdownForCopy(source, target));
  void vscode2.window.showInformationMessage("\u5DF2\u590D\u5236" + label + "\u5230\u526A\u8D34\u677F\u3002");
}
async function insertSnippet(snippet) {
  const editor = currentMarkdownEditor();
  if (!editor) return;
  await editor.insertSnippet(snippet);
}
async function insertCallout() {
  const types = ["info", "note", "tip", "success", "warning", "error", "danger"];
  const picked = await vscode2.window.showQuickPick(types, { title: "\u6298\u53E0\u6846\u7C7B\u578B" });
  if (!picked) return;
  await insertSnippet(
    new vscode2.SnippetString(
      ":::" + picked + "[${1:\u6807\u9898}]${2:{open\\}}\n$0\n:::\n"
    )
  );
}
async function maybePromptForMpe(context) {
  if (!vscode2.workspace.getConfiguration("starlog").get("mpe.promptForSetup", true)) return;
  if (!isMpeInstalled()) return;
  if (installedParserVersion("global") || installedParserVersion("workspace")) return;
  if (context.globalState.get(STATE_PROMPTED)) return;
  const action = await vscode2.window.showInformationMessage(
    "\u68C0\u6D4B\u5230 Markdown Preview Enhanced\u3002\u662F\u5426\u5B89\u88C5\u661F\u91CE\u7B14\u8BB0\u7279\u6B8A\u8BED\u6CD5\u652F\u6301\uFF08\u5C55\u793A\u6846 / \u6298\u53E0\u6846 / Tuack \u8868\u683C\uFF09\uFF1F",
    "\u5B89\u88C5\uFF08\u5168\u5C40\uFF09",
    "\u4EE5\u540E\u518D\u8BF4",
    "\u4E0D\u518D\u63D0\u793A"
  );
  if (action === "\u5B89\u88C5\uFF08\u5168\u5C40\uFF09") await runInstall(context, "global");
  if (action === "\u4E0D\u518D\u63D0\u793A") await context.globalState.update(STATE_PROMPTED, true);
}
function activate(context) {
  context.subscriptions.push(
    vscode2.commands.registerCommand("starlog.setupMpe", () => runInstall(context)),
    vscode2.commands.registerCommand("starlog.setupMpeGlobal", () => runInstall(context, "global")),
    vscode2.commands.registerCommand("starlog.setupMpeWorkspace", () => runInstall(context, "workspace")),
    vscode2.commands.registerCommand("starlog.removeMpe", () => runUninstall()),
    vscode2.commands.registerCommand("starlog.copyAsLuogu", () => copyConverted("luogu", "\u6D1B\u8C37\u6E90\u7801")),
    vscode2.commands.registerCommand("starlog.copyAsBasic", () => copyConverted("basic", "\u57FA\u672C Markdown \u6E90\u7801")),
    vscode2.commands.registerCommand(
      "starlog.insertShowBox",
      () => insertSnippet(
        new vscode2.SnippetString(
          "::show_begin{${1:\u6807\u9898}}{${2:a:Z=1[-5,5,1]}}\n$0\n::show_end\n"
        )
      )
    ),
    vscode2.commands.registerCommand("starlog.insertCallout", () => insertCallout()),
    vscode2.commands.registerCommand(
      "starlog.insertTuackTable",
      () => insertSnippet(
        new vscode2.SnippetString(
          "::cute-table{tuack}\n\n| ${1:\u8868\u5934} | ${2:\u8868\u5934} |\n| :-: | :-: |\n| ${3:\u5185\u5BB9} | < |\n| ^ | ${4:\u5185\u5BB9} |\n$0\n"
        )
      )
    ),
    vscode2.commands.registerCommand("starlog.openCheatsheet", async () => {
      const uri = vscode2.Uri.joinPath(context.extensionUri, "samples", "syntax-demo.md");
      const document = await vscode2.workspace.openTextDocument(uri);
      await vscode2.window.showTextDocument(document, { preview: false });
      await vscode2.commands.executeCommand("markdown.showPreviewToSide");
    })
  );
  void maybePromptForMpe(context);
  return {
    extendMarkdownIt(md) {
      return extendMarkdownIt(md);
    },
    /** 方便其他扩展/脚本复用的转换函数。 */
    convertMarkdownForCopy,
    mpeExtensionId: MPE_EXTENSION_ID
  };
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
