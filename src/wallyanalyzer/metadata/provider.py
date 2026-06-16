from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Protocol

from wallyanalyzer.schemas.metadata import (
    AcquisitionRecord,
    CartridgeRecord,
    SystemRecord,
    TestTrackRecord,
)


class MetadataProvider(Protocol):
    def get_acquisition(self, file_stem: str) -> AcquisitionRecord:
        raise NotImplementedError

    def get_test_track(self, name: str) -> TestTrackRecord:
        raise NotImplementedError

    def get_cartridge(self, cartridge_name: str) -> Optional[CartridgeRecord]:
        raise NotImplementedError

    def get_system(self, system_id: float | int) -> Optional[SystemRecord]:
        raise NotImplementedError


@dataclass
class InMemoryMetadataProvider:
    acquisitions: Dict[str, AcquisitionRecord]
    test_tracks: Dict[str, TestTrackRecord]
    cartridges: Dict[str, CartridgeRecord] | None = None
    systems: Dict[float | int, SystemRecord] | None = None

    def get_acquisition(self, file_stem: str) -> AcquisitionRecord:
        key = file_stem.lower()
        for candidate, record in self.acquisitions.items():
            if candidate.lower() == key:
                return record
        raise KeyError(f"No acquisition record for file_stem={file_stem!r}")

    def get_test_track(self, name: str) -> TestTrackRecord:
        key = name.lower()
        for candidate, record in self.test_tracks.items():
            if candidate.lower() == key:
                return record
        raise KeyError(f"No test track record for name={name!r}")

    def get_cartridge(self, cartridge_name: str) -> Optional[CartridgeRecord]:
        if not self.cartridges:
            return None
        key = cartridge_name.lower()
        for candidate, record in self.cartridges.items():
            if candidate.lower() == key:
                return record
        return None

    def get_system(self, system_id: float | int) -> Optional[SystemRecord]:
        if not self.systems:
            return None
        return self.systems.get(system_id)


def load_metadata_provider_from_json_dir(directory: str | Path) -> InMemoryMetadataProvider:
    directory_path = Path(directory)
    acquisitions = _load_json_records(directory_path / "acquisitions.json")
    test_tracks = _load_json_records(directory_path / "test_tracks.json")
    cartridges = _load_json_records(directory_path / "cartridges.json", required=False)
    systems = _load_json_records(directory_path / "systems.json", required=False)

    return InMemoryMetadataProvider(
        acquisitions={record["file_stem"]: AcquisitionRecord(**record) for record in acquisitions},
        test_tracks={record["name"]: TestTrackRecord(**record) for record in test_tracks},
        cartridges=None
        if cartridges is None
        else {record["cartridge_name"]: CartridgeRecord(**record) for record in cartridges},
        systems=None
        if systems is None
        else {record["system_id"]: SystemRecord(**record) for record in systems},
    )


def _load_json_records(path: Path, required: bool = True) -> list[dict] | None:
    if not path.exists():
        if required:
            raise FileNotFoundError(f"Missing metadata fixture file: {path}")
        return None
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)
