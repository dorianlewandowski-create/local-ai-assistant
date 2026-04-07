import test from 'node:test';
import assert from 'node:assert/strict';
import { ollamaChatProvider, ollamaEmbeddingProvider, ollamaVisionProvider } from '../src/models/ollama';

test('ollama provider modules expose expected methods', () => {
  assert.equal(typeof ollamaChatProvider.chat, 'function');
  assert.equal(typeof ollamaEmbeddingProvider.embed, 'function');
  assert.equal(typeof ollamaVisionProvider.analyzeImage, 'function');
});
