import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  markdownTypeAfterInput,
  markdownTypeForMarker,
} from '../src/lib/markdown.ts'

test('markdown block shortcuts trigger after a trailing space', () => {
  assert.equal(markdownTypeAfterInput('# '), 'h1')
  assert.equal(markdownTypeAfterInput('## '), 'h2')
  assert.equal(markdownTypeAfterInput('### '), 'h3')
  assert.equal(markdownTypeAfterInput('- '), 'bullet')
  assert.equal(markdownTypeAfterInput('1. '), 'number')
  assert.equal(markdownTypeAfterInput('[] '), 'todo')
  assert.equal(markdownTypeAfterInput('> '), 'quote')
  assert.equal(markdownTypeAfterInput('! '), 'callout')
  assert.equal(markdownTypeAfterInput('``` '), 'code')
  assert.equal(markdownTypeAfterInput('--- '), 'divider')
})

test('markdown shortcuts need a complete marker and separating space', () => {
  assert.equal(markdownTypeAfterInput('#'), null)
  assert.equal(markdownTypeAfterInput('# Heading'), null)
  assert.equal(markdownTypeAfterInput(' # '), null)
  assert.equal(markdownTypeForMarker('##'), 'h2')
  assert.equal(markdownTypeForMarker('# '), null)
})

test('markdown aliases keep the convenient list forms working', () => {
  assert.equal(markdownTypeAfterInput('* '), 'bullet')
  assert.equal(markdownTypeAfterInput('+ '), 'bullet')
  assert.equal(markdownTypeAfterInput('[ ] '), 'todo')
})
