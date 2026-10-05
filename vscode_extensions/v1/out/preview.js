"use strict";
(() => {
  // src/core/showBox.ts
  function splitTopLevel(input, separators = ",;") {
    const output = [];
    let start2 = 0;
    let depth = 0;
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      if ("([{".indexOf(char) >= 0) depth += 1;
      if (")]}".indexOf(char) >= 0) depth = Math.max(0, depth - 1);
      if (depth === 0 && separators.indexOf(char) >= 0) {
        const piece = input.slice(start2, index).trim();
        if (piece) output.push(piece);
        start2 = index + 1;
      }
    }
    const rest = input.slice(start2).trim();
    if (rest) output.push(rest);
    return output;
  }
  function mappingValue(mapping, key) {
    for (const pair of mapping.values) if (pair[0] === key) return pair[1];
    return void 0;
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
  function clampShowVariable(variable, raw) {
    if (variable.type === "string") return raw.slice(0, variable.maxLength === void 0 ? 100 : variable.maxLength);
    const number = Number(raw);
    if (!isFinite(number)) return variable.initial;
    const limited = Math.min(
      variable.max === void 0 ? number : variable.max,
      Math.max(variable.min === void 0 ? number : variable.min, number)
    );
    return variable.type === "integer" ? Math.round(limited) : limited;
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

  // src/preview/preview.ts
  var memory = {};
  function readModel(element) {
    const raw = element.getAttribute("data-sl-model");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(raw));
      if (!parsed || !parsed.variables) return null;
      return { variables: parsed.variables, mappings: parsed.mappings || [] };
    } catch {
      return null;
    }
  }
  function refresh(box, model, values) {
    const spans = box.querySelectorAll("[data-sl-kind]");
    for (let index = 0; index < spans.length; index += 1) {
      const span = spans[index];
      const kind = span.getAttribute("data-sl-kind") || "show";
      const arg = span.getAttribute("data-sl-arg") || "";
      span.textContent = evaluateShowToken({ kind, arg }, values, model.mappings);
    }
  }
  function setupBox(box) {
    if (box.getAttribute("data-sl-ready") === "true") return;
    const model = readModel(box);
    if (!model) return;
    box.setAttribute("data-sl-ready", "true");
    const key = box.getAttribute("data-sl-box") || "";
    const values = {};
    for (const variable of model.variables) values[variable.name] = variable.initial;
    const remembered = memory[key];
    if (remembered) {
      for (const variable of model.variables) {
        if (Object.prototype.hasOwnProperty.call(remembered, variable.name)) {
          values[variable.name] = remembered[variable.name];
        }
      }
    }
    memory[key] = values;
    const inputs = box.querySelectorAll("[data-sl-input]");
    const byName = {};
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      const name = input.getAttribute("data-sl-input") || "";
      if (!byName[name]) byName[name] = [];
      byName[name].push(input);
    }
    const variableByName = {};
    for (const variable of model.variables) variableByName[variable.name] = variable;
    const sync = (name, source) => {
      const text = showValueKey(values[name]);
      for (const input of byName[name] || []) {
        if (input !== source && input.value !== text) input.value = text;
      }
    };
    for (const name of Object.keys(byName)) {
      for (const input of byName[name]) {
        input.addEventListener("input", () => {
          const variable = variableByName[name];
          if (!variable) return;
          const next = clampShowVariable(variable, input.value);
          values[name] = next;
          memory[key] = values;
          sync(name, input);
          refresh(box, model, values);
        });
        input.addEventListener("change", () => {
          sync(name);
        });
      }
      sync(name);
    }
    refresh(box, model, values);
  }
  function setupAll() {
    const boxes = document.querySelectorAll(".starlog-showbox[data-sl-model]");
    for (let index = 0; index < boxes.length; index += 1) setupBox(boxes[index]);
  }
  function start() {
    setupAll();
    const observer = new MutationObserver(() => setupAll());
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
