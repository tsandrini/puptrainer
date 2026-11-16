"""Recordings on disk: verified, stored losslessly as FLAC, addressed by content."""

import hashlib
import io
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

MAX_DURATION_S = 30 * 60
FLOAT_SUBTYPES = frozenset({"FLOAT", "DOUBLE"})


class InvalidAudioError(ValueError):
    """The uploaded bytes are not a recording this app can store."""


@dataclass(frozen=True)
class AudioInfo:
    """What was stored.

    Attributes:
        sha256: Hash of the decoded samples with their format; the storage key.
        sample_rate: Samples per second, as recorded.
        channels: Number of channels, as recorded.
        duration_s: Length in seconds.
    """

    sha256: str
    sample_rate: int
    channels: int
    duration_s: float


class AudioStore:
    """Content-addressed FLAC files under one directory."""

    def __init__(self, root: Path) -> None:
        """Use `root`, created on first write."""
        self.root = root

    def path(self, sha256: str) -> Path:
        """Where the recording with this hash lives."""
        return self.root / sha256[:2] / f"{sha256}.flac"

    def ingest(self, data: bytes) -> AudioInfo:
        """Verify and store an uploaded WAV or FLAC file.

        The samples are kept as they are: no resampling, no normalising, no channel mixing.
        16-bit input stays 16-bit; everything else (24-bit, 32-bit, float) is stored as
        24-bit, the most FLAC holds. Float samples beyond full scale are clipped.

        Args:
            data: The file's bytes.

        Returns:
            The stored recording's key and format. Storing the same samples twice yields
            the same key and one file.

        Raises:
            InvalidAudioError: Not a readable audio file, empty, or longer than 30 minutes.
        """
        try:
            with sf.SoundFile(io.BytesIO(data)) as source:
                subtype = source.subtype
                sample_rate = source.samplerate
                channels = source.channels
                if subtype in FLOAT_SUBTYPES:
                    # NOTE: libsndfile truncates float data read as integers instead of scaling it
                    floats = source.read(dtype="float64", always_2d=True)
                    scaled = np.clip(np.rint(floats * 2**23), -(2**23), 2**23 - 1)
                    samples: np.ndarray = scaled.astype(np.int32) << 8
                else:
                    samples = np.asarray(source.read(dtype="int32", always_2d=True))
        except (sf.LibsndfileError, RuntimeError) as exc:
            raise InvalidAudioError("not a readable audio file (WAV or FLAC expected)") from exc
        frames = samples.shape[0]
        if frames == 0:
            raise InvalidAudioError("the recording is empty")
        duration = frames / sample_rate
        if duration > MAX_DURATION_S:
            raise InvalidAudioError("the recording is longer than 30 minutes")

        target = "PCM_16" if subtype in {"PCM_16", "PCM_S8", "PCM_U8"} else "PCM_24"
        if target == "PCM_24":
            # NOTE: keep exactly the 24 bits FLAC stores, so the hash matches the file
            samples = samples & np.int32(~0xFF)
        digest = hashlib.sha256()
        digest.update(f"{sample_rate}:{channels}:{target}:".encode())
        digest.update(np.ascontiguousarray(samples, dtype="<i4").tobytes())
        sha256 = digest.hexdigest()

        path = self.path(sha256)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix(".partial")
            sf.write(partial, samples, sample_rate, format="FLAC", subtype=target)
            os.replace(partial, path)
        return AudioInfo(sha256, sample_rate, channels, duration)

    def delete(self, sha256: str) -> None:
        """Remove a recording; missing files are fine."""
        self.path(sha256).unlink(missing_ok=True)
