"""Build a developer-only Graphify index from approved source at git HEAD."""
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path, PurePosixPath
from secrets import token_hex
from tempfile import TemporaryDirectory
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
RELEASE = "0.9.120"

# dist is the hand-maintained app. Vendor bundles, books, dictionaries, user
# imports, landing-page excerpts and other asset/data subtrees are not inputs.
def source_path(path):
    if (path.parent == PurePosixPath("dist") and path.suffix == ".js"
            and path.name not in {"data.js", "english-verbs.js"}):
        return PurePosixPath(path.name)
    return None


def publish_graph(graph):
    destination = ROOT / "graphify-out"
    try:
        destination.mkdir()
    except FileExistsError:
        pass
    try:
        # Do not follow a symlink, even if it changes just before publication.
        directory_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as error:
        raise SystemExit("graphify-out must be a real directory in this checkout.") from error
    pending = f".graph-{token_hex(16)}.tmp"
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        with graph.open("rb") as source:
            temp_fd = os.open(pending, flags, 0o600, dir_fd=directory_fd)
            try:
                with os.fdopen(temp_fd, "wb") as out:
                    shutil.copyfileobj(source, out)
                os.replace(pending, "graph.json", src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
            finally:
                try:
                    os.unlink(pending, dir_fd=directory_fd)
                except FileNotFoundError:
                    pass
    finally:
        os.close(directory_fd)


def main():
    if os.name != "posix":
        raise SystemExit("Run this local developer tool on macOS or Linux.")
    destination = ROOT / "graphify-out"
    if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
        raise SystemExit("graphify-out must be a real directory in this checkout.")
    try:
        installed = version("graphifyy")
    except PackageNotFoundError:
        installed = None
    if installed != RELEASE:
        raise SystemExit(f"Install graphifyy=={RELEASE} in a separate venv (see README).")
    # Always read this checkout; ignore inherited overrides and forbid Git
    # transports (a partial clone needs the selected blobs available offline).
    git_env = {key: value for key, value in os.environ.items()
               if not key.upper().startswith("GIT_")}
    git_env.update(GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1", GIT_ALLOW_PROTOCOL="")
    top = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"], cwd=ROOT, env=git_env
    ).rstrip(b"\r\n")
    if Path(os.fsdecode(top)).resolve() != ROOT:
        raise SystemExit("Run this tool from a Git checkout of this project.")
    entries = subprocess.check_output(
        ["git", "ls-tree", "-rz", "--full-tree", "HEAD"], cwd=ROOT, env=git_env
    ).split(b"\0")
    with TemporaryDirectory(prefix="local-code-graph-") as tmp:
        temp = Path(tmp)
        src, home = temp / "source", temp / "home"
        src.mkdir()
        home.mkdir()
        count = 0
        for entry in filter(None, entries):
            meta, name = entry.split(b"\t", 1)
            mode, kind, sha = meta.split(b" ")
            if kind != b"blob" or mode not in (b"100644", b"100755"):
                continue  # Never dereference symlinks or enter submodules.
            rel = source_path(PurePosixPath(os.fsdecode(name)))
            if rel is None:
                continue
            target = src / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("wb") as out:
                subprocess.run(["git", "cat-file", "blob", sha.decode("ascii")],
                               cwd=ROOT, env=git_env, stdout=out, check=True)
            count += 1
        if not count:
            raise SystemExit("No approved committed source files to index.")
        # No project configs, credentials, hooks, provider keys or user plugins.
        env = {"HOME": str(home), "USERPROFILE": str(home), "PATH": os.defpath,
               "GRAPHIFY_NO_AUTO_REFRESH": "1", "GRAPHIFY_QUERY_LOG_DISABLE": "1",
               "PYTHONUTF8": "1"}
        subprocess.run([sys.executable, "-I", "-m", "graphify", "extract", ".", "--code-only"],
                       cwd=src, env=env, check=True)
        # Only publish a complete graph; no temp paths or caches from the extractor.
        publish_graph(src / "graphify-out" / "graph.json")
    print(f"Indexed {count} committed source files: graphify-out/graph.json")


if __name__ == "__main__":
    main()
