# Corpus — index once, search the whole library

A single video's scene graph is a persistent, content-addressed artifact (see [ARCHITECTURE.md](ARCHITECTURE.md) and the on-disk cache). The **corpus** is just the set of those graphs. Two commands turn it into a searchable library:

```bash
vintel index ./clips          # analyze every video under ./clips (instant for cached ones)
vintel search "goal scored"   # search across ALL indexed videos at once
```

This is the thing a stateless, per-call native-ingest API structurally **cannot** do: it has no persistent index to search. Here, you pay to analyze each video once; every query after that is free and instant.

## `vintel index <dir>`

Walks `<dir>` for videos (`.mp4 .mov .webm .mkv .m4v .avi .m3u8`) and analyzes each into the persistent scene-graph cache. A video that's already been analyzed with the same options is a **cache hit** — instant, no pipeline run. New videos run the full pipeline and are cached for next time.

| Flag | Effect |
|---|---|
| `--no-recursive` | Don't descend into subdirectories |
| `--entities` | Also run entity tracking (cloud SAM2; slower) |
| `--no-actions` | Skip action/caption recognition (smaller index, less "see" text to search) |
| `-l, --language <iso>` | Transcription language hint |

Progress is printed to stderr (`✓` analyzed, `•` cached, `✖` failed); the JSON summary (counts + per-video duration/scene count) goes to stdout, so you can pipe it.

## `vintel search "<query>"`

Searches across **every** video in the corpus and returns ranked hits, each citing its source video and timestamp.

```bash
vintel search "whiteboard diagram"
vintel search "penalty" --kind see,read       # only visual captions + on-screen text
vintel search "intro" --from product-demos     # only sources whose path contains "product-demos"
vintel search "q3 revenue" -k 5                 # top 5
```

What it searches — every text track each scene graph already carries:

| Kind | Source |
|---|---|
| `hear` | spoken audio (transcript) |
| `read` | on-screen text (OCR), condensed into stable lines |
| `see` | visual captions / action labels |
| `entity` | tracked entity labels |
| `chapter` | chapter titles + summaries |

### How ranking works (and its current limit)

v1 corpus search is **lexical**: it scores each text unit by the fraction of (non-stopword) query terms it contains, weights by track kind (a chapter title or visible caption counts a little more than an incidental transcript word), and adds a boost when the unit contains the query as a phrase. Fast, offline (works in lite mode), zero extra model calls, instant from cache.

It is **not** embedding-based semantic search yet — "car" won't match "vehicle". That's the next step on the [roadmap](../ROADMAP.md) (embed the text tracks, swap the scorer); the index/dedupe/ranking plumbing already in place is designed for it.

## The corpus *is* the cache

There's no separate corpus store. `search` reads the same `~/.vzt-video-intel/graphs/` cache that `analyze`/`observe` write, deduped to one graph per physical video (newest wins; paths are normalized so `a/b.mp4` and `a\b.mp4` are one video). So:

- `vintel cache list` shows what's in the corpus.
- Anything you've ever `analyze`d is already searchable — `index` just bulk-fills the cache for a directory.
- `vintel cache clear` empties the corpus.

## From Claude (MCP)

The same capability is exposed as two MCP tools — `index_corpus` then `search_corpus` — so you can ask Claude *"index ./clips, then find every moment someone mentions pricing"* and it will build the library and query across all of it. See the tool list in the [README](../README.md).
