#!/usr/bin/env python3
"""Portable cloud-agent setup. Canonical source: platform-infra/scripts/agent_env.py.

Vendored byte-for-byte into components; requires only Python 3.11+.
Bootstrap never authenticates, starts services, or invokes a doctor recipe.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

PROFILES = ("observer", "operator")
ROOT = Path(__file__).resolve().parents[1]


class SetupError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def run(args, *, cwd=None, capture=False):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=capture, check=False)
    if result.returncode:
        # A credential tool's stderr can contain credentials or provider responses.
        raise SetupError(
            f"{args[0]} failed (exit {result.returncode}); run its non-secret diagnostics"
        )
    return result.stdout.strip() if capture else ""


def load(path):
    return json.loads(path.read_text())


def manifest(path):
    data = load(path / ".agent-env.json")
    if data.get("version") != 1:
        raise SetupError(f"unsupported manifest in {path}")
    if "component" not in data:
        raise SetupError(f"missing component in {path}")
    for command in data["bootstrap"]:
        if (
            not isinstance(command, list)
            or not command
            or not all(isinstance(x, str) for x in command)
        ):
            raise SetupError("bootstrap commands must be argv arrays")
    return data


def check_credentials(profile):
    actual = os.environ.get("SM_AGENT_PROFILE")
    if actual != profile:
        raise SetupError(f"set SM_AGENT_PROFILE={profile} in the selected environment")
    files = {
        name: Path(value)
        for name in ("GOOGLE_APPLICATION_CREDENTIALS", "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE")
        if (value := os.environ.get(name))
    }
    config = Path(os.environ.get("CLOUDSDK_CONFIG", Path.home() / ".config/gcloud"))
    default_adc = config / "application_default_credentials.json"
    if default_adc.exists():
        files["default ADC"] = default_adc
    for name, path in files.items():
        if load(path).get("type") != "external_account":
            raise SetupError(f"{name} must refer to federated external_account credentials")
    if any(
        os.environ.get(k)
        for k in (
            "CLOUDFLARE_API_TOKEN",
            "SENTRY_AUTH_TOKEN",
            "URCHIN_INTERNAL_API_TOKEN",
        )
    ):
        raise SetupError(
            "use server adapters, not generic provider tokens in the agent environment"
        )
    # dbt-monitor is the supported dbt control-plane client. Its dedicated
    # per-profile token uses DBT_CLOUD_API_TOKEN; the provider enforces its
    # permissions. Presence/absence here cannot establish read-only scope.


def command_plan(data, path):
    commands = []
    if python := data.get("python"):
        commands.append(["uv", "python", "install", "--no-bin", python])
    commands.extend(data["bootstrap"])
    return commands


def install_tools(root):
    """Install reviewed binaries into this checkout, never system directories."""
    lock = load(root / ".agent-tools.json")
    system = platform.system().lower() + "-" + platform.machine()
    if system not in lock["platforms"]:
        raise SetupError(
            "managed tools support Linux x86_64/aarch64; use existing pinned tools locally"
        )
    target = root / ".agent-tools"
    binary_dir = target / "bin"
    binary_dir.mkdir(parents=True, exist_ok=True)
    for name, entry in lock["platforms"][system].items():
        if not entry["url"].startswith("https://"):
            raise SetupError("managed tool downloads require HTTPS")
        destination = target / f"{name}-{entry['version']}"
        marker = destination / ".verified-sha256"
        if not marker.exists() or marker.read_text() != entry["sha256"]:
            if destination.exists():
                raise SetupError(
                    f"incomplete managed {name} install; inspect {destination} before removing it"
                )
            with tempfile.TemporaryDirectory(dir=target) as tmp:
                archive = Path(tmp) / "archive"
                digest = hashlib.sha256()
                with (
                    # HTTPS and the reviewed digest are enforced before extraction.
                    urllib.request.urlopen(entry["url"], timeout=60) as response,  # nosec B310
                    archive.open("wb") as output,
                ):
                    while block := response.read(1024 * 1024):
                        output.write(block)
                        digest.update(block)
                if digest.hexdigest() != entry["sha256"]:
                    raise SetupError(f"checksum mismatch for {name}")
                unpacked = Path(tmp) / "unpacked"
                unpacked.mkdir()
                if entry.get("raw", False):
                    shutil.copyfile(archive, unpacked / name)
                elif entry["url"].endswith(".zip"):
                    with zipfile.ZipFile(archive) as zip_archive:
                        for info in zip_archive.infolist():
                            if (
                                not (unpacked / info.filename)
                                .resolve()
                                .is_relative_to(unpacked.resolve())
                            ):
                                raise SetupError("unsafe tool archive path")
                        zip_archive.extractall(unpacked)
                else:
                    with tarfile.open(archive) as tar_archive:
                        tar_archive.extractall(unpacked, filter="data")
                (unpacked / ".verified-sha256").write_text(entry["sha256"])
                unpacked.rename(destination)
        for binary, relative in entry["binaries"].items():
            source = destination / relative
            if not source.resolve().is_relative_to(destination.resolve()):
                raise SetupError("managed binary paths must stay inside the verified archive")
            if not source.is_file():
                raise SetupError(f"managed {name} archive lacks {binary}")
            source.chmod(source.stat().st_mode | 0o111)
            link = binary_dir / binary
            if link.is_symlink():
                link.unlink()
            elif link.exists():
                raise SetupError(f"refusing to replace unmanaged executable {link}")
            link.symlink_to(os.path.relpath(source, binary_dir))
    os.environ["PATH"] = str(binary_dir) + os.pathsep + os.environ.get("PATH", "")
    # This non-secret file is sourced by the environment's task-start command.
    import shlex

    (target / "env").write_text("export PATH=" + shlex.quote(str(binary_dir)) + ':"$PATH"\n')


def bootstrap(path, dry_run=False):
    data = manifest(path)
    for args in command_plan(data, path):
        print(json.dumps({"component": data["component"], "argv": args}), flush=True)
        if not dry_run:
            run(args, cwd=path)
            if args[:3] == ["uv", "python", "install"]:
                executable = Path(run(["uv", "python", "find", data["python"]], capture=True))
                binary_dir = ROOT / ".agent-tools" / "bin"
                binary_dir.mkdir(parents=True, exist_ok=True)
                binary = binary_dir / ("python" + ".".join(data["python"].split(".")[:2]))
                if binary.is_symlink():
                    binary.unlink()
                elif binary.exists():
                    raise SetupError("refusing to replace an unmanaged Python executable")
                binary.symlink_to(executable)
                os.environ["PATH"] = str(binary_dir) + os.pathsep + os.environ.get("PATH", "")


def check(path):
    data = manifest(path)
    missing = [name for name in data["tools"] if shutil.which(name) is None]
    if missing:
        raise SetupError(
            f"{data['component']}: missing tools: {', '.join(missing)}; see docs/cloud-agents.md"
        )
    # Configuration names are safe to report; values must never be printed.
    missing = [key for key in data.get("required_env", []) if not os.environ.get(key)]
    if missing:
        raise SetupError(f"{data['component']}: missing settings: {', '.join(missing)}")
    print(
        json.dumps(
            {"component": data["component"], "status": "local-ready", "live_verified": False}
        )
    )


def identity_token(audience):
    account = os.environ.get("SM_AGENT_IDENTITY", "")
    if not re.fullmatch(r"[a-z][a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com", account):
        raise SetupError("SM_AGENT_IDENTITY must be the dedicated profile service account")
    # Native OIDC connections can expose provider-scoped identity handles, not
    # portable OAuth tokens. Let the supported CLI mint the ID token instead of
    # exporting an access token and rebuilding its IAM request ourselves.
    token = run(
        [
            "gcloud",
            "auth",
            "print-identity-token",
            f"--impersonate-service-account={account}",
            f"--audiences={audience}",
            "--include-email",
        ],
        capture=True,
    )
    if not token:
        raise SetupError(
            "profile ID-token mint returned an empty token; verify the OIDC connection"
        )
    return token


def request(method, route, body=None):
    base = os.environ.get("SM_AGENT_DISPATCHER_URL", "").rstrip("/")
    if not re.fullmatch(r"https://[a-z0-9-]+\.(?:[a-z0-9-]+\.)?run\.app", base):
        raise SetupError("SM_AGENT_DISPATCHER_URL must be the provisioned HTTPS run.app origin")
    token = identity_token(os.environ.get("SM_AGENT_DISPATCHER_AUDIENCE", base))
    req = urllib.request.Request(
        base + route,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SetupError(
            f"dispatcher returned HTTP {error.code}; inspect operation status and server audit logs"
        ) from None
    except (TimeoutError, urllib.error.URLError):
        raise SetupError(
            "dispatcher outcome unknown; inspect status using the SAME request ID before retrying"
        ) from None


def paths(root, repos, overrides):
    if not (root / "stack.json").exists():
        if repos or overrides:
            raise SetupError(
                "standalone component setup takes no repository names or checkout overrides"
            )
        return [root]
    components = load(root / "stack.json")["components"]
    selected = repos or list(components)
    mapping = {}
    for item in overrides:
        name, sep, value = item.partition("=")
        if not sep or name not in components:
            raise SetupError("--checkout requires a known REPO=PATH")
        mapping[name] = Path(value).resolve()
    if any(name not in components for name in selected):
        raise SetupError("unknown component")
    return [mapping.get(name, root / name) for name in selected]


def initialize_components(root, repos, overrides, dry_run):
    if not (root / "stack.json").exists():
        return
    components = load(root / "stack.json")["components"]
    selected = repos or list(components)
    overridden = {item.partition("=")[0] for item in overrides}
    if any(name not in components for name in selected):
        raise SetupError("unknown component")
    missing = [
        name for name in selected if name not in overridden and not (root / name / ".git").exists()
    ]
    if missing:
        # Per-command HTTPS rewrite preserves provider credentials and avoids
        # copying SSH keys or changing global Git configuration. No recursion.
        command = [
            "git",
            "-c",
            "url.https://github.com/.insteadOf=git@github.com:",
            "submodule",
            "update",
            "--init",
            "--",
            *missing,
        ]
        print(json.dumps({"initialize": missing, "argv": command}), flush=True)
        if not dry_run:
            run(command, cwd=root)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("bootstrap", "check"):
        cmd = sub.add_parser(name)
        cmd.add_argument("profile", choices=PROFILES)
        cmd.add_argument("repos", nargs="*")
        cmd.add_argument("--checkout", action="append", default=[])
        if name == "bootstrap":
            cmd.add_argument("--dry-run", action="store_true")
            cmd.add_argument(
                "--install-tools",
                action="store_true",
                help="install pinned Linux binaries into .agent-tools",
            )
        else:
            cmd.add_argument(
                "--live", action="store_true", help="verify authenticated dispatcher capabilities"
            )
    action = sub.add_parser("action")
    action.add_argument("operation", help="component.environment.action, from the server catalog")
    action.add_argument("--request-id", default=None)
    action.add_argument("--reason", required=True)
    action.add_argument("--revision", default=None)
    action.add_argument(
        "--parameters", default="{}", help="JSON object of operation-specific inputs"
    )
    action.add_argument("--emergency", action="store_true")
    status = sub.add_parser("status")
    status.add_argument("request_id")
    sub.add_parser("catalog")
    read = sub.add_parser("read")
    read.add_argument("adapter")
    args = parser.parse_args(argv)
    try:
        if args.command in ("bootstrap", "check"):
            selected_paths = paths(ROOT, args.repos, args.checkout)
            tool_path = ROOT / ".agent-tools" / "bin"
            if tool_path.is_dir():
                os.environ["PATH"] = str(tool_path) + os.pathsep + os.environ.get("PATH", "")
            if args.command == "bootstrap" and args.install_tools:
                if args.dry_run:
                    print(json.dumps({"managed_tools": load(ROOT / ".agent-tools.json")}))
                else:
                    install_tools(ROOT)
            if args.command == "check":
                check_credentials(args.profile)
            else:
                initialize_components(ROOT, args.repos, args.checkout, args.dry_run)
            failed = []
            for path in selected_paths:
                try:
                    if args.command == "bootstrap":
                        bootstrap(path, args.dry_run)
                    else:
                        check(path)
                except (SetupError, OSError, ValueError, KeyError) as error:
                    failed.append(f"{path.name}: {error}")
            if failed:
                raise SetupError("; ".join(failed))
            if args.command == "check" and args.live:
                result = request("GET", "/v1/capabilities")
                if result["profile"] != args.profile:
                    raise SetupError("authenticated identity does not match requested profile")
                print(json.dumps(result))
        elif args.command == "catalog":
            print(json.dumps(request("GET", "/v1/capabilities"), indent=2))
        elif args.command == "read":
            if not re.fullmatch(r"[a-z0-9_-]+\.[a-z0-9-]+", args.adapter):
                raise SetupError("use a named adapter from catalog")
            print(json.dumps(request("GET", "/v1/reads/" + args.adapter), indent=2))
        elif args.command == "status":
            uuid.UUID(args.request_id)
            print(json.dumps(request("GET", f"/v1/operations/{args.request_id}"), indent=2))
        else:
            check_credentials("operator")
            request_id = str(uuid.UUID(args.request_id)) if args.request_id else str(uuid.uuid4())
            print(f"request_id={request_id}", flush=True)
            body = {
                "request_id": request_id,
                "operation": args.operation,
                "reason": args.reason,
                "revision": args.revision,
                "parameters": json.loads(args.parameters),
                "emergency": args.emergency,
            }
            print(json.dumps(request("POST", "/v1/operations", body), indent=2))
        return 0
    except (SetupError, OSError, ValueError, KeyError) as error:
        # Never echo provider error bodies, input payloads, or credential contents.
        print(
            f"agent-env: {error if isinstance(error, SetupError) else type(error).__name__}",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
