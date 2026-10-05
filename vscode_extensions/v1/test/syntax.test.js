'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const grammar = JSON.parse(fs.readFileSync(path.join(root, 'syntaxes/starlog-markdown.tmLanguage.json'), 'utf8'))
const snippets = JSON.parse(fs.readFileSync(path.join(root, 'snippets/starlog-markdown.json'), 'utf8'))
assert.equal(pkg.main, './extension.js')
assert.ok(pkg.contributes.grammars[0].injectTo.includes('text.html.markdown'))
assert.equal(grammar.scopeName, 'starlog.injection.markdown')
assert.match(grammar.repository.showBlock.begin, /show_begin/)
for (const prefix of ['showbox', 'callout', 'tuack', 'showvar', 'showexpr', 'showfloor', 'showceil', 'showmap']) {
  assert.ok(Object.values(snippets).some(item => item.prefix === prefix), `missing ${prefix}`)
}
console.log('Starlog extension manifest, grammar and snippets are valid.')
