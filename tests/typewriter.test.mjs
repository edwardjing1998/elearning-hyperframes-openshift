import test from 'node:test';
import assert from 'node:assert/strict';
import {typewriterFrame,typewriterUnits} from '../public/capture-studio/typewriter.js';
test('character mode progressively reveals text including newlines',()=>{
  assert.equal(typewriterFrame('abc\ndef',{mode:'character',delay_ms:50},0).text,'a');
  assert.equal(typewriterFrame('abc\ndef',{mode:'character',delay_ms:50},100).text,'abc');
  assert.equal(typewriterFrame('abc\ndef',{mode:'character',delay_ms:50},1000).text,'abc\ndef');
});
test('line mode preserves source formatting',()=>{
  assert.deepEqual(typewriterUnits('one\ntwo\nthree','line'),['one\n','two\n','three']);
  assert.equal(typewriterFrame('one\ntwo\nthree',{mode:'line',delay_ms:100},100).text,'one\ntwo\n');
});
test('emoji are never divided into surrogate halves',()=>{
  assert.equal(typewriterFrame('🙂x',{mode:'character',delay_ms:50},0).text,'🙂');
});
