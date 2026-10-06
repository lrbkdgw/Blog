/* starlog-markdown:parser v1.0.0 — 由 VS Code 扩展「星野笔记特殊语法」自动生成，请勿手工修改。
 * 作用：让 Markdown Preview Enhanced 识别 ::show_begin / :::info / ::cute-table 等语法。
 * 移除方式：命令面板 → 「星野笔记: 移除 Markdown Preview Enhanced 支持」。
 */
(function () {
  var module = { exports: {} };
  var exports = module.exports;
  "use strict";
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
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
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/mpe/parserEntry.ts
  var parserEntry_exports = {};
  __export(parserEntry_exports, {
    default: () => parserEntry_default
  });
  module.exports = __toCommonJS(parserEntry_exports);

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

  // src/mpe/parserEntry.ts
  var parser = {
    /** MPE 解析前的钩子：把 Blog 特殊语法展开成 Markdown + HTML。 */
    onWillParseMarkdown: async function(markdown) {
      try {
        return transformMarkdown(markdown, { interactive: false });
      } catch (error) {
        return markdown;
      }
    },
    /** 解析后的钩子：目前不需要改动 HTML，保留以便将来扩展。 */
    onDidParseMarkdown: async function(html) {
      return html;
    }
  };
  var parserEntry_default = parser;

  var api = module.exports && module.exports.default ? module.exports.default : module.exports;
  return {
    onWillParseMarkdown: function (markdown) {
      return api.onWillParseMarkdown(markdown);
    },
    onDidParseMarkdown: function (html) {
      return api.onDidParseMarkdown(html);
    }
  };
})()
