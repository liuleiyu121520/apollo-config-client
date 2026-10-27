'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const events = require('node:events');
const http = require('node:http');

const { httpGet } = require('../dist/http.js');
const { ApolloNetworkError } = require('../dist/index.js');

test('httpGet rejects unsupported protocols as ApolloNetworkError', async () => {
  await assert.rejects(
    httpGet('ftp://example.com/config', { timeoutMs: 20 }),
    (err) => {
      assert.ok(err instanceof ApolloNetworkError);
      assert.match(err.message, /unsupported URL protocol/);
      assert.strictEqual(err.url, 'ftp://example.com/config');
      return true;
    }
  );
});

test('httpGet wraps synchronous request construction failures and cleans up', async () => {
  const originalRequest = http.request;
  http.request = () => {
    throw new Error('request construction failed');
  };
  try {
    await assert.rejects(
      httpGet('http://example.com/config', { timeoutMs: 20 }),
      (err) => {
        assert.ok(err instanceof ApolloNetworkError);
        assert.match(err.message, /request construction failed/);
        return true;
      }
    );
  } finally {
    http.request = originalRequest;
  }
});

test('httpGet cleans up when request.end throws synchronously', async () => {
  const originalRequest = http.request;
  const controller = new AbortController();
  const request = new events.EventEmitter();
  let destroyCalls = 0;
  request.destroy = () => {
    destroyCalls += 1;
  };
  request.end = () => {
    throw new Error('request end failed');
  };
  http.request = () => request;
  try {
    await assert.rejects(
      httpGet('http://example.com/config', {
        timeoutMs: 20,
        signal: controller.signal,
      }),
      (err) => {
        assert.ok(err instanceof ApolloNetworkError);
        assert.match(err.message, /request end failed/);
        return true;
      }
    );
    assert.strictEqual(destroyCalls, 1);
    assert.strictEqual(events.getEventListeners(controller.signal, 'abort').length, 0);
  } finally {
    http.request = originalRequest;
  }
});
