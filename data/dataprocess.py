"""
dataprocess.py

What this file does:
- Reads `data/Dialogue.csv`.
- Checks the 4th CSV column (`Character ID`).
- When `Character ID == 5`, sends the dialogue text to the backend processing
  endpoint one-by-one (sequentially, waiting for each request to finish).

Parent/child context:
- Parent system: your local backend route mounted at `POST /upload`.
- Child data source: `Dialogue.csv` rows.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from urllib import request, error


def post_upload(endpoint: str, text: str, person: str, source: str) -> tuple[bool, str]:
    """
    Send one dialogue line to the backend upload endpoint.

    Inputs:
    - endpoint (str): URL for upload API, e.g. `http://localhost:3001/upload`.
    - text (str): Dialogue content to upload.
    - person (str): Persona namespace to store under (e.g. "hagrid").
    - source (str): Source label to store with each chunk.

    Outputs:
    - tuple[bool, str]:
      - success flag
      - response summary (doc id on success, error message on failure)
    """
    payload = json.dumps(
        {
            "text": text,
            "person": person,
            "source": source,
        }
    ).encode("utf-8")

    req = request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
        parsed = json.loads(body)
        doc_id = parsed.get("id", "no-id-returned")
        return True, str(doc_id)
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return False, f"HTTP {exc.code}: {body}"
    except Exception as exc:  # pragma: no cover
        return False, str(exc)


def upload_character_dialogue(
    csv_path: Path,
    endpoint: str,
    target_character_id: str,
    person: str,
    source: str,
    limit: int | None = None,
) -> tuple[int, int]:
    """
    Loop through Dialogue CSV and upload rows for one target character id.

    Inputs:
    - csv_path (Path): Path to `Dialogue.csv`.
    - endpoint (str): Backend upload URL.
    - target_character_id (str): Character ID to match (column 4), e.g. "5".
    - person (str): Persona name stored in backend.
    - source (str): Source label used for each upload.
    - limit (int | None): Optional max number of uploads for test runs.

    Outputs:
    - tuple[int, int]:
      - attempted uploads count
      - successful uploads count
    """
    attempted = 0
    successful = 0

    with csv_path.open("r", newline="", encoding="utf-8") as csv_file:
        reader = csv.reader(csv_file)
        header = next(reader, None)
        if not header:
            return attempted, successful

        for row in reader:
            if len(row) < 5:
                continue

            character_id = row[3].strip()
            dialogue_text = row[4].strip()

            if character_id != target_character_id or not dialogue_text:
                continue

            ok, info = post_upload(endpoint, dialogue_text, person, source)
            attempted += 1
            if ok:
                successful += 1
                print(f"[ok {attempted}] uploaded id={info}")
            else:
                print(f"[fail {attempted}] {info}")

            # Sequential flow by design: each request completes before next row.
            if limit is not None and attempted >= limit:
                break

    return attempted, successful


def main() -> int:
    """
    Parse CLI options and execute sequential dialogue uploads.

    Inputs:
    - CLI args:
      - --csv (default: data/Dialogue.csv)
      - --endpoint (default: http://localhost:3001/upload)
      - --character-id (default: 5)
      - --person (default: hagrid)
      - --source (default: dialogue)
      - --limit (optional test cap)

    Outputs:
    - int: Exit code (0 success path, 1 validation failure).
    """
    parser = argparse.ArgumentParser(
        description="Upload Dialogue.csv rows where Character ID matches a target."
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=Path(__file__).resolve().parent / "Dialogue.csv",
        help="Path to Dialogue.csv.",
    )
    parser.add_argument(
        "--endpoint",
        type=str,
        default="http://localhost:3001/upload",
        help="Upload endpoint URL.",
    )
    parser.add_argument(
        "--character-id",
        type=str,
        default="5",
        help="Character ID to match from column 4.",
    )
    parser.add_argument(
        "--person",
        type=str,
        default="hagrid",
        help="Person namespace sent to backend.",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="dialogue",
        help="Source label sent to backend.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional max number of matching rows to upload.",
    )
    args = parser.parse_args()

    csv_path = args.csv.resolve()
    if not csv_path.exists():
        print(f"CSV file not found: {csv_path}")
        return 1

    attempted, successful = upload_character_dialogue(
        csv_path=csv_path,
        endpoint=args.endpoint,
        target_character_id=args.character_id,
        person=args.person.strip().lower(),
        source=args.source.strip() or "dialogue",
        limit=args.limit,
    )
    print(
        f"Finished: attempted={attempted}, successful={successful}, failed={attempted - successful}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
