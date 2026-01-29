#!/usr/bin/env python3
"""Fetch plugin repos and aggregate contributors into a local JSON file."""

import argparse
import asyncio
import json
import os
import re
import time
from typing import Dict, Iterable, List, Optional, Tuple

import aiohttp
from tqdm import tqdm

PLUGINS_API = "https://api.soulter.top/astrbot/plugins"
GITHUB_API = "https://api.github.com/repos/{owner}/{repo}/contributors"
OUT_FILE = "plugins-contributors.json"


def parse_repo_info(plugin: Dict) -> Optional[Dict[str, str]]:
    repo_field = (
        plugin.get("repo")
        or plugin.get("repository")
        or plugin.get("github")
        or plugin.get("url")
        or ""
    )
    if not repo_field:
        return None

    if "github.com" in repo_field:
        match = re.search(r"github.com/([\w.-]+)/([\w.-]+)", repo_field, re.I)
        if match:
            return {"owner": match.group(1), "name": match.group(2)}

    parts = repo_field.split("/")
    if len(parts) == 2:
        return {"owner": parts[0], "name": parts[1]}

    return None


def normalize_plugins_payload(payload) -> Iterable[Dict]:
    if isinstance(payload, dict):
        return payload.values()
    if isinstance(payload, list):
        return payload
    return []


async def fetch_json(session: aiohttp.ClientSession, url: str) -> Optional[object]:
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
        if resp.status == 200:
            return await resp.json()
        return None


async def fetch_contributors(
    session: aiohttp.ClientSession,
    repo: Dict[str, str],
    sem: asyncio.Semaphore,
    retries: int,
) -> Tuple[Dict[str, str], Optional[List[Dict]], Optional[str]]:
    url = GITHUB_API.format(owner=repo["owner"], repo=repo["name"])
    for attempt in range(retries + 1):
        try:
            async with sem:
                async with session.get(
                    url, timeout=aiohttp.ClientTimeout(total=30)
                ) as resp:
                    if resp.status == 200:
                        return repo, await resp.json(), None
                    if resp.status in (403, 429) and attempt < retries:
                        print(
                            f"Rate limited when fetching {repo['owner']}/{repo['name']}, "
                            f"retrying... (attempt {attempt + 1})"
                        )
                        await asyncio.sleep(1.5 + attempt)
                        continue
                    return repo, None, f"{resp.status}"
        except asyncio.TimeoutError:
            if attempt < retries:
                await asyncio.sleep(1.0 + attempt)
                continue
            return repo, None, "timeout"
        except aiohttp.ClientError as exc:
            return repo, None, str(exc)
    return repo, None, "unknown"


async def main_async(concurrency: int, retries: int, token: Optional[str]) -> None:
    headers = {"User-Agent": "astrbot-contributors-script"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with aiohttp.ClientSession(headers=headers) as session:
        plugins_payload = await fetch_json(session, PLUGINS_API)
        if plugins_payload is None:
            raise RuntimeError("Failed to fetch plugin list.")

        repos = []
        for plugin in normalize_plugins_payload(plugins_payload):
            info = parse_repo_info(plugin)
            if info:
                repos.append(info)

        repos = list({(r["owner"], r["name"]): r for r in repos}.values())
        sem = asyncio.Semaphore(concurrency)

        tasks = [
            fetch_contributors(session, repo, sem=sem, retries=retries) for repo in repos
        ]

        contributors_map: Dict[str, Dict] = {}
        skipped = []

        with tqdm(total=len(tasks), desc="Fetching contributors") as pbar:
            for coro in asyncio.as_completed(tasks):
                repo, contributors, error = await coro
                pbar.update(1)
                if not contributors:
                    skipped.append({"repo": repo, "error": error})
                    continue
                for c in contributors:
                    key = c.get("login") or c.get("name")
                    if not key:
                        continue
                    existing = contributors_map.get(key, {})
                    contributors_map[key] = {
                        **c,
                        "contributions": existing.get("contributions", 0)
                        + c.get("contributions", 0),
                    }
        
        print(contributors_map)

        output = {
            "generated_at": int(time.time()),
            "repo_count": len(repos),
            "contributor_count": len(contributors_map),
            "contributors": sorted(
                contributors_map.values(),
                key=lambda x: x.get("contributions", 0),
                reverse=True,
            ),
            "skipped": skipped,
        }

        with open(OUT_FILE, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(
            f"Saved {output['contributor_count']} contributors from "
            f"{output['repo_count']} repos -> {OUT_FILE}\n"
            f"Skipped {len(skipped)} repos."
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--token-file", type=str, default=".github_token")
    args = parser.parse_args()

    token = None
    if args.token_file and os.path.exists(args.token_file):
        with open(args.token_file, "r", encoding="utf-8") as f:
            token = f.read().strip() or None

    asyncio.run(main_async(args.concurrency, args.retries, token))


if __name__ == "__main__":
    main()
