import { Redis } from '@upstash/redis';
import { readInput, canonicalize, toCanonical, fromCanonical, checkSolution } from '../lib/puzzle.js';

// Storage layout:
//   puzzle:<key>  hash { shape, counts, solution, firstSeen, seen }
//   puzzles       sorted set of keys, scored by times seen
const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const pkey = key => `puzzle:${key}`;

async function list(res) {
  const flat = await redis.zrange('puzzles', 0, 499, { rev: true, withScores: true });
  const keys = [];
  for (let i = 0; i < flat.length; i += 2) keys.push(flat[i]);
  if (!keys.length) return res.json({ distinct: 0, puzzles: [] });
  const p = redis.pipeline();
  for (const k of keys) p.hmget(pkey(k), 'shape', 'counts', 'seen', 'firstSeen');
  const rows = await p.exec();
  const puzzles = keys.map((key, i) => ({ key, ...rows[i] })).filter(r => r.shape);
  res.json({ distinct: await redis.zcard('puzzles'), puzzles });
}

async function seen(key) {
  const [count] = await Promise.all([redis.hincrby(pkey(key), 'seen', 1), redis.zincrby('puzzles', 1, key)]);
  return count;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await list(res);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use GET or POST.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const input = readInput(body);
    const frame = canonicalize(input);
    const stored = await redis.hget(pkey(frame.key), 'solution');

    if (body.action === 'lookup') {
      if (!stored) return res.json({ found: false });
      const count = await seen(frame.key);
      const placed = stored.map(p => ({ k: p.k, idx: fromCanonical(frame, p.cells) }));
      return res.json({ found: true, seen: count, placed, distinct: await redis.zcard('puzzles') });
    }

    if (body.action === 'save') {
      if (stored) return res.json({ saved: false, seen: await seen(frame.key) });
      checkSolution(input, body.placed);
      const solution = body.placed.map(p => ({ k: p.k, cells: toCanonical(frame, p.idx) }));
      const created = await redis.hsetnx(pkey(frame.key), 'solution', JSON.stringify(solution));
      if (!created) return res.json({ saved: false, seen: await seen(frame.key) });
      await redis.hset(pkey(frame.key), {
        shape: frame.shape,
        counts: Object.fromEntries(Object.entries(input.counts).filter(([, n]) => n > 0)),
        firstSeen: Date.now(),
      });
      const count = await seen(frame.key);
      return res.json({ saved: true, seen: count, distinct: await redis.zcard('puzzles') });
    }

    res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Request failed.' });
  }
}
