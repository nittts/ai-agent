import { describe, it, expect } from 'vitest';
import { SseReader } from '../../src/shared/sse/sse-reader';

describe('SseReader', () => {
  it('recognises CRLF-terminated events — the format Gemini actually sends', () => {
    const reader = new SseReader();
    expect(reader.feed('data: {"a":1}\r\n\r\ndata: {"a":2}\r\n\r\n')).toEqual([
      '{"a":1}',
      '{"a":2}',
    ]);
  });

  it('recognises LF-terminated events', () => {
    expect(new SseReader().feed('data: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('recognises bare CR, also permitted by the specification', () => {
    expect(new SseReader().feed('data: {"a":1}\r\r')).toEqual(['{"a":1}']);
  });

  it('holds a partial event across socket reads', () => {
    const reader = new SseReader();

    expect(reader.feed('data: {"te')).toEqual([]);
    expect(reader.feed('xt":"hi"}\r\n\r\n')).toEqual(['{"text":"hi"}']);
  });

  it('joins multiple data: lines belonging to one event', () => {
    expect(new SseReader().feed('data: line1\ndata: line2\n\n')).toEqual(['line1\nline2']);
  });

  it('ignores comments and non-data fields', () => {
    const reader = new SseReader();
    expect(reader.feed(': keep-alive\nevent: ping\nid: 7\n\n')).toEqual([]);
    expect(reader.feed('event: msg\ndata: {"ok":true}\n\n')).toEqual(['{"ok":true}']);
  });

  it('tolerates a missing space after data:', () => {
    expect(new SseReader().feed('data:{"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('exposes the unterminated remainder for diagnosing truncated streams', () => {
    const reader = new SseReader();
    reader.feed('data: {"incomplete":');
    expect(reader.remainder()).toContain('incomplete');
  });

  it('parses a realistic Gemini stream end to end', () => {
    const raw =
      'data: {"candidates":[{"content":{"parts":[{"text":"You have "}],"role":"model"}}]}\r\n\r\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"30 days."}],"role":"model"}}]}\r\n\r\n' +
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":57,"candidatesTokenCount":22}}\r\n\r\n';

    const events = new SseReader().feed(raw).map((p) => JSON.parse(p));

    const text = events
      .flatMap((e) => e.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '')
      .join('');

    expect(text).toBe('You have 30 days.');
    expect(events.at(-1)?.usageMetadata).toEqual({
      promptTokenCount: 57,
      candidatesTokenCount: 22,
    });
  });

  it('produces identical results regardless of how the socket slices the bytes', () => {
    const raw =
      'data: {"candidates":[{"content":{"parts":[{"text":"abc"}]}}]}\r\n\r\n' +
      'data: {"usageMetadata":{"promptTokenCount":5}}\r\n\r\n';

    const wholeAtOnce = new SseReader().feed(raw);

    const byByte = new SseReader();
    const sliced: string[] = [];
    for (const ch of raw) sliced.push(...byByte.feed(ch));

    expect(sliced).toEqual(wholeAtOnce);
  });
});
