#!/usr/bin/env python3
"""Recreate the four PRO fixtures from their documented primary sources.

The soil run's header records the current run time, so its hash will differ.
Requires a local SNOWPACK 3.7.0 installation with bundled examples.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path


SNOWPACK_COMMIT = "95551b6dfbb0a8e2d3df81c77ea4567a293116c5"
SNOWPACK_ARCHIVE = (
    "https://gitlabext.wsl.ch/api/v4/projects/32/repository/archive.tar.gz"
    f"?sha={SNOWPACK_COMMIT}"
)
NIVIZ_EXAMPLE = "https://niviz.org/resources/example.pro"
DEFAULT_INSTALL = Path("/Applications/Snowpack")
FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
CACHE_EXAMPLES = Path(__file__).resolve().parents[1] / ".cache/examples"
SEASON_SHA256 = "0fa1c925b4f9c2da16098715923211e4d3d857b10098548946c9bda685f6956a"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", type=Path, default=DEFAULT_INSTALL)
    parser.add_argument("--output", type=Path, default=FIXTURES)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    CACHE_EXAMPLES.mkdir(parents=True, exist_ok=True)
    install = args.install.resolve()

    with urllib.request.urlopen(NIVIZ_EXAMPLE) as response:
        (output / "niviz-example.pro").write_bytes(response.read())

    with tempfile.TemporaryDirectory(prefix="snowpack-fixtures-") as temp:
        temp = Path(temp)
        archive = temp / "snowpack.tar.gz"
        with urllib.request.urlopen(SNOWPACK_ARCHIVE) as response:
            archive.write_bytes(response.read())
        with tarfile.open(archive, "r:gz") as source:
            member = next(
                item for item in source.getmembers()
                if item.name.endswith("/tests/albedo/output/WFJ2_res.pro")
            )
            with source.extractfile(member) as data:
                (output / "snowpack-albedo-WFJ2.pro").write_bytes(data.read())

        examples = install / "share/doc/snowpack/examples"
        source_season = examples / "output/MST96_oper.497.1220.EtSDt.pro"
        if sha256(source_season) != SEASON_SHA256:
            raise RuntimeError("Bundled full-season example differs from the pinned SHA-256")
        season = CACHE_EXAMPLES / "snowpack-large-MST96.pro"
        staged_season = season.with_suffix(".pro.tmp")
        try:
            shutil.copyfile(source_season, staged_season)
            staged_season.replace(season)
        finally:
            staged_season.unlink(missing_ok=True)

        run = temp / "soil-run"
        run.mkdir()
        (run / "output").mkdir()
        (run / "input").symlink_to(examples / "input", target_is_directory=True)
        shutil.copyfile(examples / "cfgfiles/io_soil.ini", run / "io_soil.ini")
        command = [
            str(install / "bin/snowpack"), "-c", "io_soil.ini",
            "-e", "2010-10-03T01:00",
        ]
        with (run / "run.log").open("w") as log:
            subprocess.run(command, cwd=run, stdout=log, stderr=subprocess.STDOUT,
                           check=True)
        result = run / "output/gems.pro"
        if not result.exists():
            raise RuntimeError((run / "run.log").read_text())
        shutil.copyfile(result, output / "snowpack-soil-gems.pro")

    for path in sorted(output.glob("*.pro")):
        print(f"{path.name}\t{path.stat().st_size}\t{sha256(path)}")
    print(f"{season}\t{season.stat().st_size}\t{sha256(season)}")


if __name__ == "__main__":
    main()
