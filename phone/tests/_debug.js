/* 临时诊断：用夹具的解析器检查 DOM 与 phone.js 的入口检测 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PHONE = path.resolve(__dirname, '..');
const harness = fs.readFileSync(path.join(__dirname, 'dom-harness.js'), 'utf8');

// 取出解析器相关代码：直接 eval 夹具里的函数定义
const sandbox = { console, require, module: {}, exports: {}, __dirname, process };
sandbox.global = sandbox;
vm.createContext(sandbox);

// 只执行到 parseHtml 定义结束（避开 main() 调用）
const cut = harness.indexOf('/* ------------------------------------------------------------------ Supabase 桩 */');
const head = harness.slice(0, cut)
  .replace(/^'use strict';/m, '')
  .replace(/const PHONE = [^\n]*\n/, '')
  .replace(/const problems = \[\];\nconst notes = \[\];/, 'const problems = []; const notes = [];');
try {
  vm.runInContext(head + '\nthis.parseHtml = parseHtml; this.FakeElement = FakeElement;', sandbox);
} catch (e) {
  console.log('提取解析器失败:', e.message);
  process.exit(1);
}

const html = fs.readFileSync(path.join(PHONE, 'chat.html'), 'utf8');
const root = sandbox.parseHtml(html);
const byId = new Map();
(function walk(n) {
  if (n.attributes && n.attributes.id) byId.set(n.attributes.id, n);
  (n.children || []).forEach(walk);
})(root);

console.log('解析到 id 数量:', byId.size);
console.log('前 14 个:', Array.from(byId.keys()).slice(0, 14).join(', '));
console.log('chatView 存在:', byId.has('chatView'), '| app 存在:', byId.has('app'), '| list 存在:', byId.has('list'));

const fakeDoc = {
  getElementById: id => byId.get(id) || null,
  querySelector: sel => root.querySelector(sel),
  querySelectorAll: sel => root.querySelectorAll(sel),
};
console.log("检测 document.getElementById('chatView'):", !!fakeDoc.getElementById('chatView'));
console.log("检测 document.getElementById('app'):", !!fakeDoc.getElementById('app'));
console.log('tab-pane 命中数:', fakeDoc.querySelectorAll('.tab-pane').length);
console.log('tab-item 命中数:', fakeDoc.querySelectorAll('.tab-item').length);
