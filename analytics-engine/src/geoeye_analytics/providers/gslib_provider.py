from __future__ import annotations

import hashlib
import os
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

from .base import ProviderDescriptor, ProviderUnavailableError

GSLIB_PROGRAMS = frozenset(
    {
        "declus",
        "gam",
        "gamv",
        "kb2d",
        "kt3d",
        "nscore",
        "sgsim",
        "varmap",
        "vmodel",
    }
)


@dataclass(frozen=True)
class GslibExecution:
    program: str
    executable_path: str
    executable_sha256: str
    parameter_file: str
    return_code: int
    stdout: str
    stderr: str

    def to_dict(self) -> dict[str, str | int]:
        return asdict(self)


class GslibProvider:
    """Runs configured GSLIB executables without downloading or redistributing them."""

    provider_id = "gslib"

    def __init__(self, executable_directory: str | Path | None = None) -> None:
        self.executable_directory = (
            Path(executable_directory).expanduser() if executable_directory is not None else None
        )

    @classmethod
    def from_environment(cls) -> "GslibProvider":
        return cls(os.environ.get("GEOEYE_GSLIB_BIN"))

    def describe(self) -> ProviderDescriptor:
        if self.executable_directory is None:
            return ProviderDescriptor(
                provider_id="gslib",
                display_name="GSLIB",
                role="behavior-reference",
                availability="not-configured",
                detail="Set GEOEYE_GSLIB_BIN to an existing executable directory; binaries are not bundled.",
            )
        try:
            directory = self.executable_directory.resolve(strict=True)
        except FileNotFoundError:
            return ProviderDescriptor(
                provider_id="gslib",
                display_name="GSLIB",
                role="behavior-reference",
                availability="missing",
                detail=f"Configured executable directory does not exist: {self.executable_directory}",
            )
        if not directory.is_dir():
            return ProviderDescriptor(
                provider_id="gslib",
                display_name="GSLIB",
                role="behavior-reference",
                availability="missing",
                detail=f"Configured executable path is not a directory: {directory}",
            )
        available_programs = [name for name in sorted(GSLIB_PROGRAMS) if self._candidate(name).is_file()]
        return ProviderDescriptor(
            provider_id="gslib",
            display_name="GSLIB",
            role="behavior-reference",
            availability="available" if available_programs else "missing",
            detail=(
                f"Configured programs: {', '.join(available_programs)}"
                if available_programs
                else f"No allowlisted executables were found in {directory}"
            ),
        )

    def _candidate(self, program: str) -> Path:
        if self.executable_directory is None:
            raise ProviderUnavailableError("GSLIB is not configured; set GEOEYE_GSLIB_BIN")
        suffix = ".exe" if os.name == "nt" else ""
        return self.executable_directory / f"{program}{suffix}"

    def executable_for(self, program: str) -> Path:
        normalized = Path(program).name.lower()
        if normalized.endswith(".exe"):
            normalized = normalized[:-4]
        if normalized not in GSLIB_PROGRAMS or normalized != Path(program).stem.lower():
            supported = ", ".join(sorted(GSLIB_PROGRAMS))
            raise ValueError(f"Unsupported GSLIB program {program!r}; choose one of: {supported}")

        candidate = self._candidate(normalized).resolve(strict=True)
        configured_directory = self.executable_directory.resolve(strict=True)  # type: ignore[union-attr]
        if candidate.parent != configured_directory or not candidate.is_file():
            raise ProviderUnavailableError(f"Invalid GSLIB executable: {candidate}")
        return candidate

    def executable_provenance(self, program: str) -> tuple[Path, str]:
        executable = self.executable_for(program)
        digest = hashlib.sha256()
        with executable.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return executable, digest.hexdigest()

    def run(
        self,
        program: str,
        parameter_file: str | Path,
        workspace: str | Path,
        *,
        timeout_seconds: float = 300,
    ) -> GslibExecution:
        workspace_path = Path(workspace).resolve(strict=True)
        if not workspace_path.is_dir():
            raise ValueError(f"GSLIB workspace is not a directory: {workspace_path}")
        parameter_path = Path(parameter_file).resolve(strict=True)
        try:
            parameter_path.relative_to(workspace_path)
        except ValueError as error:
            raise ValueError("GSLIB parameter files must be inside the run workspace") from error
        if not parameter_path.is_file():
            raise ValueError(f"GSLIB parameter file is not a file: {parameter_path}")

        executable, executable_hash = self.executable_provenance(program)
        completed = subprocess.run(
            [str(executable), str(parameter_path)],
            cwd=workspace_path,
            capture_output=True,
            check=False,
            shell=False,
            text=True,
            timeout=timeout_seconds,
        )
        return GslibExecution(
            program=Path(program).stem.lower(),
            executable_path=str(executable),
            executable_sha256=executable_hash,
            parameter_file=str(parameter_path),
            return_code=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )

