"""Embeddings: determinism, shape, JSONL reindex artifact."""
from __future__ import annotations

import json

import numpy as np

from app.llm import embeddings


def test_hashing_embedding_is_deterministic():
    a = embeddings.hashing_embed("teacher recruitment in Kaduna")
    b = embeddings.hashing_embed("teacher recruitment in Kaduna")
    assert np.array_equal(a, b)
    assert a.shape == (embeddings.EMBEDDING_DIM,)
    assert abs(float(a @ a) - 1.0) < 1e-9  # unit norm


def test_hashing_embedding_varies_with_text():
    a = embeddings.hashing_embed("teacher recruitment")
    b = embeddings.hashing_embed("mini-grid electrification")
    assert not np.array_equal(a, b)


def test_embed_texts_default_backend_deterministic():
    v1 = embeddings.embed_texts(["hello world", "policy twin"])
    v2 = embeddings.embed_texts(["hello world", "policy twin"])
    assert np.array_equal(v1, v2)
    assert v1.shape == (2, embeddings.EMBEDDING_DIM)


def test_reindex_writes_jsonl_artifact(tmp_path):
    out = tmp_path / "emb.jsonl"
    summary = embeddings.reindex(backend="hashing", out_path=str(out))
    assert summary["sink"] == str(out)
    assert summary["indexed"] > 0
    lines = out.read_text().strip().splitlines()
    assert len(lines) == summary["indexed"]
    row = json.loads(lines[0])
    assert row["passage_id"] and len(row["embedding"]) == embeddings.EMBEDDING_DIM


def test_cli_reindex(tmp_path, capsys):
    out = tmp_path / "cli.jsonl"
    rc = embeddings.main(["reindex", "--backend", "hashing", "--out", str(out)])
    assert rc == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["indexed"] > 0
